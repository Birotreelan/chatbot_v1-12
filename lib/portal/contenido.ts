/**
 * Qué dice cada paso del enlace externo (13/10/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * El enlace se puede ver de dos formas: como pantallas (/p/<token>) o como una
 * conversación (/c/<token>). Son la misma máquina de pasos —`decidirPaso` en
 * pasos.ts— dibujada distinto.
 *
 * El texto de cada paso vivía dentro del JSX de app/p/[token]/page.tsx. Si el
 * chat lo reescribiera, la misma redacción quedaría en dos lugares, y el día
 * que alguien ajuste "¿A qué sede querés ir?" uno de los dos formatos se queda
 * viejo sin que nada falle. Es exactamente el problema que ya nos costó el
 * menú del paciente nuevo y las dos copias del `intentMap`.
 *
 * Acá cada paso declara su encabezado una sola vez. Los dos renderizadores
 * preguntan y dibujan.
 *
 * ── Qué NO vive acá ────────────────────────────────────────────────────────
 *
 * Lo interactivo. El calendario de `elegir_horario`, el formulario del alta,
 * la lista de sedes: eso cambia de forma entre una pantalla y una burbuja de
 * chat, y forzarlo a un molde común sólo agregaría una capa que después hay
 * que desarmar. Lo que tiene que coincidir es lo que el paciente LEE.
 *
 * Tampoco vive acá la decisión de qué paso corresponde: eso es `decidirPaso`,
 * y sigue siendo la única autoridad.
 */

import type { Paso } from "./pasos"

/** El ícono de `TituloDePaso`. Ver ICONOS_DE_PASO en components/portal/marco.tsx. */
export type TipoDePaso = "dni" | "datos" | "elegir" | "agenda" | "listo"

/**
 * La etapa del indicador de avance.
 *
 * Son las mismas tres de `PASOS_DEL_AVANCE` en components/portal/marco.tsx, y
 * no se importan desde ahí a propósito: este módulo no debe depender de un
 * componente de React, porque lo va a leer también el renderizador del chat.
 * Si alguna de las dos listas cambia, el typecheck de `EncabezadoDelPaso`
 * falla —ya pasó al escribir esto, con un "Listo" que no existe— y eso es
 * exactamente la protección que se busca.
 */
export type EtapaDeAvance = "Elegir" | "Revisar" | "Confirmar"

/**
 * Lo que hace falta saber para redactar el encabezado.
 *
 * Es deliberadamente chico: si creciera, sería la señal de que el contenido
 * está empezando a decidir cosas que no le tocan.
 */
export interface ContextoDelPaso {
  /**
   * El turno es para otra persona, no para quien escribe.
   *
   * Cambia la redacción completa, no un pronombre: si el texto dice "tu DNI",
   * el paciente carga el suyo y el turno queda a nombre equivocado.
   */
  paraFamiliar?: boolean
}

/**
 * El encabezado de un paso.
 *
 * `detalle` es un array y no un string porque dos pasos tienen dos párrafos, y
 * ya nos pasó que meter los dos en un `<p>` rompa el HTML. Un array deja que
 * cada renderizador los separe como le corresponda: párrafos en la pantalla,
 * líneas en la burbuja.
 */
export interface EncabezadoDePaso {
  avance: EtapaDeAvance
  tipo: TipoDePaso
  titulo: string
  detalle: string[]
}

/**
 * Los textos, exactamente como estaban en page.tsx.
 *
 * No se tocó una palabra al extraerlos, a propósito: esta fase no cambia nada
 * de lo que el paciente ve. Si además se hubiera mejorado la redacción, un
 * cambio visual en el portal de producción quedaría escondido dentro de un
 * refactor, y no habría forma de saber si algo se ve distinto porque el texto
 * cambió o porque la extracción salió mal.
 */
