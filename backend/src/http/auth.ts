import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { SessionModel, UserModel } from "../db/models";
import { unauthenticated, forbidden } from "../lib/errors";
import { randomToken, sha256 } from "../lib/hash";
import { env } from "../config";

const SESSION_DAYS = 14;

export interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function registerUser(email: string, password: string) {
  const existing = await UserModel.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw forbidden("An account with that email already exists.");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await UserModel.create({ email: email.toLowerCase(), passwordHash });
  return user;
}

export async function verifyUser(email: string, password: string) {
  const user = await UserModel.findOne({ email: email.toLowerCase() });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await SessionModel.create({ tokenHash: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await SessionModel.deleteOne({ tokenHash: sha256(token) });
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie("sid", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie("sid", { path: "/", httpOnly: true, sameSite: "lax", secure: env.isProduction });
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "sid") return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Express middleware: attaches userId or throws 401. */
export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const token = readSessionToken(req);
    if (!token) throw unauthenticated();
    const session = await SessionModel.findOne({ tokenHash: sha256(token) });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      if (session) await session.deleteOne();
      throw unauthenticated("Your session has expired. Please sign in again.");
    }
    req.userId = String(session.userId);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * CSRF defence-in-depth. The cookie is SameSite=Lax, which already blocks
 * cross-site form posts; we additionally require state-changing requests to
 * come from an allowed origin when the browser sends one.
 */
export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser client (curl, tests)
  if (env.webOrigins.includes(origin)) return next();
  res.status(403).json({
    error: { code: "FORBIDDEN", message: `Origin ${origin} is not allowed.` },
  });
}

/** Constant-time-ish token comparison helper (not used for bcrypt hashes). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
