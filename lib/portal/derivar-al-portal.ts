/**
 * El punto único donde el bot decide mandar el enlace (22/9/2026).
 *
 * ── Por qué una sola función ───────────────────────────────────────────────
 *
 * Los lugares del bot desde los que se puede llegar a "el paciente quiere
 * reprogramar" o "el paciente quiere un turno" son varios: el botón del
 * recordatorio, el menú principal, el dispatcher, el NLU de respaldo. Si cada
 * uno armara su enlace por su cuenta, en tres semanas tendríamos cuatro
 * variantes que vencen distinto y dicen cosas distintas.
 *
 * Acá se emite el token, se arma el mensaje y se manda. Los llamadores sólo
 * preguntan "¿corresponde?" y pasan lo que saben del paciente.
 *
 * ── Nunca deja al paciente sin respuesta ───────────────────────────────────
 *
 * Devuelve `false` cuando no corresponde o cuando algo falla, y el llamador
 * sigue con el flujo conversacional de siempre. Un paciente atendido por el
 * camino viejo es mucho mejor que un paciente sin respuesta — y es la única
 * forma de que activar este switch no pueda romper nada.
 */

import { emitirEnlace, type TurnoDelPortal } from "./token"
import {
  construirMensajeConEnlace,
  enviarMensajeConEnlace,
  textoDelEnlace,
  textoSoloPorTelefono,
  BOTON_REPROGRAMAR,
  BOTON_TURNO_NUEVO,
} from "./mensaje-enlace"
import { sendWhatsAppMessage } from "../whatsapp-api"
import type { IntencionDelPortal, OrigenDelEnlace } from "./vigencia"
import { saveConversationMessage } from "../conversations"
import { presentarSiCorresponde } from "../conversation-state/presentacion-inicial"
import { nanoid } from "nanoid"

export interface DatosDelPaciente {
  pacienteId?: string
  pacienteNombre?: string
  /** Nombres de pila y apellido por separado: `set_turno` los pide así. */
  pacienteNombres?: string
  pacienteApellido?: string
  pacienteEmail?: string
  pacienteDNI?: string
  obraSocialId?: string
  sedeId?: string
  turno?: TurnoDelPortal
  /**
   * El turno se puede reprogramar solo, sin llamar a la clínica.
   *
   * Viene en el `Chatbot_Data` del recordatorio, por turno. `undefined` cuando
   * el proxy no manda el campo: ahí se asume que sí (ver `permiteReprogramarOnline`).
   */
  admiteReagendamiento?: boolean
}

/**
 * ¿Este turno se puede reprogramar desde el portal? (23/9/2026)
 *
 * ── El caso que obligó a escribir esto ─────────────────────────────────────
 *
 * Un paciente con turno con un Instrumentador Quirúrgico tocó "Reprogramar
 * turno", recibió el enlace, y el portal le mostró una pantalla vacía. El proxy
 * había contestado bien: `turnos_disponibles: []` más un `info_sin_turnos`
 * explicando que ese profesional "solo se puede reservar por teléfono".
 *
 * El dato estaba en nuestras manos ocho minutos antes, en el `Chatbot_Data` del
 * recordatorio: `admite_reagendamiento: false`. El resto del sistema lo mira
 * —`buildCancellationSuccessMessage`, el filtro de `buscarConRango`, la
 * cancelación en whatsapp.tsx— y deriva al teléfono de la clínica. La
 * intercepción del portal se metió antes en el embudo y se salteó esa
 * compuerta.
 *
 * ── Ausencia del campo no es un "no" ───────────────────────────────────────
 *
 * `!== false`, no `=== true`. Hay proxies que no mandan el campo, y ahí no
 * podemos concluir que el turno no admite reagendamiento: no sabemos. Tratar la
 * falta de información como un "no" le cortaría el portal a clientes enteros
 * sin que nadie entienda por qué.
 *
 * (Nota: `whatsapp.tsx:4678` usa `=== true` para el mismo flag, en el camino de
 * los mensajes de la clínica. Son dos criterios distintos para la misma
 * pregunta y habría que unificarlos; queda anotado, no lo toco desde acá
 * porque cambiaría el comportamiento de un flujo que hoy funciona.)
 */
export function permiteReprogramarOnline(
  paciente: DatosDelPaciente | undefined,
  config: { permitirReagendamiento?: boolean } | null | undefined,
): boolean {
  if (config?.permitirReagendamiento === false) return false
  return paciente?.admiteReagendamiento !== false
}

