"use client";

import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div
        ref={ref}
        tabIndex={-1}
        className="bg-slate-950 border border-slate-800 rounded-xl p-4 max-w-lg w-full mx-4 shadow-xl focus:outline-none"
      >
        {title && <h3 className="text-lg font-medium mb-3">{title}</h3>}
        <div className="mb-4">{children}</div>
        {actions && <div className="flex gap-2 justify-end">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || "Confirm"}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Confirm
          </Button>
        </>
      }
    >
      <p className="text-slate-300">{message}</p>
    </Modal>
  );
}