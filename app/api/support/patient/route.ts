import { NextResponse } from "next/server"
import { requireSupportAgentFromRequest } from "@/lib/auth"
import { getSupportSession } from "@/lib/human-support"
import { savePatientSnapshot } from "@/lib/conversations"

/**
 * 15/9/2026: acá había una URL de proxy FIJA
 * ("https://proxy.santiagovulliez.com/proxy_service/"), y el proxy respondía con
 * el cuerpo vacío — de ahí el "Unexpected end of JSON input" que veía el agente.
 *
 * El sistema es multi-cliente y cada clínica tiene su propio proxy (Salud Ocular
 * usa saludocular.com.ar/treelan/proxy/, otras usan
 * api.santiagovulliez.com/bridge_proxy.php). Reemplazar un literal por otro
 * arreglaría una clínica y rompería las demás, así que se usa `resolveProxyUrl`,
 * que ya es la fuente de verdad del resto del sistema: lee el campo "proxy" de
 * la config de cada cliente y cae a la env var global si todavía no lo cargaron.
 *
 * Sobre la acción: `get_paciente_interfaz` es la variante para agentes, que
 * suma los enlaces al sistema de la clínica (url_paciente / url_agenda). No
 * todos los proxies la implementan, así que si no devuelve nada se reintenta con
 * `get_paciente` — la acción estándar, que sabemos que funciona en los proxies
 * por clínica. Se pierden los enlaces, pero el agente ve los datos del paciente,
 * que es lo que necesita para atender.
 */
import { resolveProxyUrl } from "@/lib/proxy-url-resolver"

interface RespuestaProxy {
  datos: any | null
  /** Qué falló, para poder decírselo al agente en vez de un error genérico. */
  motivo?: string
}

async function consultarPaciente(
  proxyUrl: string,
  clienteId: string,
  telefono: string,
  accion: string,
): Promise<RespuestaProxy> {
  const respuesta = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Cliente_Id: clienteId, Action: accion, telefono }),
  })

  if (!respuesta.ok) {
    console.error(`[SUPPORT_PATIENT] ${accion} → HTTP ${respuesta.status} en ${proxyUrl}`)
    return { datos: null, motivo: `El sistema de la clínica respondió con un error (${respuesta.status}).` }
  }

  // Leer como texto y parsear con red: el proxy puede responder 200 con el
  // cuerpo vacío, y `.json()` ahí explota con "Unexpected end of JSON input".
  const crudo = await respuesta.text()
  if (!crudo || !crudo.trim()) {
    console.error(`[SUPPORT_PATIENT] ${accion} → 200 con cuerpo vacío en ${proxyUrl}`)
    return { datos: null, motivo: "El sistema de la clínica no devolvió datos." }
  }

  try {
    return { datos: JSON.parse(crudo) }
  } catch {
    console.error(`[SUPPORT_PATIENT] ${accion} → respuesta no es JSON:`, crudo.substring(0, 200))
    return { datos: null, motivo: "El sistema de la clínica devolvió una respuesta que no pudimos interpretar." }
  }
}

