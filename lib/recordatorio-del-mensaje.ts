/**
 * El recordatorio que el paciente tocó (13/11/2026).
 *
 * ── El caso que esto arregla ───────────────────────────────────────────────
 *
 * Reportado: a Rosana (DNI 16715916) le llegaron dos recordatorios y al tocar
 * "Confirmar" se confirmó el DNI 20755823 —otra persona— y el proxy contestó
 * "No se encontraron turnos para el paciente en la fecha especificada". Ella
 * recibió "no encontramos un turno a tu nombre" y su turno quedó sin
 * confirmar.
 *
 * Por qué: el botón no confirmaba el turno del mensaje tocado. Confirmaba lo
 * que hubiera en `appointment_context:<configId>:<telefono>`, UNA clave por
 * teléfono, que cualquier flujo puede sobrescribir —entre ellos
 * `rebuildAppointmentContextFromBackend`, que busca al paciente POR TELÉFONO
 * en la tabla `pacientes` y adopta el que encuentra—.
 *
 * Y eso no es un caso raro, es el caso normal: un teléfono es de una familia.
 * Una madre saca turno para ella y para dos hijos; alguien saca uno para un
 * conocido. Peor todavía, los datos del recordatorio salen de `agenda` y el
 * paciente puede no existir en `pacientes` si nunca se atendió, así que la
 * búsqueda por teléfono devuelve al familiar que sí está, con cara de
 * respuesta correcta.
 *
 * ── La regla ───────────────────────────────────────────────────────────────
 *
 * El turno que llegó es el que se confirma. Cuando se manda un recordatorio se
 * guarda su `Chatbot_Data` bajo el id del mensaje de WhatsApp (`wamid`), y
 * cuando el paciente toca un botón, WhatsApp dice en `context.id` a qué
 * mensaje está respondiendo. Con eso el botón del recordatorio de las 17:45
 * confirma el turno de las 17:45, pase lo que pase con el contexto del
 * teléfono y aunque hayan llegado cuatro recordatorios después.
 *
 * ── Por qué una clave propia y no el contexto del teléfono ────────────────
 *
 * Porque son dos preguntas distintas y hasta hoy compartían una respuesta:
 * "¿de qué venimos hablando con este teléfono?" —que por definición es una
 * sola y la última— y "¿de qué turno es este mensaje?" —que es una por
 * mensaje y no cambia nunca—. La segunda no se puede guardar en una variable
 * que la primera sobreescribe.
 *
 * ── Qué pasa si no hay `context.id` ───────────────────────────────────────
 *
 * Se cae al contexto del teléfono, que es el comportamiento anterior. Pasa con
 * los mensajes mandados antes de este cambio, y podría pasar si Meta dejara de
 * mandar el `context` en algún tipo de respuesta. Quien lea esto buscando por
 * qué se confirmó el turno equivocado: el log dice cuál de los dos caminos se
 * usó.
 */

import { getRedisClient } from "./redis"
import type { ChatbotData } from "./appointment-flow-state"

const PREFIJO = "recordatorio:wamid:"

/**
 * Siete días.
 *
 * Los botones de un recordatorio quedan tocables para siempre del lado del
 * paciente, y alguien que lo toca una semana después igual merece que se
 * confirme el turno correcto. Más allá de eso el turno ya pasó. Es más
 * generoso que las 48 h del contexto del teléfono a propósito: acá no hay
 * nada que se desactualice —el contenido es el de un mensaje ya enviado—.
 */
const VIDA_SEGUNDOS = 7 * 24 * 60 * 60

export interface RecordatorioDelMensaje {
  configId: string
  telefono: string
  wamid: string
  enviadoEl: string
  chatbotData: ChatbotData
}

/** El `wamid` de la respuesta de Meta, con los nombres que puede traer. */
export function wamidDelEnvio(respuesta: any): string | undefined {
  const id =
    respuesta?.messages?.[0]?.id || respuesta?.message_id || respuesta?.wamid || undefined
  return typeof id === "string" && id.trim() ? id.trim() : undefined
}

