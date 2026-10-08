'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import UploadDropzone from '@/components/UploadDropzone';
import DocumentList from '@/components/DocumentList';
import SearchBar from '@/components/SearchBar';
import ChatMessage from '@/components/ChatMessage';
import SkeletonLoader from '@/components/SkeletonLoader';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import Toast, { type ToastMessage, type ToastState } from '@/components/Toast';
import { authClient } from '@/lib/auth-client';
import { parseStreamEvent, SSEDecoder, type Citation } from '@/lib/chat/sse';

interface DocItem {
  id: string;
  title: string;
  createdAt: string;
  status?: 'processing' | 'ready' | 'failed' | string;
  error?: string | null;
}

interface ChatMsg {
  role: 'user' | 'ai';
  content: string;
  citations?: Citation[];
}

/**
 * Techo de seguridad del lado del cliente.
 *
 * La ruta `/api/ask` promete cerrar el stream en ~45s (tope de inactividad) y
 * 60s como máximo (`maxDuration`), pero si la red se corta en seco el `fetch`
 * no rechaza y el `while (await reader.read())` de `handleSend` esperaría para
 * siempre: el compositor quedaría deshabilitado sin que se vea ningún error.
 * Este temporizador aborta la petición pasando un motivo legible.
 */
const CLIENT_STREAM_TIMEOUT_MS = 90_000;

