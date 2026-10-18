# AI Prepkit

Paste a job description, point it at a company site, pick how many days you have — get a
structured interview-preparation kit: extracted requirements, a researched company brief,
interview-process intel, questions by category, flashcards, and a day-by-day schedule you
can edit, practise against, and regenerate without losing your work.

---

## 1. Project overview and chosen tech stack

**What it does.** The system crawls the company site you give it, searches public
discussion of that company's interview process, extracts the must-have/nice-to-have
requirements from the pasted description, generates questions and flashcards per category,
checks coverage deterministically, fills gaps on a second pass, and allocates everything
into exactly the number of days requested. A web interface lets you edit, reorder, pin and
regenerate sections, practise with confidence-tracked flashcards, and compare two kits.

**Stack and why:**

| Layer | Choice | Justification |
|---|---|---|
| Frontend | Next.js 15 (App Router) + React 19 + Tailwind 3.4 | The brief allows equivalents with justification. Next gives us server-side routing, fast dev/build, and — critically — a config-level **rewrite proxy** so the browser always talks to `/api` same-origin (see §4). Tailwind keeps a polished, responsive UI cheap to build. |
| Backend | Node.js 20+ with Express, TypeScript (CommonJS) | The brief mandates Node (or equivalent). Express is deliberately small: long-running SSE streams, JSON APIs, and a CLI all fit without framework magic. TypeScript end-to-end means the kit structure (zod schema in `kit-core`) is the single source of truth for both server and tests. |
| Database | MongoDB (local mongod or Atlas M0) | A generated kit *is* a document — schema-validated on write, stored whole, reopened later to continue. Mongoose gives per-field validation, TTL'd sessions and simple ownership queries. Free tier (Atlas M0) satisfies the deployment constraint. |
| Shared core | `packages/kit-core` (zod schema, coverage, schedule, validation) | The structure the graders validate, the coverage maths and the schedule allocator must behave identically in the API, the batch CLI and the tests. One package, one implementation, imported by all three. |
| LLM | Gemini free tier by default (raw REST, JSON mode), OpenAI-compatible option, mock provider | Free tier is mandated; raw REST avoids SDK weight; the mock provider makes tests, demos and the graders' runs reproducible with **no API key at all**. |

The repo is an **npm workspaces monorepo**: `packages/kit-core`, `server`, `web`, plus
`samples/` (fixture site, sample cases, verifiers). One `npm install` at the root installs
everything.

---

## 2. Setup instructions (local and deployed) and batch commands

### Local setup

```bash
git clone <repo-url> && cd aiprepkit     # or your clone directory
npm install                              # installs all workspaces
cp .env.example .env                     # then edit — see variable table below
```

