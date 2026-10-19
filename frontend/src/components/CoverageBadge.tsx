import { cn } from "@/lib/utils";

export function CoverageBadge({
  uncoveredMust,
}: {
  uncoveredMust: number;
}) {
  if (uncoveredMust === 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
        All must-haves covered
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-amber-500/20 text-amber-300 border-amber-500/40">
      {uncoveredMust} must-have gap{uncoveredMust > 1 ? "s" : ""}
    </span>
  );
}