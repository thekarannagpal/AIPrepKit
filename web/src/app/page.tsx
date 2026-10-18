"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

export default function Home() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    fetch("/api/health", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setHealth(data))
      .catch(() => {
        // tolerate failure silently
      });
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <section className="text-center py-12">
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          Turn a job description into an interview prep kit
        </h1>
        <p className="text-xl text-slate-400 mb-8">
          Research, question bank, flashcards, and a schedule tailored to your JD
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link href="/register">
            <Button variant="primary" className="px-6 py-3 text-lg">
              Get Started
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="ghost">Log in</Button>
          </Link>
        </div>
        {health && (
          <div className="mt-6 inline-flex items-center px-3 py-1 rounded-full border border-slate-800 text-xs text-slate-400">
            {health.provider} · {health.model}
          </div>
        )}
      </section>

      <section className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mt-8">
        <Card>
          <h3 className="font-medium mb-1">Research</h3>
          <p className="text-sm text-slate-400">
            Company research and requirement extraction
          </p>
        </Card>
        <Card>
          <h3 className="font-medium mb-1">Question bank</h3>
          <p className="text-sm text-slate-400">
            Tailored questions across categories
          </p>
        </Card>
        <Card>
          <h3 className="font-medium mb-1">Flashcards</h3>
          <p className="text-sm text-slate-400">
            Active recall for key concepts
          </p>
        </Card>
        <Card>
          <h3 className="font-medium mb-1">Schedule</h3>
          <p className="text-sm text-slate-400">
            Study plan matched to your availability
          </p>
        </Card>
      </section>
    </div>
  );
}