/**
 * Guarda el recordatorio bajo el id de su mensaje.
 *
 * Nunca lanza: el recordatorio ya salió. Si esto falla, el botón cae al
 * contexto del teléfono —el comportamiento de antes— y no se pierde nada que
 * no estuviera perdido.
 */
export async function guardarRecordatorioDelMensaje(params: {
  configId: string
  telefono: string
  wamid?: string
  chatbotData: ChatbotData
}): Promise<boolean> {
  const { configId, telefono, wamid, chatbotData } = params
  if (!wamid || !configId || !telefono) return false

  const redis = getRedisClient()
  if (!redis) return false

  const guardado: RecordatorioDelMensaje = {
    configId,
    telefono,
    wamid,
    enviadoEl: new Date().toISOString(),
    chatbotData,
  }

  try {
    await redis.set(`${PREFIJO}${wamid}`, JSON.stringify(guardado), { ex: VIDA_SEGUNDOS })
    console.log(
      `[RECORDATORIO] Turno del mensaje ${wamid} guardado ` +
        `(dni ${chatbotData.paciente?.dni || "—"}, ${chatbotData.turnos?.length ?? 0} turno/s)`,
    )
    return true
  } catch (error) {
    console.warn("[RECORDATORIO] No se pudo guardar el turno del mensaje:", error)
    return false
  }
}

/**
 * El recordatorio de ese mensaje, si es de este teléfono y esta clínica.
 *
 * El `wamid` lo manda el cliente —viene en el webhook— así que no alcanza con
 * que exista la clave: se verifica que el mensaje sea de quien está
 * escribiendo. Sin esa verificación, un `context.id` ajeno dejaría confirmar
 * el turno de otro paciente, que es exactamente el problema que esto viene a
 * resolver.
 */
export async function leerRecordatorioDelMensaje(params: {
  configId: string
  telefono: string
  wamid?: string | null
}): Promise<ChatbotData | null> {
  const { configId, telefono, wamid } = params
  if (!wamid || !configId || !telefono) return null

  const redis = getRedisClient()
  if (!redis) return null

  try {
    const crudo = await redis.get(`${PREFIJO}${wamid}`)
    if (!crudo) return null

    const guardado = (typeof crudo === "string" ? JSON.parse(crudo) : crudo) as RecordatorioDelMensaje
    if (!guardado?.chatbotData) return null

    if (guardado.configId !== configId || guardado.telefono !== telefono) {
      console.warn(
        `[RECORDATORIO] ${wamid} no es de ${telefono}@${configId} ` +
          `(es de ${guardado.telefono}@${guardado.configId}): se ignora`,
      )
      return null
    }

    return guardado.chatbotData
  } catch (error) {
    console.warn(`[RECORDATORIO] No se pudo leer el turno del mensaje ${wamid}:`, error)
    return null
  }
}

/** El id del mensaje al que el paciente está respondiendo, si lo hay. */
export function wamidDelMensajeRespondido(message: any): string | undefined {
  const id = message?.context?.id
  return typeof id === "string" && id.trim() ? id.trim() : undefined
}

/**
 * ── Quiénes recibieron recordatorios en este teléfono (13/11/2026) ────────
 *
 * El caso: después de confirmar los dos turnos, el paciente escribió "puedo
 * tomar otro turno?" y el bot arrancó la gestión con Testdos —el último
 * recordatorio— sin preguntar de quién se trataba. Un mensaje de texto libre
 * no viene atado a ningún recordatorio, así que el `wamid` no ayuda: hay que
 * preguntar.
 *
 * Para preguntar hay que saber que hace falta preguntar, y esto es lo que lo
 * sabe: los pacientes a los que se le mandó un recordatorio a ese teléfono.
 * Si son dos o más, no se asume ninguno.
 *
 * Por qué de acá y no consultando al backend: es gratis —ya estamos
 * escribiendo el recordatorio— y no agrega una llamada a la API en el camino
 * caliente de cada mensaje. No pretende ser la lista completa de pacientes del
 * teléfono: para eso está el aviso `pacientes_multiples` de `get_paciente`,
 * que sigue funcionando como antes. Esto cubre el caso que se puede saber sin
 * preguntarle a nadie.
 */
