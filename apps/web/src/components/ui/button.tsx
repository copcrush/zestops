import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "accent";
type ButtonSize = "sm" | "md";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-lime hover:bg-lime-strong",
  secondary: "bg-white hover:bg-mist",
  danger: "bg-coral hover:bg-[#ff7d6f]",
  accent: "bg-nova hover:bg-[#ae9bff]",
  ghost: "border-transparent shadow-none bg-transparent hover:bg-mist hover:border-ink",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-[15px] gap-2",
};

export function buttonClassName(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cn(
    "inline-flex select-none items-center justify-center whitespace-nowrap rounded-brutal border-2 border-ink",
    "font-semibold shadow-brutal-sm transition-[transform,box-shadow,background-color] duration-100",
    "hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal",
    "active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
    "disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
    extra,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "primary", size = "md", isLoading = false, icon, className, children,
                         disabled, type = "button", ...buttonProps }: ButtonProps) {
  return (
    <button type={type} className={buttonClassName(variant, size, className)} disabled={disabled || isLoading}
            aria-busy={isLoading || undefined} {...buttonProps}>
      {isLoading ? <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-ink border-t-transparent" /> : icon}
      <span>{children}</span>
    </button>
  );
}

interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function ButtonLink({ href, variant = "secondary", size = "md", icon, className, children }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClassName(variant, size, className)}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
