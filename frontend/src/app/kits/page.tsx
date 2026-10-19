"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { apiDelete, apiGet } from "@/lib/api";
import { ConfirmModal } from "@/components/Modal";
import { showToast } from "@/components/Toast";

interface KitListItem {
  _id: string;
  status: string;
  input: { company_url?: string; days: number; jd_chars: number };
  steps: Array<{ key: string; label: string; status: string; detail?: string }>;
  error: { code: string; message: string } | null;
  version: number;
  created_at: string;
  role_title?: string;
  company?: string;
  questions?: number;
  flashcards?: number;
  days?: number;
  uncovered_must?: number;
}

export default function KitsPage() {
  const [kits, setKits] = useState<KitListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchKits = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet<{ kits: KitListItem[] }>("/api/kits");
      setKits(res.kits);
    } catch (err: any) {
      setError(err?.error?.message || "Failed to load kits");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKits();
  }, []);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await apiDelete(`/api/kits/${deleteId}`);
      showToast("Kit deleted", "success");
      fetchKits();
    } catch (err: any) {
      showToast(err?.error?.message || "Delete failed", "error");
    } finally {
      setDeleteId(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-3">
        <Skeleton className="h-10" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <ErrorState message={error} retry={fetchKits} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Kits</h1>
        <Link href="/kits/new">
          <Button variant="primary">New kit</Button>
        </Link>
      </div>

      {kits.length === 0 ? (
        <EmptyState
          title="No kits yet"
          description="Create your first kit from a job description"
          action={
            <Link href="/kits/new">
              <Button variant="primary">Create kit</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3">
          {kits.map((kit) => (
            <Card key={kit._id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-medium">
                    {kit.role_title || "Untitled role"}
                  </h2>
                  <StatusBadge status={kit.status} />
                  {kit.uncovered_must && kit.uncovered_must > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-amber-500/20 text-amber-300 border-amber-500/40">
                      {kit.uncovered_must} must-have gaps
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-400">
                  {kit.company || "Unknown company"} · {kit.days || kit.input.days} days ·{" "}
                  {new Date(kit.created_at).toLocaleDateString()}
                </p>
                {kit.error && (
                  <p className="text-xs text-red-400">{kit.error.message}</p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Link href={`/kits/${kit._id}`}>
                  <Button variant="ghost">Open</Button>
                </Link>
                {kit.flashcards && kit.flashcards > 0 && (
                  <Link href={`/kits/${kit._id}/practice`}>
                    <Button variant="ghost">Practice</Button>
                  </Link>
                )}
                <Button
                  variant="danger"
                  onClick={() => setDeleteId(kit._id)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        message="Are you sure you want to delete this kit?"
      />
    </div>
  );
}