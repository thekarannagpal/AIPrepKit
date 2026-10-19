import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse bg-slate-800 rounded-xl h-6 w-full", className)} />
  );
}