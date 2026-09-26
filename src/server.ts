import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const app = buildApp();

try {
  const { host, port } = loadConfig();
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
