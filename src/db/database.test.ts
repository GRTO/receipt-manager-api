import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { sql } from "kysely";

import { buildApp } from "../app.js";
import { createMigrator } from "./migrate.js";

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
      const app = buildApp({
        database: db,
        verifyToken: async (token) => {
          if (token === "first")
            return { subject, email: "updated@example.com" };
          if (token === "second")
            return { subject: randomUUID(), email: "second@example.com" };
          throw new Error("Invalid token");
        },
      });
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

      for (let i = 0; i < 2; i += 1) {
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
