import { NextResponse } from "next/server"
import { requireSupportAgent } from "@/lib/auth"
import { getSupportSession } from "@/lib/human-support"
import { buscarPaciente } from "@/lib/api-tools/api-functions"

export async function GET(request: Request) {
  try {
    // Verificar autenticación
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

    // Obtener la sesión de soporte para extraer el teléfono y tenantId
    const supportSession = await getSupportSession(sessionId)
    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    // Verificar que el agente tiene permiso para ver esta sesión
    if (session.tenantId && session.tenantId !== supportSession.tenantId) {
      return NextResponse.json({ success: false, error: "Sin permiso para esta sesión" }, { status: 403 })
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

    // Normalizar el número de teléfono para la búsqueda
    // Remover el prefijo "549" de WhatsApp si existe y formatear
    let telefonoNormalizado = phoneNumber.replace(/\D/g, "") // Remover no-dígitos
    
    // Si empieza con 549 (código Argentina WhatsApp), intentar extraer el número local
    if (telefonoNormalizado.startsWith("549")) {
      telefonoNormalizado = telefonoNormalizado.substring(3) // Remover "549"
    } else if (telefonoNormalizado.startsWith("54")) {
      telefonoNormalizado = telefonoNormalizado.substring(2) // Remover "54"
    }

    console.log(`[SUPPORT_PATIENT] Buscando paciente con teléfono: ${telefonoNormalizado} (original: ${phoneNumber}) para cliente: ${clienteId}`)

    // Buscar paciente por teléfono
    const resultado = await buscarPaciente(clienteId, { telefono: telefonoNormalizado }, false)

    if (!resultado.exito || !resultado.datos) {
      console.log(`[SUPPORT_PATIENT] Paciente no encontrado para teléfono: ${telefonoNormalizado}`)
      return NextResponse.json({
        success: true,
        patient: null,
        isNewPatient: true,
        phoneNumber: phoneNumber,
      })
    }

    console.log(`[SUPPORT_PATIENT] Paciente encontrado:`, resultado.datos)

    // Formatear la respuesta
    return NextResponse.json({
      success: true,
      patient: resultado.datos,
      upcomingAppointments: resultado.turnosProximos || [],
      isNewPatient: resultado.esPrimeraVez ?? false,
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
