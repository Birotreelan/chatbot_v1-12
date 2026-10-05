/**
 * Qué tiene que mandarnos el sistema de la clínica (5/10/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Esta lista estaba escrita a mano, repartida entre los `if` del webhook y los
 * layouts de `lib/reminders/datos-del-turno.ts`. Eso alcanza para procesar lo
 * que llega, pero no para contestar la pregunta que importa en el despliegue
 * —"¿el sistema externo nos está mandando todo lo que necesitamos?"—, porque no
 * hay contra qué comparar: sin una lista declarada no existe el concepto de
 * "falta".
 *
 * ── Un evento, dos nombres ─────────────────────────────────────────────────
 *
 * El mismo envío se puede identificar de dos maneras, y las dos conviven:
 *
 *  - El NOMBRE de la plantilla aprobada en Meta, en `Body.template.name`:
 *    `confirmacion_1_turno`, `cancelar_turno_solicitado`…
 *  - El `tipo_mensaje` dentro de `Chatbot_Data`: `turno_cancelado_clinica`…
 *
 * Y no son dos cosas distintas: `cancelar_turno_solicitado` ES el envío cuyo
 * `tipo_mensaje` vale `turno_cancelado_clinica`. Listarlos como dos entradas
 * haría que una de las dos figure "nunca llegó" para siempre —la peor clase de
 * falso positivo, porque enseña a desconfiar del tablero—.
 *
 * Por eso cada entrada declara los dos identificadores que la nombran y tiene
 * UNA clave canónica. Un envío identificado por cualquiera de los dos cae en la
 * misma fila.
 *
 * Los tres recordatorios, en cambio, sí son tres filas: comparten el
 * `tipo_mensaje` y lo único que los distingue es el nombre de la plantilla. Que
 * falte el tercero mientras llegan los dos primeros es un problema real y
 * perfectamente silencioso.
 *
 * ── Los campos requeridos no son decorativos ───────────────────────────────
 *
 * Son los que el flujo correspondiente LEE. Si falta uno, el mensaje igual se
 * procesa pero falla más adelante, lejos de la causa: el recordatorio sale sin
 * hora, la cancelación no encuentra el turno. Registrar "llegó incompleto" como
 * un estado distinto de "no llegó" es lo que convierte esos bugs en algo que se
 * ve de una.
 *
 * Las rutas se evalúan sobre `Chatbot_Data` y usan puntos para bajar por el
 * objeto: `paciente.dni` busca `Chatbot_Data.paciente.dni`. `turnos[].fecha`
 * significa "en el primer turno del array" — es el que leen los flujos cuando
 * hay uno solo, que es el caso normal.
 */

export interface TipoEsperado {
  /** Clave canónica con la que se guarda y se busca. */
  clave: string
  /** Nombre de la plantilla en Meta, si llega como template. */
  plantilla?: string
  /** Valor de `Chatbot_Data.tipo_mensaje`, si lo trae. */
  tipoMensaje?: string
  /** Cómo se llama en el tablero. */
  nombre: string
  /** Qué hace el bot cuando llega, y por qué importa. */
  descripcion: string
  /** Sin estos campos el flujo no puede trabajar. */
  requeridos: string[]
  /** Se destaca en el tablero: si deja de llegar, hay pacientes sin respuesta. */
  critico?: boolean
}

const REQUERIDOS_DEL_RECORDATORIO = [
  "paciente.telefono",
  "turnos[].fecha",
  "turnos[].hora",
  "turnos[].profesional",
]

const REQUERIDOS_DEL_AVISO = ["paciente.telefono", "turnos[].fecha", "turnos[].hora"]

