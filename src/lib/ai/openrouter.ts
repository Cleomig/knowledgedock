import { generateText, streamText, embed, embedMany } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { AiProvider, ChatMessage, ChatResult, ChatStream, EmbeddingResult } from "./types";
import { toPrompt } from "./prompt";

/**
 * Implementación OpenRouter.
 * Soporta chat y embeddings (nemotron-3-embed:free).
 */
export class OpenRouterProvider implements AiProvider {
  private apiKey: string;
  private chatModel: string;
  private embeddingModel: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.apiKey = env.OPENROUTER_API_KEY ?? "";
    this.chatModel = env.OPENROUTER_CHAT_MODEL ?? "meta-llama/llama-3.3-70b-instruct";
    this.embeddingModel = env.OPENROUTER_EMBEDDING_MODEL ?? "nomic-ai/nemotron-3-embed-8x22b:free";

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

  async embed(text: string): Promise<EmbeddingResult> {
    const openrouter = createOpenRouter({ apiKey: this.apiKey });

    const { embedding } = await embed({
      model: openrouter.embedding(this.embeddingModel),
      value: text,
    });

    return { vector: embedding };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const openrouter = createOpenRouter({ apiKey: this.apiKey });

    const { embeddings } = await embedMany({
      model: openrouter.embedding(this.embeddingModel),
      values: texts,
    });

    return embeddings.map((v) => ({ vector: v }));
  }
}
