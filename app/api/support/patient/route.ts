import { NextResponse } from "next/server"
import { requireSupportAgent } from "@/lib/auth"
import { getSupportSession } from "@/lib/human-support"

const PROXY_URL = "https://proxy.santiagovulliez.com/proxy_service/"

export async function GET(request: Request) {
  try {
    // Verificar autenticacion
    const session = await requireSupportAgent()
    if (!session) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
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

    // Llamar al proxy para obtener datos del paciente
    const proxyResponse = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Cliente_Id: clienteId,
        Action: "get_paciente",
        telefono: telefonoNormalizado,
      }),
    })

    if (!proxyResponse.ok) {
      console.error(`[SUPPORT_PATIENT] Error del proxy: ${proxyResponse.status} ${proxyResponse.statusText}`)
      return NextResponse.json({
        success: true,
        patient: null,
        isNewPatient: true,
        phoneNumber: phoneNumber,
        message: "Error al consultar datos del paciente",
      })
    }

    const resultado = await proxyResponse.json()
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
    }

    console.log(`[SUPPORT_PATIENT] Paciente encontrado:`, paciente)

    // Formatear la respuesta
    return NextResponse.json({
      success: true,
      patient: paciente,
      upcomingAppointments: turnosProximos,
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
