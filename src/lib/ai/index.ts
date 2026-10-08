import type { AiProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { GroqProvider } from "./groq";
import { OpenRouterProvider } from "./openrouter";

let singleton: AiProvider | null = null;

/**
 * Factory que retorna el singleton del proveedor configurado.
 * El proveedor se selecciona según la variable de entorno `AI_PROVIDER`.
 *
 * Valores soportados:
 *   - `gemini`      (por defecto, usa GEMINI_API_KEY)
 *   - `groq`        (solo chat, usa GROQ_API_KEY)
 *   - `openrouter`  (chat + embeddings, usa OPENROUTER_API_KEY)
 *
 * Nota: las importaciones son estáticas (antes usaban `require` dinámico,
 * que impedía testear el factory y obligaba a desactivar el lint).
 * Instanciar no ocurre aquí, así que una key ausente solo falla al usarse.
 */
export function getAiProvider(): AiProvider {
  if (singleton) return singleton;

  const provider = process.env.AI_PROVIDER ?? "gemini";
  let instance: AiProvider;

  switch (provider) {
    case "gemini":
      instance = new GeminiProvider(process.env);
      break;
    case "groq":
      instance = new GroqProvider(process.env);
      break;
    case "openrouter":
      instance = new OpenRouterProvider(process.env);
      break;
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${provider}". Supported: gemini, groq, openrouter.`
      );
  }

  singleton = instance;
  return singleton;
}

/**
 * Restablece el singleton. Solo para tests: sin esto, un test que cambie
 * `AI_PROVIDER` seguiría recibiendo la instancia cacheada del anterior.
 */
export function resetAiProviderForTests(): void {
  singleton = null;
}
