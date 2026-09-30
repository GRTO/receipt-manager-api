import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { detectImageType, LocalImageStorage } from "./image-storage.js";

test("local image storage saves private files and removes them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "receipt-images-"));
  try {
    const storage = new LocalImageStorage(root);
    const owner = "86f6a4ab-bfc2-43f2-981a-6bb1c3d48091";
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    assert.equal(detectImageType(bytes), "image/png");
    const key = await storage.put(owner, bytes, "image/png");
    assert.match(key, new RegExp(`^${owner}/[0-9a-f-]{36}\\.png$`));
    assert.deepEqual(await storage.get(key), bytes);
    assert.deepEqual(await readFile(path.join(root, ...key.split("/"))), bytes);
    await storage.delete(key);
    await assert.rejects(storage.get(key), { code: "ENOENT" });
    await assert.rejects(storage.get("../outside.png"), /Invalid image key/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("image signatures reject arbitrary bytes", () => {
  assert.equal(detectImageType(Buffer.from("not an image")), null);
  assert.equal(
    detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])),
    "image/jpeg",
  );
  assert.equal(
    detectImageType(Buffer.from("RIFFxxxxWEBP", "ascii")),
    "image/webp",
  );
});