/**
 * Traduce el contexto que el bot ya tiene en Redis al que necesita el portal.
 *
 * `ChatbotData` lo guarda `send-reminder-template.ts` cuando la clínica manda
 * el recordatorio, así que cuando el paciente toca "Reprogramar turno" ya
 * tenemos su DNI, su obra social y —lo importante— el `profesional_id` y el
 * `sede_id` del turno. Sin eso habría que resolver el profesional por su
 * nombre, que falla con abreviaturas y homónimos.
 *
 * Se toma el PRIMER turno cuando hay varios. Es una simplificación consciente:
 * el enlace es para reprogramar uno, y elegir cuál es una decisión del paciente
 * que todavía no le pedimos. Ver el pendiente al final del archivo.
 */
export function datosDesdeElContexto(contexto: any): DatosDelPaciente | undefined {
  if (!contexto) return undefined

  const paciente = contexto.paciente
  const turno = Array.isArray(contexto.turnos) ? contexto.turnos[0] : contexto.turnos || contexto

  // ── Nombre y apellido viajan SEPARADOS (25/9/2026) ─────────────────────
  //
  // El `Chatbot_Data` que manda la clínica ya los trae aparte:
  //
  //     "paciente": { "nombres": "Nicolas", "apellido": "DE SANTIAGO", ... }
  //
  // Acá se los unía en una sola cadena para saludar, y el apellido se perdía.
  // Después, al reservar, `set_turno` respondía "Debe proporcionar Nombre,
  // Apellido, DNI..." y fallaba TODA reserva de un paciente identificado por
  // el bot.
  //
  // El nombre completo se sigue guardando para el saludo, pero los dos campos
  // originales van también. Es el mismo criterio que usa el flujo de
  // reagendamiento del bot (reschedule-flow-integration.ts), que arma
  // `{ nombre: st.paciente.nombres, apellido: st.paciente.apellido }`.
  const nombre = [paciente?.nombres, paciente?.apellido].filter(Boolean).join(" ").trim()

  const datos: DatosDelPaciente = {
    pacienteNombre: nombre || undefined,
    pacienteNombres: paciente?.nombres || undefined,
    pacienteApellido: paciente?.apellido || undefined,
    pacienteEmail: paciente?.mail || paciente?.email || undefined,
    pacienteDNI: paciente?.dni || undefined,
    obraSocialId: paciente?.obra_social_id || undefined,
    sedeId: turno?.sede_id || contexto.sede_id || undefined,
    // Se deja pasar `undefined` tal cual: distingue "el turno no admite
    // reagendamiento" de "el proxy no manda el campo". Ver `permiteReprogramarOnline`.
    admiteReagendamiento:
      typeof turno?.admite_reagendamiento === "boolean" ? turno.admite_reagendamiento : undefined,
  }

  if (turno?.fecha || turno?.hora) {
    datos.turno = {
      agendaId: turno.agenda_id,
      fecha: turno.fecha,
      fechaFormateada: turno.fecha_formateada || turno.fecha,
      hora: turno.hora,
      horaFormateada: turno.hora_formateada || turno.hora,
      profesional: turno.profesional,
      profesionalId: turno.profesional_id,
      sede: turno.sede,
      direccion: turno.direccion,
    }
  }

  return datos
}

/**
 * ¿Este cliente usa el portal?
 *
 * Se consulta con la config ya cargada, para no agregar una lectura más en el
 * camino caliente del webhook. Si ambos switches estuvieran encendidos gana el
 * portal — es el que está en producción, y el formulario del dashboard avisa
 * de la contradicción.
 */
export function usaPortal(config: { clientePortalWeb?: boolean } | null | undefined): boolean {
  return config?.clientePortalWeb === true
}

/**
 * Atiende al paciente que pidió reprogramar o sacar turno.
 *
 * `true` = el paciente YA recibió una respuesta y el llamador debe cortar ahí.
 * Ojo que eso no siempre significa "se mandó el enlace": si el turno no se
 * puede reprogramar online, la respuesta es la derivación al teléfono, y
 * también corta. La pregunta que contesta el valor de retorno es "¿hace falta
 * que sigas vos?", no "¿se mandó el enlace?".
 *
 * `false` = no corresponde o algo falló; seguí con el flujo conversacional.
 */
