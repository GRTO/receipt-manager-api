import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { createTokenVerifier } from "./auth.js";

test("Supabase tokens require a valid asymmetric signature and user claims", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const otherKey = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        keys: [{ ...jwk, kid: "test-key", alg: "ES256", use: "sig" }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const verifier = createTokenVerifier(origin);
    const subject = randomUUID();
    const issue = async (
      overrides: Record<string, unknown> = {},
      key = privateKey,
      claims: {
        issuer?: string;
        audience?: string;
        subject?: string;
        expires?: string | number;
      } = {},
    ) =>
      new SignJWT({
        email: "person@example.com",
        role: "authenticated",
        ...overrides,
      })
        .setProtectedHeader({ alg: "ES256", kid: "test-key" })
        .setIssuer(claims.issuer ?? `${origin}/auth/v1`)
        .setAudience(claims.audience ?? "authenticated")
        .setSubject(claims.subject ?? subject)
        .setExpirationTime(claims.expires ?? "1h")
        .sign(key);

    assert.deepEqual(await verifier(await issue()), {
      subject,
      email: "person@example.com",
    });
    await assert.rejects(verifier(await issue({}, otherKey.privateKey)));
    await assert.rejects(verifier(await issue({ role: "anon" })));
    await assert.rejects(verifier(await issue({ email: "" })));
    await assert.rejects(
      verifier(
        await issue({}, privateKey, {
          issuer: "https://other.example/auth/v1",
        }),
      ),
    );
    await assert.rejects(
      verifier(await issue({}, privateKey, { audience: "anon" })),
    );
    await assert.rejects(
      verifier(await issue({}, privateKey, { subject: "not-a-uuid" })),
    );
    await assert.rejects(
      verifier(
        await issue({}, privateKey, {
          expires: Math.floor(Date.now() / 1000) - 30,
        }),
      ),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
