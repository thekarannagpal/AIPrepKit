/**
 * The model sometimes wraps JSON in prose or code fences, or trails commas.
 * Rather than failing a kit over formatting, salvage what we can. This is
 * deliberately conservative: extract the outermost balanced object, strip
 * fences and trailing commas, then parse. If it still fails, we return null
 * and let the caller retry the request.
 */
export function repairJson(text: string): unknown | null {
  if (!text) return null;

  let t = text.trim();

  // ```json ... ``` fences
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  // First balanced {...} block (handles preamble prose around the JSON).
  const start = t.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let end = -1;
    let inString = false;
    let escaped = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > start) t = t.slice(start, end + 1);
  }

  // Trailing commas before } or ]
  t = t.replace(/,(\s*[}\]])/g, "$1");

  for (const candidate of [t, text.trim()]) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  return null;
}
