/**
 * La ficha del paciente para el Monitor de Conversaciones.
 *
 * ── Dos arreglos, el 27/10/2026 ────────────────────────────────────────────
 *
 * Acá había una URL de proxy escrita a mano
 * ("https://proxy.santiagovulliez.com/proxy_service/"). El sistema es
 * multi-cliente y cada clínica tiene el suyo, así que el Monitor le preguntaba
 * por los pacientes de TODAS a un solo proxy: para las demás mostraba
 * "paciente nuevo" aunque la persona tuviera veinte turnos. Es el mismo error
 * que se corrigió en /api/support/patient el 15/9 y que esta copia no recibió.
 *
 * Y pedía `get_paciente_interfaz`, una acción que no existe del lado de las
 * clínicas.
 *
 * Las dos cosas se arreglaron sacando el código de acá: ahora la consulta vive
 * en lib/paciente-del-panel.ts, que es también de donde la toma el panel de
 * atención. Ver la cabecera de ese archivo.
 */

import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"

import { getWhatsAppConfig } from "@/lib/db"
import { savePatientSnapshot } from "@/lib/conversations"
import { consultarPacienteDelPanel, snapshotDelPaciente } from "@/lib/paciente-del-panel"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Datos personales del paciente traídos del sistema de la clínica.
 *
 * Se protegen sólo las lecturas críticas —credenciales, conversaciones de
 * pacientes, datos personales y comerciales—. Las estadísticas agregadas
 * quedan abiertas a propósito: no identifican a nadie.
 *
 * La consumen pantallas del dashboard desde el navegador, que mandan la
 * cookie de sesión sola: no hubo que tocar ningún `fetch`.
 */
export async function GET(request: Request) {
  // Lectura crítica: exige sesión. Ver la nota de arriba.
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }

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

    const consulta = await consultarPacienteDelPanel({
      clienteId,
      phoneNumber,
      origen: "DASHBOARD_PATIENT",
    })

    // No pudimos preguntar: se dice, en vez de hacerlo pasar por paciente
    // nuevo. "Es la primera vez que escribe" y "no pudimos consultar" llevan a
    // decisiones distintas del agente.
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
    void savePatientSnapshot(configId, phoneNumber, snapshotDelPaciente(consulta.paciente))

    return NextResponse.json({
      success: true,
      patient: consulta.paciente,
      upcomingAppointments: consulta.turnos,
      isNewPatient: consulta.esPrimeraVez ?? false,
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
