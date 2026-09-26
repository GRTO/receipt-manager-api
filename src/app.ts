import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({ logger: true });

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

  return app;
}