export async function derivarAlPortal(params: {
  config: any
  phoneNumberId: string
  userPhoneNumber: string
  intencion: IntencionDelPortal
  origen: OrigenDelEnlace
  paciente?: DatosDelPaciente
}): Promise<boolean> {
  const { config, paciente } = params

  if (!usaPortal(config)) return false

  // ── Compuerta: ¿este turno se puede reprogramar solo? ────────────────────
  //
  // Va acá adentro y no en el llamador a propósito. Los puntos desde los que se
  // llega a "quiero reprogramar" son varios y van a ser más; si la compuerta
  // viviera en cada uno, el próximo que agreguemos la olvida y el paciente
  // vuelve a terminar en una pantalla vacía. Este es el embudo: se decide una
  // vez, acá.
  const esReprogramarUnTurno = params.intencion === "reagendar" || params.intencion === "cancelar"
  if (esReprogramarUnTurno && !permiteReprogramarOnline(paciente, config)) {
    try {
      const cuerpoBase = textoSoloPorTelefono(paciente?.turno, config.escalationPhoneNumber)
      const cuerpo = await presentarSiCorresponde(cuerpoBase, config.id, params.userPhoneNumber)

      await sendWhatsAppMessage(params.phoneNumberId, config.accessToken, params.userPhoneNumber, cuerpo)
      await saveConversationMessage({
        id: nanoid(),
        role: "assistant",
        content: cuerpo,
        timestamp: new Date().toISOString(),
        phoneNumber: params.userPhoneNumber,
        configId: config.id,
      }).catch(() => {})

      console.log(
        `[PORTAL] ${params.userPhoneNumber}: el turno no admite reagendamiento online; derivado al teléfono`,
      )
      return true
    } catch (error) {
      // Si no se pudo ni mandar la derivación, que siga el flujo de siempre:
      // cualquier respuesta es mejor que ninguna.
      console.error("[PORTAL] No se pudo derivar al teléfono:", error)
      return false
    }
  }

  try {
    const enlace = await emitirEnlace({
      configId: config.id,
      clienteId: config.cliente_id,
      phone: params.userPhoneNumber,
      intencion: params.intencion,
      origen: params.origen,
      pacienteId: paciente?.pacienteId,
      pacienteNombre: paciente?.pacienteNombre,
      pacienteNombres: paciente?.pacienteNombres,
      pacienteApellido: paciente?.pacienteApellido,
      pacienteEmail: paciente?.pacienteEmail,
      pacienteDNI: paciente?.pacienteDNI,
      obraSocialId: paciente?.obraSocialId,
      sedeId: paciente?.sedeId,
      turno: paciente?.turno,
    })

    if (!enlace) {
      console.error("[PORTAL] No se pudo emitir el enlace; sigue el flujo conversacional")
      return false
    }

    // Sin dominio la URL queda relativa, y en un mensaje de WhatsApp eso es un
    // botón que no lleva a ningún lado. Antes que mandar eso, se sigue por el
    // camino de siempre.
    if (!/^https?:\/\//i.test(enlace.url)) {
      console.error(`[PORTAL] URL sin dominio (${enlace.url}). Falta APP_URL. Sigue el flujo conversacional.`)
      return false
    }

    const esReprogramar = params.intencion === "reagendar" || params.intencion === "cancelar"

    const cuerpoBase = textoDelEnlace({
      intencion: params.intencion,
      nombre: paciente?.pacienteNombre,
      turno: paciente?.turno,
      // Redacción propia del cliente, si la cargó en su configuración.
      plantilla: config.textoEnlacePortal,
    })

    // Por el mismo embudo que el resto: si es el primer mensaje del día, el
    // paciente tiene que saber que le está escribiendo una IA antes de que le
    // mandemos a un sitio web.
    const cuerpo = await presentarSiCorresponde(cuerpoBase, config.id, params.userPhoneNumber)

    const mensaje = construirMensajeConEnlace({
      to: params.userPhoneNumber,
      cuerpo,
      url: enlace.url,
      textoDelBoton: esReprogramar ? BOTON_REPROGRAMAR : BOTON_TURNO_NUEVO,
      // Sin pie: el nombre de la clínica ya aparece como remitente del chat, y
      // repetirlo abajo de un mensaje de una línea lo hacía ver más largo de lo
      // que es.
    })

    await enviarMensajeConEnlace(params.phoneNumberId, config.accessToken, mensaje)

    // El panel tiene que mostrar que se mandó un enlace. Sin esto, un agente
    // abre la conversación y ve que el bot dejó de responder.
    await saveConversationMessage({
      id: nanoid(),
      role: "assistant",
      content: `${cuerpo}\n\n[Enlace de gestión enviado]`,
      timestamp: new Date().toISOString(),
      phoneNumber: params.userPhoneNumber,
      configId: config.id,
      messageType: "portal",
    }).catch(() => {})

    console.log(`[PORTAL] Enlace de ${params.intencion} enviado a ${params.userPhoneNumber}`)
    return true
  } catch (error) {
    console.error("[PORTAL] Falló la derivación al portal; sigue el flujo conversacional:", error)
    return false
  }
}
