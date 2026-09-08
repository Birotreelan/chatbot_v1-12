import { defineConfig } from 'vitest/config'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Config SOLO para las evaluaciones contra la IA real (7/9/2026).
 *
 * Existe separado de vitest.config.ts porque estas evaluaciones son lo opuesto
 * a un test de build: llaman a la API de verdad, cuestan plata y su resultado
 * puede variar entre corridas. Meterlas en `pnpm test` haría el build lento e
 * intermitente, y un test que falla a veces termina ignorándose.
 *
 * Se corre con `pnpm eval:dispatcher`, a mano, cuando se toca algo que puede
 * mover el comportamiento del dispatcher: el prompt, el modelo, el manifiesto
 * de tools o el contexto que se le arma.
 */

/**
 * Carga las variables de .env.local / .env a mano.
 *
 * Next.js lee estos archivos solo, pero vitest no: corre sobre Node pelado, así
 * que sin esto `process.env.OPENAI_API_KEY` llega vacío y la evaluación no
 * puede llamar a la API (7/9/2026 — con lo que se estrelló el primer intento
 * de correrla).
 *
 * Es un parser mínimo a propósito, para no sumar `dotenv` como dependencia solo
 * para esto: KEY=VALOR, ignorando comentarios y comillas envolventes. No
 * soporta valores multilínea; si alguna vez hace falta uno, conviene traer
 * dotenv en vez de estirar esto.
 */
function cargarEnvLocal(): Record<string, string> {
  const vars: Record<string, string> = {}

  // El primero que define una clave gana (.env.local pisa a .env, igual que Next).
  for (const archivo of ['.env.local', '.env']) {
    const ruta = resolve(__dirname, archivo)
    if (!existsSync(ruta)) continue

    for (const linea of readFileSync(ruta, 'utf-8').split('\n')) {
      const match = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue

      const [, clave, bruto] = match
      // Lo que ya venga del shell manda: permite `MODELO_DISPATCHER=... pnpm eval:dispatcher`
      // sin tener que editar ningún archivo.
      if (clave in vars || process.env[clave]) continue

      vars[clave] = bruto.trim().replace(/^(['"])(.*)\1$/, '$2')
    }
  }

  return vars
}

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/evaluacion/dispatcher.test.ts'],
    env: cargarEnvLocal(),
    // Las llamadas reales son lentas y no queremos que vitest las corte.
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
    // Un solo worker: son llamadas secuenciales a la misma API, paralelizarlas
    // solo agrega rate limits.
    fileParallelism: false,
  },
})
