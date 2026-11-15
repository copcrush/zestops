"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * Modal dialog built on the native <dialog> element, which gives focus
 * trapping, Escape-to-close and an inert background for free (accessibility).
 */
export function Dialog({ isOpen, onClose, title, description, children }: {
  isOpen: boolean; onClose: () => void; title: string; description?: string; children: ReactNode;
}) {
  const dialogReference = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialogElement = dialogReference.current;
    if (!dialogElement) {
      return;
    }
    if (isOpen && !dialogElement.open) {
      dialogElement.showModal();
    } else if (!isOpen && dialogElement.open) {
      dialogElement.close();
    }
  }, [isOpen]);

  return (
    <dialog ref={dialogReference} onClose={onClose} aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-brutal border-2 border-ink bg-paper p-0 text-ink shadow-brutal-lg backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]">
      <div className="flex items-start justify-between gap-4 border-b-2 border-ink bg-lime px-5 py-4">
        <div>
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          {description ? <p id={descriptionId} className="mt-0.5 text-sm">{description}</p> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close dialog"
                className="rounded-md border-2 border-ink bg-white p-1 hover:bg-mist">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div className="px-5 py-5">{isOpen ? children : null}</div>
    </dialog>
  );
}
