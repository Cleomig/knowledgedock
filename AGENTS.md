<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Notas de este proyecto

- `npm run build` imprime `Could not validate the database schema` y **no es
  un fallo** (EXIT_CODE=0). Esa comprobación necesita un Postgres en
  `localhost:55432`, que solo existe con Docker Desktop en marcha. No afecta
  al despliegue de producción.
- `next dev` regenera el bloque de arriba y deja `AGENTS.md` sin confirmar:
  con `git add AGENTS.md` y un commit se mantiene el árbol limpio.
- Los tests de chat real son opt-in con `RUN_CHAT_INTEGRATION=1`. Sin esa
  variable `vitest` los omite (ese es el `1 skipped` de la suite); los tests
  de *embeddings* sí corren en vivo.
- `src/lib/ai/gemini.ts` es el único proveedor con bucle de respaldo de
  modelos (`groq` y `openrouter` no lo tienen). Los dos topes de tiempo viven
  en `src/lib/ai/idle-timeout.ts` y `FIRST_CHUNK_TIMEOUT_MS` debe ser siempre
  menor que `STREAM_IDLE_TIMEOUT_MS`, o un modelo mudo agota el presupuesto
  de la ruta antes de llegar al siguiente.
