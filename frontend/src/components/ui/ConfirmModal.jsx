import { useEffect } from 'react';
import { X } from 'lucide-react';
import ControlButton from './ControlButton';

// Lightweight modal for pre-submit confirmations. Backdrop click and Escape
// close it. Children render inside a glass panel with title + footer slots.
export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  confirmDisabled = false,
  children,
  size = 'md',
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-sm' : 'max-w-lg';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        className="absolute inset-0 bg-obsidian/80 backdrop-blur-sm"
      />
      <div className={`relative w-full ${widthClass} rounded-2xl border border-white/[0.08] bg-obsidian shadow-2xl`}>
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-3">
          <div className="min-w-0">
            <h2 id="confirm-modal-title" className="text-lg font-display font-semibold text-white">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-[12px] text-steel/55 leading-relaxed">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-steel/40 hover:text-white transition-colors -mr-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children && (
          <div className="px-6 py-3 max-h-[60vh] overflow-y-auto">{children}</div>
        )}
        <div className="flex justify-end gap-3 px-6 pb-6 pt-3 border-t border-white/[0.04]">
          <ControlButton variant="ghost" onClick={onClose}>
            {cancelLabel}
          </ControlButton>
          <ControlButton
            variant={confirmVariant}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </ControlButton>
        </div>
      </div>
    </div>
  );
}
