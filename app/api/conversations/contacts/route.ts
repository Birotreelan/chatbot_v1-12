import { NextResponse } from "next/server"
import { getConversationContacts, getPatientSnapshots } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const dateFrom = searchParams.get("dateFrom")
    const dateTo = searchParams.get("dateTo")

    console.log("[API] GET /api/conversations/contacts - configId:", configId)
    console.log("[API] Date filters - from:", dateFrom, "to:", dateTo)

    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    const contacts = await getConversationContacts(configId, dateFrom || undefined, dateTo || undefined)

    // Mergear datos de paciente (HC, Nrodoc, Celular, Apellido, Nombre) ya guardados
    // por consultas previas a get_paciente, para mostrar/filtrar en el monitor.
    let patientMap: Map<string, { hc?: string; nrodoc?: string; celular?: string; apellido?: string; nombre?: string }> = new Map()
    try {
      patientMap = await getPatientSnapshots(
        configId,
        contacts.map((c) => c.phoneNumber),
      )
    } catch {
      // ignorar — patientMap queda vacío
    }

    const contactsWithPatient = contacts.map((contact) => {
      const patient = patientMap.get(contact.phoneNumber)
      return {
        ...contact,
        hc: patient?.hc,
        nrodoc: patient?.nrodoc,
        celular: patient?.celular,
        apellido: patient?.apellido,
        nombre: patient?.nombre,
      }
    })

    console.log("[API] Contacts fetched:", contactsWithPatient.length)

    return NextResponse.json({ contacts: contactsWithPatient })
  } catch (error) {
    console.error("[API] Error obteniendo contactos:", error)
    return NextResponse.json({ error: "Error obteniendo contactos" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
