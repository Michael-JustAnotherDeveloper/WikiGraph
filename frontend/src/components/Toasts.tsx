import { useUiStore } from '../store/ui';

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} className="glass toast" onClick={() => dismiss(toast.id)}>
          {toast.message}
        </button>
      ))}
    </div>
  );
}