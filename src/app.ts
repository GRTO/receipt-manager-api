import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({ logger: true });

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