export default function Home() {
  const router = useRouter();
  const { data: authSession, isPending: authPending } = authClient.useSession();
  const userId = authSession?.user?.id;

  // Documents
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastState>([]);

  // Chat
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);

  // Search
  const [searchResults, setSearchResults] = useState<{ content: string; similarity: number; title: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentStatusesRef = useRef<Map<string, string>>(new Map());
  const toastSequenceRef = useRef(0);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  /**
   * Descarga la lista de documentos.
   *
   * `silent` evita el skeleton y el estado de error: lo usan el sondeo de
   * documentos `processing` y el refresco tras subir/borrar para que la
   * lista no parpadee mientras se actualiza.
   *
   * Es un `useCallback` estable para que los efectos que lo invocan puedan
   * declararlo como dependencia (`react-hooks/exhaustive-deps`).
   */
  const loadDocuments = useCallback(async (silent: boolean) => {
    if (!silent) {
      setDocsLoading(true);
      setDocsError(null);
    }
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const nextDocuments = (data.documents ?? []) as DocItem[];
      const newToasts: ToastMessage[] = [];

      for (const document of nextDocuments) {
        const previousStatus = documentStatusesRef.current.get(document.id);
        const fullError = document.error ?? 'Error desconocido';

        if (previousStatus === 'processing' && document.status === 'ready') {
          newToasts.push({
            id: `document-toast-${++toastSequenceRef.current}`,
            message: `«${document.title}» está listo`,
            tone: 'success',
          });
          documentStatusesRef.current.set(document.id, document.status);
        } else if (previousStatus === 'processing' && document.status === 'failed') {
          const errorMessage =
            fullError.length > 140 ? `${fullError.slice(0, 137)}...` : fullError;
          newToasts.push({
            id: `document-toast-${++toastSequenceRef.current}`,
            message: `«${document.title}» falló: ${errorMessage}`,
            title: `«${document.title}» falló: ${fullError}`,
            tone: 'error',
          });
          documentStatusesRef.current.set(document.id, document.status);
        } else {
          documentStatusesRef.current.set(document.id, document.status ?? '');
        }
      }

      if (newToasts.length > 0) {
        setToasts((previous) => [...previous, ...newToasts].slice(-3));
      }
      setDocuments(nextDocuments);
    } catch (err) {
      if (!silent) {
        setDocsError(err instanceof Error ? err.message : 'Error al cargar documentos');
      }
    } finally {
      if (!silent) setDocsLoading(false);
    }
  }, []);

  const fetchDocuments = useCallback(() => loadDocuments(false), [loadDocuments]);

  const refreshDocuments = useCallback(() => loadDocuments(true), [loadDocuments]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== toastId));
  }, []);

  // Load private documents only after the session is resolved.
  // Sin sesión no se limpia el estado aquí: mientras no haya usuario la lista
  // ni siquiera se pinta (más abajo hay un early-return con la pantalla de
  // acceso), así que ese reset era trabajo muerto y además violaba
  // `react-hooks/set-state-in-effect` (setState síncrono dentro de un efecto).
  // Por lo mismo, la carga inicial se difiere a un macrotask: `loadDocuments`
  // enciende `docsLoading` de forma síncrona y la regla prohíbe que un
  // efecto arranque esa cadena directamente (renders en cascada).
  useEffect(() => {
    if (authPending) return;
    if (!userId) return;
    const timer = setTimeout(() => {
      void fetchDocuments();
    }, 0);
    return () => clearTimeout(timer);
  }, [authPending, userId, fetchDocuments]);

  // El índice corre en segundo plano (`after()` en el POST), así que la lista
  // se sondea en silencio mientras quede algún documento `processing`.
  const hasProcessing = documents.some((d) => d.status === 'processing');
  useEffect(() => {
    if (authPending || !userId || !hasProcessing) return;
    const timer = setInterval(() => {
      void refreshDocuments();
    }, 2500);
    return () => clearInterval(timer);
  }, [authPending, userId, hasProcessing, refreshDocuments]);

  async function handleDelete(docId: string) {
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      await refreshDocuments();
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : 'Error al borrar');
    }
  }

  async function handleSignOut() {
    const result = await authClient.signOut();
    if (result.error) {
      setChatError(result.error.message ?? 'No se pudo cerrar la sesión.');
      return;
    }
    router.replace('/login');
    router.refresh();
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || chatLoading) return;

    setQuestion('');
    setChatError(null);
    setStreamingText('');
    setStreamingCitations([]);

    // Add user message
    const userMsg: ChatMsg = { role: 'user', content: q };
    setMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      abortRef.current = new AbortController();
      watchdogRef.current = setTimeout(() => {
        // `abort(reason)` hace que el `fetch` rechace con ESTE error, de modo
        // que el catch de abajo pinta un mensaje útil en vez del genérico
        // "The user aborted a request.".
        abortRef.current?.abort(
          new Error(
            'La respuesta tardó demasiado y se ha cancelado. Vuelve a intentarlo.'
          )
        );
      }, CLIENT_STREAM_TIMEOUT_MS);
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        // Formato de error estándar de la API: { error: { code, message } }.
        const err = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      const sse = new SSEDecoder();
      const citations: Citation[] = [];
      /**
       * Acumulador LOCAL. `streamingText` es estado de React y la variable de
       * este closure nunca se actualiza: leerla al finalizar devolvía siempre
       * `''`, así que la respuesta se pintaba en blanco aunque el stream
       * hubiera traído texto (las citas sí salían porque venían de un array
       * local mutable). De ahí el síntoma de "solo veo las citas".
       */
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // `SSEDecoder` reconstruye los eventos multi-línea: el texto del
        // modelo puede contener `\n` y, sin reunir las líneas `data:`, el
        // resto del chunk se perdía y la respuesta salía cortada.
        for (const payload of sse.push(decoder.decode(value, { stream: true }))) {
          if (payload === '') continue;
          const event = parseStreamEvent(payload);

          if (event.kind === 'error') throw new Error(event.message);
          if (event.kind === 'skip') continue;
          if (event.kind === 'citation') {
            citations.push(event.citation);
            setStreamingCitations([...citations]);
            continue;
          }
          text += event.text;
          setStreamingText(text);
        }
      }

      // Red de seguridad: un [done] sin texto es una respuesta inútil y es
      // exactamente el fallo original. Mejor un error claro que un mensaje
      // vacío con citas.
      if (text.trim() === '') {
        throw new Error(
          'La respuesta llegó vacía. Suele deberse a cuota agotada o a un fallo del modelo.'
        );
      }

      // Finalize: commit the streaming message
      const aiMsg: ChatMsg = {
        role: 'ai',
        content: text,
        citations,
      };
      setMessages((prev) => [...prev, aiMsg]);
      setStreamingText('');
      setStreamingCitations([]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Error en la respuesta');
      // No dejar colgadas las citas streaming de una respuesta que nunca llegó.
      setStreamingText('');
      setStreamingCitations([]);
    } finally {
      setChatLoading(false);
      abortRef.current = null;
      if (watchdogRef.current !== null) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    }
  }

  if (authPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <p role="status" className="text-sm text-muted-foreground">Comprobando sesión...</p>
      </main>
    );
  }

  if (!authSession?.user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <section className="w-full max-w-lg rounded-xl border border-border bg-background p-8 text-center shadow-sm">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">K</div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight">KnowledgeDock</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Inicia sesión para cargar, buscar y consultar tus documentos privados.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Iniciar sesión o registrarse
          </Link>
        </section>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
              K
            </div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">KnowledgeDock</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{authSession.user.email}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-6 md:flex-row">
        {/* Left column: Upload + Documents */}
        <aside className="flex flex-col gap-6 md:w-1/3">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground uppercase tracking-wide">Subir Documento</h2>
            <UploadDropzone onUploaded={refreshDocuments} onError={(msg) => setDocsError(msg)} />
          </section>

          <section className="flex-1">
            <h2 className="mb-3 text-sm font-semibold text-foreground uppercase tracking-wide">Mis Documentos</h2>
            {docsError && <ErrorState message={docsError} onRetry={fetchDocuments} />}
            {docsLoading ? (
              <SkeletonLoader type="list" />
            ) : documents.length === 0 ? (
              <EmptyState
                title="Sin documentos"
                description="Sube un archivo .txt, .md o .pdf para empezar a buscar."
              />
            ) : (
              <DocumentList documents={documents} onDelete={handleDelete} loading={docsLoading} />
            )}
          </section>
        </aside>

        {/* Right column: Chat */}
        <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-background shadow-sm overflow-hidden">
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto p-4">
            <section className="mb-6 rounded-lg border border-border p-3">
              <h2 className="mb-3 text-sm font-semibold">Búsqueda semántica</h2>
              <SearchBar
                onResults={setSearchResults}
                onLoading={setSearchLoading}
              />
              {searchLoading && (
                <p role="status" className="mt-3 text-sm text-muted-foreground">Buscando en tus documentos...</p>
              )}
              {!searchLoading && searchResults.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {searchResults.map((result, index) => (
                    <li key={`${result.title}-${index}`} className="rounded-md bg-muted p-3 text-sm">
                      <p className="mb-1 font-medium">
                        {result.title} · similitud {(result.similarity * 100).toFixed(0)}%
                      </p>
                      <p className="text-muted-foreground">{result.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {messages.length === 0 && !chatLoading && (
              <EmptyState
                title="¿Qué necesitas saber?"
                description="Sube tus documentos y hazme una pregunta. Citare las fuentes exactas."
              />
            )}

            {messages.map((msg, i) => (
              <ChatMessage
                key={i}
                role={msg.role}
                content={msg.content}
                citations={msg.citations}
              />
            ))}

            {/* Streaming AI message */}
            {chatLoading && streamingText && (
              <ChatMessage
                role="ai"
                content={streamingText}
                citations={streamingCitations}
                isStreaming
              />
            )}

            {chatError && (
              <div className="mb-4">
                <ErrorState message={chatError} onRetry={() => setChatError(null)} />
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-4 bg-muted/30">
            <form onSubmit={handleAsk} className="flex gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Pregunta sobre tus documentos..."
                disabled={chatLoading}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Escribe tu pregunta"
              />
              <button
                type="submit"
                disabled={chatLoading || !question.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                {chatLoading ? '...' : 'Enviar'}
              </button>
            </form>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              KnowledgeDock puede cometer errores. Verifica la información importante.
            </p>
          </div>
        </section>
      </main>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
