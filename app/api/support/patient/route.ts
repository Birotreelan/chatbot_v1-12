/**
 * La ficha del paciente para el panel de atención.
 *
 * ── Qué pasó acá ───────────────────────────────────────────────────────────
 *
 * 15/9/2026: había una URL de proxy FIJA y el proxy respondía con el cuerpo
 * vacío — de ahí el "Unexpected end of JSON input" que veía el agente. Se pasó
 * a `resolveProxyUrl`, que lee el proxy de cada clínica.
 *
 * 27/10/2026: se sacó el intento previo a `get_paciente_interfaz`. Esa acción
 * era nuestra y no existe en el backend de las clínicas, así que cada consulta
 * eran dos pedidos —el primero condenado a fallar— y del otro lado quedaban
 * registrados como intentos de usar una acción desconocida.
 *
 * Y la consulta se mudó a lib/paciente-del-panel.ts, compartida con el Monitor
 * de Conversaciones: las dos rutas tenían el mismo mapeo copiado, y el arreglo
 * de la URL fija se había aplicado sólo en ésta. Ver la cabecera de ese
 * archivo.
 */

import { NextResponse } from "next/server"

import { requireSupportAgentFromRequest } from "@/lib/auth"
import { getSupportSession } from "@/lib/human-support"
import { savePatientSnapshot } from "@/lib/conversations"
import { consultarPacienteDelPanel, snapshotDelPaciente } from "@/lib/paciente-del-panel"

export async function GET(request: Request) {
  try {
    // Verificar autenticacion (con soporte para Safari/iframe)
    const { session, error } = await requireSupportAgentFromRequest(request)
    if (!session) {
      return NextResponse.json({ success: false, error: error || "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("sessionId")

    if (!sessionId) {
      return NextResponse.json({ success: false, error: "sessionId requerido" }, { status: 400 })
    }

    // La sesión de soporte da el teléfono y el tenant
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

    const consulta = await consultarPacienteDelPanel({
      clienteId,
      phoneNumber,
      origen: "SUPPORT_PATIENT",
    })

    // No pudimos preguntar: se dice. Para el agente no es lo mismo "es la
    // primera vez que escribe" que "no pudimos consultar la ficha".
    if (consulta.estado === "sin-datos") {
      return NextResponse.json({
        success: true,
        patient: null,
        isNewPatient: false,
        datosNoDisponibles: true,
        phoneNumber,
        message: consulta.motivo,
      })
    }

    if (consulta.estado === "sin-ficha") {
      return NextResponse.json({ success: true, patient: null, isNewPatient: true, phoneNumber })
    }

    // Snapshot liviano para poder filtrar contactos en el panel de soporte.
    void savePatientSnapshot(supportSession.configId, phoneNumber, snapshotDelPaciente(consulta.paciente))

    return NextResponse.json({
      success: true,
      patient: consulta.paciente,
      upcomingAppointments: consulta.turnos,
      isNewPatient: consulta.esPrimeraVez ?? false,
      phoneNumber,
    })
  } catch (error) {
    console.error("[SUPPORT_PATIENT] Error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 },
    )
  }
}