export const TIPOS_ESPERADOS: TipoEsperado[] = [
  {
    clave: "confirmacion_1_turno",
    plantilla: "confirmacion_1_turno",
    nombre: "Primer recordatorio",
    descripcion:
      "El recordatorio con los botones de confirmar y cancelar. Es el de mayor volumen y el que más pesa en la facturación.",
    requeridos: REQUERIDOS_DEL_RECORDATORIO,
  },
  {
    clave: "confirmacion_2_turno",
    plantilla: "confirmacion_2_turno",
    nombre: "Segundo recordatorio",
    descripcion: "El recordatorio siguiente, para quien no respondió al primero.",
    requeridos: REQUERIDOS_DEL_RECORDATORIO,
  },
  {
    clave: "confirmacion_3_turno",
    plantilla: "confirmacion_3_turno",
    nombre: "Tercer recordatorio",
    descripcion:
      "El último recordatorio. Es el que más fácil pasa desapercibido si deja de llegar: los dos primeros siguen saliendo y la caída no se nota.",
    requeridos: REQUERIDOS_DEL_RECORDATORIO,
  },
  {
    clave: "confirmar_turno_solicitado",
    plantilla: "confirmar_turno_solicitado",
    tipoMensaje: "turno_confirmado_clinica",
    nombre: "La clínica APROBÓ el turno pedido",
    descripcion:
      "Cierra el circuito del turno solicitado: el paciente pidió un turno —por el portal o por el chat—, le dijimos que la clínica tenía que aprobarlo, y éste es el aviso de que lo aprobó. Si deja de llegar, esos pacientes nunca se enteran de que tienen turno.",
    requeridos: REQUERIDOS_DEL_AVISO,
    critico: true,
  },
  {
    clave: "cancelar_turno_solicitado",
    plantilla: "cancelar_turno_solicitado",
    tipoMensaje: "turno_cancelado_clinica",
    nombre: "La clínica RECHAZÓ o dio de baja el turno",
    descripcion:
      "La otra mitad del circuito: la clínica no aceptó el turno pedido, o canceló uno vigente. El bot avisa y, si el turno lo admite, ofrece reagendar. Si deja de llegar, hay gente que se presenta a un turno que no existe.",
    requeridos: REQUERIDOS_DEL_AVISO,
    critico: true,
  },
  {
    clave: "turno_reagendado",
    tipoMensaje: "turno_reagendado",
    nombre: "Turno reagendado",
    descripcion: "El turno cambió de fecha u hora. El bot informa el turno nuevo.",
    requeridos: REQUERIDOS_DEL_AVISO,
  },
]

export function tipoEsperado(clave: string): TipoEsperado | undefined {
  return TIPOS_ESPERADOS.find((t) => t.clave === clave)
}

/**
 * A qué fila del catálogo corresponde este envío.
 *
 * Primero por nombre de plantilla, que es el identificador más específico: los
 * tres recordatorios comparten `tipo_mensaje` y sólo el nombre los distingue.
 * Si no hay plantilla conocida, se busca por `tipo_mensaje`.
 *
 * Si no cae en ninguna fila, devuelve la mejor identificación que tengamos con
 * el prefijo `desconocido:`. Eso es un dato, no un descarte: un error de tipeo
 * del otro lado explica que una fila figure como que nunca llegó, y sólo se
 * puede ver si se registra tal cual vino.
 */
export function claveDelEnvio(params: {
  nombreDePlantilla?: string | null
  tipoMensaje?: string | null
}): string {
  const plantilla = (params.nombreDePlantilla || "").trim()
  const tipo = (params.tipoMensaje || "").trim()

  if (plantilla) {
    const porPlantilla = TIPOS_ESPERADOS.find((t) => t.plantilla === plantilla)
    if (porPlantilla) return porPlantilla.clave
  }

  if (tipo) {
    const porTipo = TIPOS_ESPERADOS.find((t) => t.tipoMensaje === tipo)
    if (porTipo) return porTipo.clave
  }

  if (plantilla) return `desconocido:${plantilla}`
  if (tipo) return `desconocido:${tipo}`
  return "desconocido:(sin plantilla ni tipo_mensaje)"
}

/** Saca `Body.template.name`, tolerando que `Body` venga como string JSON. */
export function nombreDePlantilla(body: any): string | null {
  if (!body) return null
  try {
    const datos = typeof body === "string" ? JSON.parse(body) : body
    const nombre = datos?.template?.name ?? datos?.name
    return typeof nombre === "string" && nombre.trim() ? nombre.trim() : null
  } catch {
    return null
  }
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
export function camposFaltantes(clave: string, chatbotData: any): string[] {
  const esperado = tipoEsperado(clave)
  if (!esperado) return []

  return esperado.requeridos.filter((ruta) => {
    const valor = leerRuta(chatbotData, ruta)
    if (valor === null || valor === undefined) return true
    if (typeof valor === "string" && valor.trim() === "") return true
    return false
  })
}
