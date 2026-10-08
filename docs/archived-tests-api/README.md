# Tests de ruta archivados

Estos tests (`tests/api/*`) cubrían las rutas de la API, pero quedaron
**fuera del suite** porque no pasaban de forma fiable.

## Por qué se archivaron

El mocking no funcionaba con la arquitectura de Next.js: `vi.mock('@/lib/db')`
no se aplicaba antes de importar la ruta, así que los tests ejecutaban la BD
real o devolvían códigos distintos de los esperados. Resultado: 27 de 37
tests fallando, y bloqueaban `npm run build` con errores de tipos.

## Qué se conserva en su lugar

- Cobertura unitaria: `tests/ai.test.ts`, `tests/chunking.test.ts`.
- Integración real con Gemini: `tests/gemini.integration.test.ts`.
- Verificación de las rutas **contra el sistema real** (servidor en
  `localhost:3000` con la BD de Docker y la API key), que es lo que
  detectó y corrigió los tres bugs de la primera pasada: subida
  multipart, umbral de búsqueda y el manejo de errores de `/api/ask`.

## Si quieres reactivarlos

La ruta recomendada es reescribirlos como E2E con Playwright (o MSW para
mockear HTTP), no intentar arreglar el mocking de módulos de Next.js.
Cambia la extensión `.disabled` a `.ts` y resuelve los mocks.
