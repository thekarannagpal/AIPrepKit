"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Toast = {
  id: number;
  message: string;
  type?: "default" | "error" | "success";
};

let toastId = 0;
let showToastFn: ((message: string, type?: Toast["type"]) => void) | null = null;

export function showToast(message: string, type?: Toast["type"]) {
  if (showToastFn) {
    showToastFn(message, type);
  }
}

const ToastContext = createContext<{ show: typeof showToast } | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    showToastFn = (message, type) => {
      const id = ++toastId;
      setToasts((t) => [...t, { id, message, type: type || "default" }]);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 3000);
    };
    return () => {
      showToastFn = null;
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show: showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-2 rounded-xl border shadow-lg ${
              toast.type === "error"
                ? "bg-red-600/90 border-red-500 text-white"
                : toast.type === "success"
                ? "bg-emerald-600/90 border-emerald-500 text-white"
                : "bg-slate-900/95 border-slate-700 text-slate-100"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    showToastFn = (message, type) => {
      const id = ++toastId;
      setToasts((t) => [...t, { id, message, type: type || "default" }]);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 3000);
    };
    return () => {
      showToastFn = null;
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-2 rounded-xl border shadow-lg ${
            toast.type === "error"
              ? "bg-red-600/90 border-red-500 text-white"
              : toast.type === "success"
              ? "bg-emerald-600/90 border-emerald-500 text-white"
              : "bg-slate-900/95 border-slate-700 text-slate-100"
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  return { show: showToast };
}