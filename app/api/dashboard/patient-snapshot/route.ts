import { NextResponse } from "next/server"
import { getPatientSnapshot } from "@/lib/conversations"

// Devuelve el snapshot de paciente (HC, Nrodoc, Celular, Apellido, Nombre) ya guardado
// en Redis por una consulta previa a get_paciente / get_paciente_interfaz. No llama a la
// API de la clínica — es solo para autocompletar la UI al instante mientras carga.
export async function GET(request: Request) {
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