export async function GET(request: Request) {
  try {
    // Verificar autenticacion (con soporte para Safari/iframe)
    const { session, error } = await requireSupportAgentFromRequest(request)
    if (!session) {
      return NextResponse.json({ success: false, error: error || "No autorizado" }, { status: 401 })
    }

    // Obtener sessionId del query string
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("sessionId")

    if (!sessionId) {
      return NextResponse.json({ success: false, error: "sessionId requerido" }, { status: 400 })
    }

    // Obtener la sesion de soporte para extraer el telefono y tenantId
    const supportSession = await getSupportSession(sessionId)
    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesion no encontrada" }, { status: 404 })
    }

    // Verificar que el agente tiene permiso para ver esta sesion
    if (session.tenantId && session.tenantId !== supportSession.tenantId) {
      return NextResponse.json({ success: false, error: "Sin permiso para esta sesion" }, { status: 403 })
    }

    const phoneNumber = supportSession.phoneNumber
    const clienteId = supportSession.tenantId

    if (!phoneNumber || !clienteId) {
      return NextResponse.json({
        success: true,
        patient: null,
        isNewPatient: true,
        message: "Datos insuficientes para buscar paciente",
      })
    }

    // Normalizar el numero de telefono para la busqueda
    // Remover el prefijo "549" de WhatsApp si existe y formatear
    let telefonoNormalizado = phoneNumber.replace(/\D/g, "") // Remover no-digitos
    
    // Si empieza con 549 (codigo Argentina WhatsApp), intentar extraer el numero local
    if (telefonoNormalizado.startsWith("549")) {
      telefonoNormalizado = telefonoNormalizado.substring(3) // Remover "549"
    } else if (telefonoNormalizado.startsWith("54")) {
      telefonoNormalizado = telefonoNormalizado.substring(2) // Remover "54"
    }

    console.log(`[SUPPORT_PATIENT] Buscando paciente con telefono: ${telefonoNormalizado} (original: ${phoneNumber}) para cliente: ${clienteId}`)

    // Proxy propio de esta clínica, no uno fijo para todas.
    const proxyUrl = await resolveProxyUrl(clienteId)
    console.log(`[SUPPORT_PATIENT] Proxy resuelto para ${clienteId}: ${proxyUrl}`)

    // Primero la variante para agentes (trae los enlaces al sistema de la
    // clínica); si ese proxy no la implementa, la acción estándar.
    let consulta = await consultarPaciente(proxyUrl, clienteId, telefonoNormalizado, "get_paciente_interfaz")

    if (!consulta.datos) {
      console.warn(`[SUPPORT_PATIENT] get_paciente_interfaz no devolvió datos — reintentando con get_paciente`)
      consulta = await consultarPaciente(proxyUrl, clienteId, telefonoNormalizado, "get_paciente")
    }

    if (!consulta.datos) {
      return NextResponse.json({
        success: true,
        patient: null,
        isNewPatient: false,
        datosNoDisponibles: true,
        phoneNumber: phoneNumber,
        message: consulta.motivo || "No pudimos consultar el sistema de la clínica.",
      })
    }

    const resultado = consulta.datos

    console.log(`[SUPPORT_PATIENT] Respuesta del proxy:`, JSON.stringify(resultado, null, 2))

    // Verificar si se encontro el paciente
    // La respuesta puede variar, verificamos diferentes estructuras posibles
    const pacienteRaw = resultado.paciente || resultado.datos || resultado.data || resultado
    const turnosProximos = resultado.turnos_proximos || resultado.turnosProximos || resultado.turnos || []
    const esPrimeraVez = resultado.es_primera_vez ?? resultado.esPrimeraVez ?? null

    // Si no hay datos significativos del paciente, es paciente nuevo
    // Verificamos campos en diferentes formatos (mayusculas/minusculas)
    const tieneDatasPaciente = pacienteRaw && (
      pacienteRaw.nombre || 
      pacienteRaw.Nombres ||
      pacienteRaw.nombre_completo || 
      pacienteRaw.Nombre_Completo ||
      pacienteRaw.dni || 
      pacienteRaw.Nrodoc ||
      pacienteRaw.documento ||
      pacienteRaw.id ||
      pacienteRaw.Id
    )

    if (!tieneDatasPaciente) {
      console.log(`[SUPPORT_PATIENT] Paciente no encontrado para telefono: ${telefonoNormalizado}`)
      return NextResponse.json({
        success: true,
        patient: null,
        isNewPatient: true,
        phoneNumber: phoneNumber,
      })
    }

    // Normalizar los campos del paciente a un formato consistente
    const paciente = {
      id: pacienteRaw.Id || pacienteRaw.id,
      nombre: pacienteRaw.Nombres || pacienteRaw.nombre,
      apellido: pacienteRaw.Apellido || pacienteRaw.apellido,
      nombre_completo: pacienteRaw.Nombre_Completo || pacienteRaw.nombre_completo || 
        `${pacienteRaw.Nombres || pacienteRaw.nombre || ''} ${pacienteRaw.Apellido || pacienteRaw.apellido || ''}`.trim(),
      dni: pacienteRaw.Nrodoc || pacienteRaw.dni || pacienteRaw.documento,
      telefono: pacienteRaw.Celular || pacienteRaw.celular || pacienteRaw.telefono || phoneNumber,
      email: pacienteRaw.Mail || pacienteRaw.mail || pacienteRaw.email,
      fecha_nacimiento: pacienteRaw.Fecha_Nac || pacienteRaw.fecha_nacimiento,
      obra_social: pacienteRaw.Deudor_Nombre || pacienteRaw.obra_social,
      plan: pacienteRaw.Plan_Nombre || pacienteRaw.plan,
      nro_afiliado: pacienteRaw.Nro_Afiliado_Ppal || pacienteRaw.nro_afiliado,
      hc: pacienteRaw.HC || pacienteRaw.hc || null,
      url_paciente: pacienteRaw.url_paciente || null,
    }

    console.log(`[SUPPORT_PATIENT] Paciente encontrado:`, paciente)

    // Guardar snapshot liviano para poder filtrar contactos en el panel de soporte
    void savePatientSnapshot(supportSession.configId, phoneNumber, {
      hc: paciente.hc ? String(paciente.hc).trim() : undefined,
      nrodoc: paciente.dni ? String(paciente.dni).trim() : undefined,
      celular: paciente.telefono ? String(paciente.telefono).trim() : undefined,
      apellido: paciente.apellido ? String(paciente.apellido).trim() : undefined,
      nombre: paciente.nombre ? String(paciente.nombre).trim() : undefined,
    })

    // Normalizar turnos proximos
    const turnosNormalizados = turnosProximos.map((turno: any) => ({
      id: turno.Id || turno.id,
      fecha: turno.Fecha || turno.fecha,
      hora: (turno.Hora || turno.hora || "").substring(0, 5), // "09:00:00" -> "09:00"
      profesional: turno.Profesional_Nombre || turno.profesional || turno.profesional_nombre,
      sede: turno.Centro_Nombre || turno.sede || turno.centro_nombre,
      motivo: turno.Motivo_Nombre || turno.motivo || turno.motivo_nombre,
      estado: turno.Estado || turno.estado,
      url_agenda: turno.url_agenda || null,
    }))

    // Formatear la respuesta
    return NextResponse.json({
      success: true,
      patient: paciente,
      upcomingAppointments: turnosNormalizados,
      isNewPatient: esPrimeraVez ?? false,
      phoneNumber: phoneNumber,
    })
  } catch (error) {
    console.error("[SUPPORT_PATIENT] Error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    )
  }
}
