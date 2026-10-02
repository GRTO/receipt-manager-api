import { buildApp } from "./app.js";
import { createTokenVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/database.js";
import { LocalImageStorage } from "./image-storage.js";
import { LocalTextRecognizer } from "./ocr.js";
import { ScanService } from "./scans.js";

const config = loadConfig();
if (!config.databaseUrl || !config.supabaseUrl) {
  throw new Error(
    "DATABASE_URL and SUPABASE_URL are required to start the API",
  );
}

const database = createDatabase(config.databaseUrl);
const imageStorage = new LocalImageStorage(config.imageStorageDir);
const scanService = new ScanService(
  database,
  imageStorage,
  new LocalTextRecognizer(),
);
const app = buildApp({
  database,
  verifyToken: createTokenVerifier(config.supabaseUrl),
  imageStorage,
  scanService,
});
app.addHook("onClose", async () => scanService.stop());
app.addHook("onClose", async () => database.destroy());

try {
  await scanService.start();
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
