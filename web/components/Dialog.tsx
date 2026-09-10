"use client";

// The mechanism of a modal window, in one single place.
//
// Built on `<dialog>` rather than on a fixed-position div: the browser gives the
// keyboard trap, the focus return, the Escape key and the backdrop, which would
// otherwise have to be written and maintained.
import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({
  open,
  title,
  onClose,
  footer,
  width = "30rem",
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  width?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
        // Escape fires `cancel`: letting it close without warning would leave the
        // parent's state believing the window still open.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
        // A click on the backdrop has the dialog itself as its target, never its
        // content: that is what tells the two apart.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      style={{ width }}
      className="m-auto max-h-[85vh] max-w-[92vw] rounded border border-olive bg-paper p-0 text-zinc-900 backdrop:bg-zinc-900/40"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="shrink-0 px-5 pt-5">
          <h2 className="text-lg font-medium">{title}</h2>
        </div>
        <div className="grow overflow-y-auto px-5 py-4 text-sm text-zinc-700">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-zinc-200 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}
