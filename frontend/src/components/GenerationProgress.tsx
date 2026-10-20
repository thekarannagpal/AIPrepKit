"use client";

import { useEffect, useState } from "react";
import { ErrorState } from "./ErrorState";
import { Card } from "./Card";

interface Step {
  key: string;
  label: string;
  status: "pending" | "started" | "done" | "failed";
  detail?: string;
}

interface EventData {
  type: string;
  status?: string;
  steps?: Step[];
  error?: { code: string; message: string };
  key?: string;
  label?: string;
  detail?: string;
  message?: string;
}

export function GenerationProgress({ kitId }: { kitId: string }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/kits/${kitId}/events`);
    es.onmessage = (evt) => {
      try {
        const data: EventData = JSON.parse(evt.data);
        if (data.type === "snapshot") {
          if (data.steps) setSteps(data.steps);
          if (data.status) setProgress(data.status);
          if (data.error?.code) setError(data.error);
          // The kit may have finished between the page's last fetch and this
          // subscription attaching; there will be no `done` event to catch it.
          if (data.status === "complete") {
            setDone(true);
            window.location.reload();
          }
        } else if (data.type === "step" && data.key) {
          setSteps((prev) => {
            const i = prev.findIndex((s) => s.key === data.key);
            if (i >= 0) {
              const next = [...prev];
              next[i] = {
                key: data.key!,
                label: data.label || next[i].label,
                status: (data.status as any) || next[i].status,
                detail: data.detail || next[i].detail,
              };
              return next;
            }
            if (!data.key) return prev;
            return prev.concat([
              {
                key: data.key,
                label: data.label || data.key,
                status: (data.status as any) || "started",
                detail: data.detail,
              },
            ] as Step[]);
          });
        } else if (data.type === "progress") {
          if (data.message) setProgress(data.message);
        } else if (data.type === "done") {
          setDone(true);
          window.location.reload();
        } else if (data.type === "failed") {
          if (data.error?.code) setError(data.error);
          es.close();
        }
      } catch (e) {
        console.error(e);
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [kitId]);

  if (error && error.code) {
    return (
      <ErrorState
        title={`Failed: ${error.code}`}
        message={error.message}
        back
      />
    );
  }

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Generating kit...</h2>
        {progress && <p className="text-sm text-slate-400">{progress}</p>}
        <div className="flex flex-col gap-3">
          {steps.map((step) => (
            <div key={step.key} className="flex items-start gap-3">
              {step.status === "pending" && (
                <span className="w-4 h-4 rounded-full border border-slate-600 mt-0.5" />
              )}
              {step.status === "started" && (
                <span className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mt-0.5" />
              )}
              {step.status === "done" && (
                <span className="w-4 h-4 rounded-full bg-emerald-500 mt-0.5 flex items-center justify-center text-xs">
                  ✓
                </span>
              )}
              {step.status === "failed" && (
                <span className="w-4 h-4 rounded-full bg-red-500 mt-0.5 flex items-center justify-center text-xs">
                  ×
                </span>
              )}
              <div className="flex flex-col">
                <span className="text-sm">{step.label}</span>
                {step.detail && (
                  <span className="text-xs text-slate-400">{step.detail}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}