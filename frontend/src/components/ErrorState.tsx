"use client";

import { Button } from "./Button";

export function ErrorState({
  title,
  message,
  retry,
  back,
}: {
  title?: string;
  message?: string;
  retry?: () => void;
  back?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center border border-red-500/40 bg-red-500/10 rounded-xl">
      <h3 className="text-lg font-medium text-red-300">{title || "Error"}</h3>
      {message && <p className="text-sm text-red-400">{message}</p>}
      <div className="flex gap-2">
        {retry && (
          <Button variant="primary" onClick={retry}>
            Retry
          </Button>
        )}
        {back && (
          <Button variant="ghost" onClick={() => window.history.back()}>
            Back
          </Button>
        )}
      </div>
    </div>
  );
}