const PREFIJO_PACIENTES = "recordatorio:pacientes:"

export interface TurnoDeUnRecordatorio {
  agendaId?: string
  fecha?: string
  hora?: string
}

export interface PacienteConRecordatorio {
  dni: string
  nombres?: string
  apellido?: string
  /**
   * Los turnos que le avisamos a ESTE paciente.
   *
   * Es lo que permite atribuir un turno cuando la lista que devuelve la API no
   * dice de quién es cada uno. Ver `atribucionPorRecordatorios`.
   */
  turnos?: TurnoDeUnRecordatorio[]
}

interface RegistroDelTelefono {
  pacientes: Record<string, PacienteConRecordatorio>
  /** Cuándo llegó el último recordatorio. Invalida la identificación anterior. */
  ultimoRecordatorioEl?: string
  /** A quién identificamos, y cuándo. Ver `quienEstaEscribiendo`. */
  identificadoDni?: string
  identificadoEl?: string
}

function clavePacientes(configId: string, telefono: string): string {
  return `${PREFIJO_PACIENTES}${configId}:${telefono}`
}

async function leerRegistro(configId: string, telefono: string): Promise<RegistroDelTelefono> {
  const vacio: RegistroDelTelefono = { pacientes: {} }
  if (!configId || !telefono) return vacio
  const redis = getRedisClient()
  if (!redis) return vacio

  try {
    const crudo = await redis.get(clavePacientes(configId, telefono))
    if (!crudo) return vacio
    const leido = typeof crudo === "string" ? JSON.parse(crudo) : crudo
    // Compatibilidad con el formato anterior, que era el mapa pelado.
    if (leido && !leido.pacientes) return { pacientes: leido as Record<string, PacienteConRecordatorio> }
    return { pacientes: {}, ...leido }
  } catch (error) {
    console.warn("[RECORDATORIO] No se pudo leer el registro del teléfono:", error)
    return vacio
  }
}

async function escribirRegistro(
  configId: string,
  telefono: string,
  registro: RegistroDelTelefono,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.set(clavePacientes(configId, telefono), JSON.stringify(registro), { ex: VIDA_SEGUNDOS })
  } catch (error) {
    console.warn("[RECORDATORIO] No se pudo escribir el registro del teléfono:", error)
  }
}

/** Anota al paciente de un recordatorio. Indexado por documento: es la identidad que siempre está. */
export async function anotarPacienteDelTelefono(params: {
  configId: string
  telefono: string
  paciente?: { dni?: string; nombres?: string; apellido?: string }
  /** Los turnos del recordatorio, para poder atribuirlos después. */
  turnos?: any[]
}): Promise<void> {
  const dni = String(params.paciente?.dni || "").trim()
  if (!dni || !params.configId || !params.telefono) return

  const registro = await leerRegistro(params.configId, params.telefono)
  const yaAnotados = registro.pacientes[dni]?.turnos || []
  const nuevos = (params.turnos || [])
    .map((t) => ({
      agendaId: String(t?.agenda_id ?? t?.agendaId ?? "").trim() || undefined,
      fecha: String(t?.fecha ?? t?.Fecha ?? "").trim() || undefined,
      hora: String(t?.hora ?? t?.Hora ?? "").trim() || undefined,
    }))
    .filter((t) => t.agendaId || (t.fecha && t.hora))

  // Sin duplicar: el mismo turno puede venir en varios recordatorios.
  const clavesYa = new Set(yaAnotados.map((t) => `${t.agendaId}|${t.fecha}|${t.hora}`))
  const turnos = [...yaAnotados]
  for (const t of nuevos) {
    const clave = `${t.agendaId}|${t.fecha}|${t.hora}`
    if (!clavesYa.has(clave)) {
      clavesYa.add(clave)
      turnos.push(t)
    }
  }

  registro.pacientes[dni] = {
    dni,
    nombres: params.paciente?.nombres,
    apellido: params.paciente?.apellido,
    turnos,
  }
  registro.ultimoRecordatorioEl = new Date().toISOString()

  await escribirRegistro(params.configId, params.telefono, registro)

  const cuantos = Object.keys(registro.pacientes).length
  if (cuantos > 1) {
    console.log(
      `[RECORDATORIO] El teléfono ${params.telefono} tiene ${cuantos} pacientes con recordatorio: ` +
        `una gestión por texto libre va a pedir el DNI`,
    )
  }
}

