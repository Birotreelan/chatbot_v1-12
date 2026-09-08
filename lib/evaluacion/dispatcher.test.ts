/**
 * lib/evaluacion/dispatcher.test.ts
 *
 * Corre los casos de `casos-dispatcher.ts` contra el AI Dispatcher REAL y
 * reporta qué tool eligió en cada uno.
 *
 * ── NO corre en `pnpm test` ───────────────────────────────────────────────
 *
 * Está excluido del vitest.config principal a propósito: cada caso es una
 * llamada paga a la API y el resultado puede variar entre corridas. Meterlo en
 * el build lo haría lento, caro e intermitente — y un test que falla a veces
 * termina ignorándose, que es peor que no tenerlo.
 *
 * Corre solo cuando se lo invoca explícitamente, con su propio config:
 *
 *   pnpm eval:dispatcher                          # corre y compara con la baseline
 *   GUARDAR_BASELINE=1 pnpm eval:dispatcher       # guarda el resultado como baseline
 *   REPETICIONES=3 pnpm eval:dispatcher           # N corridas por caso
 *
 * ── Cómo medir un cambio de prompt o de modelo ────────────────────────────
 *
 *   1. Sin el cambio aplicado:  GUARDAR_BASELINE=1 pnpm eval:dispatcher
 *   2. Aplicá el cambio.
 *   3. Con el cambio aplicado:  pnpm eval:dispatcher
 *
 * El paso 3 imprime exactamente qué casos cambiaron de decisión. Eso es lo que
 * convierte "cambiemos de modelo" en un experimento con resultado, en vez de
 * una apuesta. Para probar otro modelo sin tocar código:
 *
 *   MODELO_DISPATCHER=gpt-4.1-mini pnpm eval:dispatcher
 *
 * Requiere OPENAI_API_KEY. No necesita Redis: sin él, las métricas de
 * diagnóstico simplemente no se registran.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { runAIDispatcher } from '../conversation-state/ai-dispatcher/dispatcher'
import { CASOS_DISPATCHER, type CasoDispatcher } from './casos-dispatcher'

const RUTA_BASELINE = resolve(process.cwd(), 'lib/evaluacion/baseline-dispatcher.json')
const GUARDAR_BASELINE = process.env.GUARDAR_BASELINE === '1'
const REPETICIONES = Number(process.env.REPETICIONES ?? 1)

/** Las llamadas reales a la API son lentas: 15 casos pueden tardar bastante. */
const TIMEOUT_MS = 10 * 60 * 1000

interface Resultado {
  caso: CasoDispatcher
  obtenidos: string[]
  ok: boolean
  inestable: boolean
}

interface Baseline {
  fecha: string
  modelo: string
  resultados: Record<string, string>
}

