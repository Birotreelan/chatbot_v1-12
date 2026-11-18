import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getAllConversationMessages } from "@/lib/conversations"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Exporta las conversaciones enteras de una clínica a CSV.
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
    const phoneNumbersParam = searchParams.get("phoneNumbers")

    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    if (!phoneNumbersParam) {
      return NextResponse.json({ error: "No hay contactos para exportar" }, { status: 400 })
    }

    console.log(`[API] Exportando conversaciones para configId: ${configId}`)

    const phoneNumbers = phoneNumbersParam.split(",").filter(Boolean)

    if (phoneNumbers.length === 0) {
      return NextResponse.json({ error: "No hay conversaciones para exportar" }, { status: 404 })
    }

    const allMessages = []
    for (const phoneNumber of phoneNumbers) {
      // Export usa getAllConversationMessages para obtener todo el historial
      const messages = await getAllConversationMessages(configId, phoneNumber)
      allMessages.push(...messages)
    }

    // Ordenar por timestamp
    allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // Generar CSV
    const csvRows = [
      // Header
      ["Fecha", "Hora", "Número de Teléfono", "Rol", "Mensaje", "Tipo de Mensaje"].join(","),
    ]

    for (const message of allMessages) {
      const date = new Date(message.timestamp)
      const dateStr = date.toLocaleDateString("es-ES")
      const timeStr = date.toLocaleTimeString("es-ES")
      const role = message.role === "user" ? "Usuario" : message.role === "assistant" ? "Asistente" : "Sistema"
      const content = `"${message.content.replace(/"/g, '""')}"` // Escapar comillas
      const messageType = message.messageType || "text"

      csvRows.push([dateStr, timeStr, message.phoneNumber, role, content, messageType].join(","))
    }

    const csvContent = csvRows.join("\n")

    // Retornar CSV con headers apropiados
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="conversaciones_${configId}_${new Date().toISOString().split("T")[0]}.csv"`,
      },
    })
  } catch (error) {
    console.error("[API] Error exportando conversaciones:", error)
    return NextResponse.json({ error: "Error exportando conversaciones" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
