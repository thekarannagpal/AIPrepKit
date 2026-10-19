import type { Response } from "express";

/**
 * In-process SSE hub. Progress for a kit generation streams to any client
 * watching that kit; the DB copy of the steps is the durable record, this is
 * only the live channel. Single-node by design — the deployment is one
 * process on a free tier, and cross-process pub/sub would be machinery
 * without a job.
 */
type Listener = (event: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(kitId: string, res: Response): () => void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");

  const set = listeners.get(kitId) ?? new Set<Listener>();
  const listener: Listener = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  set.add(listener);
  listeners.set(kitId, set);

  // Heartbeat keeps proxies from closing an idle stream.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);

  return () => {
    clearInterval(heartbeat);
    set.delete(listener);
    if (set.size === 0) listeners.delete(kitId);
    res.end();
  };
}

export function publish(kitId: string, event: unknown): void {
  const set = listeners.get(kitId);
  if (!set) return;
  for (const listener of set) listener(event);
}
