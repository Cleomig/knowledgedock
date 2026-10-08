import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Un prefijo `_` marca parámetros que se ignoran a propósito porque la
      // firma viene impuesta por la interfaz `AiProvider`: `_options` en
      // `chat`, `_text`/`_texts` en `embed`/`embedBatch` de Groq. Solo se
      // relaja para argumentos; las variables no usadas siguen en warn.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
