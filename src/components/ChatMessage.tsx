'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { Citation } from '@/lib/chat/sse';
import { parseCitationMarkers } from '@/lib/chat/citations';

interface ChatMessageProps {
  role: 'user' | 'ai';
  content: string;
  citations?: Citation[];
  isStreaming?: boolean;
}

/** Cuánto dura el resaltado del chip tras saltar a él desde el texto. */
const FLASH_MS = 1600;

export default function ChatMessage({ role, content, citations, isStreaming = false }: ChatMessageProps) {
  const isUser = role === 'user';
  const bottomRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flashed, setFlashed] = useState<number | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [content, citations]);

  // El resaltado vive fuera del ciclo de vida del render: sin esta limpieza,
  // un setTimeout huérfano podría escribir estado en un componente ya
  // desmontado (p. ej. al borrar la conversación).
  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  /**
   * Números que realmente tienen chip debajo. El número del chip sale de
   * `cit.id` (el `index` que manda el servidor), no de la posición del
   * array: si algún evento llegara fuera de orden, los `[n]` del texto
   * seguirían apuntando al chip correcto.
   */
  const citationNumbers = new Set(
    (citations ?? []).map((cit, idx) => Number(cit.id) || idx + 1),
  );

  /**
   * Salta al chip de la cita y lo destaca un instante.
   *
   * Sin esto los `[n]` eran texto mudo: el lector no tenía forma de saber a
   * qué documento se refería la respuesta, que era justo lo que quedaba
   * suelto en medio de la frase.
   */
  const jumpToCitation = (n: number) => {
    const chip = bubbleRef.current?.querySelector(`[data-cite-id="${n}"]`);
    if (!chip) return;

    chip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setFlashed(n);

    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashed(null), FLASH_MS);
  };

  /**
   * Pinta el texto separando las referencias de cita del texto normal.
   *
   * Un grupo solo se vuelve navegable si TODOS sus números tienen chip:
   * si no, se devuelve el marcador original intacto (`raw`) en vez de
   * dejar un botón a medio montar o reescribir la frase del modelo.
   */
  const renderContent = (text: string) =>
    parseCitationMarkers(text).map((segment, index) => {
      if (segment.kind === 'text') {
        return <Fragment key={index}>{segment.text}</Fragment>;
      }

      const resolvable =
        segment.numbers.length > 0 && segment.numbers.every((n) => citationNumbers.has(n));

      if (!resolvable) {
        return <Fragment key={index}>{segment.raw}</Fragment>;
      }

      // Cada número recibe sus propios corchetes: `[3, 5]` pasa a ser
      // `[3], [5]` porque cada referencia lleva a un chip distinto.
      return (
        <Fragment key={index}>
          {segment.numbers.map((n, position) => (
            <Fragment key={`${n}-${position}`}>
              {position > 0 && ', '}
              <button
                type="button"
                onClick={() => jumpToCitation(n)}
                title={`Ver la cita ${n}`}
                aria-label={`Ir a la cita ${n}`}
                className="mx-0.5 cursor-pointer rounded bg-accent px-1 font-medium text-accent-foreground underline decoration-dotted underline-offset-2 hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {`[${n}]`}
              </button>
            </Fragment>
          ))}
        </Fragment>
      );
    });

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-6`}>
      <div
        ref={bubbleRef}
        className={`max-w-[85%] rounded-xl px-4 py-3 ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm'
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {renderContent(content)}
          {isStreaming && '▊'}
        </p>

        {!isUser && citations && citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1 pt-2 border-t border-border/50">
            {citations.map((cit, idx) => {
              const n = Number(cit.id) || idx + 1;
              // El tooltip muestra el texto fuente: es lo que el lector
              // quiere comprobar al señalar una cita, no solo el nombre
              // del archivo (que se repite en todos los chunks).
              const tip = cit.sourceText ? `${cit.docTitle}\n\n${cit.sourceText}` : cit.docTitle;

              return (
                <span
                  key={cit.id || idx}
                  data-cite-id={n}
                  title={tip}
                  aria-label={`Cita ${n}: ${cit.docTitle}`}
                  className={`inline-flex items-center rounded bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground transition-shadow ${
                    flashed === n ? 'ring-2 ring-ring' : ''
                  }`}
                >
                  [{n}] {cit.docTitle}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
