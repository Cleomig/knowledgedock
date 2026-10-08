import '@testing-library/jest-dom/vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Carga `.env.local` en process.env para los tests.
 *
 * Vitest no carga los .env de Next.js por sí solo. Sin esto,
 * los tests de integración de Gemini se saltarían por falta de key
 * aunque existiera un `.env.local` válido.
 *
 * No pisa variables ya definidas (un valor inyectado por CI manda).
 */
function loadLocalEnv(): void {
  const file = resolve(__dirname, '..', '.env.local')
  if (!existsSync(file)) return

  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue // comentarios y líneas vacías
    const [, key, rawValue] = match
    if (key in process.env) continue
    // Quita comillas envolventes si las hay
    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadLocalEnv()
