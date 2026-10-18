import { buildApp } from "./http/app";
import { connectDb } from "./db/models";
import { env } from "./config";
import { log } from "./lib/logger";

async function main() {
  try {
    await connectDb(env.mongodbUri);
    log.info("mongo connected", { uri: env.mongodbUri.replace(/\/\/.*@/, "//***@") });
  } catch (err) {
    log.error("mongo connection failed — the API cannot start", {
      err: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  const app = buildApp();
  app.listen(env.port, () => {
    log.info("api listening", {
      port: env.port,
      provider: env.llm.provider,
      allowed_origins: env.webOrigins,
    });
  });
}

main().catch((err) => {
  log.error("server crashed", { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
