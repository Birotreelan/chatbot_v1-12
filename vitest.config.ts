import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Configuración de vitest (1/9/2026).
 *
 * Ya existían tests (`menu-option-detector.test.ts`, `selection-extractor.test.ts`)
 * y vitest estaba en las dependencias, pero no había ni config ni script para
 * correrlos: en la práctica nadie los ejecutaba. Sin el alias `@/` esos tests
 * ni siquiera resuelven sus imports.
 */
export default defineConfig({
  resolve: {
    // Mismo alias que tsconfig.json ("@/*": ["./*"]).
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: [
      'node_modules/**',
      '.next/**',
      // Se llama ".test.ts" pero no tiene tests: es un archivo de EJEMPLOS de uso
      // del selection-extractor, escrito para leerse, no para ejecutarse (su
      // propio encabezado dice "PRUEBAS Y EJEMPLOS"). Vitest lo levanta por el
      // nombre y falla con "No test suite found". Se excluye en vez de
      // renombrarlo para no romper referencias; si algún día se le escriben
      // tests de verdad, se saca de esta lista.
      'lib/conversation-state/selection-extractor.test.ts',
    ],
  },
})