/**
 * ¿Sabemos quién está escribiendo? (13/11/2026)
 *
 * Devuelve el paciente sólo si se identificó DESPUÉS del último recordatorio.
 * La fecha importa: en la prueba, el paciente se había identificado como
 * Testdos veinte minutos antes, llegaron dos recordatorios nuevos —uno de cada
 * paciente— y la identificación vieja hizo que la gestión siguiera con
 * Testdos. Un recordatorio nuevo vuelve la pregunta a cero.
 *
 * Con un solo paciente en el teléfono no hay nada que preguntar y esto no se
 * consulta.
 */
export async function quienEstaEscribiendo(
  configId: string,
  telefono: string,
): Promise<PacienteConRecordatorio | null> {
  const registro = await leerRegistro(configId, telefono)
  const { identificadoDni, identificadoEl, ultimoRecordatorioEl } = registro

  if (!identificadoDni || !identificadoEl) return null
  if (ultimoRecordatorioEl && ultimoRecordatorioEl > identificadoEl) return null

  return registro.pacientes[identificadoDni] || { dni: identificadoDni }
}

/** Anota a quién identificamos, para no volver a preguntarle en cada mensaje. */
export async function recordarQuienEscribe(
  configId: string,
  telefono: string,
  dni: string,
): Promise<void> {
  const limpio = String(dni || "").trim()
  if (!limpio) return
  const registro = await leerRegistro(configId, telefono)
  registro.identificadoDni = limpio
  registro.identificadoEl = new Date().toISOString()
  await escribirRegistro(configId, telefono, registro)
}

/** Los pacientes con recordatorio en ese teléfono. Vacío si no se sabe. */
export async function pacientesDelTelefono(
  configId: string,
  telefono: string,
): Promise<PacienteConRecordatorio[]> {
  const registro = await leerRegistro(configId, telefono)
  return Object.values(registro.pacientes)
}

/**
 * ¿A qué paciente se refiere este texto?
 *
 * Acepta el documento —"14123321", "14.123.321"— y el nombre, con o sin el
 * "soy" adelante. El nombre se compara por primer nombre y por apellido, en
 * minúsculas y sin acentos, y sólo cuenta si identifica a UNO: con dos
 * hermanas de apellido igual, "soy Gonzalez" no alcanza y se sigue
 * preguntando.
 *
 * Existe porque el paciente escribió "soy testuno" en medio de un flujo y
 * recibió "Perdón, no entendí tu mensaje" dos veces. Lo había dicho con todas
 * las letras.
 */
