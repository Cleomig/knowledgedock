import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Toast, { type ToastState } from '@/components/Toast';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('muestra el mensaje y permite cerrar el aviso manualmente', () => {
    const toasts: ToastState = [
      { id: 'toast-1', message: 'Documento listo', tone: 'success' },
    ];
    const onDismiss = vi.fn();

    render(<Toast toasts={toasts} onDismiss={onDismiss} />);

    expect(screen.getByText('Documento listo')).toBeInTheDocument();
    const closeButton = screen.getByRole('button', { name: 'Cerrar aviso' });
    fireEvent.click(closeButton);
    expect(onDismiss).toHaveBeenCalledWith('toast-1');
  });

  it('cierra automáticamente los avisos de éxito tras 5,5 segundos', async () => {
    vi.useFakeTimers();
    const toasts: ToastState = [
      { id: 'toast-2', message: 'Documento listo', tone: 'success' },
    ];
    const onDismiss = vi.fn();

    render(<Toast toasts={toasts} onDismiss={onDismiss} />);

    await vi.advanceTimersByTimeAsync(5500);

    expect(onDismiss).toHaveBeenCalledWith('toast-2');
  });
});
