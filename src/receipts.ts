import type { FastifyInstance } from "fastify";
import { sql, type Kysely, type Selectable } from "kysely";

import type { Database } from "./db/database.js";

type ReceiptRow = Selectable<Database["receipts"]>;
type Sort = "date_desc" | "date_asc" | "total_desc" | "total_asc";
type ReceiptInput = {
  merchant: string;
  purchaseDate: string;
  total: string;
  currency: string;
  categoryId: string;
  notes?: string | null;
  subtotal?: string | null;
  tax?: string | null;
};
type ReceiptPatch = Partial<ReceiptInput>;
type ListQuery = {
  search?: string;
  month?: string;
  categoryId?: string;
  sort?: Sort;
  limit?: number;
  cursor?: string;
};

const uuid =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const money = "^(0|[1-9][0-9]{0,15})\\.[0-9]{2}$";
const date = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";
const month = "^[0-9]{4}-(0[1-9]|1[0-2])$";
const inputProperties = {
  merchant: { type: "string", minLength: 1, maxLength: 200 },
  purchaseDate: { type: "string", pattern: date },
  total: { type: "string", pattern: money },
  currency: { type: "string", pattern: "^[A-Z]{3}$" },
  categoryId: { type: "string", pattern: uuid },
  notes: { type: ["string", "null"], maxLength: 2000 },
  subtotal: { type: ["string", "null"], pattern: money },
  tax: { type: ["string", "null"], pattern: money },
} as const;
const inputSchema = {
  type: "object",
  required: ["merchant", "purchaseDate", "total", "currency", "categoryId"],
  additionalProperties: false,
  properties: inputProperties,
} as const;
const patchSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: inputProperties,
} as const;
const idSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: uuid } },
} as const;

function fail(code: string, message: string) {
  return { error: { code, message } };
}

function validDate(value: string): boolean {
  if (!new RegExp(date).test(value)) return false;
  if (value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function toApi(row: ReceiptRow) {
  return {
    id: row.id,
    merchant: row.merchant,
    purchaseDate: row.purchase_date,
    total: row.total,
    currency: row.currency,
    categoryId: row.category_id,
    notes: row.notes,
    subtotal: row.subtotal,
    tax: row.tax,
    imageUrl: null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function cursorValue(row: ReceiptRow, sort: Sort) {
  return sort.startsWith("date") ? row.purchase_date : row.total;
}

function encodeCursor(
  row: ReceiptRow,
  query: ListQuery,
  owner: string,
  sort: Sort,
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      owner,
      search: query.search ?? null,
      month: query.month ?? null,
      categoryId: query.categoryId ?? null,
      sort,
      value: cursorValue(row, sort),
      id: row.id,
    }),
  ).toString("base64url");
}

function decodeCursor(
  raw: string,
  query: ListQuery,
  owner: string,
  sort: Sort,
): { value: string; id: string } | null {
  if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const data: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (!data || typeof data !== "object") return null;
    const cursor = data as Record<string, unknown>;
    if (
      cursor.v !== 1 ||
      cursor.owner !== owner ||
      cursor.search !== (query.search ?? null) ||
      cursor.month !== (query.month ?? null) ||
      cursor.categoryId !== (query.categoryId ?? null) ||
      cursor.sort !== sort ||
      typeof cursor.value !== "string" ||
      typeof cursor.id !== "string" ||
      !new RegExp(uuid).test(cursor.id)
    )
      return null;
    if (
      sort.startsWith("date")
        ? !validDate(cursor.value)
        : !new RegExp(money).test(cursor.value)
    )
      return null;
    return { value: cursor.value, id: cursor.id };
  } catch {
    return null;
  }
}

async function validateInput(
  db: Kysely<Database>,
  input: ReceiptPatch,
): Promise<string | null> {
  if (input.merchant !== undefined && !input.merchant.trim())
    return "merchant must not be blank";
  if (input.purchaseDate !== undefined && !validDate(input.purchaseDate))
    return "purchaseDate must be a valid calendar date";
  if (input.categoryId !== undefined) {
    const category = await db
      .selectFrom("categories")
      .select("id")
      .where("id", "=", input.categoryId)
      .executeTakeFirst();
    if (!category) return "categoryId is not supported";
  }
  if (input.currency !== undefined) {
    const currency = await db
      .selectFrom("currencies")
      .select("code")
      .where("code", "=", input.currency)
      .executeTakeFirst();
    if (!currency) return "currency is not supported";
  }
  return null;
}

function changes(input: ReceiptPatch) {
  return {
    ...(input.merchant !== undefined
      ? { merchant: input.merchant.trim() }
      : {}),
    ...(input.purchaseDate !== undefined
      ? { purchase_date: input.purchaseDate }
      : {}),
    ...(input.total !== undefined ? { total: input.total } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.categoryId !== undefined
      ? { category_id: input.categoryId }
      : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.subtotal !== undefined ? { subtotal: input.subtotal } : {}),
    ...(input.tax !== undefined ? { tax: input.tax } : {}),
  };
}

async function checkInputTypes(
  request: { body: unknown },
  reply: { status: (code: number) => { send: (body: object) => void } },
) {
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  )
    return;
  const body = request.body as Record<string, unknown>;
  for (const field of [
    "merchant",
    "purchaseDate",
    "total",
    "currency",
    "categoryId",
    "notes",
    "subtotal",
    "tax",
  ]) {
    const value = body[field];
    if (
      value !== undefined &&
      typeof value !== "string" &&
      !(value === null && ["notes", "subtotal", "tax"].includes(field))
    ) {
      reply
        .status(400)
        .send(
          fail(
            "VALIDATION_ERROR",
            `${field} must be a string${["notes", "subtotal", "tax"].includes(field) ? " or null" : ""}`,
          ),
        );
      return;
    }
  }
}

