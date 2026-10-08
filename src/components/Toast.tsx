'use client';

import { useEffect, useState } from 'react';

export type ToastTone = 'success' | 'error';

export interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
  title?: string;
}

export type ToastState = ToastMessage[];

interface ToastProps {
  toasts: ToastState;
  onDismiss: (id: string) => void;
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const enterTimer = setTimeout(() => setIsVisible(true), 0);
    const dismissTimer = setTimeout(
      () => onDismiss(toast.id),
      toast.tone === 'success' ? 5500 : 8000
    );

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(dismissTimer);
    };
  }, [onDismiss, toast.id, toast.tone]);

  const isError = toast.tone === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      title={toast.title}
      className={`flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-foreground shadow-md transition-[opacity,transform] duration-200 ease-out ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      } ${isError ? 'border-destructive/30' : ''}`}
    >
      <p className={`min-w-0 flex-1 text-sm ${isError ? 'text-destructive' : ''}`}>
        {toast.message}
      </p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar aviso"
        className="shrink-0 rounded-md px-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ×
      </button>
    </div>
  );
}

export default function Toast({ toasts, onDismiss }: ToastProps) {
  const visibleToasts = toasts.slice(-3);
  if (visibleToasts.length === 0) return null;

  return (
    <div
      aria-label="Avisos"
      aria-live="polite"
      aria-relevant="additions text"
      className="fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3"
    >
      {visibleToasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
