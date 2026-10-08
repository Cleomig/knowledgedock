import { generateText, streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { AiProvider, ChatMessage, ChatResult, ChatStream, EmbeddingResult } from "./types";
import { toPrompt } from "./prompt";

const DEFAULT_EMBEDDING_DIMENSIONS = 768;

/**
 * Implementación OpenRouter.
 * Chat usa el SDK de AI; embeddings usan la REST API directa porque el SDK
 * no expone el parámetro `dimensions` necesario para casar con vector(768).
 */
export class OpenRouterProvider implements AiProvider {
  private apiKey: string;
  private chatModel: string;
  private embeddingModel: string;
  private embeddingDimensions: number;

  constructor(env: NodeJS.ProcessEnv) {
    this.apiKey = env.OPENROUTER_API_KEY ?? "";
    this.chatModel = env.OPENROUTER_CHAT_MODEL ?? "google/gemini-2.5-flash";
    this.embeddingModel = env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
    this.embeddingDimensions =
      Number(env.OPENROUTER_EMBEDDING_DIMENSIONS) || DEFAULT_EMBEDDING_DIMENSIONS;

    if (!this.apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is required for OpenRouterProvider. Set it in .env."
      );
    }
  }

  async chat(messages: ChatMessage[], _options?: { stream?: boolean }): Promise<ChatResult> {
    const openrouter = createOpenRouter({ apiKey: this.apiKey });
    const { instructions, messages: rest } = toPrompt(messages);

    const result = await generateText({
      model: openrouter(this.chatModel),
      ...(instructions ? { instructions } : {}),
      messages: rest,
    });

    return { text: result.text };
  }

  async streamChat(messages: ChatMessage[]): Promise<ChatStream> {
    const openrouter = createOpenRouter({ apiKey: this.apiKey });
    const { instructions, messages: rest } = toPrompt(messages);

    const result = streamText({
      model: openrouter(this.chatModel),
      ...(instructions ? { instructions } : {}),
      messages: rest,
    });

    return { textStream: result.textStream };
  }

  /**
   * Llama a la REST API de OpenRouter directamente para poder pasar
   * `dimensions` (el SDK de AI no lo soporta).
   */
  private async callEmbeddingsApi(input: string | string[]): Promise<number[][]> {
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.embeddingModel,
        input,
        dimensions: this.embeddingDimensions,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `OpenRouter embeddings API error ${response.status}: ${body.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    if (!data.data || data.data.length === 0) {
      throw new Error("OpenRouter embeddings API returned no data");
    }

    return data.data.map((d) => d.embedding);
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const [vector] = await this.callEmbeddingsApi(text);
    return { vector };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const vectors = await this.callEmbeddingsApi(texts);
    return vectors.map((vector) => ({ vector }));
  }
}
