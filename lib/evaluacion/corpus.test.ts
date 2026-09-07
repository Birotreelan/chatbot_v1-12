/**
 * lib/evaluacion/corpus.test.ts
 *
 * Corre el corpus de evaluación contra el clasificador por REGLAS.
 *
 * ── Por qué sólo las reglas ───────────────────────────────────────────────
 *
 * El clasificador real es en cascada: reglas primero y, si la confianza queda
 * por debajo de 0.7, GPT-4o-mini. Este runner ejercita únicamente la capa de
 * reglas, y es a propósito:
 *
 *   - Es gratis, instantáneo y determinístico: se puede correr en cada cambio
 *     sin pensar en costos ni en flakiness.
 *   - Es exactamente la capa donde se produjeron los errores que nos costaron
 *     conversaciones (`que tengo`, `no voy`, el signo de interrogación). Un
 *     regex mal escrito rompe acá, y acá se detecta.
 *
 * Los casos marcados `requiereIA` son los que por definición NO se pueden
 * resolver mirando palabras sueltas. Para ellos el resultado correcto de las
 * reglas es **no decidir** (confianza < 0.7) y ceder a la IA. Si una regla los
 * clasifica con alta confianza, eso es una FALLA: significa que volvimos a
 * poner un patrón ambiguo decidiendo por su cuenta.
 *
 * Ese es el invariante central que protege este archivo:
 *
 *   Una regla sólo puede decidir cuando no hay ambigüedad posible.
 *
 * Correr con:  pnpm corpus
 */

import { describe, it, expect } from 'vitest'
import { CORPUS, type CasoCorpus } from './corpus'
import { classifyIntentWithRules } from '../conversation-state/nlu-fallback-handler'

/** Umbral con el que classifyIntent() acepta el resultado de las reglas. */
const UMBRAL_DECISION = 0.7

interface Resultado {
  caso: CasoCorpus
  obtenido: string
  confianza: number
  decidio: boolean
  ok: boolean
}

function evaluar(caso: CasoCorpus): Resultado {
  const r = classifyIntentWithRules(caso.mensaje, caso.contexto ?? {})
  const decidio = r.confidence >= UMBRAL_DECISION

  // Hay dos formas de "acertar", según lo que el caso espera:
  //
  //  a) ABSTENERSE. Vale para los casos que necesitan contexto (requiereIA) y
  //     también para los que esperan 'otro': 'otro' no es una intención que se
  //     pueda afirmar, es "ninguna regla debe apropiarse de este mensaje".
  //     Ejemplo: "9390322 rosa mattos" es el dato de un paso, no una intención.
  //
  //  b) ACERTAR LA INTENCIÓN, decidiendo con confianza suficiente.
  //
  // (7/9/2026: la primera versión exigía `decidio === true` también para los
  // casos de 'otro', así que los daba por fallados justo cuando se comportaban
  // como queríamos.)
  const esperaAbstencion = caso.requiereIA === true || caso.esperado === 'otro'

  const ok = esperaAbstencion
    ? !decidio
    : decidio && r.intent === caso.esperado

  return { caso, obtenido: r.intent, confianza: r.confidence, decidio, ok }
}

function formatearFalla(r: Resultado): string {
  const lineas: Array<string | null> = [
    `  Mensaje:   "${r.caso.mensaje}"`,
    `  Origen:    ${r.caso.origen}`,
    r.caso.contexto?.confirmacionPendiente ? `  Contexto:  hay una confirmación de turno pendiente` : null,
    r.caso.requiereIA === true || r.caso.esperado === 'otro'
      ? `  Esperado:  que las reglas NO decidan (lo resuelve la IA o el handler del paso)`
      : `  Esperado:  ${r.caso.esperado}`,
    `  Obtenido:  ${r.obtenido} (confianza ${r.confianza}${r.decidio ? ' — DECIDIÓ' : ' — cedió a la IA'})`,
  ]
  if (r.caso.nota) lineas.push(`  Nota:      ${r.caso.nota}`)
  return lineas.filter(Boolean).join('\n')
}

describe('Corpus de comprensión del lenguaje — capa de reglas', () => {
  const resultados = CORPUS.map(evaluar)
  // Los `pendiente` son fallas conocidas y documentadas: se informan, no cortan.
  const activos = resultados.filter((r) => !r.caso.pendiente)
  const pendientes = resultados.filter((r) => r.caso.pendiente)
  const regresiones = activos.filter((r) => r.caso.tipo === 'regresion')
  const cobertura = activos.filter((r) => r.caso.tipo === 'cobertura')

  it('reporta la precisión del corpus', () => {
    const aciertos = activos.filter((r) => r.ok).length
    const total = activos.length
    const pct = ((aciertos / total) * 100).toFixed(1)

    console.log('\n' + '═'.repeat(72))
    console.log(`CORPUS: ${aciertos}/${total} (${pct}%)`)
    console.log(
      `  Regresiones: ${regresiones.filter((r) => r.ok).length}/${regresiones.length}` +
        `   ·   Cobertura: ${cobertura.filter((r) => r.ok).length}/${cobertura.length}` +
        `   ·   Pendientes conocidos: ${pendientes.length}`,
    )
    console.log('═'.repeat(72))

    const fallas = activos.filter((r) => !r.ok)
    if (fallas.length > 0) {
      console.log(`\n${fallas.length} caso(s) sin resolver:\n`)
      for (const f of fallas) {
        console.log(formatearFalla(f))
        console.log('')
      }
    }

    if (pendientes.length > 0) {
      console.log(`\nConocidos sin resolver (no bloquean):\n`)
      for (const p of pendientes) {
        console.log(formatearFalla(p))
        console.log(`  Pendiente: ${p.caso.pendiente}`)
        console.log('')
      }
    }

    // Este test siempre pasa: su trabajo es informar. Los que cortan son los de abajo.
    expect(total).toBeGreaterThan(0)
  })

  /**
   * Las regresiones son casos que YA rompieron con pacientes reales. Volver a
   * fallar uno significa reintroducir un bug conocido, así que esto sí corta.
   */
  it('no reintroduce ninguna regresión conocida', () => {
    const detalle = regresiones.filter((r) => !r.ok).map(formatearFalla).join('\n\n')
    expect(detalle, `\n\nRegresiones reintroducidas:\n\n${detalle}\n`).toBe('')
  })

  /**
   * El invariante de diseño: ninguna regla puede resolver por su cuenta un
   * mensaje que necesita entender la oración completa. Si esto falla, alguien
   * volvió a agregar un patrón ambiguo decidiendo con alta confianza — que es
   * exactamente la causa del caso Guemes.
   */
  it('ninguna regla decide sobre mensajes que requieren contexto', () => {
    const detalle = activos
      .filter((r) => r.caso.requiereIA && r.decidio)
      .map(formatearFalla)
      .join('\n\n')
    expect(
      detalle,
      `\n\nHay reglas decidiendo sobre mensajes ambiguos (deberían ceder a la IA):\n\n${detalle}\n`,
    ).toBe('')
  })
})
