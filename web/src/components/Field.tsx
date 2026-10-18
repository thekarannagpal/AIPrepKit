"use client";

import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  error?: string;
  className?: string;
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & FieldProps
>(({ label, error, className, ...props }, ref) => (
  <div className={cn("flex flex-col gap-1", className)}>
    <label className="text-sm text-slate-300">{label}</label>
    <input
      ref={ref}
      className={cn(
        "px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-100",
        className
      )}
      {...props}
    />
    {error && <p className="text-xs text-red-400">{error}</p>}
  </div>
));

Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps
>(({ label, error, className, ...props }, ref) => (
  <div className={cn("flex flex-col gap-1", className)}>
    <label className="text-sm text-slate-300">{label}</label>
    <textarea
      ref={ref}
      className={cn(
        "px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 min-h-[80px]",
        className
      )}
      {...props}
    />
    {error && <p className="text-xs text-red-400">{error}</p>}
  </div>
));

Textarea.displayName = "Textarea";