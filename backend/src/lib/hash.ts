import crypto from "crypto";

/** Random opaque token for sessions (256 bits). */
export const randomToken = (): string => crypto.randomBytes(32).toString("hex");

/** Sessions are stored hashed — a database leak does not leak live sessions. */
export const sha256 = (s: string): string =>
  crypto.createHash("sha256").update(s).digest("hex");

/**
 * Input fingerprint used to detect a re-submission of the same description +
 * company (brief §10: "the same description and company are submitted twice").
 * Normalises whitespace so trivially re-pasted text hashes identically.
 */
export function inputFingerprint(jd: string, companyUrl: string, days: number): string {
  const normalisedJd = jd.replace(/\s+/g, " ").trim().toLowerCase();
  const normalisedUrl = companyUrl.trim().toLowerCase().replace(/\/+$/, "");
  return crypto
    .createHash("sha256")
    .update(`${normalisedJd}::${normalisedUrl}::${days}`)
    .digest("hex");
}
