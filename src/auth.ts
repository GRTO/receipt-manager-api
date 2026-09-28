import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthIdentity {
  subject: string;
  email: string;
}

export type TokenVerifier = (token: string) => Promise<AuthIdentity>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createTokenVerifier(supabaseUrl: string): TokenVerifier {
  const issuer = new URL("/auth/v1", supabaseUrl).toString();
  const jwks = createRemoteJWKSet(
    new URL("/auth/v1/.well-known/jwks.json", supabaseUrl),
  );

  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: "authenticated",
      algorithms: ["RS256", "ES256", "EdDSA"],
      requiredClaims: ["exp", "sub", "iss", "aud"],
    });

    if (
      typeof payload.sub !== "string" ||
      !uuidPattern.test(payload.sub) ||
      typeof payload.email !== "string" ||
      !payload.email.trim() ||
      payload.role !== "authenticated"
    ) {
      throw new Error("Invalid user claims");
    }

    return { subject: payload.sub, email: payload.email };
  };
}
