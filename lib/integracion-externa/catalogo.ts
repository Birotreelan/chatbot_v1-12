/**
 * Qué tiene que mandarnos el sistema de la clínica (5/10/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Esta lista estaba escrita a mano, repartida entre los `if` del webhook: un
 * `tipo_mensaje === 'turno_cancelado_clinica'` acá, otro allá. Eso alcanza para
 * procesar lo que llega, pero no para contestar la pregunta que importa en el
 * despliegue —"¿el sistema externo nos está mandando todo lo que necesitamos?"—,
 * porque no hay contra qué comparar: sin una lista declarada no existe el
 * concepto de "falta".
 *
 * Acá está declarada una sola vez. El webhook sigue decidiendo qué hacer con
 * cada tipo; esto sólo dice cuáles esperamos y qué campos necesita cada uno.
 *
 * ── Los campos requeridos no son decorativos ───────────────────────────────
 *
 * Son los que el flujo correspondiente LEE. Si falta uno, el mensaje igual se
 * procesa pero falla más adelante, lejos de la causa: el recordatorio sale sin
 * hora, la cancelación no encuentra el turno. Registrar "llegó incompleto" como
 * un estado distinto de "no llegó" es lo que convierte esos bugs en algo que se
 * ve de una.
 *
 * Las rutas usan puntos para bajar por el objeto: `paciente.dni` busca
 * `Chatbot_Data.paciente.dni`. `turnos[].fecha` significa "en el primer turno
 * del array" — es el que leen los flujos cuando hay uno solo.
 */

export interface TipoEsperado {
  /** El valor exacto de `Chatbot_Data.tipo_mensaje`. */
  tipo: string
  /** Cómo se llama en el tablero. */
  nombre: string
  /** Qué hace el bot cuando llega. */
  descripcion: string
  /** Sin estos campos el flujo no puede trabajar. Ver el encabezado. */
  requeridos: string[]
  /**
   * `true` cuando lo genera el bot y no la clínica.
   *
   * No se muestra como "falta": que no aparezca no es un problema de la
   * integración, y mezclarlo con lo que sí depende del sistema externo haría
   * ruido en la única tabla donde el ruido se paga caro.
   */
  propio?: boolean
}

export const TIPOS_ESPERADOS: TipoEsperado[] = [
  {
    tipo: "confirmacion_turno",
    nombre: "Recordatorio de turno",
    descripcion:
      "El recordatorio con los botones de confirmar y cancelar. Es el mensaje de mayor volumen y el que más pesa en la facturación.",
    requeridos: [
      "paciente.telefono",
      "turnos[].fecha",
      "turnos[].hora",
      "turnos[].profesional",
      "turnos[].sede",
    ],
  },
  {
    tipo: "turno_cancelado_clinica",
    nombre: "Cancelación hecha por la clínica",
    descripcion:
      "La clínica dio de baja el turno. El bot avisa al paciente y, si el turno lo admite, le ofrece reagendar.",
    requeridos: ["paciente.telefono", "turnos[].fecha", "turnos[].hora"],
  },
  {
    tipo: "turno_confirmado_clinica",
    nombre: "Confirmación hecha por la clínica",
    descripcion: "La clínica confirmó el turno. El bot se lo informa al paciente.",
    requeridos: ["paciente.telefono", "turnos[].fecha", "turnos[].hora"],
  },
  {
    tipo: "turno_reagendado",
    nombre: "Turno reagendado",
    descripcion: "El turno cambió de fecha u hora. El bot informa el turno nuevo.",
    requeridos: ["paciente.telefono", "turnos[].fecha", "turnos[].hora"],
  },
  {
    tipo: "turno_cancelado",
    nombre: "Turno cancelado",
    descripcion: "Baja del turno sin que la haya pedido la clínica.",
    requeridos: ["paciente.telefono"],
  },
  {
    tipo: "user_initiated",
    nombre: "Conversación iniciada por el paciente",
    descripcion: "Lo marca el bot cuando el paciente escribe primero. No lo manda la clínica.",
    requeridos: [],
    propio: true,
  },
]

/** Los que dependen del sistema externo: los únicos que pueden "faltar". */
export const TIPOS_DEL_SISTEMA_EXTERNO = TIPOS_ESPERADOS.filter((t) => !t.propio)

export function tipoEsperado(tipo: string): TipoEsperado | undefined {
  return TIPOS_ESPERADOS.find((t) => t.tipo === tipo)
}

/**
 * Lee una ruta con puntos dentro del `Chatbot_Data`.
 *
 * `turnos[].campo` mira el PRIMER turno. Es lo que hacen los flujos cuando el
 * paciente tiene uno solo, que es el caso normal; validar todo el array
 * marcaría como incompleto un payload con cuatro turnos donde al cuarto le
 * falta la dirección, y eso no es lo que rompe nada.
 */
export function leerRuta(datos: any, ruta: string): unknown {
  if (!datos) return undefined

  return ruta.split(".").reduce<any>((actual, parte) => {
    if (actual === null || actual === undefined) return undefined

    if (parte.endsWith("[]")) {
      const campo = parte.slice(0, -2)
      const lista = actual[campo]
      return Array.isArray(lista) ? lista[0] : undefined
    }

    return actual[parte]
  }, datos)
}

/**
 * Qué campos requeridos faltan en este payload.
 *
 * Vacío = llegó completo. Un campo presente pero vacío cuenta como faltante:
 * `hora: ""` rompe igual que no mandarla, y en el tablero tiene que verse igual.
 */
export function camposFaltantes(tipo: string, chatbotData: any): string[] {
  const esperado = tipoEsperado(tipo)
  if (!esperado) return []

  return esperado.requeridos.filter((ruta) => {
    const valor = leerRuta(chatbotData, ruta)
    if (valor === null || valor === undefined) return true
    if (typeof valor === "string" && valor.trim() === "") return true
    return false
  })
}
