import express from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { log } from "../lib/logger";
import { env } from "../config";
import { authRouter } from "./authRoutes";
import { kitsRouter } from "./kits";
import { requireAuth, originGuard } from "./auth";
import { KitModel } from "../db/models";

export function buildApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "512kb" }));

  // CORS: the web app normally reaches the API same-origin through Next's
  // /api rewrite, but direct cross-origin access (curl from a different
  // origin, split deployments) must be answered correctly. Only origins from
  // WEB_ORIGIN are ever reflected, always with credentials.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && env.webOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(originGuard);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, provider: env.llm.provider, model: env.llm.provider === "gemini" ? env.llm.geminiModel : env.llm.provider === "openai" ? env.llm.openaiModel : "mock" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/kits", requireAuth, kitsRouter);

  // 404 for unknown API routes — JSON, never an HTML error page.
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint." } });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION",
          message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
          details: err.issues,
        },
      });
      return;
    }
    log.error("unhandled error", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong." } });
  });

  return app;
}

/** Used by tests: the app without a live Mongo connection. */
export { KitModel };
