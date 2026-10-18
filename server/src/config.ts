import { config as loadDotenv } from "dotenv";
import path from "path";
import fs from "fs";

// Load .env from the repo root regardless of the cwd the process started in.
const rootEnv = path.resolve(__dirname, "../../.env");
if (fs.existsSync(rootEnv)) loadDotenv({ path: rootEnv });
else loadDotenv();

const bool = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined || v === "" ? fallback : ["1", "true", "yes"].includes(v.toLowerCase());

const int = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const env = {
  port: int(process.env.PORT, 4000),
  sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me",
  webOrigins: (process.env.WEB_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/aiprepkit",
  isProduction: process.env.NODE_ENV === "production",

  llm: {
    provider: (process.env.LLM_PROVIDER || "gemini") as "gemini" | "openai" | "mock",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.groq.com/openai/v1",
    openaiModel: process.env.OPENAI_MODEL || "llama-3.3-70b-versatile",
    rpm: int(process.env.LLM_RPM, 10),
    maxRetries: int(process.env.LLM_MAX_RETRIES, 6),
    maxCallsPerKit: int(process.env.LLM_MAX_CALLS_PER_KIT, 30),
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0.4),
  },

  crawl: {
    userAgent:
      process.env.USER_AGENT || "AIPrepKitBot/1.0 (+https://github.com/aiprepkit/aiprepkit)",
    minIntervalMs: int(process.env.CRAWL_MIN_INTERVAL_MS, 750),
    maxPages: int(process.env.CRAWL_MAX_PAGES, 14),
    maxDepth: int(process.env.CRAWL_MAX_DEPTH, 3),
    fetchTimeoutMs: int(process.env.FETCH_TIMEOUT_MS, 10_000),
    fetchMaxBytes: int(process.env.FETCH_MAX_BYTES, 2 * 1024 * 1024),
    // SECURITY: private/loopback targets are refused in production (SSRF).
    // Fixture sites in local runs and the batch command run on localhost, so
    // this stays on outside production. See .env.example.
    allowPrivateHosts: bool(process.env.ALLOW_PRIVATE_HOSTS, !process.env.NODE_ENV || process.env.NODE_ENV !== "production"),
  },

  eval: {
    caseTimeoutSeconds: int(process.env.EVAL_CASE_TIMEOUT_SECONDS, 170),
  },
};
