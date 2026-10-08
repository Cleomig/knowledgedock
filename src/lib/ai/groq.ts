import { generateText, streamText } from "ai";
import { groq } from "@ai-sdk/groq";
import type { AiProvider, ChatMessage, ChatResult, ChatStream, EmbeddingResult } from "./types";
import { toPrompt } from "./prompt";

/**
 * Implementación Groq para chat solamente.
 * Embeddings retornan null como stub (Groq no provee embeddings).
 */
export class GroqProvider implements AiProvider {
  private apiKey: string;
  private model: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.apiKey = env.GROQ_API_KEY ?? "";
    this.model = env.GROQ_CHAT_MODEL ?? "llama-3.3-70b-versatile";

    if (!this.apiKey) {
      throw new Error(
        "GROQ_API_KEY is required for GroqProvider. Set it in .env."
      );
    }
  }

  async chat(messages: ChatMessage[], _options?: { stream?: boolean }): Promise<ChatResult> {
    const { instructions, messages: rest } = toPrompt(messages);

    const result = await generateText({
      model: groq(this.model),
      ...(instructions ? { instructions } : {}),
      messages: rest,
    });

    return { text: result.text };
  }

  async streamChat(messages: ChatMessage[]): Promise<ChatStream> {
    const { instructions, messages: rest } = toPrompt(messages);

    const result = streamText({
      model: groq(this.model),
      ...(instructions ? { instructions } : {}),
      messages: rest,
    });

    return { textStream: result.textStream };
  }

  /**
   * Groq no ofrece embeddings. Retorna error.
   */
  async embed(_text: string): Promise<EmbeddingResult> {
    throw new Error("GroqProvider does not support embeddings. Use Gemini or OpenRouter.");
  }

  /**
   * Groq no ofrece embeddings. Retorna error.
   */
  async embedBatch(_texts: string[]): Promise<EmbeddingResult[]> {
    throw new Error("GroqProvider does not support embeddings. Use Gemini or OpenRouter.");
  }
}
