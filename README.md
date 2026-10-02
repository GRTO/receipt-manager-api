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
the backend. The API listens on `http://127.0.0.1:3000` by default. Confirm it is running by opening
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
| `IMAGE_STORAGE_DIR` | Private local receipt images (default `./data/images`)             | No           |

Configured URLs and ports are validated at startup. Keep database credentials on the server; never use a Supabase service-role key in the Expo app.

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

The `/v1` contract and shared error format are in [openapi.yaml](openapi.yaml). Amounts are decimal strings with two fractional digits; the backend stores them exactly and the Expo app must convert explicitly from its current JavaScript numbers. Receipt access is personal-only. The API derives ownership from a verified Supabase access token and rejects owner IDs in request bodies. Search and filters apply only to the signed-in user's receipts. The list accepts `search`, `month`, `categoryId`, `sort`, `limit`, and `cursor`; sort values are `date_desc` (default), `date_asc`, `total_desc`, and `total_asc`. Use `nextCursor` with the same filters and sort order for the next page. Spending summaries are part of Step 8.

## Private receipt images

Create a receipt first, then `PUT` its JPEG, PNG, or WebP bytes to `/v1/receipts/{id}/image` with the matching `Content-Type` and bearer token. Images may be up to 10 MiB. The server checks the file signature, generates a unique key, and stores the bytes under `IMAGE_STORAGE_DIR`. The receipt stores only the key. `imageUrl` is a relative, authenticated API path; fetch it with the same bearer token. Access is checked against the receipt owner. Replacing an image removes the old file, and deleting a receipt removes its file.

The default `./data/images` directory is ignored by Git. Keep it private to the API process and back it up together with PostgreSQL. To avoid paying for cloud storage, this implementation uses local disk and makes no AWS calls. Set `IMAGE_STORAGE_DIR` to a persistent directory when running the API outside this repository. A copy of the database without the image directory will have missing images.

## Current implementation

This repository provides the server foundation, configuration validation, a shared error format, a tested health route, PostgreSQL schema/migrations, Supabase JWT verification, `GET /v1/me`, categories, and owner-scoped receipt CRUD with filtering and cursor pagination. Calendar dates remain strings through the database layer to avoid timezone shifts. The [frontend plan](../receipt-manager/README.md) describes the implementation sequence.

Private receipt images are implemented in Step 6. Receipt create and update reject `imageUploadId`; upload to an existing receipt using the image route instead. A receipt without an image returns `imageUrl: null`.

## Local OCR scans

Step 9 backend scan jobs run with Tesseract.js and the Portuguese and English
language models installed by `npm install`. Recognition runs inside the API
process and makes no OCR service calls. It uses CPU and memory on the host;
there is no per-scan charge. Run `npm run db:migrate` after updating this branch.

Send JPEG, PNG, or WebP bytes (maximum 10 MiB) to `POST /v1/scans` with a bearer
token and matching `Content-Type`. The response is a `202` job. Poll
`GET /v1/scans/{id}` for `pending`, `processing`, `completed`, or `failed`. A
failed job can be retried once with `POST /v1/scans/{id}/retry`. Jobs and their
private source images expire after 24 hours; the worker cleans them up.

Completed jobs return suggested `merchant`, `purchaseDate`, `total`, `currency`,
`subtotal`, and `tax` fields when recognized. The API does not save a receipt
from these suggestions. The frontend must show its review form, allow edits,
then create a receipt through `POST /v1/receipts`. Scans are scoped to the
authenticated owner. The current worker assumes one API process and storage
directory; do not run multiple instances against the same scan table without
adding a distributed claim and shared image storage.
