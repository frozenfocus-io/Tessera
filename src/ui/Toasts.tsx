import { dismissToast, toasts } from '../app/workspace';
import { IconClose } from './icons';

export function Toasts() {
  const list = toasts.value;
  if (list.length === 0) return null;
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div class={`toast toast-${t.kind}`} key={t.id}>
          <div>
            <div>{t.text}</div>
            {t.detail ? <div class="toast-detail">{t.detail}</div> : null}
          </div>
          {t.action ? (
            <button
              class="btn btn-ghost toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button class="btn btn-icon btn-ghost" aria-label="Meldung schließen" onClick={() => dismissToast(t.id)}>
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
