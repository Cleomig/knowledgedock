import { describe, it, expect } from "vitest";
import { GeminiProvider } from "../src/lib/ai/gemini";

/**
 * Test de integración contra la API real de Gemini.
 *
 * Solo se ejecuta cuando hay GEMINI_API_KEY disponible (`.env.local`),
 * para no gastar cuota gratuita en cada `npm test` de CI.
 *
 * Cubre los dos bugs que solo aparecen contra la API real:
 *  1. La key debe llegar al SDK (el export `google` por defecto no lee
 *     GEMINI_API_KEY y fallaría con "API key is missing").
 *  2. El vector debe medir 768 para casar con `vector(768)` de schema.sql.
 *
 * Los timeouts son de 30s porque son llamadas de red reales; el default
 * de Vitest (5s) daba falsos negativos cuando el proveedor iba lento.
 */
const INTEGRATION_TIMEOUT = 30_000;

const apiKey = process.env.GEMINI_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

/**
 * El endpoint de chat del free tier devuelve 503 "high demand" de forma
 * intermitente: en medición la latencia varió de 2.8s a 31s y llegó a
 * agotar los reintentos del SDK y del propio test.
 *
 * Por eso este caso es opt-in (`RUN_CHAT_INTEGRATION=1`). Los tests de
 * embeddings sí corren siempre: son rápidos, estables y son los que
 * validan la dimensionalidad de 768 contra el schema.
 */
const chatIt = process.env.RUN_CHAT_INTEGRATION === "1" ? it : it.skip;

describeIf("GeminiProvider (integración real)", () => {
  // `describe.skip` ejecuta el cuerpo del bloque: solo omite los `it`.
  // Por eso el proveedor se construye bajo demanda: el constructor lanza
  // si falta GEMINI_API_KEY y reventaría CI aunque la suite estuviera saltada.
  const getProvider = () => new GeminiProvider(process.env);

  it(
    "embed devuelve exactamente 768 dimensiones",
    async () => {
      const { vector } = await getProvider().embed("hola mundo", {
        taskType: "retrieval_query",
      });

      expect(vector).toHaveLength(768);
      expect(vector.every((n) => Number.isFinite(n))).toBe(true);
    },
    INTEGRATION_TIMEOUT
  );

  it(
    "embedBatch devuelve un vector de 768 por cada texto, en orden",
    async () => {
      const texts = ["primer fragmento", "segundo fragmento", "tercer fragmento"];
      const results = await getProvider().embedBatch(texts, {
        taskType: "retrieval_document",
      });

      expect(results).toHaveLength(texts.length);
      for (const r of results) {
        expect(r.vector).toHaveLength(768);
      }
    },
    INTEGRATION_TIMEOUT
  );

  it(
    "textos relacionados puntúan más alto que textos distintos",
    async () => {
      const [q, a, b] = await Promise.all([
        getProvider().embed("como conectarme a la base de datos", {
          taskType: "retrieval_query",
        }),
        getProvider().embed("La DATABASE_URL de Neon se configura en .env.local", {
          taskType: "retrieval_document",
        }),
        getProvider().embed("El chunking divide el texto en partes de 500 caracteres", {
          taskType: "retrieval_document",
        }),
      ]);

      const cos = (x: number[], y: number[]) => {
        let dot = 0;
        let nx = 0;
        let ny = 0;
        for (let i = 0; i < x.length; i++) {
          dot += x[i] * y[i];
          nx += x[i] * x[i];
          ny += y[i] * y[i];
        }
        return dot / (Math.sqrt(nx) * Math.sqrt(ny));
      };

      expect(cos(q.vector, a.vector)).toBeGreaterThan(cos(q.vector, b.vector));
    },
    INTEGRATION_TIMEOUT
  );

  // El chat es el único llamado propenso a 503 "high demand" (free tier):
  // en pruebas la latencia varió entre 2.8s y 31s con fallos intermitentes.
  // `retry` reejecuta el test completo ante un fallo; los embeddings
  // no lo necesitan porque son rápidos y estables.
  chatIt(
    "chat responde con el modelo configurado",
    async () => {
      const { text } = await getProvider().chat([
        { role: "user", content: "Responde unicamente con: ok" },
      ]);

      expect(text.trim().length).toBeGreaterThan(0);
    },
    { timeout: INTEGRATION_TIMEOUT, retry: 2 }
  );
});
