import type { ChatMessage } from "./types";

/**
 * Prompt normalizado listo para `generateText` / `streamText`.
 */
export interface NormalizedPrompt {
  /** Instrucciones de sistema, si las hay. */
  instructions?: string;
  /** Solo user/assistant: el SDK rechaza `system` aquí. */
  messages: { role: "user" | "assistant"; content: string }[];
}

/**
 * Separa los mensajes `system` del resto.
 *
 * El SDK de AI lanza `AI_InvalidPromptError: System messages are not allowed
 * in the prompt or messages fields. Use the instructions option instead.`
 * si `role: "system"` viaja dentro de `messages`. Como toda la abstracción
 * del proveedor recibe una lista plana de `ChatMessage`, el reparto se hace
 * aquí una sola vez en vez de en cada proveedor.
 *
 * Varias entradas `system` se concatenan en orden.
 */
export function toPrompt(messages: ChatMessage[]): NormalizedPrompt {
  let system = "";
  // Acumulamos en vez de filtrar: `filter` no estrecha el tipo de rol, y
  // NormalizedPrompt.messages debe excluir "system" a nivel de tipos para
  // que el compilador impida reenviarlo al SDK.
  const rest: { role: "user" | "assistant"; content: string }[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      system = system ? `${system}\n\n${m.content}` : m.content;
      continue;
    }
    rest.push({ role: m.role, content: m.content });
  }

  return {
    ...(system ? { instructions: system } : {}),
    messages: rest,
  };
}
