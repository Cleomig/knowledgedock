import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAiProvider, resetAiProviderForTests } from '../src/lib/ai'
import { GeminiProvider, EMBEDDING_DIMENSIONS } from '../src/lib/ai/gemini'
import { GroqProvider } from '../src/lib/ai/groq'
import { OpenRouterProvider } from '../src/lib/ai/openrouter'
import { toPrompt } from '../src/lib/ai/prompt'
import type { AiProvider } from '../src/lib/ai/types'

const ROOT = resolve(__dirname, '..')

describe('getAiProvider (factory real)', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    resetAiProviderForTests()
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GROQ_API_KEY = 'test-key'
    process.env.OPENROUTER_API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env = originalEnv
    resetAiProviderForTests()
  })

  it('devuelve GeminiProvider por defecto', () => {
    delete process.env.AI_PROVIDER
    expect(getAiProvider()).toBeInstanceOf(GeminiProvider)
  })

  it('respeta AI_PROVIDER=gemini', () => {
    process.env.AI_PROVIDER = 'gemini'
    expect(getAiProvider()).toBeInstanceOf(GeminiProvider)
  })

  it('respeta AI_PROVIDER=groq', () => {
    process.env.AI_PROVIDER = 'groq'
    expect(getAiProvider()).toBeInstanceOf(GroqProvider)
  })

  it('respeta AI_PROVIDER=openrouter', () => {
    process.env.AI_PROVIDER = 'openrouter'
    expect(getAiProvider()).toBeInstanceOf(OpenRouterProvider)
  })

  it('es un singleton: dos llamadas devuelven la misma instancia', () => {
    process.env.AI_PROVIDER = 'gemini'
    expect(getAiProvider()).toBe(getAiProvider())
  })

  it('el cache sobrevive a cambios de AI_PROVIDER (comportamiento documentado)', () => {
    process.env.AI_PROVIDER = 'gemini'
    const first = getAiProvider()

    process.env.AI_PROVIDER = 'groq'
    expect(getAiProvider()).toBe(first)
    expect(getAiProvider()).toBeInstanceOf(GeminiProvider)

    // y resetAiProviderForTests() sí lo limpia
    resetAiProviderForTests()
    expect(getAiProvider()).toBeInstanceOf(GroqProvider)
  })

  it('falla limpiamente con un proveedor desconocido', () => {
    process.env.AI_PROVIDER = 'no-existe'
    expect(() => getAiProvider()).toThrow(/Unknown AI_PROVIDER "no-existe"/)
  })

  it('no cachea una instancia si el proveedor era inválido', () => {
    process.env.AI_PROVIDER = 'no-existe'
    expect(() => getAiProvider()).toThrow()
    resetAiProviderForTests()
    process.env.AI_PROVIDER = 'gemini'
    expect(getAiProvider()).toBeInstanceOf(GeminiProvider)
  })
})

describe('validación de credenciales por proveedor', () => {
  // Next.js amplía ProcessEnv exigiendo NODE_ENV, así que lo incluimos.
  const env = (vars: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    NODE_ENV: 'test',
    ...vars,
  })

  const cases: Array<[string, () => void, string]> = [
    ['GeminiProvider', () => new GeminiProvider(env()), 'GEMINI_API_KEY'],
    ['GroqProvider', () => new GroqProvider(env()), 'GROQ_API_KEY'],
    ['OpenRouterProvider', () => new OpenRouterProvider(env()), 'OPENROUTER_API_KEY'],
  ]

  for (const [name, build, expectedKey] of cases) {
    it(`${name} lanza un error claro si falta ${expectedKey}`, () => {
      expect(build).toThrow(new RegExp(`${expectedKey} is required`))
    })
  }

  it('cada proveedor construye correctamente con su key presente', () => {
    expect(() => new GeminiProvider(env({ GEMINI_API_KEY: 'k' }))).not.toThrow()
    expect(() => new GroqProvider(env({ GROQ_API_KEY: 'k' }))).not.toThrow()
    expect(() =>
      new OpenRouterProvider(env({ OPENROUTER_API_KEY: 'k' }))
    ).not.toThrow()
  })
})

describe('contrato de la interfaz AiProvider', () => {
  const env = (vars: Record<string, string>): NodeJS.ProcessEnv => ({
    NODE_ENV: 'test',
    ...vars,
  })

  const providers: Array<[string, AiProvider]> = [
    ['gemini', new GeminiProvider(env({ GEMINI_API_KEY: 'k' }))],
    ['groq', new GroqProvider(env({ GROQ_API_KEY: 'k' }))],
    ['openrouter', new OpenRouterProvider(env({ OPENROUTER_API_KEY: 'k' }))],
  ]

  for (const [name, provider] of providers) {
    it(`${name} implementa chat, streamChat, embed y embedBatch`, () => {
      expect(typeof provider.chat).toBe('function')
      expect(typeof provider.streamChat).toBe('function')
      expect(typeof provider.embed).toBe('function')
      expect(typeof provider.embedBatch).toBe('function')
    })
  }

  it('Groq rechaza embeddings con un mensaje accionable', async () => {
    const groq = new GroqProvider(env({ GROQ_API_KEY: 'k' }))
    await expect(groq.embed('hola')).rejects.toThrow(/does not support embeddings/)
    await expect(groq.embedBatch(['a'])).rejects.toThrow(/Gemini or OpenRouter/)
  })
})

