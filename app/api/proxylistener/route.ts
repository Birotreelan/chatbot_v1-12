import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneIdFresh, getAllWhatsAppConfigs } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { saveConversationMessage } from "@/lib/conversations"
import { nanoid } from "nanoid"
import { normalizePhoneNumber } from "@/lib/utils"
import { trackAppointmentEvent, getTemplateSentTime, markPendingReschedule } from "@/lib/appointment-stats"
import { sendReminderTemplate } from "@/lib/reminders/send-reminder-template"
import { calcularRecordatorios, type RecordatoriosConfig } from "@/lib/reminders/schedule-calculator"
import { assignSegundoRecordatorioSlot, saveReminderQueue, type QueuedReminder } from "@/lib/reminders/reminder-queue"
import { scheduleMessage } from "@/lib/queue"

export async function POST(request: Request) {
  try {
    console.log("[PROXYLISTENER] ===== INICIO DE SOLICITUD =====")

    console.log("[v0] 📥 REQUEST DETAILS:")
    console.log("[v0] Method:", request.method)
    console.log("[v0] URL:", request.url)
    console.log("[v0] Headers:", JSON.stringify(Object.fromEntries(request.headers.entries()), null, 2))

    // Obtener los parámetros de la solicitud
    const data = await request.json()

    console.log("[v0] Body (parsed JSON):", JSON.stringify(data, null, 2))
    console.log("[v0] Body keys:", Object.keys(data))
    console.log("[v0] Body type:", typeof data)
    console.log("[PROXYLISTENER] ===== FIN DE DETALLES DE REQUEST =====")

    console.log("[PROXYLISTENER] Datos recibidos:", JSON.stringify(data, null, 2))

    // Detectar si es envío de template o respuesta de botón
    const isTemplateResponse = data.action === "template_response"

    if (isTemplateResponse) {
      console.log("[PROXYLISTENER] ===== PROCESANDO RESPUESTA DE BOTÓN =====")
      return await handleButtonResponse(data)
    } else {
      console.log("[PROXYLISTENER] ===== PROCESANDO ENVÍO DE TEMPLATE =====")
      return await handleTemplateSend(data)
    }
  } catch (error) {
    console.error("[PROXYLISTENER] Error general:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

// Función para manejar respuestas de botones
async function handleButtonResponse(data: any) {
  try {
    const { Cliente_Id, Phone_Number_Id, messages } = data

    if (!messages || messages.length === 0) {
      return NextResponse.json({ success: false, error: "No se encontraron mensajes" }, { status: 400 })
    }

    const message = messages[0]
    const userPhoneNumber = message.from
    const buttonResponse = message.button?.text || message.button?.payload || ""

    console.log("[PROXYLISTENER] Usuario:", userPhoneNumber)
    console.log("[PROXYLISTENER] Respuesta del botón:", buttonResponse)
    console.log("[PROXYLISTENER] Tipo de mensaje:", message.type)

    // Buscar configuración (siempre fresca, sin cachear)
    const config = await getWhatsAppConfigByPhoneIdFresh(Phone_Number_Id)
    if (!config) {
      return NextResponse.json(
        { success: false, error: `No se encontró configuración para Phone_Number_Id: ${Phone_Number_Id}` },
        { status: 404 },
      )
    }

    const templateSentAt = await getTemplateSentTime(config.id, userPhoneNumber)

    // Simular validación del estado del turno
    // En un sistema real, aquí consultarías la base de datos para verificar el estado actual del turno
    const buttonLower = buttonResponse.toLowerCase()

    // Simular diferentes tipos de errores que puede devolver el sistema real
    if (buttonLower.includes("cancelar")) {
      // Simular que el turno ya fue confirmado y no se puede cancelar
      return NextResponse.json({
        success: false,
        error: "CANNOT_CANCEL",
        message: "No se puede cancelar un turno que ya fue confirmado",
        action_type: "error_cancelacion",
        user_action: buttonResponse,
        suggested_action: "contact_clinic",
      })
    }

    if (buttonLower.includes("confirmar")) {
      // Simular que el turno ya fue cancelado y no se puede confirmar
      // (esto podría pasar si alguien cancela y luego intenta confirmar)
      const isAlreadyCancelled = Math.random() > 0.7 // 30% de probabilidad para testing

      if (isAlreadyCancelled) {
        return NextResponse.json({
          success: false,
          error: "CANNOT_CONFIRM",
          message: "No se puede confirmar un turno que ya fue cancelado",
          action_type: "error_confirmacion",
          user_action: buttonResponse,
          suggested_action: "contact_clinic",
        })
      }
    }

    // Procesar según el tipo de respuesta (casos exitosos)
    let responseData = {
      success: true,
      action: "button_response",
      button_text: buttonResponse,
      user_phone: userPhoneNumber,
      timestamp: new Date().toISOString(),
    }

    if (buttonLower.includes("confirmar") || buttonLower === "sí" || buttonLower === "si") {
      responseData = {
        ...responseData,
        action_type: "confirmacion_turno",
        message: "Turno confirmado exitosamente",
        status: "confirmed",
        next_steps: "El turno ha sido confirmado. Te esperamos en la fecha y hora programada.",
      }

      console.log("[PROXYLISTENER] ✅ Turno confirmado por usuario:", userPhoneNumber)

      await trackAppointmentEvent({
        clienteId: config.id,
        phoneNumber: userPhoneNumber,
        eventType: "confirmed",
        timestamp: new Date().toISOString(),
        templateSentAt: templateSentAt || undefined,
      })
    } else if (buttonLower.includes("cancelar") || buttonLower === "no") {
      responseData = {
        ...responseData,
        action_type: "cancelacion_turno",
        message: "Turno cancelado exitosamente",
        status: "cancelled",
        next_steps: "El turno ha sido cancelado. Si deseas reagendar, puedes solicitar un nuevo turno.",
      }

      console.log("[PROXYLISTENER] ❌ Turno cancelado por usuario:", userPhoneNumber)

      await trackAppointmentEvent({
        clienteId: config.id,
        phoneNumber: userPhoneNumber,
        eventType: "cancelled",
        timestamp: new Date().toISOString(),
        templateSentAt: templateSentAt || undefined,
      })
      
      // Marcar que hay una cancelación pendiente de reagendar (ventana de 12h)
      await markPendingReschedule(config.id, userPhoneNumber)
      console.log(`[PROXYLISTENER] 📊 Marcado pending reschedule para ${userPhoneNumber}`)
    } else if (buttonLower.includes("reprogramar") || buttonLower.includes("reagendar")) {
      responseData = {
        ...responseData,
        action_type: "reprogramacion_turno",
        message: "Solicitud de reprogramación recibida",
        status: "rescheduling_requested",
        next_steps:
          "Tu solicitud de reprogramación ha sido recibida. Nos comunicaremos contigo para coordinar una nueva fecha.",
      }

      console.log("[PROXYLISTENER] 🔄 Reprogramación solicitada por usuario:", userPhoneNumber)

      await trackAppointmentEvent({
        clienteId: config.id,
        phoneNumber: userPhoneNumber,
        eventType: "rescheduled",
        timestamp: new Date().toISOString(),
        templateSentAt: templateSentAt || undefined,
      })
    } else {
      // Respuesta genérica para otros botones
      responseData = {
        ...responseData,
        action_type: "respuesta_generica",
        message: `Respuesta "${buttonResponse}" procesada`,
        status: "processed",
        next_steps: "Tu respuesta ha sido registrada exitosamente.",
      }

      console.log("[PROXYLISTENER] ℹ️ Respuesta genérica procesada:", buttonResponse)
    }

    console.log("[PROXYLISTENER] Respuesta preparada:", JSON.stringify(responseData, null, 2))
    return NextResponse.json(responseData)
  } catch (error) {
    console.error("[PROXYLISTENER] Error procesando respuesta de botón:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Error procesando respuesta de botón",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

// Función para manejar envío de templates
async function handleTemplateSend(data: any) {
  try {
    const { Cliente_Id, Phone_Number_Id, Phone, Type, Body, Chatbot_Data, Sede_Id, Recordatorios_Config } = data

    console.log("[PROXYLISTENER] Parámetros extraídos:")
    console.log("[PROXYLISTENER] - Cliente_Id:", Cliente_Id)
    console.log("[PROXYLISTENER] - Phone_Number_Id:", Phone_Number_Id)
    console.log("[PROXYLISTENER] - Phone:", Phone)
    console.log("[PROXYLISTENER] - Type:", Type)
    console.log("[PROXYLISTENER] - Body:", typeof Body === "object" ? JSON.stringify(Body, null, 2) : Body)
    console.log("[PROXYLISTENER] - Chatbot_Data:", Chatbot_Data)
    console.log("[PROXYLISTENER] - Sede_Id:", Sede_Id)

    // Validaciones
    if (!Cliente_Id) {
      return NextResponse.json({ success: false, error: "Se requiere el parámetro Cliente_Id" }, { status: 400 })
    }

    if (!Body) {
      return NextResponse.json({ success: false, error: "Se requiere el parámetro Body" }, { status: 400 })
    }

    if (!Phone) {
      console.error("[PROXYLISTENER] ❌ ERROR CRÍTICO: No se proporcionó el parámetro Phone")
      console.error("[PROXYLISTENER] Este es un error de configuración del sistema externo")
      return NextResponse.json(
        {
          success: false,
          error: "PHONE_REQUIRED",
          message: "El parámetro 'Phone' es obligatorio. No se puede enviar mensaje sin número de teléfono explícito.",
          details:
            "Este error previene el envío de mensajes al contacto incorrecto. Verifica la configuración del sistema que envía plantillas.",
        },
        { status: 400 },
      )
    }

    if (!Phone_Number_Id && !Phone) {
      return NextResponse.json(
        { success: false, error: "Se requiere al menos uno de los parámetros: Phone_Number_Id o Phone" },
        { status: 400 },
      )
    }

    // Validar el tipo de mensaje
    if (Type && Type !== "text" && Type !== "template") {
      return NextResponse.json(
        { success: false, error: "El parámetro Type debe ser 'text' o 'template'" },
        { status: 400 },
      )
    }

    const messageType = Type || "text"

    // Buscar configuración de WhatsApp (siempre fresca, sin cachear)
    let config = null

    if (Phone_Number_Id) {
      config = await getWhatsAppConfigByPhoneIdFresh(Phone_Number_Id)
    }

    if (!config) {
      const allConfigs = await getAllWhatsAppConfigs()
      const matchingConfigs = allConfigs.filter((c) => c.cliente_id === Cliente_Id && c.active)

      if (matchingConfigs.length === 0) {
        return NextResponse.json(
          { success: false, error: `No se encontró una configuración activa para el Cliente_Id: ${Cliente_Id}` },
          { status: 404 },
        )
      }

      config = matchingConfigs[0]
    }

    console.log("[PROXYLISTENER] Configuración encontrada:", {
      phoneNumberId: config.phoneNumberId,
      wabaId: config.wabaId,
      active: config.active,
      hasToken: !!config.accessToken,
    })
    console.log(
      "[PROXYLISTENER] AccessToken desde config (Redis):",
      config.accessToken ? `${config.accessToken.slice(0, 4)}...${config.accessToken.slice(-4)}` : "(vacío)",
    )

    if (!config.active) {
      return NextResponse.json(
        { success: false, error: "La configuración de WhatsApp no está activa" },
        { status: 400 },
      )
    }

    // NOTA: Se eliminó la verificación de health status antes de enviar mensajes
    // El mensaje se intenta enviar directamente y los errores se capturan en el proceso de envío

    // NUNCA usar lastUserPhoneNumber como fallback
    const destinationPhone = Phone.startsWith("+") ? Phone : `+${Phone}`

    console.log("[PROXYLISTENER] ✅ Número de teléfono validado:", destinationPhone)
    console.log("[PROXYLISTENER] ✅ Origen del número: Parámetro 'Phone' (explícito)")
    console.log("[PROXYLISTENER] Enviando mensaje tipo:", messageType)

    const cleanPhoneNumber = normalizePhoneNumber(destinationPhone)

    console.log("[PROXYLISTENER] 📤 ===== RASTREO DE ENVÍO =====")
    console.log("[PROXYLISTENER] Destinatario normalizado:", cleanPhoneNumber)
    console.log("[PROXYLISTENER] Destinatario con formato:", destinationPhone)
    console.log("[PROXYLISTENER] Config ID:", config.id)
    console.log("[PROXYLISTENER] Phone Number ID:", config.phoneNumberId)
    console.log("[PROXYLISTENER] Tipo de mensaje:", messageType)
    console.log("[PROXYLISTENER] Cliente ID:", Cliente_Id)
    console.log("[PROXYLISTENER] Timestamp:", new Date().toISOString())
    console.log("[PROXYLISTENER] ================================")

    // Enviar mensaje según el tipo
    let whatsappResponse = null

    if (messageType === "text") {
      whatsappResponse = await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, destinationPhone, Body)

      await saveConversationMessage({
        id: nanoid(),
        role: "assistant",
        content: Body,
        timestamp: new Date().toISOString(),
        phoneNumber: cleanPhoneNumber,
        configId: config.id,
        messageType: "text",
      })
      console.log("[PROXYLISTENER] ✅ Mensaje de texto guardado en Redis")
    } else {
      // Envío + tracking + notificación a OpenAI: lógica compartida con los
      // reintentos de recordatorio (ver lib/reminders/send-reminder-template.ts)
      whatsappResponse = await sendReminderTemplate({
        config,
        destinationPhone,
        cleanPhoneNumber,
        Body,
        Chatbot_Data,
        Sede_Id,
      })

      // 🆕 Recordatorios_Config (17/7/2026): programar reintentos (24h / segundo /
      // último) para este mismo turno, además del envío síncrono de arriba.
      // Viene como string JSON, hermano de Chatbot_Data (no anidado adentro).
      if (Recordatorios_Config) {
        try {
          await scheduleFollowUpReminders({
            Recordatorios_Config,
            Body,
            Chatbot_Data,
            config,
            destinationPhone,
            cleanPhoneNumber,
            Sede_Id,
          })
        } catch (e) {
          console.error("[PROXYLISTENER] ⚠️ Error programando recordatorios de reintento (continuando):", e)
        }
      }
    }

    console.log("[PROXYLISTENER] Respuesta de WhatsApp:", whatsappResponse)
    return NextResponse.json(whatsappResponse)
  } catch (error) {
    console.error("[PROXYLISTENER] Error enviando template:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al enviar mensaje",
      },
      { status: 500 },
    )
  }
}

// URL base del deploy — mismo valor hardcodeado que ya usa lib/queue.ts (enqueueMessage)
const REMINDERS_BASE_URL = "https://treelan-bot.vercel.app"

/**
 * Programa en QStash los recordatorios de reintento (24h / segundo / último)
 * de un turno, a partir de "Recordatorios_Config" (string JSON, hermano de
 * Chatbot_Data). No afecta el envío síncrono ya realizado — esto es
 * exclusivamente para los reintentos futuros.
 */
async function scheduleFollowUpReminders(params: {
  Recordatorios_Config: string
  Body: any
  Chatbot_Data?: string | any
  config: any
  destinationPhone: string
  cleanPhoneNumber: string
  Sede_Id?: string
}): Promise<void> {
  const { Recordatorios_Config, Body, Chatbot_Data, config, destinationPhone, cleanPhoneNumber, Sede_Id } = params

  let recordatoriosConfig: RecordatoriosConfig
  try {
    recordatoriosConfig =
      typeof Recordatorios_Config === "string" ? JSON.parse(Recordatorios_Config) : Recordatorios_Config
  } catch (e) {
    console.error("[PROXYLISTENER] ❌ Recordatorios_Config no es JSON válido, se omite el encolado:", e)
    return
  }

  const chatbotDataParsed = typeof Chatbot_Data === "string" ? JSON.parse(Chatbot_Data) : Chatbot_Data
  const firstTurno = Array.isArray(chatbotDataParsed?.turnos) ? chatbotDataParsed.turnos[0] : null

  if (!firstTurno?.fecha || !firstTurno?.hora) {
    console.warn("[PROXYLISTENER] ⚠️ No hay turno con fecha/hora en Chatbot_Data, se omite el encolado de recordatorios")
    return
  }

  const planificados = calcularRecordatorios(firstTurno.fecha, firstTurno.hora, recordatoriosConfig)
  if (planificados.length === 0) {
    console.log("[PROXYLISTENER] 📅 No hay recordatorios de reintento para programar (flags en false o ya pasaron)")
    return
  }

  const queued: QueuedReminder[] = []

  for (const reminder of planificados) {
    let sendAtUnix: number
    if (reminder.kind === "segundo") {
      sendAtUnix = await assignSegundoRecordatorioSlot(
        config.id,
        reminder.ventanaKey,
        reminder.ventanaInicioUnix,
        reminder.ventanaFinUnix,
      )
    } else {
      sendAtUnix = reminder.sendAtUnix
    }

    const { messageId, success } = await scheduleMessage(
      `${REMINDERS_BASE_URL}/api/reminders/deliver`,
      {
        Cliente_Id: config.cliente_id,
        Phone_Number_Id: config.phoneNumberId,
        Phone: destinationPhone,
        Body,
        Chatbot_Data,
        Sede_Id,
        kind: reminder.kind,
        configId: config.id,
        agendaId: firstTurno.agenda_id,
      },
      sendAtUnix,
    )

    if (success && messageId) {
      queued.push({ messageId, kind: reminder.kind, sendAtUnix })
    } else {
      console.error(`[PROXYLISTENER] ⚠️ No se pudo programar recordatorio "${reminder.kind}" en QStash`)
    }
  }

  if (queued.length > 0) {
    await saveReminderQueue(config.id, cleanPhoneNumber, queued)
    console.log(`[PROXYLISTENER] ✅ ${queued.length} recordatorio(s) de reintento programado(s) para ${cleanPhoneNumber}`)
  }
}