export function encabezadoDelPaso(
  paso: Paso,
  ctx: ContextoDelPaso = {},
): EncabezadoDePaso | null {
  const paraFamiliar = ctx.paraFamiliar === true

  switch (paso) {
    case "pedir_dni":
      return {
        avance: "Elegir",
        tipo: "dni",
        titulo: paraFamiliar
          ? "¿Cuál es el DNI de la persona que se va a atender?"
          : "¿Cuál es tu DNI?",
        detalle: [
          paraFamiliar
            ? "Si ya se atendió en la clínica, con el documento alcanza: recuperamos sus datos automáticamente."
            : "Si ya te atendiste en la clínica, con tu documento alcanza: recuperamos tus datos automáticamente.",
        ],
      }

    case "registrar":
      return {
        avance: "Elegir",
        tipo: "datos",
        titulo: paraFamiliar
          ? "Es su primera vez con nosotros"
          : "Es tu primera vez con nosotros",
        detalle: [
          paraFamiliar
            ? "Completá los datos de la persona que se va a atender. Luego vas a poder elegir el turno."
            : "Completá tus datos para registrarte. Luego vas a poder elegir el turno.",
        ],
      }

    case "elegir_sede":
      return {
        avance: "Elegir",
        tipo: "elegir",
        titulo: "¿A qué sede querés ir?",
        detalle: [
          "Seleccioná el lugar donde querés atenderte. Luego te mostraremos los horarios disponibles en esa sede.",
        ],
      }

    case "elegir_tipo_busqueda":
      return {
        avance: "Elegir",
        tipo: "elegir",
        titulo: "¿Cómo querés buscar tu turno?",
        detalle: [
          "Elegí cómo preferís buscar tu turno. Cualquiera de las opciones te lleva a los horarios disponibles.",
        ],
      }

    case "elegir_especialidad":
      return {
        avance: "Elegir",
        tipo: "elegir",
        titulo: "¿Qué especialidad necesitás?",
        detalle: [
          "Seleccioná la especialidad de tu consulta. Luego te mostraremos los horarios de los profesionales que la atienden.",
        ],
      }

    case "elegir_profesional":
      return {
        avance: "Elegir",
        tipo: "elegir",
        titulo: "¿Con qué profesional querés atenderte?",
        detalle: ["Seleccioná con quién querés atenderte. Luego te mostraremos sus horarios disponibles."],
      }

    case "elegir_horario":
      return {
        avance: "Elegir",
        tipo: "agenda",
        titulo: "Elegí cuándo querés tu turno",
        detalle: [
          "Seleccioná primero una fecha. Luego te mostraremos los horarios disponibles para ese día.",
          "Antes de confirmar, vas a poder revisar todos los datos de tu turno.",
        ],
      }

    case "reprogramar":
      return {
        avance: "Elegir",
        tipo: "agenda",
        titulo: "Elegí cuándo querés reprogramar tu turno",
        detalle: [
          "Seleccioná primero una fecha. Luego te mostraremos los horarios disponibles para ese día.",
          "Tu turno actual sigue vigente: no se cancela hasta que confirmes el cambio.",
        ],
      }

    // ── Los dos pasos sin encabezado ──────────────────────────────────────
    //
    // `gestionar_turno` y `derivar_obra_social` no tienen `TituloDePaso`: el
    // primero es un componente con las tres salidas juntas y el segundo es un
    // aviso cuyo título depende del nombre de la obra social, que no se conoce
    // acá. Devuelven `null` en lugar de un encabezado vacío para que el
    // renderizador tenga que decidir qué hace, en vez de dibujar un título en
    // blanco y que parezca que falta el dato.
    case "gestionar_turno":
    case "derivar_obra_social":
      return null
  }
}

// ─── El historial del chat ──────────────────────────────────────────────────

/**
 * Una pregunta ya respondida, para dibujarla como par de burbujas.
 *
 * La `pregunta` es una versión CORTA del título del paso, no el título entero:
 * en el historial alcanza con recordar de qué se trataba, y repetir el párrafo
 * completo de cada paso dejaría la conversación ilegible a los tres pasos.
 */
export interface PasoRespondido {
  paso: Paso
  pregunta: string
  respuesta: string
  /** `true` si el paciente puede volver a este paso. Ver PASOS_REVISITABLES. */
  revisitable: boolean
}

/** Las preguntas, en versión corta, para el historial. */
const PREGUNTA_CORTA: Partial<Record<Paso, string>> = {
  pedir_dni: "Tu DNI",
  registrar: "Tus datos",
  elegir_sede: "¿A qué sede querés ir?",
  elegir_tipo_busqueda: "¿Cómo querés buscar tu turno?",
  elegir_especialidad: "¿Qué especialidad necesitás?",
  elegir_profesional: "¿Con qué profesional querés atenderte?",
}

