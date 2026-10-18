#!/usr/bin/env node
/**
 * Batch entry point — brief §9, exact interface:
 *
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Reads an array of {id, jd, company_url, days}, runs the SAME pipeline the
 * web app uses (no parallel implementation), and writes one JSON file in the
 * Appendix B shape. A case that fails is recorded and the run continues.
 * Credentials come from .env (documented in .env.example); MongoDB is NOT
 * required — the pipeline is pure retrieval + generation.
 */
import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import { z } from "zod";
import { AppError } from "./lib/errors";
import { log } from "./lib/logger";
import { LlmClient } from "./llm/client";
import { runPipeline } from "./pipeline/runPipeline";
import { env } from "./config";

const CaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int().min(1).max(365),
});

interface OutputKitEntry {
  id: string;
  status: "ok" | "failed";
  kit: unknown;
  error: { code: string; message: string } | null;
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o", default: "kits.json" },
      "only-first": { type: "string" }, // dev helper, not part of the brief
    },
    allowPositionals: false,
  });

  if (!values.input) {
    process.stderr.write("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>\n");
    process.exit(2);
  }

  const inputPath = path.resolve(String(values.input));
  const outputPath = path.resolve(String(values.output));

  let parsedCases: unknown;
  try {
    parsedCases = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  } catch (err) {
    process.stderr.write(`Could not read ${inputPath}: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }

  if (!Array.isArray(parsedCases)) {
    process.stderr.write("Input file must contain a JSON array of cases.\n");
    process.exit(2);
  }

  log.info("evaluate start", { cases: parsedCases.length, provider: env.llm.provider, model: describeModel() });

  const kits: OutputKitEntry[] = [];
  const started = Date.now();

  for (const [index, raw] of parsedCases.entries()) {
    const caseStart = Date.now();
    const idHint = typeof raw === "object" && raw && "id" in raw ? String((raw as any).id) : `case-${index + 1}`;

    const parsed = CaseSchema.safeParse(raw);
    if (!parsed.success) {
      kits.push({
        id: idHint,
        status: "failed",
        kit: null,
        error: {
          code: "INPUT_INVALID",
          message: `Case does not match the expected shape: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        },
      });
      continue;
    }
    const testCase = parsed.data;

    try {
      const llm = new LlmClient({});
      const kit = await withTimeout(
        runPipeline(
          { jd: testCase.jd, companyUrl: testCase.company_url, days: testCase.days },
          {
            llm,
            onEvent: (e) => {
              if (e.type === "step" && e.status === "done") {
                log.info("case step", { id: testCase.id, step: e.key, detail: e.detail });
              }
            },
          }
        ),
        env.eval.caseTimeoutSeconds * 1000,
        testCase.id
      );
      kits.push({ id: testCase.id, status: "ok", kit: kit.kit, error: null });
      log.info("case ok", {
        id: testCase.id,
        seconds: ((Date.now() - caseStart) / 1000).toFixed(1),
        questions: kit.kit.questions.length,
        uncovered_must: kit.kit.coverage.uncovered_must_requirement_ids.length,
        llm_calls: llm.callCount,
      });
    } catch (err) {
      const appErr =
        err instanceof AppError
          ? err
          : new AppError("INTERNAL", err instanceof Error ? err.message : String(err), 500);
      kits.push({
        id: testCase.id,
        status: "failed",
        kit: null,
        error: { code: appErr.code, message: appErr.message },
      });
      log.error("case failed", { id: testCase.id, code: appErr.code, message: appErr.message });
    }
  }

  const output = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    kits,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  const okCount = kits.filter((k) => k.status === "ok").length;
  log.info("evaluate done", {
    ok: okCount,
    failed: kits.length - okCount,
    seconds_total: ((Date.now() - started) / 1000).toFixed(1),
    output: outputPath,
  });
  process.stdout.write(
    `Wrote ${kits.length} kit(s) to ${outputPath} (${okCount} ok, ${kits.length - okCount} failed) in ${(
      (Date.now() - started) /
      1000
    ).toFixed(1)}s\n`
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, id: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError(
          "INTERNAL",
          `Case ${id} exceeded the ${Math.round(ms / 1000)}s time budget (EVAL_CASE_TIMEOUT_SECONDS).`,
          500
        )
      );
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function describeModel(): string {
  switch (env.llm.provider) {
    case "gemini":
      return env.llm.geminiModel;
    case "openai":
      return env.llm.openaiModel;
    default:
      return "mock";
  }
}

main().catch((err) => {
  log.error("evaluate crashed", { err: err instanceof Error ? err.message : String(err) });
  process.exit(2);
});
