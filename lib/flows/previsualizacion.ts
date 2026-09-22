/**
 * Previsualización del Flow dentro de nuestro dashboard (22/9/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * WhatsApp Manager tiene un constructor que muestra el Flow como lo va a ver el
 * paciente. Funciona bien, pero obliga a salir a la plataforma de Meta para el
 * único paso que es de criterio y no de ejecución: mirar los textos antes de
 * publicar. Publicar no se deshace, así que ese momento importa.
 *
 * Esto traduce el Flow JSON a algo que el dashboard puede dibujar.
 *
 * ── Qué NO es ──────────────────────────────────────────────────────────────
 *
 * No es un renderer general de Flow JSON. Entiende los cuatro componentes que
 * usamos —TextBody, TextSubheading, RadioButtonsGroup y Footer— y nada más.
 * Cualquier otro aparece como "componente no previsualizable", con su tipo a la
 * vista, en vez de desaparecer en silencio.
 *
 * Decirlo importa: una previsualización que oculta lo que no entiende es peor
 * que no tenerla, porque da confianza sobre algo que no miró.
 *
 * ── Los datos que muestra ──────────────────────────────────────────────────
 *
 * El Flow es dinámico: `${data.turnos_disponibles}` lo completa el mensaje al
 * enviarse. Para previsualizar se usan los `__example__` que el propio Flow
 * JSON declara — los mismos que Meta exige y usa en su constructor.
 */

export type ComponenteVisible =
  | { tipo: "parrafo"; texto: string }
  | { tipo: "subtitulo"; texto: string }
  | { tipo: "opciones"; etiqueta: string; opciones: Array<{ id: string; title: string; description?: string }> }
  | { tipo: "boton"; texto: string }
  | { tipo: "desconocido"; texto: string }

export interface PantallaVisible {
  id: string
  titulo: string
  terminal: boolean
  componentes: ComponenteVisible[]
}

const REFERENCIA_SOLA = /^\$\{data\.([\w-]+)\}$/
const REFERENCIA_EMBEBIDA = /\$\{data\.([\w-]+)\}/g

/**
 * `${data.campo}` → el valor de `__example__` declarado para ese campo.
 *
 * Hay dos formas, y las dos aparecen en nuestro Flow JSON:
 *
 *  - La referencia SOLA (`"${data.turnos_disponibles}"`), que es como se pasa
 *    un array a un `data-source`. Ahí hay que devolver el valor entero, no su
 *    representación en texto.
 *  - La referencia EMBEBIDA ("Vas a cancelar tu turno del ${data.turno_actual}."),
 *    que es como se arma una frase. Ahí se reemplaza en el lugar.
 *
 * La primera versión sólo contemplaba la de arriba y la previsualización
 * mostraba la frase con el `${…}` crudo. Lo atrapó un test.
 *
 * Si la referencia no existe entre los ejemplos, se deja tal cual en vez de
 * vaciarla: ver un `${data.turnos}` en la previsualización es el aviso de que
 * el Flow JSON tiene un campo mal escrito.
 */
function resolver(valor: unknown, ejemplos: Record<string, unknown>): unknown {
  if (typeof valor !== "string") return valor

  const sola = valor.match(REFERENCIA_SOLA)
  if (sola) return sola[1] in ejemplos ? ejemplos[sola[1]] : valor

  return valor.replace(REFERENCIA_EMBEBIDA, (original, campo) =>
    campo in ejemplos ? String(ejemplos[campo]) : original,
  )
}

/** Los `__example__` de la declaración `data` de la pantalla. */
function ejemplosDeLaPantalla(screen: any): Record<string, unknown> {
  const declaracion = screen?.data
  if (!declaracion || typeof declaracion !== "object") return {}

  const ejemplos: Record<string, unknown> = {}
  for (const [campo, definicion] of Object.entries(declaracion as Record<string, any>)) {
    if (definicion && typeof definicion === "object" && "__example__" in definicion) {
      ejemplos[campo] = definicion.__example__
    }
  }
  return ejemplos
}

function texto(valor: unknown): string {
  if (typeof valor === "string") return valor
  if (valor === null || valor === undefined) return ""
  return String(valor)
}

export function previsualizarPantalla(screen: any): PantallaVisible {
  const ejemplos = ejemplosDeLaPantalla(screen)
  const hijos: any[] = Array.isArray(screen?.layout?.children) ? screen.layout.children : []

  const componentes: ComponenteVisible[] = hijos.map((hijo): ComponenteVisible => {
    switch (hijo?.type) {
      case "TextBody":
      case "TextCaption":
        return { tipo: "parrafo", texto: texto(resolver(hijo.text, ejemplos)) }

      case "TextHeading":
      case "TextSubheading":
        return { tipo: "subtitulo", texto: texto(resolver(hijo.text, ejemplos)) }

      case "RadioButtonsGroup":
      case "Dropdown": {
        const fuente = resolver(hijo["data-source"], ejemplos)
        const opciones = Array.isArray(fuente)
          ? fuente.map((o: any) => ({
              id: texto(o?.id),
              title: texto(o?.title),
              ...(o?.description ? { description: texto(o.description) } : {}),
            }))
          : []
        return { tipo: "opciones", etiqueta: texto(resolver(hijo.label, ejemplos)), opciones }
      }

      case "Footer":
        return { tipo: "boton", texto: texto(resolver(hijo.label, ejemplos)) }

      default:
        return { tipo: "desconocido", texto: texto(hijo?.type) || "sin tipo" }
    }
  })

  return {
    id: texto(screen?.id),
    titulo: texto(screen?.title) || texto(screen?.id),
    terminal: screen?.terminal === true,
    componentes,
  }
}

export function previsualizarFlow(flowJson: any): PantallaVisible[] {
  const pantallas = Array.isArray(flowJson?.screens) ? flowJson.screens : []
  return pantallas.map(previsualizarPantalla)
}