/**
 * Los pasos ya respondidos, derivados del estado.
 *
 * ── Por qué se derivan y no se guardan ────────────────────────────────────
 *
 * Porque el estado ya existe: los filtros viven en la query string y la
 * identidad en el token. Guardar además una transcripción daría dos respuestas
 * a la misma pregunta —"¿qué eligió el paciente?"— y un refresh o un "atrás"
 * del navegador podría mostrar una conversación que no coincide con el estado
 * real. Es el mismo criterio que `decidirPaso`: una sola autoridad.
 *
 * ── Por qué los nombres entran por parámetro ──────────────────────────────
 *
 * La URL tiene ids (`sedeId=00e3...`), y el historial necesita nombres ("Sede
 * Calle 56"). Resolverlos es E/S, y en este proyecto la E/S vive en la página
 * —ver la cabecera de pagina-del-enlace.tsx—. Esta función es pura: recibe los
 * nombres ya resueltos y arma el texto. Si no se pudo resolver alguno, se
 * omite la burbuja en lugar de mostrar un id: un identificador crudo en medio
 * de una conversación no le dice nada al paciente y parece un error.
 */
export function historialDelChat(params: {
  /** Lo que el paciente ya eligió, tal como viaja en la URL. */
  elegido: Record<string, string | undefined>
  /** DNI resuelto, del token o cargado en el enlace. */
  dni?: string
  /** `true` si el paciente se dio de alta en este enlace. */
  seDioDeAlta?: boolean
  /** Nombres ya resueltos, por id. */
  nombres: {
    sede?: string
    tipoBusqueda?: string
    especialidad?: string
    profesional?: string
  }
  /** Para decidir si ofrecer "Cambiar". */
  puedeCambiarDni?: boolean
}): PasoRespondido[] {
  const historial: PasoRespondido[] = []

  const agregar = (paso: Paso, respuesta: string | undefined, revisitable: boolean) => {
    if (!respuesta) return
    const pregunta = PREGUNTA_CORTA[paso]
    if (!pregunta) return
    historial.push({ paso, pregunta, respuesta, revisitable })
  }

  // El orden es el de la cadena de pasos, no el de los campos: así la
  // conversación se lee en el orden en que pasó.
  agregar("pedir_dni", params.dni, params.puedeCambiarDni === true)
  if (params.seDioDeAlta) {
    agregar("registrar", "Datos cargados", true)
  }
  agregar("elegir_sede", params.nombres.sede, true)
  agregar("elegir_tipo_busqueda", params.nombres.tipoBusqueda, false)
  agregar("elegir_especialidad", params.nombres.especialidad, false)
  agregar("elegir_profesional", params.nombres.profesional, false)

  return historial
}

/**
 * El saludo con el que arranca la conversación del chat.
 *
 * ── Por qué hay un saludo y en las pantallas no ───────────────────────────
 *
 * Porque una conversación que empieza con una pregunta a secas se lee como un
 * formulario disfrazado. La pantalla puede arrancar con el título del paso
 * —tiene el encabezado de la clínica arriba, que ya da contexto—; una burbuja
 * suelta que dice "¿Cuál es tu DNI?" no.
 *
 * Dice de dónde viene el enlace a propósito. El paciente lo abrió desde
 * WhatsApp y está a un toque de volver ahí: recordarle que es la misma gestión
 * evita el "¿esto es de la clínica?" que termina en un mensaje preguntándole al
 * bot — un mensaje que pagamos.
 *
 * `nombre` es el primero solo, como en el resto del portal: "Hola, Nicolas" y
 * no "Hola, Nicolas DE SANTIAGO".
 */
export function saludoDelChat(params: {
  nombre?: string
  clinica?: string
  /** El turno es para otra persona. Cambia a quién se le habla. */
  paraFamiliar?: boolean
}): string {
  const quien = params.nombre ? `Hola, ${params.nombre}` : "Hola"
  const donde = params.clinica ? ` de ${params.clinica}` : ""
  const que = params.paraFamiliar
    ? "Seguimos por acá con el turno de tu familiar."
    : "Seguimos por acá con tu turno."

  return `${quien}. Soy el asistente${donde} y continuamos la conversación de WhatsApp. ${que}`
}
