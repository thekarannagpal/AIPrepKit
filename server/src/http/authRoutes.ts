import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  registerUser,
  verifyUser,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  readSessionToken,
  requireAuth,
  type AuthedRequest,
} from "./auth";
import { badRequest, unauthenticated } from "../lib/errors";
import { UserModel } from "../db/models";

export const authRouter = Router();

const CredentialsSchema = z.object({
  email: z.string().email("Enter a valid email address.").max(200),
  password: z.string().min(8, "Password needs at least 8 characters.").max(200),
});

// Naive per-IP throttle: enough to blunt credential stuffing in a demo app
// without pulling in infrastructure for a free-tier deployment.
const attempts = new Map<string, { count: number; resetAt: number }>();
function throttle(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 20;
}

authRouter.post("/register", async (req, res, next) => {
  try {
    if (throttle(`reg:${req.ip}`)) throw badRequest("Too many attempts. Try again in a minute.");
    const body = CredentialsSchema.parse(req.body);
    const user = await registerUser(body.email, body.password);
    const session = await createSession(String(user._id));
    setSessionCookie(res, session.token, session.expiresAt);
    res.status(201).json({ user: { id: String(user._id), email: user.email } });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    if (throttle(`login:${req.ip}`)) throw badRequest("Too many attempts. Try again in a minute.");
    const body = CredentialsSchema.parse(req.body);
    const user = await verifyUser(body.email, body.password);
    if (!user) throw unauthenticated("Wrong email or password.");
    const session = await createSession(String(user._id));
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ user: { id: String(user._id), email: user.email } });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = readSessionToken(req);
    if (token) await destroySession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await UserModel.findById(req.userId).select("email");
    if (!user) throw unauthenticated();
    res.json({ user: { id: String(user._id), email: user.email } });
  } catch (err) {
    next(err);
  }
});
