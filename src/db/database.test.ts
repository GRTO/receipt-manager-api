import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { sql } from "kysely";

import { buildApp } from "../app.js";
import { createMigrator } from "./migrate.js";
import { MAX_IMAGE_BYTES, type ImageStorage } from "../image-storage.js";
import { ScanService } from "../scans.js";

const testUrl = process.env.TEST_DATABASE_URL;

test(
  "migrations, seed data, and database constraints",
  { skip: !testUrl },
  async () => {
    if (!testUrl) return;
    if (new URL(testUrl).pathname !== "/receipt_manager_test") {
      throw new Error("TEST_DATABASE_URL must point to receipt_manager_test");
    }

    const { db, migrator } = createMigrator(testUrl);
    try {
      const initial = await migrator.migrateToLatest();
      if (initial.error) throw initial.error;
      await db.deleteFrom("receipts").execute();
      await db.deleteFrom("users").execute();
      const categories = await db
        .selectFrom("categories")
        .select(["slug", "id"])
        .execute();
      assert.equal(categories.length, 11);
      assert.ok(categories.some((category) => category.slug === "groceries"));
      assert.equal(
        (await db.selectFrom("currencies").selectAll().execute()).length,
        1,
      );

      const subject = randomUUID();
      const secondSubject = randomUUID();
      const user = await db
        .insertInto("users")
        .values({
          auth_subject: subject,
          email: "test@example.com",
          preferred_currency: "EUR",
        })
        .returning(["id", "preferred_currency"])
        .executeTakeFirstOrThrow();
      assert.equal(user.preferred_currency, "EUR");
      const images = new Map<string, Buffer>();
      const imageStorage: ImageStorage = {
        async put(owner, bytes, type) {
          const key = `${owner}/${randomUUID()}.${type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp"}`;
          images.set(key, bytes);
          return key;
        },
        async get(key) {
          const bytes = images.get(key);
          if (!bytes) throw new Error("Missing image");
          return bytes;
        },
        async delete(key) {
          images.delete(key);
        },
      };
      let ocrShouldFail = false;
      const scanService = new ScanService(db, imageStorage, {
        async recognize() {
          if (ocrShouldFail) throw new Error("OCR unavailable");
          return "Mercado da Vila\nData 02/10/2026\nTOTAL A PAGAR 12,50 €";
        },
        async close() {},
      });
      const app = buildApp({
        database: db,
        imageStorage,
        scanService,
        verifyToken: async (token) => {
          if (token === "first")
            return { subject, email: "updated@example.com" };
          if (token === "second")
            return { subject: secondSubject, email: "second@example.com" };
          throw new Error("Invalid token");
        },
      });
      app.addHook("onClose", async () => scanService.stop());
      try {
        const first = await app.inject({
          method: "GET",
          url: "/v1/me",
          headers: { authorization: "Bearer first" },
        });
        assert.equal(first.statusCode, 200);
        assert.equal(first.json().id, user.id);
        assert.equal(first.json().email, "updated@example.com");
        assert.equal(first.json().preferredCurrency, "EUR");
        const second = await app.inject({
          method: "GET",
          url: "/v1/me",
          headers: { authorization: "Bearer second" },
        });
        assert.equal(second.statusCode, 200);
        assert.notEqual(second.json().id, user.id);

        const groceries = categories.find(
          (category) => category.slug === "groceries",
        )!.id;
        const fuel = categories.find(
          (category) => category.slug === "fuel",
        )!.id;
        const auth = { authorization: "Bearer first" };
        const otherAuth = { authorization: "Bearer second" };
        const categoryResponse = await app.inject({
          method: "GET",
          url: "/v1/categories",
          headers: auth,
        });
        assert.equal(categoryResponse.statusCode, 200);
        assert.equal(categoryResponse.json().items.length, 11);
        assert.ok(
          categoryResponse
            .json()
            .items.some((item: { id: string }) => item.id === groceries),
        );

        const base = {
          merchant: "Market",
          purchaseDate: "2026-09-27",
          total: "12.50",
          currency: "EUR",
          categoryId: groceries,
        };
        const create = async (body: Record<string, unknown>, headers = auth) =>
          app.inject({
            method: "POST",
            url: "/v1/receipts",
            headers,
            payload: body,
          });
        const created = await create({
          ...base,
          ownerUserId: second.json().id,
        });
        assert.equal(created.statusCode, 400);
        assert.equal(created.json().error.code, "VALIDATION_ERROR");
        const firstReceipt = await create(base);
        assert.equal(firstReceipt.statusCode, 201);
        assert.equal(firstReceipt.json().merchant, "Market");
        assert.equal(firstReceipt.json().total, "12.50");
        assert.equal(firstReceipt.json().categoryId, groceries);
        assert.equal(firstReceipt.json().imageUrl, null);
        const imageUrl = `/v1/receipts/${firstReceipt.json().id}/image`;
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
        const upload = (
          payload: Buffer,
          headers = auth,
          contentType = "image/png",
        ) =>
          app.inject({
            method: "PUT",
            url: imageUrl,
            headers: { ...headers, "content-type": contentType },
            payload,
          });
        assert.equal(
          (await upload(png, { authorization: "Bearer second" })).statusCode,
          404,
        );
        assert.equal(
          (await upload(Buffer.from("not an image"))).statusCode,
          400,
        );
        assert.equal((await upload(png, auth, "image/jpeg")).statusCode, 400);
        assert.equal(
          (await upload(Buffer.alloc(MAX_IMAGE_BYTES + 1))).statusCode,
          413,
        );
        assert.equal(images.size, 0);
        const uploaded = await upload(png);
        assert.equal(uploaded.statusCode, 200);
        assert.equal(uploaded.json().imageUrl, imageUrl);
        assert.equal(images.size, 1);
        const imageKey = (
          await db
            .selectFrom("receipts")
            .select("image_object_key")
            .where("id", "=", firstReceipt.json().id)
            .executeTakeFirstOrThrow()
        ).image_object_key;
        assert.ok(imageKey);
        assert.ok(imageKey.startsWith(`${user.id}/`));
        assert.equal(
          (
            await app.inject({
              method: "GET",
              url: imageUrl,
              headers: { authorization: "Bearer second" },
            })
          ).statusCode,
          404,
        );
        assert.equal(
          (await app.inject({ method: "GET", url: imageUrl })).statusCode,
          401,
        );
        const viewed = await app.inject({
          method: "GET",
          url: imageUrl,
          headers: auth,
        });
        assert.equal(viewed.statusCode, 200);
        assert.equal(viewed.headers["content-type"], "image/png");
        assert.deepEqual(viewed.rawPayload, png);
        const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
        assert.equal((await upload(jpeg, auth, "image/jpeg")).statusCode, 200);
        assert.equal(images.size, 1);
        assert.equal(images.has(imageKey), false);
        const replaced = await app.inject({
          method: "GET",
          url: imageUrl,
          headers: auth,
        });
        assert.equal(replaced.headers["content-type"], "image/jpeg");
        assert.deepEqual(replaced.rawPayload, jpeg);
        assert.equal(
          (
            await db
              .selectFrom("receipts")
              .select("owner_user_id")
              .where("id", "=", firstReceipt.json().id)
              .executeTakeFirstOrThrow()
          ).owner_user_id,
          user.id,
        );

        for (const body of [
          { ...base, merchant: "  " },
          { ...base, purchaseDate: "2026-02-30" },
          { ...base, total: "-1.00" },
          { ...base, total: "1.234" },
          { ...base, merchant: 123 },
          { ...base, total: 12.5 },
          { ...base, currency: "USD" },
          { ...base, categoryId: randomUUID() },
          { ...base, imageUploadId: randomUUID() },
        ]) {
          const result = await create(body);
          assert.equal(result.statusCode, 400, JSON.stringify(body));
          assert.equal(result.json().error.code, "VALIDATION_ERROR");
        }

        const secondReceipt = await create({
          ...base,
          merchant: "Fuel stop",
          purchaseDate: "2026-09-28",
          total: "20.00",
          categoryId: fuel,
          notes: "road trip",
        });
        const thirdReceipt = await create({
          ...base,
          merchant: "Market again",
          purchaseDate: "2026-08-20",
          total: "5.00",
        });
        assert.equal(secondReceipt.statusCode, 201);
        assert.equal(thirdReceipt.statusCode, 201);
        const otherReceipt = await create(base, otherAuth);
        assert.equal(otherReceipt.statusCode, 201);

        const list = async (query = "", headers = auth) =>
          app.inject({ method: "GET", url: `/v1/receipts${query}`, headers });
        const page1 = await list("?limit=1");
        assert.equal(page1.statusCode, 200);
        assert.equal(page1.json().items[0].id, secondReceipt.json().id);
        assert.equal(page1.json().items[0].purchaseDate, "2026-09-28");
        assert.ok(page1.json().nextCursor);
        const page2 = await list(`?limit=1&cursor=${page1.json().nextCursor}`);
        assert.equal(page2.json().items[0].id, firstReceipt.json().id);
        const page3 = await list(`?limit=1&cursor=${page2.json().nextCursor}`);
        assert.equal(page3.json().items[0].id, thirdReceipt.json().id);
        assert.equal(page3.json().nextCursor, null);
        assert.equal(
          (await list("?month=2026-09&categoryId=" + groceries)).json().items
            .length,
          1,
        );
        assert.equal(
          (await list("?search=road%20trip")).json().items[0].id,
          secondReceipt.json().id,
        );
        assert.equal(
          (await list("?sort=total_asc")).json().items[0].id,
          thirdReceipt.json().id,
        );
        assert.equal(
          (await list("?sort=date_asc")).json().items[0].id,
          thirdReceipt.json().id,
        );
        assert.equal(
          (await list("?sort=total_desc&limit=1")).json().items[0].id,
          secondReceipt.json().id,
        );
        assert.equal(
          (await list("?month=2026-08&cursor=" + page1.json().nextCursor))
            .statusCode,
          400,
        );
        assert.equal((await list("?cursor=bad")).statusCode, 400);
        assert.equal((await list("?limit=101")).statusCode, 400);
        assert.equal(
          (await list(`?cursor=${page1.json().nextCursor}`, otherAuth))
            .statusCode,
          400,
        );

        const tiedReceipt = await create({ ...base, merchant: "Same day" });
        assert.equal(tiedReceipt.statusCode, 201);
        const sortedIds = new Set<string>();
        let totalCursor: string | null = null;
        do {
          const page: { items: { id: string }[]; nextCursor: string | null } = (
            await list(
              `?sort=total_asc&limit=1${totalCursor ? `&cursor=${totalCursor}` : ""}`,
            )
          ).json();
          assert.equal(page.items.length, 1);
          assert.ok(!sortedIds.has(page.items[0]!.id));
          sortedIds.add(page.items[0]!.id);
          totalCursor = page.nextCursor;
        } while (totalCursor);
        assert.deepEqual(
          sortedIds,
          new Set([
            firstReceipt.json().id,
            secondReceipt.json().id,
            thirdReceipt.json().id,
            tiedReceipt.json().id,
          ]),
        );

        const newLatest = await create({
          ...base,
          merchant: "New latest",
          purchaseDate: "2026-10-01",
        });
        assert.equal(newLatest.statusCode, 201);
        const resumed = await list(
          `?limit=1&cursor=${page1.json().nextCursor}`,
        );
        assert.notEqual(resumed.json().items[0].id, newLatest.json().id);

        const id = firstReceipt.json().id;
        for (const method of ["GET", "PATCH", "DELETE"] as const) {
          const result = await app.inject({
            method,
            url: `/v1/receipts/${id}`,
            headers: otherAuth,
            ...(method === "PATCH" ? { payload: { merchant: "Stolen" } } : {}),
          });
          assert.equal(result.statusCode, 404);
        }
        const patch = await app.inject({
          method: "PATCH",
          url: `/v1/receipts/${id}`,
          headers: auth,
          payload: {
            merchant: "  Updated market  ",
            notes: null,
            total: "13.00",
          },
        });
        assert.equal(patch.statusCode, 200);
        assert.equal(patch.json().merchant, "Updated market");
        assert.equal(patch.json().total, "13.00");
        assert.equal(
          (
            await app.inject({
              method: "GET",
              url: `/v1/receipts/${id}`,
              headers: auth,
            })
          ).json().notes,
          null,
        );
        const deleted = await app.inject({
          method: "DELETE",
          url: `/v1/receipts/${id}`,
          headers: auth,
        });
        assert.equal(deleted.statusCode, 204);
        assert.equal(images.size, 0);
        assert.equal(
          (await app.inject({ method: "GET", url: imageUrl, headers: auth }))
            .statusCode,
          404,
        );
        assert.equal(
          (
            await app.inject({
              method: "GET",
              url: `/v1/receipts/${id}`,
              headers: auth,
            })
          ).statusCode,
          404,
        );
        await scanService.start();
        const scanPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
        const scanUpload = () =>
          app.inject({
            method: "POST",
            url: "/v1/scans",
            headers: { ...auth, "content-type": "image/png" },
            payload: scanPng,
          });
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/v1/scans",
              headers: { ...auth, "content-type": "image/jpeg" },
              payload: scanPng,
            })
          ).statusCode,
          400,
        );
        const scan = await scanUpload();
        assert.equal(scan.statusCode, 202);
        const scanUrl = `/v1/scans/${scan.json().id}`;
        assert.equal(
          (
            await app.inject({
              method: "GET",
              url: scanUrl,
              headers: otherAuth,
            })
          ).statusCode,
          404,
        );
        let completed;
        for (let i = 0; i < 50; i += 1) {
          completed = await app.inject({
            method: "GET",
            url: scanUrl,
            headers: auth,
          });
          if (completed.json().status === "completed") break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(completed?.json().status, "completed");
        assert.equal(completed?.json().fields.total, "12.50");
        assert.equal(completed?.json().fields.purchaseDate, "2026-10-02");
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: `${scanUrl}/retry`,
              headers: auth,
            })
          ).statusCode,
          409,
        );

        ocrShouldFail = true;
        const failedScan = await scanUpload();
        const failedUrl = `/v1/scans/${failedScan.json().id}`;
        let failed;
        for (let i = 0; i < 50; i += 1) {
          failed = await app.inject({
            method: "GET",
            url: failedUrl,
            headers: auth,
          });
          if (failed.json().status === "failed") break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(failed?.json().errorCode, "OCR_FAILED");
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: `${failedUrl}/retry`,
              headers: otherAuth,
            })
          ).statusCode,
          404,
        );
        ocrShouldFail = false;
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: `${failedUrl}/retry`,
              headers: auth,
            })
          ).statusCode,
          202,
        );
        for (let i = 0; i < 50; i += 1) {
          completed = await app.inject({
            method: "GET",
            url: failedUrl,
            headers: auth,
          });
          if (completed.json().status === "completed") break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(completed?.json().status, "completed");
      } finally {
        await app.close();
      }
      const categoryId = categories.find(
        (category) => category.slug === "groceries",
      )?.id;
      assert.ok(categoryId);

      const receipt = await db
        .insertInto("receipts")
        .values({
          owner_user_id: user.id,
          merchant: "Market",
          purchase_date: "2026-09-27",
          total: "12.50",
          currency: "EUR",
          category_id: categoryId,
          notes: null,
          subtotal: null,
          tax: null,
          image_object_key: null,
        })
        .returning(["id", "total"])
        .executeTakeFirstOrThrow();
      assert.equal(receipt.total, "12.50");

      await assert.rejects(
        sql`INSERT INTO receipts (owner_user_id, merchant, purchase_date, total, currency, category_id) VALUES (${user.id}, 'Bad', '2026-09-27', -1, 'EUR', ${categoryId})`.execute(
          db,
        ),
        (error: unknown) => (error as { code?: string }).code === "23514",
      );
      await assert.rejects(
        sql`INSERT INTO receipts (owner_user_id, merchant, purchase_date, total, currency, category_id) VALUES (${user.id}, 'Bad', '2026-09-27', 1, 'XYZ', ${categoryId})`.execute(
          db,
        ),
        (error: unknown) => (error as { code?: string }).code === "23503",
      );
      await assert.rejects(
        sql`INSERT INTO receipts (owner_user_id, merchant, purchase_date, total, currency, category_id) VALUES (${randomUUID()}, 'Bad', '2026-09-27', 1, 'EUR', ${categoryId})`.execute(
          db,
        ),
        (error: unknown) => (error as { code?: string }).code === "23503",
      );

      await db.deleteFrom("users").where("id", "=", user.id).execute();
      assert.equal(
        (
          await db
            .selectFrom("receipts")
            .select("id")
            .where("id", "=", receipt.id)
            .execute()
        ).length,
        0,
      );

      await db.deleteFrom("receipts").execute();
      await db.deleteFrom("users").execute();

      for (let i = 0; i < 3; i += 1) {
        const rollback = await migrator.migrateDown();
        if (rollback.error) throw rollback.error;
        assert.equal(rollback.results?.[0]?.status, "Success");
      }
      const reapplied = await migrator.migrateToLatest();
      if (reapplied.error) throw reapplied.error;
      assert.equal(
        (await db.selectFrom("categories").select("id").execute()).length,
        11,
      );
    } finally {
      await db.destroy();
    }
  },
);