function recortar(texto: string, max = 70): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`
}

function formatearFalla(r: Resultado): string {
  const { caso } = r
  const lineas = [
    `  Mensaje:   "${caso.mensaje}"`,
    `  Contexto:  flujo=${caso.ctx.activeFlow.type}/${caso.ctx.activeFlow.phase}, turnos=${caso.ctx.turnos.length}` +
      (caso.ctx.templatePendingConfirmation ? ', recordatorio pendiente de responder' : ''),
    `  Esperado:  ${caso.esperado}`,
    `  Obtenido:  ${[...new Set(r.obtenidos)].join(', ')}`,
    caso.nota ? `  Nota:      ${caso.nota}` : null,
  ]
  return lineas.filter(Boolean).join('\n')
}

describe('AI Dispatcher — evaluación contra casos reales', () => {
  const resultados: Resultado[] = []

  beforeAll(async () => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'Falta OPENAI_API_KEY — esta evaluación llama a la API real.\n' +
          'vitest.eval.config.ts la busca en .env.local y .env del proyecto.\n' +
          'Si no tenés esos archivos localmente, traelos con `vercel env pull .env.local`,\n' +
          'o pasá la clave solo para esta corrida: OPENAI_API_KEY=... pnpm eval:dispatcher',
      )
    }

    for (const caso of CASOS_DISPATCHER) {
      const obtenidos: string[] = []
      for (let i = 0; i < REPETICIONES; i++) {
        const r = await runAIDispatcher('eval', 'eval', caso.mensaje, caso.ctx)
        obtenidos.push(r.handled ? r.tool : 'SIN_TOOL')
      }
      resultados.push({
        caso,
        obtenidos,
        ok: obtenidos.every((o) => o === caso.esperado),
        inestable: new Set(obtenidos).size > 1,
      })
    }
  }, TIMEOUT_MS)

  it('reporta la precisión y compara contra la baseline', () => {
    const aciertos = resultados.filter((r) => r.ok).length
    const pct = ((aciertos / resultados.length) * 100).toFixed(1)
    const regresiones = resultados.filter((r) => r.caso.tipo === 'regresion')
    const cobertura = resultados.filter((r) => r.caso.tipo === 'cobertura')

    console.log('\n' + '═'.repeat(72))
    console.log(`DISPATCHER: ${aciertos}/${resultados.length} (${pct}%)`)
    console.log(
      `  Regresiones: ${regresiones.filter((r) => r.ok).length}/${regresiones.length}` +
        `   ·   Cobertura: ${cobertura.filter((r) => r.ok).length}/${cobertura.length}` +
        `   ·   Repeticiones por caso: ${REPETICIONES}`,
    )
    console.log('═'.repeat(72))

    const fallas = resultados.filter((r) => !r.ok)
    if (fallas.length > 0) {
      console.log(`\n${fallas.length} caso(s) con la decisión equivocada:\n`)
      for (const f of fallas) {
        console.log(formatearFalla(f))
        console.log('')
      }
    }

    // Un caso que cambia de decisión entre corridas idénticas ya está fallando,
    // aunque hoy acierte: es el primero que se va a romper ante cualquier cambio.
    const inestables = resultados.filter((r) => r.inestable)
    if (inestables.length > 0) {
      console.log(`\n${inestables.length} caso(s) con decisión INESTABLE entre repeticiones:`)
      for (const i of inestables) {
        console.log(`  "${recortar(i.caso.mensaje)}" → ${i.obtenidos.join(' / ')}`)
      }
      console.log('')
    }

    // ── Baseline ───────────────────────────────────────────────────────────
    const actual: Record<string, string> = {}
    for (const r of resultados) actual[r.caso.mensaje] = r.obtenidos[0]

    if (GUARDAR_BASELINE) {
      const baseline: Baseline = {
        fecha: new Date().toISOString(),
        modelo: process.env.MODELO_DISPATCHER || 'gpt-4o-mini',
        resultados: actual,
      }
      writeFileSync(RUTA_BASELINE, JSON.stringify(baseline, null, 2) + '\n')
      console.log(`Baseline guardada en ${RUTA_BASELINE}\n`)
    } else if (!existsSync(RUTA_BASELINE)) {
      console.log('No hay baseline guardada. Corré `GUARDAR_BASELINE=1 pnpm eval:dispatcher` para crearla.\n')
    } else {
      const baseline: Baseline = JSON.parse(readFileSync(RUTA_BASELINE, 'utf-8'))
      const cambios = Object.entries(actual).filter(
        ([mensaje, tool]) => baseline.resultados[mensaje] && baseline.resultados[mensaje] !== tool,
      )
      const nuevos = Object.keys(actual).filter((m) => !(m in baseline.resultados))

      console.log(`Comparado con la baseline del ${baseline.fecha.slice(0, 10)} (modelo: ${baseline.modelo}):`)
      if (cambios.length === 0) {
        console.log('  Ningún caso cambió de decisión.')
      } else {
        console.log(`  ${cambios.length} caso(s) cambiaron de decisión:\n`)
        for (const [mensaje, tool] of cambios) {
          console.log(`  "${recortar(mensaje)}"`)
          console.log(`     antes: ${baseline.resultados[mensaje]}`)
          console.log(`     ahora: ${tool}`)
        }
      }
      if (nuevos.length > 0) console.log(`\n  ${nuevos.length} caso(s) nuevos, sin baseline previa.`)
      console.log('')
    }

    // Este test informa; los que cortan son los de abajo.
    expect(resultados.length).toBeGreaterThan(0)
  })

  it('no reintroduce ninguna regresión conocida', () => {
    const detalle = resultados
      .filter((r) => r.caso.tipo === 'regresion' && !r.ok)
      .map(formatearFalla)
      .join('\n\n')
    expect(detalle, `\n\nRegresiones reintroducidas:\n\n${detalle}\n`).toBe('')
  })

  it('no rompe ningún caso de cobertura', () => {
    const detalle = resultados
      .filter((r) => r.caso.tipo === 'cobertura' && !r.ok)
      .map(formatearFalla)
      .join('\n\n')
    expect(detalle, `\n\nCasos de cobertura rotos:\n\n${detalle}\n`).toBe('')
  })
})
