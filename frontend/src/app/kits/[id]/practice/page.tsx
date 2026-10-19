"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Skeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { showToast } from "@/components/Toast";

interface PracticeCard {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
  confidence?: number;
  box?: number;
  due_at?: string;
}

interface PracticeResponse {
  order: PracticeCard[];
  stats: {
    total: number;
    seen: number;
    by_confidence: any;
    requirement_coverage: Array<{ id: string; text: string; practised: boolean }>;
  };
}

export default function PracticePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [data, setData] = useState<PracticeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const fetchPractice = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet<PracticeResponse>(`/api/kits/${id}/practice`);
      setData(res);
      setIndex(0);
      setRevealed(false);
      setDone(false);
      setSummary(res.stats);
    } catch (err: any) {
      setError(err?.error?.message || "Failed to load practice");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPractice();
  }, [id]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (done) return;
      if (!revealed && e.code === "Space") {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ["Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code)) {
        const conf = Number(e.code.slice(-1));
        handleScore(conf as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [revealed, done, index, data]);

  const handleScore = async (confidence: 1 | 2 | 3 | 4) => {
    if (!data || submitting) return;
    const card = data.order[index];
    if (!card) return;
    setSubmitting(true);
    try {
      await apiPost(`/api/kits/${id}/practice`, {
        card_id: card.id,
        confidence,
      });
      const nextIndex = index + 1;
      if (nextIndex >= data.order.length) {
        setDone(true);
      } else {
        setIndex(nextIndex);
        setRevealed(false);
      }
    } catch (err: any) {
      showToast?.(err?.error?.message || "Failed to record", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <ErrorState message={error} retry={fetchPractice} />
      </div>
    );
  }

  if (!data || data.order.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Card className="text-center py-8">
          <p className="text-slate-400">No flashcards to practice</p>
          <Button className="mt-4" onClick={() => router.push(`/kits/${id}`)}>
            Back to kit
          </Button>
        </Card>
      </div>
    );
  }

  const current = data.order[index];
  const seen = index + (revealed ? 1 : 0);
  const progress = data.stats.total ? (seen / data.stats.total) * 100 : 0;

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Session complete</h1>
          <div className="flex flex-col gap-2 text-sm">
            <p>Total: {data.stats.total}</p>
            {summary?.by_confidence && (
              <div>
                <p className="text-slate-300">By confidence:</p>
                <ul className="list-disc list-inside text-slate-400">
                  <li>1 Again: {summary.by_confidence[1] || 0}</li>
                  <li>2 Hard: {summary.by_confidence[2] || 0}</li>
                  <li>3 Good: {summary.by_confidence[3] || 0}</li>
                  <li>4 Easy: {summary.by_confidence[4] || 0}</li>
                </ul>
              </div>
            )}
            {summary?.requirement_coverage?.length > 0 && (
              <div>
                <p className="text-slate-300">Requirements not yet practised:</p>
                <ul className="list-disc list-inside text-slate-400">
                  {summary.requirement_coverage
                    .filter((r: any) => !r.practised)
                    .map((r: any) => (
                      <li key={r.id}>{r.id}: {r.text}</li>
                    ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={fetchPractice}>Restart</Button>
            <Button variant="ghost" onClick={() => router.push(`/kits/${id}`)}>
              Back to kit
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="w-full bg-slate-800 rounded-full h-2">
        <div
          className="bg-indigo-500 h-2 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <Card className="flex flex-col gap-4 min-h-[300px] justify-between">
        <div>
          <p className="text-xs text-slate-400 mb-2">
            Card {index + 1} of {data.stats.total}
          </p>
          <div className="p-4 border border-slate-800 rounded-xl min-h-[120px]">
            <p className="whitespace-pre-wrap">{revealed ? current.back : current.front}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {!revealed ? (
            <Button onClick={() => setRevealed(true)} className="w-full">
              Reveal answer (Space)
            </Button>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Button variant="danger" onClick={() => handleScore(1)} disabled={submitting}>
                1 Again
              </Button>
              <Button className="bg-amber-600 hover:bg-amber-500 border-amber-600" onClick={() => handleScore(2)} disabled={submitting}>
                2 Hard
              </Button>
              <Button className="bg-emerald-600 hover:bg-emerald-500 border-emerald-600" onClick={() => handleScore(3)} disabled={submitting}>
                3 Good
              </Button>
              <Button variant="primary" onClick={() => handleScore(4)} disabled={submitting}>
                4 Easy
              </Button>
            </div>
          )}
        </div>
      </Card>
      <p className="text-xs text-slate-400 text-center">Keyboard: Space to reveal, 1-4 to score</p>
    </div>
  );
}