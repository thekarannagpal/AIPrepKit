"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", loading, disabled, children, ...props }, ref) => {
    const base = "px-4 py-2 rounded-xl border transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2";
    const variants = {
      primary: "bg-indigo-500 hover:bg-indigo-400 border-indigo-500 text-white",
      ghost: "bg-transparent hover:bg-slate-900 border-slate-800 text-slate-100",
      danger: "bg-red-600 hover:bg-red-500 border-red-600 text-white",
    };

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";