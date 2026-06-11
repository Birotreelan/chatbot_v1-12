import { NextResponse } from "next/server"
import { getWhatsAppConfig } from "@/lib/db"

const PROXY_URL = "https://proxy.santiagovulliez.com/proxy_service/"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    if (!configId || !phoneNumber) {
      return NextResponse.json({ success: false, error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    // Obtener la configuración para extraer el clienteId
    const config = await getWhatsAppConfig(configId)
    if (!config) {
      return NextResponse.json({ success: false, error: "Configuracion no encontrada" }, { status: 404 })
    }

    const clienteId = config.cliente_id
    if (!clienteId) {
      return NextResponse.json({
        success: true,
        patient: null,
        isNewPatient: true,
        phoneNumber,
        message: "Esta configuracion no tiene Cliente_Id asignado",
      })
    }

    // Normalizar el numero de telefono para la busqueda
    let telefonoNormalizado = phoneNumber.replace(/\D/g, "")
    if (telefonoNormalizado.startsWith("549")) {
      telefonoNormalizado = telefonoNormalizado.substring(3)
    } else if (telefonoNormalizado.startsWith("54")) {
      telefonoNormalizado = telefonoNormalizado.substring(2)
    }

    console.log(
      `[DASHBOARD_PATIENT] Buscando paciente con telefono: ${telefonoNormalizado} (original: ${phoneNumber}) para cliente: ${clienteId}`,
    )

    const proxyResponse = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Cliente_Id: clienteId,
        Action: "get_paciente_interfaz",
        telefono: telefonoNormalizado,
      }),
    })

    if (!proxyResponse.ok) {
      console.error(`[DASHBOARD_PATIENT] Error del proxy: ${proxyResponse.status} ${proxyResponse.statusText}`)
      return NextResponse.json({
        success: true,
        patient: null,
        isNewPatient: true,
        phoneNumber,
        message: "Error al consultar datos del paciente",
      })
    }

    const resultado = await proxyResponse.json()
    console.log(`[DASHBOARD_PATIENT] Respuesta del proxy:`, JSON.stringify(resultado, null, 2))

    const pacienteRaw = resultado.paciente || resultado.datos || resultado.data || resultado
    const turnosProximos = resultado.turnos_proximos || resultado.turnosProximos || resultado.turnos || []
    const esPrimeraVez = resultado.es_primera_vez ?? resultado.esPrimeraVez ?? null

    const tieneDatasPaciente =
      pacienteRaw &&
      (pacienteRaw.nombre ||
        pacienteRaw.Nombres ||
        pacienteRaw.nombre_completo ||
        pacienteRaw.Nombre_Completo ||
        pacienteRaw.dni ||
        pacienteRaw.Nrodoc ||
        pacienteRaw.documento ||
        pacienteRaw.id ||
        pacienteRaw.Id)

    if (!tieneDatasPaciente) {
      console.log(`[DASHBOARD_PATIENT] Paciente no encontrado para telefono: ${telefonoNormalizado}`)
      return NextResponse.json({
        success: true,
        patient: null,
        isNewPatient: true,
        phoneNumber,
      })
    }

    const paciente = {
      id: pacienteRaw.Id || pacienteRaw.id,
      nombre: pacienteRaw.Nombres || pacienteRaw.nombre,
      apellido: pacienteRaw.Apellido || pacienteRaw.apellido,
      nombre_completo:
        pacienteRaw.Nombre_Completo ||
        pacienteRaw.nombre_completo ||
        `${pacienteRaw.Nombres || pacienteRaw.nombre || ""} ${pacienteRaw.Apellido || pacienteRaw.apellido || ""}`.trim(),
      dni: pacienteRaw.Nrodoc || pacienteRaw.dni || pacienteRaw.documento,
      telefono: pacienteRaw.Celular || pacienteRaw.celular || pacienteRaw.telefono || phoneNumber,
      email: pacienteRaw.Mail || pacienteRaw.mail || pacienteRaw.email,
      fecha_nacimiento: pacienteRaw.Fecha_Nac || pacienteRaw.fecha_nacimiento,
      obra_social: pacienteRaw.Deudor_Nombre || pacienteRaw.obra_social,
      plan: pacienteRaw.Plan_Nombre || pacienteRaw.plan,
      nro_afiliado: pacienteRaw.Nro_Afiliado_Ppal || pacienteRaw.nro_afiliado,
      url_paciente: pacienteRaw.url_paciente || null,
    }

    const turnosNormalizados = turnosProximos.map((turno: any) => ({
      id: turno.Id || turno.id,
      fecha: turno.Fecha || turno.fecha,
      hora: (turno.Hora || turno.hora || "").substring(0, 5),
      profesional: turno.Profesional_Nombre || turno.profesional || turno.profesional_nombre,
      sede: turno.Centro_Nombre || turno.sede || turno.centro_nombre,
      motivo: turno.Motivo_Nombre || turno.motivo || turno.motivo_nombre,
      estado: turno.Estado || turno.estado,
      url_agenda: turno.url_agenda || null,
    }))

    return NextResponse.json({
      success: true,
      patient: paciente,
      upcomingAppointments: turnosNormalizados,
      isNewPatient: esPrimeraVez ?? false,
      phoneNumber,
    })
  } catch (error) {
    console.error("[DASHBOARD_PATIENT] Error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 },
    )
  }
}