export function pacienteMencionado(
  texto: string,
  pacientes: PacienteConRecordatorio[],
): PacienteConRecordatorio | null {
  const crudo = String(texto || "").trim()
  if (!crudo || pacientes.length === 0) return null

  const digitos = crudo.replace(/[^0-9]/g, "")
  if (digitos.length >= 7 && digitos.length <= 8) {
    const porDni = pacientes.find((p) => String(p.dni || "").replace(/[^0-9]/g, "") === digitos)
    if (porDni) return porDni
  }

  const normalizar = (v?: string | null) =>
    String(v || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim()

  const dicho = normalizar(crudo)
  // Sin esto, un mensaje largo que mencione de paso el nombre de otro paciente
  // cambiaría de paciente solo. Se exige que el mensaje sea el nombre, o un
  // "soy <nombre>".
  const soloNombre = dicho.replace(/^(soy|habla|es)\s+/, "").replace(/[.!¡?¿,]/g, "").trim()
  if (!soloNombre || soloNombre.split(/\s+/).length > 3) return null

  const coincidencias = pacientes.filter((p) => {
    const nombres = normalizar(p.nombres)
    const apellido = normalizar(p.apellido)
    // "María Laura" son dos nombres de pila: tiene que coincidir la tira
    // completa, no sólo una palabra. Y el orden nombre/apellido varía según
    // quién lo escriba.
    const formas = new Set(
      [
        nombres,
        apellido,
        `${nombres} ${apellido}`.trim(),
        `${apellido} ${nombres}`.trim(),
        ...nombres.split(/\s+/),
        ...apellido.split(/\s+/),
      ].filter(Boolean),
    )
    return formas.has(soloNombre)
  })

  return coincidencias.length === 1 ? coincidencias[0] : null
}

/**
 * De quién es cada turno, según los recordatorios que mandamos (13/11/2026).
 *
 * ── Por qué hace falta ────────────────────────────────────────────────────
 *
 * `turnos_proximos` no dice de quién es cada turno. Se probó filtrar por
 * `paciente_id`, HC o documento y las filas no traen ninguno de los tres: el
 * paciente identificado como Testuno seguía viendo los dos turnos del
 * teléfono, el suyo y el de Testdos.
 *
 * Pero nosotros ya sabemos de quién es cada uno, porque fuimos nosotros los
 * que mandamos el recordatorio de cada turno a cada paciente. Esta función usa
 * ese conocimiento: es la misma idea que arregló la confirmación por botón —el
 * dato correcto ya lo teníamos, sólo había que no tirarlo—.
 *
 * ── Cómo se empareja ──────────────────────────────────────────────────────
 *
 * Por `agenda_id`, que identifica la fila exacta. Y si no está, por fecha más
 * hora, que en una misma agenda no se repiten. La hora se compara por sus
 * primeros cinco caracteres porque la API la devuelve de las dos formas —
 * "18:00" y "18:00:00"— según por dónde salga.
 *
 * ── Qué NO es ─────────────────────────────────────────────────────────────
 *
 * No es la lista de turnos del paciente: es sólo lo que podemos atribuir. Un
 * turno que el paciente sacó por teléfono y del que nunca se mandó un
 * recordatorio no está acá, y por eso los turnos que no se pueden atribuir se
 * conservan. Ver la nota de `turnosDelPaciente`.
 */
export interface AtribucionDeTurnos {
  /** Devuelve el documento del dueño del turno, o null si no se puede atribuir. */
  duenoDe(turno: any): string | null
  /** Si es false, no hay nada atribuido y no vale la pena consultar. */
  sirve: boolean
}

export async function atribucionPorRecordatorios(
  configId: string,
  telefono: string,
): Promise<AtribucionDeTurnos> {
  const pacientes = await pacientesDelTelefono(configId, telefono)

  const porAgenda = new Map<string, string>()
  const porFechaHora = new Map<string, string>()

  const horaCorta = (v: unknown) => String(v ?? "").trim().slice(0, 5)

  for (const paciente of pacientes) {
    for (const turno of paciente.turnos || []) {
      if (turno.agendaId) porAgenda.set(turno.agendaId, paciente.dni)
      if (turno.fecha && turno.hora) {
        porFechaHora.set(`${turno.fecha}|${horaCorta(turno.hora)}`, paciente.dni)
      }
    }
  }

  return {
    sirve: porAgenda.size > 0 || porFechaHora.size > 0,
    duenoDe(turno: any): string | null {
      const agendaId = String(turno?.agenda_id ?? turno?.Agenda_Id ?? turno?.agendaId ?? "").trim()
      if (agendaId && porAgenda.has(agendaId)) return porAgenda.get(agendaId)!

      const fecha = String(turno?.fecha ?? turno?.Fecha ?? "").trim()
      const hora = horaCorta(turno?.hora ?? turno?.Hora)
      if (fecha && hora) {
        const clave = `${fecha}|${hora}`
        if (porFechaHora.has(clave)) return porFechaHora.get(clave)!
      }

      return null
    },
  }
}
