import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FileMigrationProvider, Migrator } from "kysely/migration";

import { loadConfig } from "../config.js";
import { createDatabase } from "./database.js";

export function createMigrator(databaseUrl: string): {
  db: ReturnType<typeof createDatabase>;
  migrator: Migrator;
} {
  const db = createDatabase(databaseUrl);
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: fileURLToPath(new URL("./migrations/", import.meta.url)),
      import: (filePath) => import(pathToFileURL(filePath).href),
    }),
  });
  return { db, migrator };
}

async function main() {
  const direction = process.argv[2];
  if (direction !== "up" && direction !== "down") {
    throw new Error("Use 'up' or 'down'");
  }
  const databaseUrl = loadConfig().databaseUrl;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations");

  const { db, migrator } = createMigrator(databaseUrl);
  try {
    const { error, results } =
      direction === "up"
        ? await migrator.migrateToLatest()
        : await migrator.migrateDown();
    for (const result of results ?? []) {
      console.info(`${result.migrationName}: ${result.status}`);
    }
    if (error) throw error;
  } finally {
    await db.destroy();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
