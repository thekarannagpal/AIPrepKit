import { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center border border-dashed border-slate-800 rounded-xl">
      <h3 className="text-lg font-medium">{title}</h3>
      {description && <p className="text-sm text-slate-400">{description}</p>}
      {action}
    </div>
  );
}