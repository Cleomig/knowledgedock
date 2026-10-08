# KnowledgeDock — Spec de construcción

> Proyecto de portafolio. Ejemplo completo, 100% free tier.
> Este archivo es el **contrato único**. Todo agente trabaja contra esto.

## 1. Qué es

Buscador semántico de documentos con IA. Subes documentos (txt/md/pdf),
los indexa, y puedes hacer preguntas en lenguaje natural obteniendo
**respuestas con citas a la fuente exacta**.

## 2. Stack (todo gratis, sin tarjeta)

| Capa | Elección | Por qué |
|---|---|---|
| Framework | Next.js 15+ (App Router) + TypeScript | Deploy nativo en Vercel |
| UI | Tailwind CSS + shadcn/ui | Rápido y profesional |
| BD | Neon Postgres + `pgvector` | Free: 100 proyectos, escala a 0 |
| Auth | Better Auth (guardado en Neon) | 60k MAU free, sin RLS |
| IA chat | **Gemini Flash** (free tier) | 1 API key, sin tarjeta |
| IA embeddings | **`gemini-embedding-001`** (free tier) | 500k tokens/día |
| Archivos | Cloudflare R2 | 10 GB, 0 $ de egress |
| Deploy | Vercel Hobby | 100 GB transfer |
| CI | GitHub Actions | Ilimitado en repo público |

**Una sola variable: `GEMINI_API_KEY`.** Chat y embeddings usan la misma key.

## 3. Capa de abstracción de IA (obligatoria)

Nunca se llama al proveedor desde las rutas directamente.

```
lib/ai/
  ├─ types.ts       → interfaz AiProvider { chat(), embed(), embedBatch() }
  ├─ gemini.ts      → implementación por defecto
  ├─ groq.ts        → chat solamente (stub, embeddings = null)
  ├─ openrouter.ts  → chat + embeddings (nemotron-3-embed:free)
  └─ index.ts       → lee AI_PROVIDER del env, exporta singleton
```

Cambio de proveedor = cambiar `AI_PROVIDER` en `.env`. Nada más.

## 4. Esquema de BD

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- dim=768 para gemini-embedding-001. Si cambias de modelo, cambia esto.
CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    text NOT NULL,
  title       text NOT NULL,
  mime_type   text NOT NULL,
  storage_key text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id         bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord        int  NOT NULL,          -- posición en el documento
  content    text NOT NULL,
  embedding  vector(768) NOT NULL
);

CREATE INDEX chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);
```

## 5. API — contratos

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/documents` | Sube y indexa un documento (chunk + embed) |
| `GET` | `/api/documents` | Lista documentos del usuario |
| `DELETE` | `/api/documents/[id]` | Borra documento + sus chunks |
| `POST` | `/api/search` | `{ query }` → chunks ordenados por similitud |
| `POST` | `/api/ask` | `{ question }` → `{ answer, citations[] }` con streaming |

Errores: siempre `{ error: { code, message } }` con HTTP status correcto.

## 6. Features mínimas del MVP

1. **Subir documento** (.txt, .md, .pdf) con drag & drop
2. **Indexación**: chunking (~500 tokens, 50 overlap) → embeddings → pgvector
3. **Búsqueda semántica** con umbral de similitud configurable
4. **Preguntar** con respuesta en streaming + citas `[1]`, `[2]` alineadas al texto fuente
5. **Lista de documentos** con borrado
6. **Estados de carga y error** en toda la UI

## 7. No hacer (evitar scope creep)

- ❌ Pagos, multi-tenant complejo, roles de admin
- ❌ OAuth social (email/magic link basta)
- ❌ Editar documentos in-place
- ❌ Sincronía en tiempo real / colaboración
- ❌ Kubernetes, Docker, microservicios

## 8. Calidad obligatoria

- TypeScript estricto, `npm run build` sin errores
- Componentes de cliente mínimos (`'use client'` solo donde haga falta)
- Accesibilidad: labels, `aria-*`, contraste AA, foco visible
- Loading y error states en cada ruta
- README con: qué es, screenshot, arquitectura, setup, deploy

## 9. Decisiones clave para entrevista (documentar en README)

1. **Por qué abstracción de proveedor** → evitar lock-in
2. **Por qué HNSW sobre IVFFlat** → mejor recall en datasets pequeños
3. **Por qué chunking con overlap** → evitar cortar contexto en los bordes
4. **Por qué Neon scale-to-zero** → costo $0 en tráfico intermitente
