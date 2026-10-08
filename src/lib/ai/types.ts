export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatResult {
  text: string;
  reasoning?: string;
}

export interface EmbeddingResult {
  vector: number[];
}

/**
 * taskType mejora la calidad de recuperación del proveedor Google:
 * - retrieval_query:    para incóltas del usuario (búsqueda / pregunta)
 * - retrieval_document: para los fragmentos indexados al subir un documento
 * Proveedores que no lo soportan lo ignoran sin efecto.
 */
export type EmbeddingTaskType = "retrieval_query" | "retrieval_document";

export interface EmbeddingOptions {
  taskType?: EmbeddingTaskType;
}

/**
 * Flujo de texto incremental devuelto por `streamChat`.
 * `textStream` se consume con `for await`.
 */
export interface ChatStream {
  textStream: AsyncIterable<string>;
}

export interface AiProvider {
  /**
   * Envía un mensaje de chat y retorna la respuesta completa.
   * Puede recibir stream: true para streaming incremental.
   */
  chat(messages: ChatMessage[], options?: { stream?: boolean }): Promise<ChatResult>;

  /**
   * Envía un mensaje de chat y devuelve el texto por fragmentos.
   * Obligatorio para `/api/ask`, que debe emitir SSE token a token.
   *
   * Existe en la interfaz (y no solo en la ruta) para que la abstracción
   * del proveedor también cubra la generación: sin esto, cada ruta tendría
   * que instanciar el SDK a mano y atarse a un modelo concreto.
   */
  streamChat(messages: ChatMessage[]): Promise<ChatStream>;

  /**
   * Genera un embedding de dimensión fija para un texto dado.
   */
  embed(text: string, options?: EmbeddingOptions): Promise<EmbeddingResult>;

  /**
   * Genera embeddings en lote para varios textos.
   * Retorna en el mismo orden que el input.
   */
  embedBatch(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResult[]>;
}
