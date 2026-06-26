import { useStore } from '../store';

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => dismissToast(t.id)}
          title="Dismiss"
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
