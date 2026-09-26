import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

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
  assert.throws(
    () => loadConfig({ STORAGE_BUCKET: "INVALID" }),
    /STORAGE_BUCKET/,
  );
  assert.equal(
    loadConfig({ DATABASE_URL: "postgresql://localhost:5432/receipts" })
      .databaseUrl,
    "postgresql://localhost:5432/receipts",
  );
});
