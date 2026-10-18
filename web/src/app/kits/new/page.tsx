"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea } from "@/components/Field";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { apiPost } from "@/lib/api";
import { z } from "zod";
import { showToast } from "@/components/Toast";

const singleSchema = z.object({
  jd: z.string().min(1),
  company_url: z.string().url().optional().or(z.literal("")),
  days: z.number().int().min(1).max(60),
  force: z.boolean().optional(),
});

const batchSchema = z.object({
  cases: z
    .array(
      z.object({
        jd: z.string().min(1),
        company_url: z.string().url().optional().or(z.literal("")),
        days: z.number().int().min(1).max(60),
      })
    )
    .min(1),
});

export default function NewKitPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"single" | "batch">("single");
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(7);
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [batchText, setBatchText] = useState("");
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

  const handleSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const parsed = singleSchema.safeParse({
      jd,
      company_url: companyUrl || undefined,
      days: Number(days),
      force,
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message || "Invalid input");
      return;
    }
    setLoading(true);
    try {
      const res = await apiPost<{ kit: any; deduplicated?: boolean }>(
        "/api/kits",
        parsed.data
      );
      router.push(`/kits/${res.kit?._id || res.kit?.id || ""}`);
    } catch (err: any) {
      setError(err?.error?.message || "Failed to create kit");
    } finally {
      setLoading(false);
    }
  };

  const handleBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchErrors([]);
    let cases: any[] = [];
    try {
      if (batchFile) {
        const text = await batchFile.text();
        const data = JSON.parse(text);
        cases = data;
      } else {
        const data = JSON.parse(batchText || "[]");
        cases = data;
      }
      const parsed = batchSchema.safeParse({ cases });
      if (!parsed.success) {
        setBatchErrors(parsed.error.errors.map((e) => e.message));
        return;
      }
      setBatchLoading(true);
      const res = await apiPost<{ kits: any[] }>("/api/kits/batch", parsed.data);
      setBatchResults(res.kits);
      showToast("Batch created", "success");
    } catch (err: any) {
      setBatchErrors([err?.message || err?.error?.message || "Invalid batch"]);
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">New Kit</h1>
      <div className="flex gap-2 border-b border-slate-800">
        <button
          className={`px-4 py-2 -mb-px border-b-2 ${
            tab === "single"
              ? "border-indigo-500 text-slate-100"
              : "border-transparent text-slate-400"
          }`}
          onClick={() => setTab("single")}
          aria-selected={tab === "single"}
        >
          Single
        </button>
        <button
          className={`px-4 py-2 -mb-px border-b-2 ${
            tab === "batch"
              ? "border-indigo-500 text-slate-100"
              : "border-transparent text-slate-400"
          }`}
          onClick={() => setTab("batch")}
          aria-selected={tab === "batch"}
        >
          Batch upload
        </button>
      </div>

      {tab === "single" && (
        <Card>
          <form onSubmit={handleSingle} className="flex flex-col gap-4">
            <Textarea
              label="Job description"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              className="min-h-[160px]"
              required
            />
            <div className="text-xs text-slate-400">{jd.length} chars</div>
            <Input
              label="Company website (optional)"
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
              placeholder="https://example.com"
            />
            <Input
              label="Days available (1-60)"
              type="number"
              min={1}
              max={60}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              required
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                className="w-4 h-4"
              />
              Rebuild even if duplicate
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" loading={loading}>
              Create kit
            </Button>
          </form>
        </Card>
      )}

      {tab === "batch" && (
        <Card>
          <form onSubmit={handleBatch} className="flex flex-col gap-4">
            <div>
              <label className="text-sm text-slate-300 mb-1 block">
                Upload .json file
              </label>
              <input
                type="file"
                accept=".json"
                onChange={(e) => setBatchFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:bg-slate-800 file:text-slate-100 hover:file:bg-slate-700"
              />
            </div>
            <Textarea
              label="Or paste JSON"
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder='[{"jd": "...", "company_url": "https://...", "days": 7}]'
              className="min-h-[120px]"
            />
            {batchErrors.length > 0 && (
              <ul className="text-sm text-red-400 list-disc list-inside">
                {batchErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            <Button type="submit" loading={batchLoading}>
              Create batch
            </Button>
            {batchResults.length > 0 && (
              <div className="flex flex-col gap-2 mt-4">
                <h3 className="font-medium">Created kits</h3>
                {batchResults.map((r, i) => (
                  <a
                    key={i}
                    href={`/kits/${r.kit?._id || r.kit?.id}`}
                    className="text-sm text-indigo-400 hover:text-indigo-300"
                  >
                    {r.kit?.role?.title || "Kit"} -{" "}
                    {r.kit?.source?.company || "Company"}
                  </a>
                ))}
              </div>
            )}
          </form>
        </Card>
      )}
    </div>
  );
}