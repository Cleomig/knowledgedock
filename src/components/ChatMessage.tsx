'use client';

import { useRef, useEffect } from 'react';

interface Citation {
  id: string;
  sourceText: string;
  docTitle: string;
}

interface ChatMessageProps {
  role: 'user' | 'ai';
  content: string;
  citations?: Citation[];
  isStreaming?: boolean;
}

export default function ChatMessage({ role, content, citations, isStreaming = false }: ChatMessageProps) {
  const isUser = role === 'user';
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [content, citations]);

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-6`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm'
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}{isStreaming && '▊'}</p>

        {!isUser && citations && citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1 pt-2 border-t border-border/50">
            {citations.map((cit, idx) => (
              <span
                key={cit.id || idx}
                className="inline-flex items-center rounded bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground"
                title={cit.docTitle}
                aria-label={`Cita ${idx + 1}: ${cit.docTitle}`}
              >
                [{idx + 1}] {cit.docTitle}
              </span>
            ))}
          </div>
        )}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
