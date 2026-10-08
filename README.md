# KnowledgeDock

[![CI](https://github.com/Cleomig/knowledgedock/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cleomig/knowledgedock/actions/workflows/ci.yml)

**Busca y consulta tus documentos con IA y referencias a sus fuentes.**

KnowledgeDock es un proyecto de portafolio para indexar documentos y recuperar fragmentos por similitud semántica. El backend permite cargar `.txt`, `.md` y `.pdf`, generar embeddings y consultar los fragmentos con PostgreSQL y `pgvector`.

La interfaz carga y actualiza la lista de documentos, permite borrarlos y envía preguntas al endpoint de streaming. El componente `SearchBar` envía consultas al endpoint de búsqueda semántica.

[![Next.js 16.4.0](https://img.shields.io/badge/Next.js-16.4.0-black?logo=next.js)](https://nextjs.org/)
[![React 19.3.0](https://img.shields.io/badge/React-19.3.0-149ECA?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL + pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)

## Captura de pantalla

<!-- Reemplazar el marcador cuando haya una captura real de la aplicación. -->
![Marcador para una captura de KnowledgeDock](https://placehold.co/1200x675?text=KnowledgeDock+-+captura+pendiente)

## Funcionalidades implementadas

| Área | Funcionalidad | Estado real |
|---|---|---|
| Carga e indexación | `POST /api/documents` recibe un archivo, extrae texto, lo divide en fragmentos, genera embeddings por lote y los guarda en PostgreSQL. | La interfaz acepta arrastrar y soltar o seleccionar `.txt`, `.md` y `.pdf`, muestra estados de carga/error y recarga la lista tras indexar. |
| Formatos | Acepta texto (`text/*`) y PDF (`application/pdf`); el componente ofrece `.txt`, `.md` y `.pdf`. | Extracción PDF con `pdf-parse`. |
| Búsqueda semántica | `POST /api/search` genera el embedding de la consulta y devuelve hasta 10 fragmentos por similitud coseno; umbral predeterminado `0.5`. | `SearchBar` envía la consulta y entrega los resultados al callback de la interfaz. |
| Preguntas con contexto | `POST /api/ask` busca los 5 fragmentos más cercanos y transmite texto y eventos de citas mediante SSE. | La interfaz envía preguntas, procesa el stream, presenta el texto progresivamente y muestra las fuentes citadas. |
| Documentos | `GET /api/documents` lista documentos del propietario configurado. `DELETE /api/documents/[id]` borra el documento y sus fragmentos. | La página obtiene la lista al iniciar y después de cargas o borrados; incluye estados de carga, vacío y error. |
| Interfaz | Componentes de carga, lista, mensajes, estados vacío/error y esqueletos. | Flujo conectado a las rutas de documentos y preguntas; el componente `SearchBar` incluye la llamada de búsqueda. |

## Arquitectura

```mermaid
flowchart LR
    U[Usuario] --> UI[Interfaz Next.js]
    UI --> DOC[POST /api/documents]
    UI --> Q[POST /api/search]
    UI --> ASK[POST /api/ask]
    UI --> LIST[GET /api/documents]
    DOC --> EXT[Extracción de texto<br/>txt / md / pdf-parse]
    EXT --> CH[Chunking<br/>500 caracteres / 50 de solapamiento]
    CH --> EMB[Proveedor de embeddings]
    EMB --> DB[(PostgreSQL<br/>pgvector, vector(768))]
    Q --> EMB
    Q --> DB
    ASK --> EMB
    ASK --> DB
    DB -->|Top 5 fragmentos| G[Gemini 3.8 Flash<br/>streaming SSE]
    G --> ASK
    ASK -->|Respuesta y citas por SSE| UI
    LIST --> DB
```

Los archivos se procesan en memoria durante la carga. La API crea un `storage_key` como marcador, pero no sube el archivo a Cloudflare R2. La autenticación tampoco está conectada; las rutas usan el propietario `anonymous` por defecto.

## Stack

Versiones declaradas en `package.json` (los prefijos `^` indican rangos semver):

| Capa | Paquete/servicio | Versión declarada | Uso o estado |
|---|---|---:|---|
| Framework | Next.js | `16.4.0` | App Router, UI y rutas de API. |
| UI | React / React DOM | `19.3.0` | Componentes de interfaz. |
| Lenguaje | TypeScript | `^5` | Tipado de la aplicación. |
| Estilos | Tailwind CSS | `^4` | Estilos de la interfaz. |
| SDK de IA | `ai` | `^7.0.131` | Generación de texto y embeddings. |
| Proveedor Gemini | `@ai-sdk/google` | `^4.0.90` | Chat y embeddings mediante la integración del proveedor. |
| Proveedor Groq | `@ai-sdk/groq` | `^4.0.57` | Adaptador de chat en la capa de proveedores; no ofrece embeddings. |
| Proveedor OpenRouter | `@openrouter/ai-sdk-provider` | `^3.1.0` | Adaptador de chat y embeddings disponible en la capa de proveedores. |
| Base de datos | PostgreSQL (`pg`) | `^8.23.1` | Conexión al motor PostgreSQL, por ejemplo Neon. |
| Vectores | `pgvector` | `^0.3.0` | Adaptador de vectores; el servidor debe tener instalada la extensión `vector`. |
| PDFs | `pdf-parse` | `^2.4.5` | Extracción de texto de archivos PDF. |
| Iconos | `lucide-react` | `^1.52.0` | Iconografía de la UI. |
| Autenticación | `better-auth` | `^1.7.7` | Dependencia presente, pero sin flujo de autenticación implementado. |

## Quick Start

Requisitos: Node.js compatible con Next.js 16, npm, una base PostgreSQL con la extensión `pgvector` y una clave de Gemini.

1. Instala las dependencias desde el lockfile:

   ```bash
   npm ci
   ```

2. Crea `.env.local` desde la plantilla (PowerShell):

   ```powershell
   Copy-Item .env.example .env.local
   ```

   Configura como mínimo `DATABASE_URL` y `GEMINI_API_KEY`. Para el flujo predeterminado, conserva `AI_PROVIDER=gemini`.

3. Ejecuta `db/schema.sql` en la base de datos configurada. Con `psql`, sustituye la URL por el mismo valor de `DATABASE_URL`:

   ```bash
   psql "<DATABASE_URL>" -f db/schema.sql
   ```

   También puedes pegar `db/schema.sql` en el SQL Editor de tu proveedor PostgreSQL.

4. Arranca la aplicación:

   ```bash
   npm run dev
   ```

   Visita [http://localhost:3000](http://localhost:3000).

Scripts disponibles:

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
```

El script `test` ejecuta `vitest run`. También están definidos `test:watch`, `test:ui`, `test:coverage`, `test:unit`, `test:integration` y `test:api`; consulta sus rutas en `package.json`.

## Ejecución local con Docker

Para desarrollar sin provisionar Neon, se incluye un `docker-compose.yml` que levanta
PostgreSQL 16 con `pgvector` ya integrado. Los datos persisten en el volumen
`knowledgedock_pgdata`.

```powershell
# 1. Levantar el contenedor
docker compose up -d

# 2. Crear el esquema (tablas + extensión vector + índice HNSW)
.\scripts\setup-db.ps1

# 3. Copiar variables de entorno y apuntar DATABASE_URL a PostgreSQL local
Copy-Item .env.example .env.local
# .env.local ya tendrá la línea DATABASE_URL para localhost:55432

# 4. Arrancar la aplicación
npm run dev
```

Visita [http://localhost:3000](http://localhost:3000).

Detener y limpiar el contenedor (los datos persisten en el volumen):

```powershell
docker compose down
```

Eliminar también el volumen (pérdida total de datos):

```powershell
docker compose down -v
```

**Neon para producción.** La especificación original elige Neon Postgres como
proveedor de producción por su escala a cero (costo $0 en tráfico intermitente)
y su capacidad de crear hasta 100 proyectos gratuitos. Para producción, reemplaza
`DATABASE_URL` en `.env.production` por la URL que Neon te proporcione y ejecuta
`db/schema.sql` en su editor SQL.

## Pruebas

- `npm test` ejecuta 44 pruebas en 3 archivos: 10 unitarias de chunking, 30 de contrato de la abstracción (`AiProvider`, factory, dimensiones, variables de entorno, separación de `system` en `instructions` y regresión contra rutas que se saltan la abstracción) y 4 de integración real con Gemini, de las que 3 se ejecutan siempre que hay clave. Si `GEMINI_API_KEY` no está en `.env.local`, las de integración se omiten.
- `RUN_CHAT_INTEGRATION=1 npm test` habilita además la prueba de integración de chat. El chat se ejecuta de forma opt-in porque su disponibilidad y latencia varían; las pruebas de embeddings se ejecutan siempre que existe la clave y son rápidas y estables.
- Las rutas de la API se verificaron contra el sistema real (servidor en `localhost:3000`, PostgreSQL con pgvector en Docker y la clave de Gemini): carga multipart de un documento, búsqueda semántica con 10 resultados y similitud ≥ 0.5, y `/api/ask` devolviendo streaming con citas. Los tests de ruta con *mocks* que cubrían esto no funcionaban con la arquitectura de módulos de Next.js y quedan archivados en [`docs/archived-tests-api/`](docs/archived-tests-api/README.md) con la explicación y cómo reactivarlos vía E2E.

## Variables de entorno

La lista completa con valores predeterminados está en [`.env.example`](.env.example).

| Variable | Uso y estado |
|---|---|
| `AI_PROVIDER` | Proveedor de embeddings: `gemini` (predeterminado), `groq` u `openrouter`. Para el flujo actual de carga, búsqueda y preguntas, usa Gemini. |
| `GEMINI_API_KEY` | Requerida para usar Gemini como proveedor configurado. Una sola clave se utiliza para chat y embeddings. |
| `GEMINI_CHAT_MODEL` | Modelo configurable en el adaptador Gemini; predeterminado `gemini-3.8-flash`. |
| `GEMINI_EMBEDDING_MODEL` | Modelo de embeddings; predeterminado `gemini-embedding-001`. El esquema requiere vectores de 768 dimensiones. |
| `GROQ_API_KEY`, `GROQ_CHAT_MODEL` | Configuración del adaptador Groq. Groq no genera embeddings, por lo que no cubre el flujo RAG actual. |
| `OPENROUTER_API_KEY`, `OPENROUTER_CHAT_MODEL`, `OPENROUTER_EMBEDDING_MODEL` | Configuración del adaptador OpenRouter. La abstracción permite usar el proveedor; el flujo RAG del proyecto está configurado actualmente para Gemini. |
| `DATABASE_URL` | Requerida. Cadena de conexión PostgreSQL usada por `src/lib/db.ts`. |
| `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL` | Presentes en la plantilla para Better Auth, pero el proyecto aún no configura autenticación. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT` | Presentes en la plantilla; la carga actual no usa R2 ni conserva el archivo original allí. |

La API también lee `DEFAULT_OWNER_ID` si está definido; no aparece en `.env.example` y, si falta, usa `anonymous`. No hay inicio de sesión ni aislamiento de datos por usuario implementados.

## Decisiones técnicas

1. **Abstracción del proveedor de IA, también para streaming.** `AiProvider` define `chat`, `streamChat`, `embed` y `embedBatch`, y `AI_PROVIDER` selecciona Gemini, Groq u OpenRouter. Esto concentra la integración con proveedores y reduce el acoplamiento; Groq no soporta embeddings. El flujo RAG actual está configurado para Gemini. `streamChat` está en la interfaz y no en la ruta porque `/api/ask` emitía SSE: instanciar el SDK ahí mismo era lo que había roto la ruta (ver decisión 8).
2. **HNSW sobre IVFFlat.** El índice `hnsw` usa distancia coseno y evita depender de una fase de entrenamiento de listas; es una elección apropiada para priorizar recall en el tamaño pequeño previsto para el proyecto. El índice ya está definido en `db/schema.sql`.
3. **Chunking con overlap.** El solapamiento conserva parte del contexto en los bordes y reduce la posibilidad de separar una idea entre fragmentos. La especificación propone aproximadamente 500 tokens y 50 de overlap; la implementación actual usa **500 caracteres y 50 caracteres**, retrocede hasta un espacio para no cortar palabras. No equivale a 500 tokens.
4. **Neon scale-to-zero.** La especificación elige Neon para reducir el costo cuando la aplicación recibe tráfico intermitente: la base puede escalar a cero al estar inactiva. La contrapartida es que la primera conexión tras la inactividad puede tener mayor latencia.
5. **Clave de API explícita en el SDK.** Gemini se configura con `createGoogleGenerativeAI({ apiKey })`. El export predeterminado `google` solo lee `GOOGLE_GENERATIVE_AI_API_KEY`; no reconocería `GEMINI_API_KEY` y fallaría con `API key is missing`.
6. **Vectores de 768 dimensiones.** `gemini-embedding-001` devuelve 3072 dimensiones por defecto. Se solicita `outputDimensionality: 768` para coincidir con `vector(768)` en `db/schema.sql`; sin ello, los `INSERT` fallarían. La dimensionalidad menor también reduce el tamaño del índice HNSW. `tests/ai.test.ts` comprueba que la configuración y el esquema no se desincronicen.
7. **`taskType` según el sentido del texto.** Las consultas usan `retrieval_query` en `/api/search` y `/api/ask`; los fragmentos indexados usan `retrieval_document`. Distinguir consulta y documento ayuda al modelo de embeddings a optimizar la recuperación.
8. **Modelo de chat `gemini-3.8-flash`.** Es el modelo configurado por defecto para nuevas cuentas, dado que `gemini-2.0-flash` y `gemini-2.5-flash` ya no están disponibles para usuarios nuevos (error 404). Esta ruta estaba rota en silencio: `/api/ask` instanciaba `google("gemini-2.0-flash")` a mano en vez de usar el proveedor, por lo que devolvía 404 aunque `GEMINI_API_KEY` fuera válida. La prueba «ninguna ruta importa un SDK de IA directamente» impide que vuelva a pasar.
9. **`system` se separa en `instructions`.** El SDK de AI rechaza `role: "system"` dentro de `messages` con `AI_InvalidPromptError: System messages are not allowed... Use the instructions option instead`. `src/lib/ai/prompt.ts` reparte el prompt una sola vez para los tres proveedores; sin eso, `/api/ask` emitía citas y `[done]` pero nunca texto. Relacionado: el stream ya no emite `[done]` cuando la generación falla, para que un cliente no dé por buena una respuesta vacía.
10. **Umbral de búsqueda `0.5`.** El valor inicial de `0.7` estaba por encima de lo que produce `gemini-embedding-001`: en consultas reales la similitud máxima quedó entre 0,63 y 0,66, así que la búsqueda devolvía siempre `results: []`. Sigue siendo configurable por petición.

## Límites del free tier

Valores verificados para este proyecto; los proveedores pueden modificar cuotas y condiciones:

| Servicio | Límite gratuito indicado |
|---|---|
| Gemini | Chat y hasta **500.000 tokens al día de embeddings** con una sola API key. |
| Vercel Hobby | **100 GB** de transferencia. |
| Neon | Hasta **100 proyectos** y **0,5 GB** de almacenamiento. |
| GitHub Actions | Uso ilimitado en repositorios públicos. |

El consumo de chat y embeddings sigue sujeto a las políticas y cuotas vigentes de Gemini. El proyecto no incluye límites de carga o cuotas propios para evitar exceder los del proveedor.

El chat del nivel gratuito puede devolver `503 high demand` de forma intermitente; la latencia observada varió entre 2,8 y 31 segundos. Por eso la prueba de integración de chat es opt-in (`RUN_CHAT_INTEGRATION=1`), mientras las de embeddings se ejecutan siempre que hay clave y son rápidas y estables.

## Alcance actual y limitaciones

- Los metadatos y embeddings se guardan en PostgreSQL. El archivo original no se persiste en R2.
- No hay autenticación activa: `owner_id` usa `anonymous` por defecto, por lo que no existe aislamiento multiusuario. Better Auth está instalado y sus variables aparecen en `.env.example`, pero todavía no hay un flujo de autenticación implementado.
- `GROQ` no puede usarse en rutas que requieren embeddings. Aunque la abstracción admite varios proveedores, el flujo RAG actual está configurado para Gemini.

## Licencia

El repositorio no contiene un archivo `LICENSE`; por tanto, no declara una licencia de uso, modificación o redistribución. Añade la licencia elegida antes de conceder esos permisos.
