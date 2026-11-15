import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

import { cn } from "./cn";

const controlClassName = cn(
  "w-full rounded-brutal border-2 border-ink bg-white px-3 text-[15px] text-ink placeholder:text-muted/70",
  "shadow-[inset_2px_2px_0_0_rgba(20,20,20,0.08)] transition-colors",
  "focus:border-nova-strong focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-1",
  "aria-[invalid=true]:border-coral-strong aria-[invalid=true]:bg-coral-soft",
  "disabled:cursor-not-allowed disabled:bg-mist",
);

export function TextInput({ className, ...inputProps }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClassName, "h-11", className)} {...inputProps} />;
}

export function SelectInput({ className, children, ...selectProps }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlClassName, "h-11 pr-8", className)} {...selectProps}>{children}</select>;
}

export function TextArea({ className, ...textAreaProps }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClassName, "min-h-24 py-2", className)} {...textAreaProps} />;
}

/**
 * Label + control + hint + error, wired together for screen readers:
 * pass `describedBy` ids to the control via the render function.
 */
export function Field({ id, label, hint, error, required, children }: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (controlProps: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        {required ? <span aria-hidden className="text-coral-strong"> *</span> : null}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? <p id={hintId} className="text-xs text-muted">{hint}</p> : null}
      {error ? <p id={errorId} className="text-sm font-semibold text-coral-strong">{error}</p> : null}
    </div>
  );
}