export function registerReceiptRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
) {
  app.get("/v1/categories", async () => ({
    items: await db
      .selectFrom("categories")
      .select(["id", "slug", "name", "color", "icon"])
      .orderBy("name")
      .execute(),
  }));

  app.get<{ Querystring: ListQuery }>(
    "/v1/receipts",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string", maxLength: 200 },
            month: { type: "string", pattern: month },
            categoryId: { type: "string", pattern: uuid },
            sort: {
              type: "string",
              enum: ["date_desc", "date_asc", "total_desc", "total_asc"],
            },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", maxLength: 2048 },
          },
        },
      },
    },
    async (request, reply) => {
      const query = request.query;
      if (query.month?.startsWith("0000-"))
        return reply
          .status(400)
          .send(
            fail("VALIDATION_ERROR", "month must be a valid calendar month"),
          );
      const sort = query.sort ?? "date_desc";
      const limit = query.limit ?? 25;
      const cursor = query.cursor
        ? decodeCursor(query.cursor, query, request.user.id, sort)
        : undefined;
      if (query.cursor && !cursor)
        return reply
          .status(400)
          .send(fail("VALIDATION_ERROR", "Invalid cursor"));
      const column = sort.startsWith("date") ? "purchase_date" : "total";
      const direction = sort.endsWith("desc") ? "desc" : "asc";
      let statement = db
        .selectFrom("receipts")
        .selectAll()
        .where("owner_user_id", "=", request.user.id);
      if (query.search)
        statement = statement.where((eb) =>
          eb.or([
            eb(
              sql`position(lower(${query.search}) in lower(merchant))`,
              ">",
              0,
            ),
            eb(
              sql`position(lower(${query.search}) in lower(coalesce(notes, '')))`,
              ">",
              0,
            ),
          ]),
        );
      if (query.month) {
        const year = Number(query.month.slice(0, 4));
        const monthNumber = Number(query.month.slice(5, 7));
        const next =
          monthNumber === 12
            ? `${year + 1}-01-01`
            : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
        statement = statement
          .where("purchase_date", ">=", `${query.month}-01`)
          .where("purchase_date", "<", next);
      }
      if (query.categoryId)
        statement = statement.where("category_id", "=", query.categoryId);
      if (cursor) {
        const operator = direction === "desc" ? "<" : ">";
        statement = statement.where((eb) =>
          eb.or([
            eb(column, operator, cursor.value),
            eb.and([
              eb(column, "=", cursor.value),
              eb("id", operator, cursor.id),
            ]),
          ]),
        );
      }
      const rows = await statement
        .orderBy(column, direction)
        .orderBy("id", direction)
        .limit(limit + 1)
        .execute();
      const items = rows.slice(0, limit);
      return {
        items: items.map(toApi),
        nextCursor:
          rows.length > limit && items.length
            ? encodeCursor(
                items[items.length - 1]!,
                query,
                request.user.id,
                sort,
              )
            : null,
      };
    },
  );

  app.post<{ Body: ReceiptInput }>(
    "/v1/receipts",
    { schema: { body: inputSchema }, preValidation: checkInputTypes },
    async (request, reply) => {
      const error = await validateInput(db, request.body);
      if (error) return reply.status(400).send(fail("VALIDATION_ERROR", error));
      const row = await db
        .insertInto("receipts")
        .values({
          owner_user_id: request.user.id,
          ...changes(request.body),
          merchant: request.body.merchant.trim(),
          purchase_date: request.body.purchaseDate,
          total: request.body.total,
          currency: request.body.currency,
          category_id: request.body.categoryId,
          notes: request.body.notes ?? null,
          subtotal: request.body.subtotal ?? null,
          tax: request.body.tax ?? null,
          image_object_key: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return reply.status(201).send(toApi(row));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/receipts/:id",
    { schema: { params: idSchema } },
    async (request, reply) => {
      const row = await db
        .selectFrom("receipts")
        .selectAll()
        .where("id", "=", request.params.id)
        .where("owner_user_id", "=", request.user.id)
        .executeTakeFirst();
      return row
        ? toApi(row)
        : reply.status(404).send(fail("NOT_FOUND", "Receipt not found"));
    },
  );

  app.patch<{ Params: { id: string }; Body: ReceiptPatch }>(
    "/v1/receipts/:id",
    {
      schema: { params: idSchema, body: patchSchema },
      preValidation: checkInputTypes,
    },
    async (request, reply) => {
      const error = await validateInput(db, request.body);
      if (error) return reply.status(400).send(fail("VALIDATION_ERROR", error));
      const row = await db
        .updateTable("receipts")
        .set({ ...changes(request.body), updated_at: new Date() })
        .where("id", "=", request.params.id)
        .where("owner_user_id", "=", request.user.id)
        .returningAll()
        .executeTakeFirst();
      return row
        ? toApi(row)
        : reply.status(404).send(fail("NOT_FOUND", "Receipt not found"));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/receipts/:id",
    { schema: { params: idSchema } },
    async (request, reply) => {
      const row = await db
        .deleteFrom("receipts")
        .where("id", "=", request.params.id)
        .where("owner_user_id", "=", request.user.id)
        .returning("id")
        .executeTakeFirst();
      return row
        ? reply.status(204).send()
        : reply.status(404).send(fail("NOT_FOUND", "Receipt not found"));
    },
  );
}
