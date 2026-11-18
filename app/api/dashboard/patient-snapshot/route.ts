import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getPatientSnapshot } from "@/lib/conversations"

// Devuelve el snapshot de paciente (HC, Nrodoc, Celular, Apellido, Nombre) ya guardado
// en Redis por una consulta previa a get_paciente. No llama a la
// API de la clínica — es solo para autocompletar la UI al instante mientras carga.
/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Datos personales del paciente: documento, obra social, historia clínica.
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

    const snapshot = await getPatientSnapshot(configId, phoneNumber)

    return NextResponse.json({ success: true, snapshot })
  } catch (error) {
    console.error("[DASHBOARD_PATIENT_SNAPSHOT] Error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 },
    )
  }
}

export const dynamic = "force-dynamic"
