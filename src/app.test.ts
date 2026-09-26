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

test("invalid PORT fails before the server starts", () => {
  assert.throws(() => loadConfig({ PORT: "70000" }), /PORT must be an integer/);
});
