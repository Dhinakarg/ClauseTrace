import { useEffect, useRef } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button.jsx';

export function ResetModal({ open = false, onClose, onConfirm }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-lg border border-ink-200 bg-surface p-5 shadow-overlay"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-flag-50 p-2 text-flag-600 shrink-0">
            <AlertTriangle aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 id="reset-modal-title" className="text-base font-semibold text-ink-900">
              Reset workspace?
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-600">
              This clears the current browser-local ClauseTrace workspace and returns the application to its initial state.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-ink-100 pt-4">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            icon={RotateCcw}
            onClick={() => {
              onConfirm?.();
              onClose?.();
            }}
          >
            Reset workspace
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ResetModal;