describe('consistencia de dimensiones con el schema', () => {
  it('EMBEDDING_DIMENSIONS coincide con vector(N) de db/schema.sql', () => {
    const schema = readFileSync(resolve(ROOT, 'db', 'schema.sql'), 'utf8')
    const match = /embedding\s+vector\((\d+)\)/i.exec(schema)

    expect(match).not.toBeNull()
    const schemaDimensions = Number(match![1])

    expect(EMBEDDING_DIMENSIONS).toBe(schemaDimensions)
    expect(EMBEDDING_DIMENSIONS).toBe(768)
  })

  it('el schema define la extensión vector y el índice HNSW', () => {
    const schema = readFileSync(resolve(ROOT, 'db', 'schema.sql'), 'utf8')

    expect(schema).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i)
    expect(schema).toMatch(/USING hnsw/i)
    expect(schema).toMatch(/vector_cosine_ops/i)
  })
})

describe('toPrompt: separa el rol system', () => {
  /**
   * Regresión: el SDK lanza
   *   AI_InvalidPromptError: System messages are not allowed in the prompt or
   *   messages fields. Use the instructions option instead.
   * si `role: "system"` viaja dentro de `messages`. /api/ask fallaba en
   * silencio: el SSE emitía citas y [done] pero nunca texto.
   */
  it('saca el system a instructions y deja solo user/assistant', () => {
    const { instructions, messages } = toPrompt([
      { role: 'system', content: 'Eres un asistente.' },
      { role: 'user', content: '¿Qué es KnowledgeDock?' },
    ])

    expect(instructions).toBe('Eres un asistente.')
    expect(messages).toEqual([{ role: 'user', content: '¿Qué es KnowledgeDock?' }])
    // toContain no compara tipos literales, así que compila aunque el tipo
    // de mensajes ya excluya "system" a nivel de TypeScript.
    expect(messages.map((m) => m.role)).not.toContain('system')
  })

  it('concatena varios system en orden', () => {
    const { instructions } = toPrompt([
      { role: 'system', content: 'Uno' },
      { role: 'user', content: 'hola' },
      { role: 'system', content: 'Dos' },
    ])
    expect(instructions).toBe('Uno\n\nDos')
  })

  it('omite instructions si no hay system', () => {
    const { instructions, messages } = toPrompt([{ role: 'user', content: 'hola' }])
    expect(instructions).toBeUndefined()
    expect(messages).toHaveLength(1)
  })

  it('preserva el orden de user y assistant', () => {
    const { messages } = toPrompt([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ])
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('los tres proveedores usan toPrompt en chat y streamChat', () => {
    // No ejecutamos la red: comprobamos que el código no vuelve a pasar
    // `messages` con role system directamente al SDK.
    for (const file of ['gemini.ts', 'groq.ts', 'openrouter.ts']) {
      const src = readFileSync(resolve(ROOT, 'src', 'lib', 'ai', file), 'utf8')
      expect(src, `${file} debe importar toPrompt`).toContain('toPrompt')
      expect(src, `${file} no debe reenviar messages sin pasar por toPrompt`).not.toMatch(
        /messages:\s*messages\.map/
      )
    }
  })
})

describe('la abstracción del proveedor no se salta en las rutas', () => {
  /**
   * Regresión: /api/ask instanciaba `google("gemini-2.0-flash")` a mano.
   * Ese modelo ya no existe (404) y el export por defecto del SDK no lee
   * GEMINI_API_KEY, así que la ruta fallaba aunque la key fuera válida.
   *
   * Este test falla si alguien vuelve a importar un SDK de IA directamente
   * desde una ruta, en vez de pasar por getAiProvider().
   */
  function routeFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry)
      if (statSync(full).isDirectory()) out.push(...routeFiles(full))
      else if (entry === 'route.ts' || entry === 'route.tsx') out.push(full)
    }
    return out
  }

  it('ninguna ruta importa un SDK de IA directamente', () => {
    const apiDir = resolve(ROOT, 'src', 'app', 'api')
    const files = routeFiles(apiDir)

    // 4 archivos de ruta: documents, documents/[id], search y ask.
    expect(files).toHaveLength(4)

    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      // Tampoco vale importar el SDK sin usarlo: es la señal de que la
      // ruta se está saltando la abstracción por otro lado.
      if (/from\s+["'](@ai-sdk\/|@openrouter\/|groq["'])/.test(source)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('las rutas que usan IA la obtienen vía getAiProvider()', () => {
    const apiDir = resolve(ROOT, 'src', 'app', 'api')
    const files = routeFiles(apiDir)

    // /api/documents/[id] solo borra filas: no necesita IA.
    const needsAi = files.filter((f) => !f.includes('[id]'))
    expect(needsAi).toHaveLength(3)

    const missing = needsAi.filter((f) => !readFileSync(f, 'utf8').includes('getAiProvider'))
    expect(missing).toEqual([])
  })
})

describe('contrato de variables de entorno', () => {
  const example = readFileSync(resolve(ROOT, '.env.example'), 'utf8')

  it.each([
    'AI_PROVIDER',
    'GEMINI_API_KEY',
    'GEMINI_CHAT_MODEL',
    'GEMINI_EMBEDDING_MODEL',
    'DATABASE_URL',
  ])('.env.example documenta %s', (key) => {
    expect(example).toContain(key)
  })
})
