import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getConversationContacts, getPatientSnapshots } from "@/lib/conversations"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Conversaciones de pacientes: teléfonos, nombres y contenido clínico.
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
    // Sin esto, con un configId y un teléfono se leía la conversación de
    // cualquier paciente. Ver lib/conversations-auth.ts.
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

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