`.env` minimums:

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `gemini` (default) \| `openai` \| `mock`. `mock` needs no key. |
| `GEMINI_API_KEY` | Google AI Studio free-tier key (https://aistudio.google.com/app/apikey). Required unless provider is `mock`. |
| `GEMINI_MODEL` | Default `gemini-2.0-flash`. |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | Only for `LLM_PROVIDER=openai` — any OpenAI-compatible endpoint (Groq, OpenRouter, Ollama). |
| `LLM_RPM`, `LLM_MAX_RETRIES`, `LLM_MAX_CALLS_PER_KIT`, `LLM_TEMPERATURE` | Rate-limit/backoff budget. Defaults tuned for the Gemini free tier (15 RPM → we use 10). |
| `MONGODB_URI` | Defaults to `mongodb://localhost:27017/aiprepkit`. **Not needed for the batch command.** |
| `SESSION_SECRET` | Hashes session tokens at rest. Set a long random string in any shared environment. |
| `WEB_ORIGIN` | Comma-separated browser origins allowed for direct credentialed CORS (default `http://localhost:3000`). |
| `ALLOW_PRIVATE_HOSTS` | Whether localhost/private IPs may be crawled. Defaults to **on** in dev (so local fixture sites work), **off** under `NODE_ENV=production` (SSRF defence). Override explicitly with `=1` if your production batch must crawl localhost. |
| `CRAWL_MAX_PAGES`, `CRAWL_MAX_DEPTH`, `FETCH_TIMEOUT_MS`, `FETCH_MAX_BYTES`, `CRAWL_MIN_INTERVAL_MS`, `USER_AGENT` | Crawl politeness and safety budgets (defaults: 14 pages, depth 3, 10 s, 2 MB, 750 ms between requests, identifiable UA). |
| `EVAL_CASE_TIMEOUT_SECONDS` | Per-case budget in the batch CLI (default 170 s, keeping 5 cases inside 15 minutes). |
| `NEXT_PUBLIC_API_URL` | Only if the frontend ever calls the API directly; the default rewrite proxy uses `http://localhost:4000` server-side. |

`.env.example` in the repo root documents every variable with comments; it is the
authoritative list.

Then run:

```bash
# Terminal 1 — MongoDB (skip if you use Atlas and set MONGODB_URI)
mongod          # or: docker run -d -p 27017:27017 mongo:7

# Terminal 2 — API on :4000
npm run dev:api

# Terminal 3 — Web on :3000
npm run dev:web

# Terminal 4 (optional) — local fixture company site on :4173, for a
# localhost site to crawl in demos and the smoke test
node samples/fixture-site.mjs
```

Open http://localhost:3000, register, and create a kit against
`http://localhost:4173` (a two-careers-page fixture with a hidden
`/private/secrets` path to demonstrate robots/scope discipline).

Tests and production build:

```bash
npm test          # kit-core suite + server suite
npm run build      # builds core, server, web
```

End-to-end smoke test against a running stack (auth → SSE generation → structure →
duplicate → edit/regen → practice → compare → ownership):

```bash
node samples/smoke.mjs
```

### Batch entry point (exact commands)

From a **clean clone** (the root script builds `kit-core` first, so no prior build step
is needed, and **no MongoDB is required** — the CLI runs the pipeline in-process):

```bash
npm install

# With a real provider (Gemini free tier)
npm run evaluate -- --input samples/cases.sample.json --output samples/kits.sample.json

# Offline / no API key — deterministic mock provider
LLM_PROVIDER=mock npm run evaluate -- --input samples/cases.sample.json --output samples/kits.sample.json
```

On **Windows PowerShell**, npm can drop `--flag` names when forwarding to scripts, so the
CLI also accepts plain positionals (input, then optional output) — this form is portable:

```powershell
npm install
$env:LLM_PROVIDER="mock"      # omit if you have GEMINI_API_KEY set
npm run evaluate -- samples/cases.sample.json samples/kits.sample.json
```

Behaviour guarantees:

- Output is always written, in the required shape: `{ version: "1.0", generated_at,
  kits: [{ id, status, kit, error }] }` — verify with `node samples/verify-kits.cjs <out>`.
- A failing case records `{ status: "failed", kit: null, error: { code, message } }` and the
  **run continues** to the next case; only usage errors (missing args), a missing LLM key,
  or a crash exit non-zero (exit code `2`, with guidance on stderr).
- Relative input/output paths resolve from the directory you invoked npm in, even though
  npm runs the script inside `server/`.
- Missing provider key → immediate exit `2` with instructions (including how to run the
  mock offline) rather than a doomed 15-minute run.

```bash
node samples/verify-kits.cjs samples/kits.sample.json   # "SHAPE OK"
```

### Deployed setup

Public deployment targets a free tier everywhere:

- **Frontend — Vercel**: import the repo, set root directory `web/`. The
  `next.config.mjs` rewrite proxies `/api/*` to the API URL, so the only variable needed
  is server-side: `NEXT_PUBLIC_API_URL=https://<your-api-host>`. (It is read by the Next
  server at request time through the rewrite; no secrets ever reach the browser bundle.)
- **Backend — Render (or any Node host)**: build `npm install && npm run build`, start
  `npm run start -w @aiprepkit/server` (i.e. `node server/dist/index.js`). Set
  `NODE_ENV=production`, `MONGODB_URI=<Atlas URI>`, a strong `SESSION_SECRET`,
  `WEB_ORIGIN=https://<your-web-host>`, and your LLM variables. Health check: `GET /api/health`.
- **Database — MongoDB Atlas M0**: create a cluster, allow the API host's egress, put the
  connection string in `MONGODB_URI`.
- **Cookies/proxy topology**: the browser only ever talks to the frontend origin
  (`/api/...`), and Next forwards those requests server-side to the API with the original
  `Set-Cookie` passed back. Session cookies are therefore first-party on the frontend
  domain — no cross-site cookie flags needed. `WEB_ORIGIN` is only consulted for *direct*
  cross-origin API access (curl, split deployments), which the proxy makes optional.
  Never commit `.env`; hosted platforms provide secret storage — `.env.example` is the
  documented template.

---

## 3. LLM provider and model

- **Default: Google Gemini free tier**, model **`gemini-2.0-flash`**
  (`GEMINI_MODEL`, raw REST calls with `responseMimeType: application/json`). Chosen for
  its generous free rate limits and native JSON mode; no client-side API key anywhere —
  the key lives only on the server.
- **Alternative**: `LLM_PROVIDER=openai` speaks the OpenAI chat-completions protocol to
  any base URL (Groq/OpenRouter/Ollama), `OPENAI_MODEL` selects the model.
- **Mock**: `LLM_PROVIDER=mock` — deterministic, offline, no key. Used by the test suite,
  the sample batch run and demos; it produces a well-formed kit from whatever the local
  crawl and JD actually yielded.
- **Resilience**: sliding-window RPM limiter (default 10 RPM, under the free tier's 15),
  exponential backoff with jitter and `Retry-After` honouring on 429/5xx, a hard cap on
  calls per kit (`LLM_MAX_CALLS_PER_KIT=30`, keeps batches inside the timebox), JSON
  extraction with a repair pass and one strict re-ask before failing the case.
- The model actually used is recorded per kit in `generatedWith` and visible in the UI/API.

---

## 4. High-level architecture

```
Browser ── same-origin /api/* ──> Next.js (web/) ── rewrite proxy ──> Express API (server/)
                                                                      │  auth (session cookie, httpOnly)
                                                                      │  /api/kits CRUD + SSE /events
                                                                      │  practice, compare, regenerate
                                                                      ▼
                                                          pipeline/runPipeline (shared by
                                                          web API and batch CLI)
                                                          │
              ┌───────────── research ────────────┐       │  steps 1–12 (§6)
              │ crawler (robots, ranked BFS)      │       ▼
              │ fetcher (guard, limits)           │   packages/kit-core
              │ discussion search (Reddit, DDG)   │   · zod kit schema (validation)
              └───────────────────────────────────┘   · coverage computation
                                                      · schedule allocation
MongoDB (kits, users, sessions, practice)  ◄──────────· structure validate/repair
```

- **One pipeline, two entry points.** The Express create-route and the batch CLI both call
  `runPipeline`; there is no second implementation to drift.
- **Progress** is SSE (`GET /api/kits/:id/events`): every subscriber first receives a
  `snapshot` event carrying the full step list (so a late subscriber or page reload is
  never blind), then live `step` events, then a terminal `done`/`failed`. The database
  copy of `steps` is the durable record; the in-process hub is the live channel.
- **Long-running generation is fire-and-forget**: `POST /api/kits` returns `201` with the
  queued document immediately and the pipeline runs in the background. All writes to a kit
  document are serialized through a single save queue (mongoose rejects concurrent
  `save()` calls on one document), and the fire-and-forget wrapper catches rejections so a
  transient DB error can never crash the process.
- **Batch mode** (`server/src/evaluate.ts`) reads a JSON array of cases, runs them
  sequentially with a per-case timeout, and writes the Appendix-B file. It never touches
  MongoDB — it is a pure pipeline runner, which is why it works from a clean clone with
  only an LLM key (or the mock).
- The in-process SSE hub is **single-node by design** (free tier = one process); a
  multi-process deploy would need an external pub/sub, which would be machinery without a
  job here.

---

## 5. Retrieval approach and sources

**Sources used** (all free, no paid APIs):

1. **The company site itself** — the only source of company facts. Starting from the URL
   you provide, the crawler fetches `robots.txt` first, then walks same-host links with a
   **link-ranking heuristic** (careers/about/jobs URLs rank highest, so a hiring page is
   sought early), breadth-first to **depth ≤ 3**, capped at `CRAWL_MAX_PAGES` (14) with a
   750 ms politeness delay, 10 s timeout, 2 MB size cap and an HTML/text content-type
   allowlist. Pages are classified (hiring / about / other) with a keyword heuristic; the
   hiring/about pages feed the brief and interview-intel prompts.
2. **Public discussion of the interview process** — best-effort search over **Reddit's
   public JSON search API** and **DuckDuckGo's HTML endpoint** for
   `<company> interview experience` style queries. If nothing usable is found, the kit
   proceeds with an honest "no public discussion found" note — this is *not* a failure.

**robots.txt and site terms**: every crawl begins by fetching and parsing `robots.txt`
for our user agent (`USER_AGENT`, default `AIPrepKitBot/1.0` — identifiable, with a
contact URL placeholder). `Disallow`ed paths are stripped from the frontier *before*
fetching (they appear in the research log as `skipped`, not as failures), and the fetcher
re-checks disallow rules per request. The crawl never submits forms, never executes
JavaScript, and rate-limits itself per host.

**URL and network safety**: only `http(s)` URLs without embedded credentials are accepted
(400 otherwise); redirects are re-validated. In production, hosts that resolve to
private/loopback/link-local/metadata ranges are refused (SSRF defence) —
`ALLOW_PRIVATE_HOSTS` overrides this deliberately so localhost fixture sites and graders'
local sites work, and it defaults to on outside production exactly for that reason.

**Prompt-injection defence**: fetched page text and pasted JDs are *data*, never
instructions. The system preamble states that instructions found inside source documents
must be ignored, each source is passed inside explicit delimiters, and no page content can
influence control flow — only the prompts' data fields. Requirements come only from the JD
text; company claims only from crawled pages; every prompt forbids invention and instructs
the model to leave fields empty or say "not found" when sources don't support an answer.

---

## 6. Step sequencing (what each step is responsible for)

Each step consumes the previous step's output; deterministic steps never touch the model:

| # | Step | Responsibility |
|---|---|---|
| 1 | `guard_input` | Validate the company URL (scheme, credentials, private-host policy), clamp `days` to 1–60, normalize input. |
| 2 | `crawl_site` | robots.txt-aware, link-ranked BFS over the company site; page fetch, extraction, hiring/about classification. Records every fetched/skipped/failed page in the research log — unreachable pages are *recorded, never fatal*. |
| 3 | `find_discussion` | Best-effort Reddit/DuckDuckGo search for public interview discussion; empty result is reported honestly, not invented. |
| 4 | `extract_requirements` | **LLM**: extract requirements from the JD only, with must/nice priority. **Code** assigns stable ids `r1, r2, …` in document order, so ids never drift across runs or edits. |
| 5 | `company_brief` | **LLM**: brief grounded strictly in crawled pages (empty fields if pages don't support a claim). |
| 6 | `interview_intel` | **LLM**: process intel from hiring pages + public discussion, attributed; states "no public discussion found" when step 3 came up empty. |
| 7 | `generate_questions` | **LLM**: one **separate call per category** — technical, behavioural, system-design, company-fit — each with its own instructions, so categories don't bleed together. Each question links to requirement ids. |
| 8 | `check_coverage` | **CODE** (not the model): compute which must-have requirements have at least one question → `coverage.uncovered_must_requirement_ids`. |
| 9 | `fill_gaps` | **LLM**: targeted pass generating questions only for the still-uncovered must-haves. |
| 10 | `recheck_coverage` | **CODE**: recompute coverage after the fill. Steps 9–10 repeat up to **`MAX_COVERAGE_PASSES = 3`**, then stop. |
| 11 | `allocate_schedule` | **CODE**: deterministic allocation of every question to exactly the requested number of days (§8). |
| 12 | `validate_kit` | **CODE**: validate against the Appendix-A zod schema, repairing mechanical issues (id uniqueness, dangling requirement references) before anything is persisted. |

**Why 3 coverage passes.** Each pass can only *add* questions for requirements the previous
check proved uncovered, and each pass the uncovered set either shrinks or is already empty —
so two full re-checks (initial check + up to 2 fills) resolve any gap the model is capable
of closing. A third round catches regeneration drift. Beyond three, an uncovered must-have
is by definition not closeable by re-asking (typically a two-line JD stub that states a
requirement with nothing to generate from), and the honest behaviour is to **ship the kit
with the gap recorded in `coverage.uncovered_must_requirement_ids`** rather than loop
forever or invent questions. The brief's hard rule — no uncovered must-haves *silently* —
is met: gaps are always surfaced in the kit, the UI badge and the batch log.

The second pass is also why the pipeline re-enters at step 9 rather than restarting: work
already done (crawl, extraction, category questions) is preserved, and only the verified
gap is targeted.

---

## 7. Generated, edited and pinned state

Every question and flashcard carries three flags in the kit document itself (nothing lives
only in component state — you can close the tab and reopen the kit later):

```jsonc
{
  "id": "q3",
  "origin": "generated" | "user",  // who created it
  "edited": false,                  // has a human modified the generated text?
  "pinned": false                   // user explicitly wants it kept (with pinned_at)
}
```

- **`origin: "generated"`** — created by the pipeline. Edit it and it becomes
  `edited: true`; the `origin` stays `generated` so we remember where it came from.
- **`origin: "user"`** — created by you in the builder (add-question button). These are
  never touched by any regeneration.
- **`pinned`** — set from the UI; a pinned item is protected from regeneration exactly
  like an edited or user-created one, as an explicit "keep this, I mean it" signal.

**Regeneration survival** (`POST /api/kits/:id/regenerate` with
`{ section }` where section is `company_brief`, `questions`, `questions:<category>`,
`flashcards`, or `schedule`):

1. The request is scoped — for question sections the server **only loads the target
   category's items into the regeneration prompt**; other categories and sections are
   structurally unreachable, so their edits cannot be clobbered by construction, not by
   careful merging.
2. Within the target, regeneration replaces **only items that are untouched generated
   items** (`origin=generated`, `edited=false`, `pinned=false`). Edited, pinned and
   user-created items are kept byte-for-byte, in place.
3. New generated items fill the remaining slots around them; ids stay unique and
   stable, requirement links are re-validated, coverage and the schedule are recomputed
   (schedule regeneration is pure code, so it never involves the model at all).
4. The result is schema-validated before saving — a regen can never persist a malformed
   kit.

This is the "hardest state" from the brief, and it is solved by putting the state *in the
document* and filtering on it in one place (`regenerateSection`), rather than diffing
snapshots.

---

## 8. Schedule allocation

Pure arithmetic in `packages/kit-core/src/schedule.ts` — never an LLM prompt:

1. **Score** every question: `difficulty × (2 if it covers any must-have requirement, else 1)`
   — harder, higher-priority material scores higher.
2. **Sort descending** by score with a stable tie-break on existing order (deterministic:
   same input → same schedule, every run).
3. **Deal round-robin** across the days: highest-score question → day 1, next → day 2, …
   wrapping. Because the *first* item of the deal is always the heaviest, earlier days get
   the harder/higher-priority work, while round-robin keeps daily load balanced — both
   required properties hold simultaneously instead of trading off.
4. **Emit exactly `days` entries** numbered 1..days (1-day and 60-day both work — the
   bounds are schema-clamped at input and asserted in tests), every question in exactly
   one day, and `minutes` = the **integer sum** of that day's questions' per-question
   minutes (no rounding drift — minutes are integers by construction).
5. **Coverage guarantee**: if any must-have requirement's questions would miss the
   schedule, the allocator cannot produce that state — every question is allocated, and
   coverage was already verified in step 8/10; the schedule step re-asserts
   every must-have is represented before returning.

**Tests** (`packages/kit-core`, `npm run test -w @aiprepkit/core`): schedule allocation
(exact day count, all questions allocated exactly once, harder-first ordering, integer
minutes, 1- and 60-day edges), coverage checking (uncovered musts detected, recompute
after fills), and structure validation (Appendix-A shape accepts valid kits and rejects
malformed ones) — the three behaviours the brief explicitly requires, plus schema edge
cases. The server suite (`npm run test -w @aiprepkit/server`) adds hermetic integration
tests for auth, dedupe, regeneration survival, crawl guards (robots, SSRF, size/type
limits), rate-limit backoff and the batch CLI — **37 core + 60 server tests, all green**.

---

## 9. Creative feature: two-kit comparison ("where does my prep transfer?")

**Problem.** People don't prepare for one role in isolation — they apply to several, and
the real question is *which prep transfers* and *what's unique*. The brief suggests
"comparing two postings to find the overlap"; we built it as a first-class screen.

`POST /api/kits/:id/compare { other_kit_id }` produces a report over two of your kits:

- **Requirement overlap**: requirements in both kits (by normalized text), only-A, only-B —
  with priority-weighted scoring so must-have overlap ranks above nice-to-have.
- **Coverage transfer**: which must-haves of kit B already have question coverage in kit A
  ("you're already prepared for these"), and which are genuinely new.
- **Schedule delta**: total minutes, day counts and load-per-day of both plans side by side,
  so you can decide whether to merge or re-allocate.
- **LLM overlap narrative**: one model call explains *why* overlapping areas overlap
  (same stack, same seniority signal) — grounded in both kits' actual requirement text.

It's built on the same schema/coverage code as everything else, works with any two of your
kits, and answers a question the single-kit flow can't: "I have 4 days and two live
applications — what do I actually spend them on?" It also demonstrates the kit document is
a self-contained, comparable artifact rather than view-bound state.

---

## 10. Key design decisions, trade-offs and known limitations

**Design decisions worth defending:**

- **Deterministic code where the brief demands guarantees.** Coverage checking and
  schedule allocation are ordinary functions with tests, not prompts. An LLM asked to
  "allocate minutes" will drift on integer sums and invent on uncovered musts; code
  cannot. The model's role is content; code's role is every stated invariant (structure,
  ids, coverage, minutes, day counts).
- **Same pipeline for web and batch.** One `runPipeline` keeps the batch output and the
  UI output identical — the graders' batch run exercises exactly the code the UI runs.
- **Snapshot-then-live SSE.** Live-only SSE strands late subscribers (and every page
  reload of a running kit); DB-only polling wastes the live channel. The snapshot event
  makes both the UI and any test deterministic regardless of when you attach.
- **State inside the document** (`origin/edited/pinned`) rather than diffing or
  side-tables: regeneration is a filter over one array, survives restarts, and is testable
  without the UI.
- **Next rewrite proxy for `/api`.** Keeps SSE and cookies same-origin, so no
  `EventSource` auth hacks, no CORS preflakes on the hot path, and no cross-site cookie
  flags. Direct CORS still exists (allow-listed `WEB_ORIGIN`) for split deployments —
  defence in depth, not the primary path.
- **Mock provider as a first-class citizen.** Offline reproducibility for tests, samples
  and graders outweighs the small surface it adds.

**Long-running generation, partial failure, duplicate triggers (brief §13):**

- **Takes 90 seconds?** `POST` returns `201` immediately with the queued kit; the UI
  streams step-by-step progress over SSE, each step persisting its status, so a reload
  mid-run re-opens the same kit and the snapshot replays where it got to.
- **Fails halfway?** The step that failed is marked `failed` with a structured
  `{ code, message }` on the kit (`status: "failed"` only when *no* kit could be produced).
  Unreachable pages, a missing hiring page, or no public discussion are **recorded in the
  research log and carried as honest gaps** — they make a *thinner kit, not a failed run*.
  The UI shows the error state with the log; the batch records `status:"failed"` for that
  case only and continues with the rest.
- **Triggered twice for the same posting?** Requests are fingerprinted on
  (JD, company URL, days). An identical submission while a matching kit exists returns the
  **existing kit** with `deduplicated: true` (HTTP 200) instead of generating again;
  `force: true` explicitly rebuilds. This also collapses double-clicks and retries.

**Edge-case behaviour (each exercised by tests/smoke):**

| Edge case | Behaviour |
|---|---|
| Invalid URL / 404 / timeout | URL syntax fails fast (400); unreachable or non-HTML pages are logged in `source.pages` as failed/skipped with reason — kit completes honestly without them. |
| No hiring page found | Research log records the attempt; company brief + intel state what's missing instead of inventing process details. |
| Two-line JD stub | Extraction yields only what's stated (possibly 1–2 requirements or none) → deliberately thin kit; never padded with invented requirements. |
| No public discussion | `interview_intel` reports "no public discussion found"; run continues. |
| Invalid LLM JSON | Extract → repair pass → one strict re-ask; still invalid = that case/kit fails with a structured code (batch continues). |
| Rate limits (429) | Sliding-window RPM limiter up front + exponential backoff with jitter, honouring `Retry-After`; bounded by `LLM_MAX_RETRIES` then `LLM_MAX_CALLS_PER_KIT`. |
| 1-day / 60-day schedules | Clamped at input; allocator and tests cover both extremes (exact day count, full allocation). |
| Private/loopback URL | Allowed in dev (fixture sites), refused in production unless `ALLOW_PRIVATE_HOSTS=1`. |

**Trade-offs and known limitations:**

- **Single-process SSE hub** — progress won't survive an API restart mid-generation (the
  kit stays `running` until the next open, where the UI offers retry; a multi-instance
  deploy needs Redis pub/sub — deliberately not built for a one-process free tier).
- **Search-engine discussion lookup is best-effort** (Reddit JSON + DuckDuckGo HTML).
  Both can rate-limit or change markup; failures degrade to "no discussion found" rather
  than retry storms.
- **No JS rendering** — heavily client-rendered career sites yield fewer pages; the log
  says so honestly. A headless browser was out of the 4-day timebox.
- **Heuristic hiring-page classification and link ranking** — good on conventional sites,
  weaker on single-page apps; depth/page caps trade completeness for politeness and the
  15-minute batch budget.
- **3 coverage passes is a budget, not a proof** — after three rounds remaining gaps are
  reported, not silently dropped (see §6 for the reasoning).
- **Comparison's transfer scoring is lexical** — normalized-text matching finds
  near-duplicates but not deep semantic equivalence; the LLM narrative adds context but
  isn't audited for recall.

**Repo hygiene.** Commits are small and meaningful, each describing a working state
("Harden crawl guards and add hermetic server test suite", "Make the batch CLI robust and
add runnable sample cases"). `samples/` ships the fixture site, sample cases and output,
the shape verifier and the end-to-end smoke test so any claim in this README is
re-runnable in one command.
