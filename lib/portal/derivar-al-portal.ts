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
  textoParaReprogramar,
  textoParaTurnoNuevo,
  BOTON_REPROGRAMAR,
  BOTON_TURNO_NUEVO,
} from "./mensaje-enlace"
import type { IntencionDelPortal, OrigenDelEnlace } from "./vigencia"
import { saveConversationMessage } from "../conversations"
import { presentarSiCorresponde } from "../conversation-state/presentacion-inicial"
import { nanoid } from "nanoid"

export interface DatosDelPaciente {
  pacienteId?: string
  pacienteNombre?: string
  pacienteDNI?: string
  obraSocialId?: string
  sedeId?: string
  turno?: TurnoDelPortal
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

  const nombre = [paciente?.nombres, paciente?.apellido].filter(Boolean).join(" ").trim()

  const datos: DatosDelPaciente = {
    pacienteNombre: nombre || undefined,
    pacienteDNI: paciente?.dni || undefined,
    obraSocialId: paciente?.obra_social_id || undefined,
    sedeId: turno?.sede_id || contexto.sede_id || undefined,
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
 * Emite el enlace y se lo manda al paciente.
 *
 * `true` si el paciente ya recibió el enlace y el llamador debe cortar ahí.
 * `false` si hay que seguir con el flujo de siempre.
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

  try {
    const enlace = await emitirEnlace({
      configId: config.id,
      clienteId: config.cliente_id,
      phone: params.userPhoneNumber,
      intencion: params.intencion,
      origen: params.origen,
      pacienteId: paciente?.pacienteId,
      pacienteNombre: paciente?.pacienteNombre,
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
    const cuerpoBase = esReprogramar ? textoParaReprogramar(paciente?.turno) : textoParaTurnoNuevo()

    // Por el mismo embudo que el resto: si es el primer mensaje del día, el
    // paciente tiene que saber que le está escribiendo una IA antes de que le
    // mandemos a un sitio web.
    const cuerpo = await presentarSiCorresponde(cuerpoBase, config.id, params.userPhoneNumber)

    const mensaje = construirMensajeConEnlace({
      to: params.userPhoneNumber,
      cuerpo,
      url: enlace.url,
      textoDelBoton: esReprogramar ? BOTON_REPROGRAMAR : BOTON_TURNO_NUEVO,
      pie: config.displayName || undefined,
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
