import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: "bg-slate-800 text-slate-200 border-slate-700",
    running: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse",
    complete: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    failed: "bg-red-500/20 text-red-400 border-red-500/40",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs border",
        styles[status] || styles.queued
      )}
    >
      {status}
    </span>
  );
}