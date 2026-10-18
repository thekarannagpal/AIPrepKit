// Validates samples/kits.sample.json against the Appendix B contract.
const fs = require("fs");
const { validateKit } = require("@aiprepkit/core");

const out = JSON.parse(fs.readFileSync(process.argv[2] || "samples/kits.sample.json", "utf-8"));
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };

if (out.version !== "1.0") fail(`version=${out.version}`);
if (typeof out.generated_at !== "string" || Number.isNaN(Date.parse(out.generated_at))) fail("generated_at");
if (!Array.isArray(out.kits)) fail("kits not an array");
for (const entry of out.kits) {
  if (typeof entry.id !== "string") fail("entry.id");
  if (!["ok", "failed"].includes(entry.status)) fail(`${entry.id} status=${entry.status}`);
  if (entry.status === "ok") {
    if (!entry.kit) fail(`${entry.id} ok without kit`);
    const v = validateKit(entry.kit);
    if (!v.ok) fail(`${entry.id} invalid kit: ${v.errors.slice(0, 3).join("; ")}`);
    if (entry.error !== null) fail(`${entry.id} ok but error set`);
    const days = entry.kit.schedule.days.length;
    if (days !== entry.kit.schedule.days_available) fail(`${entry.id} days mismatch`);
    const must = entry.kit.role.requirements.filter((r) => r.priority === "must");
    const uncovered = new Set(entry.kit.coverage.uncovered_must_requirement_ids);
    const left = must.filter((r) => uncovered.has(r.id));
    console.log(
      `  ok ${entry.id}: reqs=${entry.kit.role.requirements.length} must=${must.length} uncovered_must=${left.length} ` +
        `q=${entry.kit.questions.length} cards=${entry.kit.flashcards.length} days=${days} warnings=${entry.kit.notes.length}`
    );
  } else {
    if (!entry.error || !entry.error.code || !entry.error.message) fail(`${entry.id} failed without error`);
    if (entry.kit !== null) fail(`${entry.id} failed with kit`);
    console.log(`  failed ${entry.id}: ${entry.error.code}`);
  }
}
console.log(process.exitCode ? "SHAPE INVALID" : "SHAPE OK (Appendix B)");
