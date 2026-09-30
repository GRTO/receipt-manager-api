import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/database.js";

test("GET /health responds successfully", async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

test("missing routes use the shared error shape", async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: "GET", url: "/missing" });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } finally {
    await app.close();
  }
});

test("/v1/me rejects missing and invalid bearer tokens", async () => {
  const database = createDatabase("postgresql://localhost/unused");
  const app = buildApp({
    database,
    verifyToken: async () => {
      throw new Error("Invalid token");
    },
  });
  app.get("/v1/protected", async () => ({ exposed: true }));
  try {
    for (const url of ["/v1/me", "/v1/protected"]) {
      for (const authorization of [undefined, "Basic abc", "Bearer invalid"]) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: authorization ? { authorization } : {},
        });
        assert.equal(response.statusCode, 401);
        assert.equal(response.json().error.code, "UNAUTHORIZED");
      }
    }
  } finally {
    await app.close();
    await database.destroy();
  }
});

test("invalid PORT fails before the server starts", () => {
  assert.throws(() => loadConfig({ PORT: "70000" }), /PORT must be an integer/);
});

test("future integration settings are checked at startup", () => {
  assert.throws(
    () => loadConfig({ SUPABASE_URL: "http://example.com" }),
    /must use HTTPS/,
  );
  assert.throws(
    () => loadConfig({ DATABASE_URL: "not a url" }),
    /DATABASE_URL must be a valid URL/,
  );
  assert.throws(
    () => loadConfig({ DATABASE_URL: "https://example.com" }),
    /DATABASE_URL must be a valid URL/,
  );
  assert.equal(loadConfig({}).imageStorageDir, "./data/images");
  assert.equal(
    loadConfig({ IMAGE_STORAGE_DIR: "./private-images" }).imageStorageDir,
    "./private-images",
  );
  assert.equal(
    loadConfig({ DATABASE_URL: "postgresql://localhost:5432/receipts" })
      .databaseUrl,
    "postgresql://localhost:5432/receipts",
  );
});
