# Receipt Manager API

Standalone Node.js API for the Receipt Manager Expo app. The server is written in TypeScript and runs as compiled JavaScript.

## Requirements

- Node.js 24 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

The API listens on `http://127.0.0.1:3000` by default. `GET /health` returns `{ "status": "ok" }` without authentication and can be used as a deployment liveness check. It currently has no external dependencies to check; add database and storage readiness checks when those integrations are implemented. The server does not automatically load `.env`; provide variables through your process manager or shell. `.env.example` lists them.

| Variable           | Purpose                                                                | Required now |
| ------------------ | ---------------------------------------------------------------------- | ------------ |
| `HOST`             | Listen address (default `127.0.0.1`; use `0.0.0.0` in a container)     | No           |
| `PORT`             | Listen port (default `3000`)                                           | No           |
| `DATABASE_URL`     | PostgreSQL connection URL for Step 3                                   | No           |
| `SUPABASE_URL`     | Supabase project URL; used to derive JWT issuer and JWKS URL in Step 4 | No           |
| `STORAGE_ENDPOINT` | Private object storage endpoint for Step 6                             | No           |
| `STORAGE_BUCKET`   | Private image bucket for Step 6                                        | No           |

Configured URLs, ports, and bucket names are validated at startup. Future integrations must require their own settings when enabled. Keep database credentials and storage secrets on the server; never use a Supabase service-role key in the Expo app.

```bash
npm run typecheck
npm test
npm run build
npm start
npm run check
```

`npm run check` runs typecheck, lint, format verification, and tests. CI runs the same check on Node 24 using the committed npm lockfile.

## First-release contract

The planned `/v1` routes and shared error format are in [openapi.yaml](openapi.yaml). Amounts are decimal strings with two fractional digits; the backend will store them exactly and the Expo app must convert explicitly from its current JavaScript numbers. Receipt access is personal-only. The API will derive ownership from a verified Supabase access token, never from a request body. Search and filters apply only to the signed-in user's receipts. Image uploads and spending summaries are part of later implementation steps.

## Current implementation

This repository currently provides the server foundation, configuration validation, a shared error format, and a tested health route. It has no receipt data, authentication, database, image storage, or OCR yet. The [frontend plan](../receipt-manager/README.md) describes the implementation sequence.

Next, add PostgreSQL migrations, then authentication and receipt routes against the OpenAPI contract.
