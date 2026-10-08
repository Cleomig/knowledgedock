import { AlertTriangle } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export default function ErrorState({ title = 'Ha ocurrido un error', message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive mb-3" />
      <h3 className="text-lg font-semibold text-destructive">{title}</h3>
      <p className="mt-1 text-sm text-foreground/80 mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
