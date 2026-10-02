import Fastify from "fastify";
import type { Kysely } from "kysely";

import type { TokenVerifier } from "./auth.js";
import type { Database } from "./db/database.js";
import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  type ImageStorage,
} from "./image-storage.js";
import { registerReceiptRoutes } from "./receipts.js";
import { registerScanRoutes, type ScanService } from "./scans.js";

interface AppOptions {
  database?: Kysely<Database>;
  verifyToken?: TokenVerifier;
  imageStorage?: ImageStorage;
  scanService?: ScanService;
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: true,
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.addContentTypeParser(
    [...IMAGE_TYPES],
    { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    const failure =
      error instanceof Error ? error : new Error("Internal server error");
    const hasValidation =
      "validation" in failure && Boolean(failure.validation);
    const status = hasValidation
      ? 400
      : "statusCode" in failure && typeof failure.statusCode === "number"
        ? failure.statusCode
        : 500;
    const code = hasValidation
      ? "VALIDATION_ERROR"
      : status >= 500
        ? "INTERNAL_ERROR"
        : "REQUEST_ERROR";
    reply.status(status).send({
      error: {
        code,
        message: status >= 500 ? "Internal server error" : failure.message,
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply
      .status(404)
      .send({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string", const: "ok" } },
          },
        },
      },
    },
    async () => ({ status: "ok" }),
  );

  app.addHook("onRequest", async (request, reply) => {
    if (request.url !== "/v1" && !request.url.startsWith("/v1/")) return;
    if (!options.database || !options.verifyToken) {
      return reply.status(503).send({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Authentication is not configured",
        },
      });
    }

    const authorization = request.headers.authorization;
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");
    if (!match?.[1]) {
      return reply.status(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "A valid bearer token is required",
        },
      });
    }

    let identity;
    try {
      identity = await options.verifyToken(match[1]);
    } catch {
      return reply.status(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "A valid bearer token is required",
        },
      });
    }

    const user = await options.database
      .insertInto("users")
      .values({
        auth_subject: identity.subject,
        email: identity.email,
        preferred_currency: "EUR",
      })
      .onConflict((conflict) =>
        conflict.column("auth_subject").doUpdateSet({
          email: identity.email,
          updated_at: new Date(),
        }),
      )
      .returning([
        "id",
        "email",
        "preferred_currency",
        "created_at",
        "updated_at",
      ])
      .executeTakeFirstOrThrow();

    request.user = user;
  });

  app.get("/v1/me", async (request) => ({
    id: request.user.id,
    email: request.user.email,
    preferredCurrency: request.user.preferred_currency,
    createdAt: request.user.created_at.toISOString(),
    updatedAt: request.user.updated_at.toISOString(),
  }));

  if (options.database)
    registerReceiptRoutes(app, options.database, options.imageStorage);
  if (options.scanService) registerScanRoutes(app, options.scanService);

  return app;
}

declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      preferred_currency: string;
      created_at: Date;
      updated_at: Date;
    };
  }
}
