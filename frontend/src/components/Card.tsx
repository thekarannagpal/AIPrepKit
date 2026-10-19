import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-slate-950 border border-slate-800 rounded-xl p-4 shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}