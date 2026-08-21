"use client";

// La mécanique d'une fenêtre modale, en un seul endroit.
//
// Bâtie sur `<dialog>` plutôt que sur un div en position fixe : le navigateur
// donne le piège au clavier, le retour du focus, la touche Échap et le voile,
// qu'il faudrait sinon écrire et maintenir.
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
      // Échap déclenche `cancel` : le laisser fermer sans prévenir laisserait
      // l'état du parent croire la fenêtre encore ouverte.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Un clic sur le voile a pour cible le dialogue lui-même, jamais son
      // contenu : c'est ce qui distingue les deux.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      style={{ width }}
      className="m-auto max-h-[85vh] max-w-[92vw] rounded border border-zinc-300 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-900/40"
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
