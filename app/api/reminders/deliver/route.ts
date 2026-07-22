import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneIdFresh, getAllWhatsAppConfigs } from "@/lib/db"
import { normalizePhoneNumber } from "@/lib/utils"
import { sendReminderTemplate } from "@/lib/reminders/send-reminder-template"
import { removeReminderFromQueue } from "@/lib/reminders/reminder-queue"
import { getAppointmentContext } from "@/lib/appointment-flow-state"
import { logger } from "@/lib/logger"

/**
 * app/api/reminders/deliver/route.ts
 *
 * Destino de los recordatorios de reintento (24h / segundo / último) que
 * app/api/proxylistener/route.ts programa en QStash con notBefore. QStash
 * llama a esta ruta exactamente en el horario calculado.
 */

export const maxDuration = 60

interface DeliverReminderPayload {
  Cliente_Id?: string
  Phone_Number_Id?: string
  Phone: string
  Body: any
  Chatbot_Data?: any
  Sede_Id?: string
  kind: "segundo" | "24h" | "ultimo"
  configId: string
  agendaId?: string
}

async function deliverReminder(req: Request): Promise<NextResponse> {
  try {
    const payload = (await req.json()) as DeliverReminderPayload
    const messageId = req.headers.get("upstash-message-id") || ""

    const { Cliente_Id, Phone_Number_Id, Phone, Body, Chatbot_Data, Sede_Id, kind, configId, agendaId } = payload

    if (!Phone || !Body || !configId) {
      logger.error("REMINDERS-DELIVER", "Payload incompleto, se descarta el recordatorio", payload as any)
      return NextResponse.json({ success: false, error: "Payload incompleto" }, { status: 400 })
    }

    const destinationPhone = Phone.startsWith("+") ? Phone : `+${Phone}`
    const cleanPhoneNumber = normalizePhoneNumber(destinationPhone)

    // Config fresca: puede haber cambiado (token rotado, desactivada) entre el
    // momento en que se programó el recordatorio (hasta 72hs antes) y ahora.
    let config = Phone_Number_Id ? await getWhatsAppConfigByPhoneIdFresh(Phone_Number_Id) : null
    if (!config && Cliente_Id) {
      const allConfigs = await getAllWhatsAppConfigs()
      config = allConfigs.find((c) => c.cliente_id === Cliente_Id && c.active) || null
    }

    if (!config || !config.active) {
      logger.warn("REMINDERS-DELIVER", `Config no encontrada o inactiva, se descarta recordatorio "${kind}"`, {
        configId,
        Cliente_Id,
      })
      if (messageId) await removeReminderFromQueue(configId, cleanPhoneNumber, messageId)
      return NextResponse.json({ success: false, error: "Config no disponible" })
    }

    // Chequeo de vigencia: si el turno ya no está activo (cancelado / cambiado
    // de agenda_id) desde que se programó este recordatorio, no se envía. Es
    // la red de seguridad extra ante una carrera con la cancelación que
    // dispara lib/whatsapp.tsx al recibir CUALQUIER respuesta del paciente
    // (el mecanismo principal es cancelar el mensaje en QStash directamente,
    // esto cubre el caso de que ya estuviera en vuelo).
    if (agendaId) {
      const contextoActual = await getAppointmentContext(cleanPhoneNumber, config.id)
      const turnoVigente = contextoActual?.turnos?.some((t) => t.agenda_id === agendaId)

      if (!turnoVigente) {
        logger.info("REMINDERS-DELIVER", `Turno ${agendaId} ya no vigente, se omite recordatorio "${kind}"`, {
          phone: cleanPhoneNumber,
        })
        if (messageId) await removeReminderFromQueue(configId, cleanPhoneNumber, messageId)
        return NextResponse.json({ success: true, skipped: true, reason: "turno_no_vigente" })
      }
    }

    const whatsappResponse = await sendReminderTemplate({
      config,
      destinationPhone,
      cleanPhoneNumber,
      Body,
      Chatbot_Data,
      Sede_Id,
    })

    if (messageId) {
      await removeReminderFromQueue(configId, cleanPhoneNumber, messageId)
    }

    logger.info("REMINDERS-DELIVER", `Recordatorio "${kind}" entregado a ${cleanPhoneNumber}`)
    return NextResponse.json({ success: true, whatsappResponse })
  } catch (error) {
    logger.error("REMINDERS-DELIVER", "Error entregando recordatorio", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}

function isQStashConfigured() {
  return !!(process.env.QSTASH_TOKEN && process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
}

export async function POST(req: Request) {
  if (isQStashConfigured() && process.env.VERCEL_ENV === "production") {
    try {
      const { verifySignature } = await import("@upstash/qstash/nextjs")
      const signature = req.headers.get("upstash-signature")
      const timestamp = req.headers.get("upstash-timestamp")

      if (!signature || !timestamp) {
        logger.debug("REMINDERS-DELIVER", "Sin headers QStash, procesando sin verificación")
        return deliverReminder(req)
      }

      const body = await req.text()
      const isValid = await verifySignature({
        signature,
        body,
        timestamp,
        signingKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
      })

      if (!isValid) {
        logger.error("REMINDERS-DELIVER", "Firma QStash inválida")
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }

      const newReq = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: body,
      })

      return deliverReminder(newReq)
    } catch (error) {
      logger.warn("REMINDERS-DELIVER", "Error verificando firma, procesando sin verificación")
      return deliverReminder(req)
    }
  } else {
    return deliverReminder(req)
  }
}
