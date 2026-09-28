# Receipt Manager API

Standalone Node.js API for the Receipt Manager Expo app. The server is written in TypeScript and runs as compiled JavaScript.

## Requirements

- Node.js 24 or newer
- npm
- Docker with Compose for local PostgreSQL

## Run locally

```bash
npm install
docker compose up -d postgres
$env:DATABASE_URL = "postgresql://receipts:receipts_dev@localhost:5432/receipts"
$env:SUPABASE_URL = "https://your-project.supabase.co"
npm run db:migrate
npm run dev
```

These environment assignment examples use PowerShell. The commands install the
API dependencies, start local PostgreSQL, apply the database schema, and start
the backend. The API listens on `http://127.0.0.1:3000` by default. Before
moving to Step 4, confirm it is running by opening
`http://127.0.0.1:3000/health`; it should return `{ "status": "ok" }`.

The server does not automatically load `.env`; provide variables through your
process manager or shell. `.env.example` lists them.

Set `SUPABASE_URL` to your Supabase project's URL before starting the API.
Configure email one-time passcodes in Supabase Auth and activate an asymmetric
JWT signing key (ES256 or RS256). The project JWKS must publish its public key
at `/auth/v1/.well-known/jwks.json`; legacy HS256 tokens are rejected. The
Expo sign-in flow is planned for Step 7. Until then, obtain a Supabase Auth
access token and call `GET /v1/me` with `Authorization: Bearer <token>` to
check authentication. The API creates a local user on the first valid request.

| Variable            | Purpose                                                            | Required now |
| ------------------- | ------------------------------------------------------------------ | ------------ |
| `HOST`              | Listen address (default `127.0.0.1`; use `0.0.0.0` in a container) | No           |
| `PORT`              | Listen port (default `3000`)                                       | No           |
| `DATABASE_URL`      | PostgreSQL connection URL for migrations and user profiles         | Yes          |
| `TEST_DATABASE_URL` | Dedicated `receipt_manager_test` database for integration tests    | DB tests     |
| `SUPABASE_URL`      | Supabase project URL; used to derive JWT issuer and JWKS URL       | Yes          |
| `STORAGE_ENDPOINT`  | Private object storage endpoint for Step 6                         | No           |
| `STORAGE_BUCKET`    | Private image bucket for Step 6                                    | No           |

Configured URLs, ports, and bucket names are validated at startup. Future integrations must require their own settings when enabled. Keep database credentials and storage secrets on the server; never use a Supabase service-role key in the Expo app.

```bash
npm run typecheck
npm test
npm run build
npm start
npm run check
```

`npm run check` runs typecheck, lint, format verification, and tests. CI runs the same check on Node 24 with PostgreSQL using the committed npm lockfile.

## PostgreSQL and migrations

The database layer uses [Kysely](https://kysely.dev/docs/getting-started) with `pg` and Kysely's [migration runner](https://kysely.dev/docs/migrations). Migrations are compiled from `src/db/migrations` and applied explicitly by `npm run db:migrate`; app startup does not mutate the schema. `npm run db:rollback` reverses one migration. Local Compose creates both `receipts` and the dedicated `receipt_manager_test` database on first startup.

For local database tests:

```powershell
$env:TEST_DATABASE_URL = "postgresql://receipts:receipts_dev@localhost:5432/receipt_manager_test"
npm run test:db
```

`npm test` also runs the database test when `TEST_DATABASE_URL` is set; otherwise it skips that integration test. The test migrates down and up, so keep this URL pointed only at the dedicated test database. To reset all local development and test data, run `docker compose down -v`, then `docker compose up -d postgres` and `npm run db:migrate`. This deletes the Compose PostgreSQL volume.

Amounts use PostgreSQL `numeric(18,2)` and decimal strings such as `"12.50"` on the API wire. The `pg` driver returns numeric values as strings, so no floating point conversion is required. EUR is the initial supported currency and the default for users and receipts. Currency fields reference the `currencies` table; add supported ISO 4217 codes through a later migration before accepting them at the API. Totals must be grouped by currency. Categories have stable UUIDs plus the frontend's existing slugs; Step 7 must map the frontend's slug IDs to API UUIDs.

## First-release contract

The planned `/v1` routes and shared error format are in [openapi.yaml](openapi.yaml). Amounts are decimal strings with two fractional digits; the backend will store them exactly and the Expo app must convert explicitly from its current JavaScript numbers. Receipt access is personal-only. The API will derive ownership from a verified Supabase access token, never from a request body. Search and filters apply only to the signed-in user's receipts. Image uploads and spending summaries are part of later implementation steps.

## Current implementation

This repository provides the server foundation, configuration validation, a shared error format, a tested health route, PostgreSQL schema/migrations, Supabase JWT verification, and `GET /v1/me`. It has no receipt routes, image storage, or OCR yet. The [frontend plan](../receipt-manager/README.md) describes the implementation sequence.

Next, add owner-scoped receipt routes against the OpenAPI contract.
