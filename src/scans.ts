import type { FastifyInstance } from "fastify";
import { type Kysely, type Selectable } from "kysely";

import type { Database } from "./db/database.js";
import {
  detectImageType,
  MAX_IMAGE_BYTES,
  type ImageStorage,
} from "./image-storage.js";
import type { TextRecognizer } from "./ocr.js";
import { extractScanFields } from "./scan-fields.js";

type ScanRow = Selectable<Database["scan_jobs"]>;
const uuid =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const idSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: uuid } },
} as const;

function fail(code: string, message: string) {
  return { error: { code, message } };
}

function toApi(row: ScanRow) {
  return {
    id: row.id,
    status: row.status,
    fields: row.status === "completed" ? row.fields : null,
    errorCode: row.status === "failed" ? row.error_code : null,
    attempts: row.attempts,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

export class ScanService {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly images: ImageStorage,
    private readonly recognizer: TextRecognizer,
  ) {}

  async start(): Promise<void> {
    // This local-disk deployment runs one API process. Recover interrupted jobs.
    await this.db
      .updateTable("scan_jobs")
      .set({
        status: "failed",
        error_code: "OCR_FAILED",
        updated_at: new Date(),
      })
      .where("status", "=", "processing")
      .where("attempts", ">=", 2)
      .execute();
    await this.db
      .updateTable("scan_jobs")
      .set({ status: "pending", updated_at: new Date() })
      .where("status", "=", "processing")
      .where("attempts", "<", 2)
      .where("expires_at", ">", new Date())
      .execute();
    this.timer = setInterval(() => void this.tick(), 10_000);
    this.timer.unref();
    this.wake();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    while (this.running)
      await new Promise((resolve) => setTimeout(resolve, 25));
    await this.recognizer.close();
  }

  wake(): void {
    if (!this.stopping) queueMicrotask(() => void this.tick());
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      await this.cleanupExpired();
      while (!this.stopping) {
        if (!(await this.processOne())) break;
      }
    } catch (error) {
      console.error("Scan worker failed", error);
    } finally {
      this.running = false;
    }
  }

  private async cleanupExpired(): Promise<void> {
    const rows = await this.db
      .selectFrom("scan_jobs")
      .select(["id", "image_object_key"])
      .where("expires_at", "<=", new Date())
      .limit(50)
      .execute();
    for (const row of rows) {
      try {
        await this.images.delete(row.image_object_key);
        await this.db
          .deleteFrom("scan_jobs")
          .where("id", "=", row.id)
          .execute();
      } catch (error) {
        console.error("Expired scan cleanup failed", error);
      }
    }
  }

  private async processOne(): Promise<boolean> {
    const next = await this.db
      .selectFrom("scan_jobs")
      .select(["id"])
      .where("status", "=", "pending")
      .where("expires_at", ">", new Date())
      .orderBy("created_at")
      .limit(1)
      .executeTakeFirst();
    if (!next) return false;
    const row = await this.db
      .updateTable("scan_jobs")
      .set((eb) => ({
        status: "processing",
        attempts: eb("attempts", "+", 1),
        error_code: null,
        updated_at: new Date(),
      }))
      .where("id", "=", next.id)
      .where("status", "=", "pending")
      .returningAll()
      .executeTakeFirst();
    if (!row) return true;
    try {
      const bytes = await this.images.get(row.image_object_key);
      const text = await this.recognizer.recognize(bytes);
      const fields = extractScanFields(text);
      if (!Object.keys(fields).length) {
        await this.db
          .updateTable("scan_jobs")
          .set({
            status: "failed",
            error_code: "NO_TEXT",
            updated_at: new Date(),
          })
          .where("id", "=", row.id)
          .execute();
      } else {
        await this.db
          .updateTable("scan_jobs")
          .set({ status: "completed", fields, updated_at: new Date() })
          .where("id", "=", row.id)
          .execute();
      }
    } catch (error) {
      console.error("OCR failed", error);
      await this.db
        .updateTable("scan_jobs")
        .set({
          status: "failed",
          error_code: "OCR_FAILED",
          updated_at: new Date(),
        })
        .where("id", "=", row.id)
        .execute();
    }
    return true;
  }

  async create(
    ownerId: string,
    bytes: Buffer,
  ): Promise<ReturnType<typeof toApi>> {
    const type = detectImageType(bytes);
    if (!type) throw new Error("Invalid image type");
    const key = await this.images.put(ownerId, bytes, type);
    try {
      const row = await this.db
        .insertInto("scan_jobs")
        .values({
          owner_user_id: ownerId,
          image_object_key: key,
          status: "pending",
          fields: null,
          error_code: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      this.wake();
      return toApi(row);
    } catch (error) {
      await this.images.delete(key);
      throw error;
    }
  }

  async get(
    ownerId: string,
    id: string,
  ): Promise<ReturnType<typeof toApi> | null> {
    const row = await this.db
      .selectFrom("scan_jobs")
      .selectAll()
      .where("id", "=", id)
      .where("owner_user_id", "=", ownerId)
      .where("expires_at", ">", new Date())
      .executeTakeFirst();
    return row ? toApi(row) : null;
  }

  async retry(
    ownerId: string,
    id: string,
  ): Promise<ReturnType<typeof toApi> | null> {
    const row = await this.db
      .updateTable("scan_jobs")
      .set({ status: "pending", error_code: null, updated_at: new Date() })
      .where("id", "=", id)
      .where("owner_user_id", "=", ownerId)
      .where("status", "=", "failed")
      .where("attempts", "<", 2)
      .where("expires_at", ">", new Date())
      .returningAll()
      .executeTakeFirst();
    if (row) this.wake();
    return row ? toApi(row) : null;
  }
}

export function registerScanRoutes(
  app: FastifyInstance,
  scans: ScanService,
): void {
  app.post<{ Body: Buffer }>(
    "/v1/scans",
    { bodyLimit: MAX_IMAGE_BYTES },
    async (request, reply) => {
      const bytes = request.body;
      const type = Buffer.isBuffer(bytes) ? detectImageType(bytes) : null;
      if (
        !type ||
        bytes.length === 0 ||
        bytes.length > MAX_IMAGE_BYTES ||
        request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
          type
      )
        return reply
          .status(400)
          .send(
            fail(
              "VALIDATION_ERROR",
              "Scan must be a JPEG, PNG, or WebP file up to 10 MiB with a matching Content-Type",
            ),
          );
      return reply.status(202).send(await scans.create(request.user.id, bytes));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/scans/:id",
    { schema: { params: idSchema } },
    async (request, reply) => {
      const job = await scans.get(request.user.id, request.params.id);
      return job ?? reply.status(404).send(fail("NOT_FOUND", "Scan not found"));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/scans/:id/retry",
    { schema: { params: idSchema } },
    async (request, reply) => {
      const job = await scans.get(request.user.id, request.params.id);
      if (!job)
        return reply.status(404).send(fail("NOT_FOUND", "Scan not found"));
      if (job.status !== "failed" || job.attempts >= 2)
        return reply
          .status(409)
          .send(fail("CONFLICT", "Scan cannot be retried"));
      const retried = await scans.retry(request.user.id, request.params.id);
      return retried
        ? reply.status(202).send(retried)
        : reply
            .status(409)
            .send(fail("CONFLICT", "Scan changed; refresh its status"));
    },
  );
}
