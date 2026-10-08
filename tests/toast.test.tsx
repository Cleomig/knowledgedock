import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Toast, { type ToastState } from '@/components/Toast';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

afterEach(() => {
  act(() => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function renderToast(toasts: ToastState, onDismiss: (id: string) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => root.render(<Toast toasts={toasts} onDismiss={onDismiss} />));
  return container;
}

describe('Toast', () => {
  it('muestra el mensaje y permite cerrar el aviso manualmente', () => {
    const toasts: ToastState = [
      { id: 'toast-1', message: 'Documento listo', tone: 'success' },
    ];
    const onDismiss = vi.fn();

    const container = renderToast(toasts, onDismiss);

    expect(container.textContent).toContain('Documento listo');
    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Cerrar aviso"]'
    );
    expect(closeButton).not.toBeNull();
    act(() => closeButton?.click());
    expect(onDismiss).toHaveBeenCalledWith('toast-1');
  });

  it('cierra automáticamente los avisos de éxito tras 5,5 segundos', async () => {
    vi.useFakeTimers();
    const toasts: ToastState = [
      { id: 'toast-2', message: 'Documento listo', tone: 'success' },
    ];
    const onDismiss = vi.fn();

    renderToast(toasts, onDismiss);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });

    expect(onDismiss).toHaveBeenCalledWith('toast-2');
  });
});
