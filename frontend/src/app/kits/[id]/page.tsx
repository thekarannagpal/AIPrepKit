"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input, Textarea } from "@/components/Field";
import { StatusBadge } from "@/components/StatusBadge";
import { CoverageBadge } from "@/components/CoverageBadge";
import { Skeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { GenerationProgress } from "@/components/GenerationProgress";
import { showToast } from "@/components/Toast";
import { useSectionSave } from "@/hooks/useSectionSave";
import { Question, Flashcard } from "@aiprepkit/core";
import { QuestionEditor } from "@/components/QuestionEditor";
import { FlashcardCard } from "@/components/FlashcardCard";
import { ScheduleView } from "@/components/ScheduleView";

interface KitData {
  _id: string;
  status: string;
  version: number;
  input: any;
  steps: any[];
  error: any;
  role_title?: string;
  company?: string;
  days?: number;
  uncovered_must?: number;
  role?: any;
  company_brief?: any;
  questions?: Question[];
  flashcards?: Flashcard[];
  schedule?: any;
  coverage?: any;
  notes?: string[];
  source?: any;
  kit?: any;
}

export default function KitPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [kit, setKit] = useState<KitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("Brief");
  const [saveStatus, setSaveStatus] = useState<"Saving…" | "Saved" | "Unsaved changes" | "">("");
  const [editedBrief, setEditedBrief] = useState<any>(null);
  const [editedQuestions, setEditedQuestions] = useState<Question[]>([]);
  const [editedFlashcards, setEditedFlashcards] = useState<Flashcard[]>([]);
  const [regeneratingSection, setRegeneratingSection] = useState<string | null>(null);

  const { save, debouncedSave, updateVersion } = useSectionSave<KitData>(id);

  const tabs = ["Brief", "Role", "Questions", "Flashcards", "Schedule", "Research"];

  const fetchKit = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet<{ kit: any }>(`/api/kits/${id}`);
      const raw = res.kit;
      const inner = raw.kit || raw;
      const merged: KitData = {
        ...raw,
        ...inner,
        role_title: raw.role_title || inner.role?.title || raw.role?.title || "Untitled",
        company: raw.company || inner.source?.company || raw.source?.company || "",
        days: raw.days || inner.schedule?.days_available || raw.input?.days || 1,
        uncovered_must: raw.uncovered_must ?? inner.coverage?.uncovered_must_requirement_ids?.length ?? 0,
        role: inner.role || raw.role,
        company_brief: inner.company_brief || raw.company_brief,
        questions: inner.questions || raw.questions || [],
        flashcards: inner.flashcards || raw.flashcards || [],
        schedule: inner.schedule || raw.schedule,
        coverage: inner.coverage || raw.coverage,
        notes: inner.notes || raw.notes || [],
        source: inner.source || raw.source,
      };
      setKit(merged);
      setEditedBrief(merged.company_brief || null);
      setEditedQuestions(merged.questions || []);
      setEditedFlashcards(merged.flashcards || []);
      updateVersion(raw.version);
    } catch (err: any) {
      setError(err?.error?.message || "Failed to load kit");
    } finally {
      setLoading(false);
    }
  }, [id, updateVersion]);

  useEffect(() => {
    fetchKit();
  }, [fetchKit]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHash = () => {
      const h = window.location.hash.slice(1);
      if (tabs.includes(h)) {
        setActiveTab(h);
      }
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const changeTab = (newTab: string) => {
    setActiveTab(newTab);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${newTab}`);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <Skeleton className="h-12 mb-4" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <ErrorState message={error} retry={fetchKit} />
      </div>
    );
  }

  if (!kit) return null;

  if (kit.status === "queued" || kit.status === "running") {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <GenerationProgress kitId={id} />
      </div>
    );
  }

  if (kit.status === "failed" && !kit.questions?.length) {
    // Failed before any content existed (bad URL, interrupted run, provider
    // error) — show the structured reason instead of an empty shell.
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <ErrorState
          message={kit.error?.message || "This kit could not be generated."}
          retry={fetchKit}
        />
      </div>
    );
  }

  const handleBriefChange = (field: "summary" | "what_they_do", value: string) => {
    setEditedBrief((prev: any) => ({ ...prev, [field]: value }));
    setSaveStatus("Unsaved changes");
    debouncedSave({
      company_brief: { ...editedBrief, [field]: value },
    });
  };

  const handleRegenerate = async (section: string, confirmMessage: string) => {
    if (!confirm(confirmMessage)) return;
    setRegeneratingSection(section);
    try {
      const res = await apiPost(`/api/kits/${id}/regenerate`, { section });
      if (res.summary) {
        showToast(
          `kept:${res.summary.kept} replaced:${res.summary.replaced} added:${res.summary.added}`,
          "success"
        );
      } else {
        showToast("Section regenerated successfully", "success");
      }
      await fetchKit();
    } catch (err: any) {
      showToast(err?.error?.message || "Regenerate failed", "error");
    } finally {
      setRegeneratingSection(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {kit.role_title || kit.role?.title || "Untitled"} @ {kit.company || kit.source?.company}
          </h1>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <StatusBadge status={kit.status} />
            <span className="text-xs text-slate-400">{kit.days || kit.input?.days} days</span>
            {kit.coverage && <CoverageBadge uncoveredMust={kit.uncovered_must || kit.coverage.uncovered_must_requirement_ids?.length || 0} />}
            {saveStatus && <span className="text-xs text-slate-400">{saveStatus}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/kits/${id}/practice`}>
            <Button variant="primary">Practice Flashcards</Button>
          </Link>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-800 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${
              activeTab === tab
                ? "border-indigo-500 text-slate-100"
                : "border-transparent text-slate-400 hover:text-slate-100"
            }`}
            onClick={() => changeTab(tab)}
            aria-selected={activeTab === tab}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Brief" && (
        <Card className="flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h3 className="font-medium text-slate-100">Company Brief</h3>
            <Button
              variant="ghost"
              disabled={regeneratingSection !== null}
              onClick={() => handleRegenerate("company_brief", "Regenerate company brief from researched pages?")}
              className="px-2 py-1 text-sm"
            >
              {regeneratingSection === "company_brief" ? "Regenerating…" : "Regenerate brief"}
            </Button>
          </div>
          <Textarea
            label="Summary"
            value={editedBrief?.summary || ""}
            onChange={(e) => handleBriefChange("summary", e.target.value)}
            className="min-h-[100px]"
          />
          <Textarea
            label="What they do"
            value={editedBrief?.what_they_do || ""}
            onChange={(e) => handleBriefChange("what_they_do", e.target.value)}
            className="min-h-[100px]"
          />
          <div>
            <p className="text-sm text-slate-300 mb-1">Sources</p>
            {editedBrief?.sources?.length ? (
              <ul className="text-sm text-slate-400 list-disc list-inside">
                {editedBrief.sources.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 italic">No external sources used.</p>
            )}
          </div>
          {kit.notes && kit.notes.length > 0 && (
            <div>
              <p className="text-sm text-slate-300 mb-1">Notes</p>
              <ul className="text-sm text-slate-400 list-disc list-inside">
                {kit.notes.map((n: string, i: number) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {activeTab === "Role" && (
        kit.role ? (
          <Card className="flex flex-col gap-3">
            <Input label="Title" value={kit.role.title || ""} readOnly />
            <Input label="Seniority" value={kit.role.seniority || ""} readOnly />
            <div>
              <p className="text-sm text-slate-300 mb-1">Responsibilities</p>
              <ul className="text-sm text-slate-400 list-disc list-inside">
                {kit.role.responsibilities?.map((r: string, i: number) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm text-slate-300 mb-1">Requirements</p>
              <div className="flex flex-col gap-2">
                {kit.role.requirements?.map((req: any) => (
                  <div
                    key={req.id}
                    className="border border-slate-800 rounded-xl p-3 flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{req.id}</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${
                          req.kind === "technical"
                            ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                            : req.kind === "behavioural"
                            ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                            : "bg-slate-500/20 text-slate-300 border-slate-500/40"
                        }`}
                      >
                        {req.kind}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${
                          req.priority === "must"
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : "bg-slate-500/20 text-slate-300 border-slate-500/40"
                        }`}
                      >
                        {req.priority}
                      </span>
                    </div>
                    <p className="text-sm">{req.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ) : (
          <Card><p className="text-sm text-slate-400">No role requirements extracted yet.</p></Card>
        )
      )}

      {activeTab === "Questions" && (
        <div className="flex flex-col gap-4">
          {["technical", "behavioural", "system-design", "company-fit"].map((cat) => {
            const questions = (editedQuestions || []).filter((q) => q.category === cat);
            return (
              <Card key={cat} className="flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-medium capitalize">{cat.replace("-", " ")}</h3>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      disabled={regeneratingSection !== null}
                      onClick={() => handleRegenerate(`questions:${cat}`, `Regenerate ${cat}?`)}
                      className="px-2 py-1 text-sm"
                    >
                      {regeneratingSection === `questions:${cat}` ? "Regenerating…" : "Regenerate"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const maxId = Math.max(0, ...editedQuestions.map((q) => parseInt(q.id.slice(1) || "0")));
                        const newQ: Question = {
                          id: `q${maxId + 1}`,
                          requirement_ids: [],
                          category: cat as any,
                          prompt: "",
                          answer_outline: "",
                          difficulty: 1,
                          origin: "user",
                          edited: true,
                          pinned: false,
                        };
                        const next = [...editedQuestions, newQ];
                        setEditedQuestions(next);
                        debouncedSave({ questions: next });
                      }}
                      className="px-2 py-1 text-sm"
                    >
                      Add question
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {questions.map((q, idx) => {
                    const globalIdx = editedQuestions.findIndex((eq) => eq.id === q.id);
                    return (
                      <QuestionEditor
                        key={q.id}
                        question={q}
                        onChange={(updated) => {
                          const next = [...editedQuestions];
                          next[globalIdx] = { ...updated, edited: true };
                          setEditedQuestions(next);
                          debouncedSave({ questions: next });
                        }}
                        onChangeCategory={(newCat) => {
                          const next = [...editedQuestions];
                          next[globalIdx] = { ...q, category: newCat, edited: true };
                          setEditedQuestions(next);
                          debouncedSave({ questions: next });
                        }}
                        onDelete={() => {
                          const next = editedQuestions.filter((eq) => eq.id !== q.id);
                          setEditedQuestions(next);
                          debouncedSave({ questions: next });
                        }}
                        onMoveUp={
                          globalIdx > 0
                            ? () => {
                                const next = [...editedQuestions];
                                [next[globalIdx - 1], next[globalIdx]] = [
                                  next[globalIdx],
                                  next[globalIdx - 1],
                                ];
                                setEditedQuestions(next);
                                debouncedSave({ questions: next });
                              }
                            : undefined
                        }
                        onMoveDown={
                          globalIdx < editedQuestions.length - 1
                            ? () => {
                                const next = [...editedQuestions];
                                [next[globalIdx], next[globalIdx + 1]] = [
                                  next[globalIdx + 1],
                                  next[globalIdx],
                                ];
                                setEditedQuestions(next);
                                debouncedSave({ questions: next });
                              }
                            : undefined
                        }
                        onTogglePin={() => {
                          const next = [...editedQuestions];
                          next[globalIdx] = { ...q, pinned: !q.pinned, edited: true };
                          setEditedQuestions(next);
                          debouncedSave({ questions: next });
                        }}
                      />
                    );
                  })}
                </div>
              </Card>
            );
          })}
          <Button
            variant="ghost"
            disabled={regeneratingSection !== null}
            onClick={() => handleRegenerate("questions", "Regenerate all questions?")}
          >
            {regeneratingSection === "questions" ? "Regenerating all…" : "Regenerate all questions"}
          </Button>
        </div>
      )}

      {activeTab === "Flashcards" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between">
            <Button
              variant="ghost"
              disabled={regeneratingSection !== null}
              onClick={() => handleRegenerate("flashcards", "Regenerate flashcards?")}
            >
              {regeneratingSection === "flashcards" ? "Regenerating…" : "Regenerate flashcards"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const maxId = Math.max(0, ...editedFlashcards.map((f) => parseInt(f.id.slice(1) || "0")));
                const newF: Flashcard = {
                  id: `f${maxId + 1}`,
                  front: "",
                  back: "",
                  requirement_ids: [],
                  origin: "user",
                  edited: true,
                  pinned: false,
                };
                const next = [...editedFlashcards, newF];
                setEditedFlashcards(next);
                debouncedSave({ flashcards: next });
              }}
            >
              Add card
            </Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {editedFlashcards.map((f) => {
              const idx = editedFlashcards.findIndex((ef) => ef.id === f.id);
              return (
                <FlashcardCard
                  key={f.id}
                  card={f}
                  onChange={(updated) => {
                    const next = [...editedFlashcards];
                    next[idx] = { ...updated, edited: true };
                    setEditedFlashcards(next);
                    debouncedSave({ flashcards: next });
                  }}
                  onDelete={() => {
                    const next = editedFlashcards.filter((ef) => ef.id !== f.id);
                    setEditedFlashcards(next);
                    debouncedSave({ flashcards: next });
                  }}
                  onTogglePin={() => {
                    const next = [...editedFlashcards];
                    next[idx] = { ...f, pinned: !f.pinned, edited: true };
                    setEditedFlashcards(next);
                    debouncedSave({ flashcards: next });
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "Schedule" && (
        <Card className="flex flex-col gap-3">
          <div className="flex justify-between">
            <Button
              variant="ghost"
              disabled={regeneratingSection !== null}
              onClick={() => handleRegenerate("schedule", "Regenerate schedule?")}
            >
              {regeneratingSection === "schedule" ? "Regenerating…" : "Regenerate schedule"}
            </Button>
          </div>
          <ScheduleView schedule={kit.schedule} />
        </Card>
      )}

      {activeTab === "Research" && (
        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-sm text-slate-300 mb-1">Pages used</p>
            <ul className="text-sm text-slate-400 list-disc list-inside">
              {kit.source?.pages_used?.map((p: string, i: number) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm text-slate-300 mb-1">Research log</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="p-2">URL</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {kit.source?.research_log?.map((log: any, i: number) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="p-2 break-all">{log.url}</td>
                      <td className="p-2">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded border ${
                            log.status === "fetched"
                              ? "border-emerald-500/40 text-emerald-300"
                              : log.status === "skipped"
                              ? "border-slate-700 text-slate-300"
                              : "border-red-500/40 text-red-400"
                          }`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="p-2 text-slate-400">{log.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-xs text-slate-400">
            Generated with: {kit.source?.provider || ""} / {kit.source?.model || ""}
          </div>
        </Card>
      )}
    </div>
  );
}