"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Skeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { apiGet, apiPost } from "@/lib/api";

export default function ComparePage() {
  const [kits, setKits] = useState<any[]>([]);
  const [loadingKits, setLoadingKits] = useState(true);
  const [kitA, setKitA] = useState("");
  const [kitB, setKitB] = useState("");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchKits = async () => {
      setLoadingKits(true);
      try {
        const res = await apiGet<{ kits: any[] }>("/api/kits");
        setKits(res.kits.filter((k) => k.status === "complete"));
      } catch (err: any) {
        setError(err?.error?.message || "Failed to load kits");
      } finally {
        setLoadingKits(false);
      }
    };
    fetchKits();
  }, []);

  const handleCompare = async () => {
    if (!kitA || !kitB) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiPost(`/api/kits/${kitA}/compare`, {
        other_kit_id: kitB,
      });
      setReport(res.report);
    } catch (err: any) {
      setError(err?.error?.message || "Compare failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Compare Kits</h1>
      <Card className="flex flex-col sm:flex-row gap-3">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm text-slate-300">Kit A</label>
          <select
            value={kitA}
            onChange={(e) => setKitA(e.target.value)}
            className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-100"
          >
            <option value="">Select...</option>
            {kits
              .filter((k) => k._id !== kitB)
              .map((k) => (
                <option key={k._id} value={k._id}>
                  {k.role_title || k.role?.title} @ {k.company || k.source?.company}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm text-slate-300">Kit B</label>
          <select
            value={kitB}
            onChange={(e) => setKitB(e.target.value)}
            className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-100"
          >
            <option value="">Select...</option>
            {kits
              .filter((k) => k._id !== kitA)
              .map((k) => (
                <option key={k._id} value={k._id}>
                  {k.role_title || k.role?.title} @ {k.company || k.source?.company}
                </option>
              ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button onClick={handleCompare} loading={loading} disabled={!kitA || !kitB}>
            Compare
          </Button>
        </div>
      </Card>
      {error && <ErrorState message={error} />}
      {loading && <Skeleton className="h-64" />}
      {report && (
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-lg font-medium mb-2">Summary</h2>
            <p className="text-slate-300 mb-2">{report.summary?.headline}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-800 rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full"
                  style={{ width: `${report.summary?.overlap_pct || 0}%` }}
                />
              </div>
              <span className="text-sm text-slate-400">{report.summary?.overlap_pct || 0}% overlap</span>
            </div>
            <p className="text-sm text-slate-400 mt-2">
              Minutes saved: {report.summary?.minutes_saved || 0}
            </p>
          </Card>

          {report.shared?.length > 0 && (
            <Card>
              <h3 className="font-medium mb-2">Shared requirements</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="p-2">Text A</th>
                      <th className="p-2">Text B</th>
                      <th className="p-2">Match</th>
                      <th className="p-2">Rationale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.shared.map((s: any, i: number) => (
                      <tr key={i} className="border-t border-slate-800">
                        <td className="p-2">{s.text_a}</td>
                        <td className="p-2">{s.text_b}</td>
                        <td className="p-2">
                          <span className="text-xs px-1.5 py-0.5 rounded border border-slate-700">
                            {s.match_type}
                          </span>
                        </td>
                        <td className="p-2 text-slate-400">{s.rationale || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <Card>
              <h3 className="font-medium mb-2">Unique to A</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {report.unique_to_a?.map((u: any) => (
                  <li key={u.id} className="border-b border-slate-800 pb-2">
                    <span className="text-slate-400">{u.id}</span> - {u.text}
                    <span className="text-xs ml-1 px-1 py-0.5 rounded bg-slate-800">{u.priority}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h3 className="font-medium mb-2">Unique to B</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {report.unique_to_b?.map((u: any) => (
                  <li key={u.id} className="border-b border-slate-800 pb-2">
                    <span className="text-slate-400">{u.id}</span> - {u.text}
                    <span className="text-xs ml-1 px-1 py-0.5 rounded bg-slate-800">{u.priority}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}