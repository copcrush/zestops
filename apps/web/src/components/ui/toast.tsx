"use client";

import { CheckCircle2, X, XCircle } from "lucide-react";
import { createContext, type ReactNode, use, useCallback, useMemo, useState } from "react";

import { cn } from "./cn";

type ToastTone = "success" | "error";
interface ToastMessage { id: number; tone: ToastTone; message: string }

const ToastContext = createContext<{ showToast: (tone: ToastTone, message: string) => void } | null>(null);

/** Success/failure feedback announced to screen readers through an aria-live region. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((toastId: number) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  }, []);

  const showToast = useCallback((tone: ToastTone, message: string) => {
    const toastId = Date.now() + Math.random();
    setToasts((currentToasts) => [...currentToasts.slice(-2), { id: toastId, tone, message }]);
    window.setTimeout(() => dismissToast(toastId), 5000);
  }, [dismissToast]);

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext value={contextValue}>
      {children}
      <div aria-live="polite" aria-atomic="false"
           className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6">
        {toasts.map((toast) => (
          <div key={toast.id} role={toast.tone === "error" ? "alert" : "status"}
               className={cn("pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-brutal border-2 border-ink",
                 "px-4 py-3 text-sm font-semibold shadow-brutal", toast.tone === "success" ? "bg-lime" : "bg-coral")}>
            {toast.tone === "success"
              ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
              : <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <p className="flex-1">{toast.message}</p>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification"
                    className="rounded p-0.5 hover:bg-white/50">
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const toastContext = use(ToastContext);
  if (!toastContext) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return toastContext;
}
