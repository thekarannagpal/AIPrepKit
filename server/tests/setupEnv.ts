/**
 * Runs before any test file's imports evaluate, so modules that read env at
 * import time (config.ts, the shared LLM limiter) see these values.
 * Hermetic test defaults: no network politeness delays, no rate limiting,
 * mock provider, private hosts allowed (fixture sites are on 127.0.0.1).
 */
process.env.LLM_PROVIDER = "mock";
process.env.ALLOW_PRIVATE_HOSTS = "true";
process.env.CRAWL_MIN_INTERVAL_MS = "5";
process.env.CRAWL_MAX_PAGES = "8";
process.env.CRAWL_MAX_DEPTH = "3";
process.env.FETCH_TIMEOUT_MS = "4000";
process.env.LLM_RPM = "10000";
process.env.LLM_MAX_CALLS_PER_KIT = "60";
process.env.LOG_LEVEL = "error";
process.env.EVAL_CASE_TIMEOUT_SECONDS = "90";
