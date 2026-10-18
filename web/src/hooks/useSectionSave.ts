"use client";

import { useCallback, useRef, useState } from "react";
import { apiPut } from "@/lib/api";
import { showToast } from "@/components/Toast";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useSectionSave<T = any>(kitId: string, expectedVersion?: number) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const versionRef = useRef(expectedVersion);

  const save = useCallback(
    async (section: Partial<T> & { expected_version?: number }) => {
      setStatus("saving");
      try {
        const payload = {
          ...section,
          expected_version: section.expected_version ?? versionRef.current,
        };
        const res = await apiPut<{ kit: any }>(`/api/kits/${kitId}`, payload);
        if (res.kit?.version !== undefined) {
          versionRef.current = res.kit.version;
        }
        setStatus("saved");
        return res;
      } catch (err: any) {
        if (err?.error?.code === "CONFLICT") {
          showToast("Kit changed elsewhere — reload", "error");
        } else {
          showToast(err?.error?.message || "Save failed", "error");
        }
        setStatus("error");
        throw err;
      }
    },
    [kitId]
  );

  const debouncedSave = useCallback(
    (section: Partial<T>, delay = 800) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setStatus("saving");
      timeoutRef.current = setTimeout(() => {
        save(section).catch(() => {});
      }, delay);
    },
    [save]
  );

  const updateVersion = useCallback((v: number) => {
    versionRef.current = v;
  }, []);

  return { status, save, debouncedSave, updateVersion };
}