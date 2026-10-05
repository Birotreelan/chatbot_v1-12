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
 * `tipo_mensaje` y lo único que los distingue es el nombre de la plantilla. El
 * número es la CANTIDAD DE TURNOS que anuncia el mensaje —`confirmacion_3_turno`
 * avisa tres turnos en uno—, no el orden del recordatorio. Que falte el de tres
 * turnos mientras llegan los otros dos es un problema real y perfectamente
 * silencioso: afecta a pocos pacientes por día y no mueve ningún total.
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

/**
 * Lo que necesita un recordatorio de `cantidad` turnos.
 *
 * El número de la plantilla es la CANTIDAD DE TURNOS que anuncia, no el orden
 * del recordatorio: `confirmacion_3_turno` es el aviso de tres turnos. Por eso
 * se exigen los datos de cada uno —si llega con dos, la plantilla sale con
 * parámetros vacíos y el paciente recibe un recordatorio mutilado—, y por eso
 * la validación no es la misma para las tres.
 */
function requeridosDelRecordatorio(cantidad: number): string[] {
  const campos = ["paciente.telefono"]
  for (let i = 0; i < cantidad; i++) {
    campos.push(`turnos[${i}].fecha`, `turnos[${i}].hora`, `turnos[${i}].profesional`)
  }
  return campos
}

const REQUERIDOS_DEL_AVISO = ["paciente.telefono", "turnos[].fecha", "turnos[].hora"]

export const TIPOS_ESPERADOS: TipoEsperado[] = [
  {
    clave: "confirmacion_1_turno",
    plantilla: "confirmacion_1_turno",
    nombre: "Recordatorio de 1 turno",
    descripcion:
      "El recordatorio con los botones de confirmar y cancelar, para el paciente que tiene un solo turno. Es el de mayor volumen y el que más pesa en la facturación.",
    requeridos: requeridosDelRecordatorio(1),
  },
  {
    clave: "confirmacion_2_turno",
    plantilla: "confirmacion_2_turno",
    nombre: "Recordatorio de 2 turnos",
    descripcion:
      "El mismo recordatorio para el paciente que tiene dos turnos: los anuncia a los dos en un solo mensaje.",
    requeridos: requeridosDelRecordatorio(2),
  },
  {
    clave: "confirmacion_3_turno",
    plantilla: "confirmacion_3_turno",
    nombre: "Recordatorio de 3 turnos",
    descripcion:
      "El recordatorio del paciente con tres turnos. Es el de menos volumen, así que si deja de llegar no se nota: los de uno y dos turnos siguen saliendo y el problema sólo afecta a unos pocos pacientes por día.",
    requeridos: requeridosDelRecordatorio(3),
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
 * `turnos[].campo` mira el primer turno; `turnos[1].campo`, el segundo. El
 * índice explícito es lo que permite verificar que un `confirmacion_3_turno`
 * traiga de verdad los tres turnos: si viene con dos, la plantilla se envía
 * con un parámetro vacío y el paciente recibe un recordatorio mutilado.
 */
export function leerRuta(datos: any, ruta: string): unknown {
  if (!datos) return undefined

  return ruta.split(".").reduce<any>((actual, parte) => {
    if (actual === null || actual === undefined) return undefined

    // `turnos[]` = el primero. `turnos[1]` = el segundo, y así.
    const conIndice = parte.match(/^(.+)\[(\d*)\]$/)
    if (conIndice) {
      const campo = conIndice[1]
      const indice = conIndice[2] === "" ? 0 : Number(conIndice[2])
      const lista = actual[campo]
      return Array.isArray(lista) ? lista[indice] : undefined
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
