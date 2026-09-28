import { buildApp } from "./app.js";
import { createTokenVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/database.js";

const config = loadConfig();
if (!config.databaseUrl || !config.supabaseUrl) {
  throw new Error(
    "DATABASE_URL and SUPABASE_URL are required to start the API",
  );
}

const database = createDatabase(config.databaseUrl);
const app = buildApp({
  database,
  verifyToken: createTokenVerifier(config.supabaseUrl),
});
app.addHook("onClose", async () => database.destroy());

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
