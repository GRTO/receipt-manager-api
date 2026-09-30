# Receipt Manager

An Expo + TypeScript receipt-management app. The current app uses an in-memory `ReceiptService` and a mock scanning flow. The backend scaffold lives in the sibling [`receipt-manager-api`](../receipt-manager-api/README.md) repository; this README records the proposed architecture and implementation plan.

## Resume here

The backend repository exists. Steps 2-6 are implemented. Step 6 uses private local disk storage with no cloud charges; its integration suite passed against local PostgreSQL. Continue with **Step 7: Connect the Expo frontend** in the checklist below. The changes are uncommitted for review. Mark each checkbox when its work is complete so this section stays useful across sessions.

## Run the frontend

```bash
npm install
npm run start
npm run ios      # macOS with Xcode
npm run android  # Android emulator/device
npm run test
npm run typecheck
```

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` when connecting to an API. Expo public variables are bundled into the app, so they must never contain credentials or other secrets.

## Current frontend architecture

`src/features/receipts` owns receipt types, validation, screens, utilities, and the `ReceiptService` interface. UI components live in `src/components`; navigation, theme, and short-lived scan state are separate. Screens call `receiptService`, so an HTTP implementation can replace the in-memory implementation without changing every screen.

The login screen currently enters the app without authenticating. Receipt data is held in memory, receipt images use mock/local URLs, and `extractReceipt` returns mock values. The spending screens calculate summaries from a limited number of fetched receipts. Household sharing, cloud sync, export, and budgets are represented in the UI but do not yet have backend behavior.

## Proposed backend architecture

The **separate backend repository** contains a Node.js server written in **TypeScript**. TypeScript compiles to JavaScript for execution; there is no need to maintain parallel `.ts` and `.js` source files. Keep this Expo app in the frontend repository and connect the two through a documented HTTP API.

```text
Expo app  ->  REST API  ->  PostgreSQL
                 |
                 +------> Private local image directory
                 |
                 +------> OCR provider/worker (later phase)
```

| Concern         | Proposed choice                                                                   | Reason                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Server          | Node.js + TypeScript + Fastify                                                    | Small HTTP service with TypeScript support and request/response schema validation.                                              |
| API             | REST, documented with OpenAPI                                                     | Maps directly to the current `ReceiptService` methods and gives the separate repos an explicit contract.                        |
| Database        | PostgreSQL                                                                        | Relational fit for users, receipts, categories, households, and spending queries. Use migrations committed to the backend repo. |
| Database access | A TypeScript query layer/ORM with migrations; select one before adding PostgreSQL | Keep schema changes repeatable and database queries typed.                                                                      |
| Images          | Private local file storage                                                        | Zero cloud cost for personal use. Store image bytes outside PostgreSQL and object keys in the database.                         |
| Authentication  | Provider and sign-in method to be decided                                         | The API must validate identity and authorize every receipt operation.                                                           |
| OCR             | Optional asynchronous integration after basic receipt flows work                  | OCR output is a suggestion; the user reviews and edits it before saving.                                                        |

A CRM is not needed: this app manages receipts rather than customer relationships. GraphQL is not needed for the initial API. Reconsider it if future clients need substantially different combinations of related data or REST calls become cumbersome.

## Data model to design first

Start with these entities and constraints in the backend repo:

- **User:** stable ID, identity-provider ID (or credential reference), email, timestamps, and preferences that must sync between devices.
- **Receipt:** ID, owner user ID, merchant, purchase date, total, currency, category ID, optional notes/tax/subtotal, optional image object key, and created/updated timestamps. Derive the acting user from authentication; do not trust a client-supplied `userId`.
- **Category:** stable ID and display metadata. Seed the categories currently defined in `receiptService.ts`, then decide whether user-defined categories are needed.
- **Household and membership:** add when the rules for `shared` receipts are settled. A shared receipt needs an actual household ID and membership checks; the current `ownership` flag alone is not access control.
- **Scan/OCR job:** add when asynchronous OCR is introduced, including job status, extracted fields, and failure details.

Use an exact database representation for money, such as `numeric` with a chosen scale, and define a consistent decimal representation in the API. The frontend currently uses JavaScript `number` for amounts, so integration must explicitly convert and validate amounts. Keep currency as an ISO currency code; never silently add amounts in different currencies when producing spending totals. Index receipts by the fields used for owner-scoped lists, dates, and filters.

## Initial API contract

Put the API under `/v1`. The exact request and response schemas should be recorded in OpenAPI and checked against the frontend service interface.

| Route                      | Purpose                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /v1/me`               | Return the authenticated user and relevant preferences.                                            |
| `GET /v1/categories`       | Return selectable categories.                                                                      |
| `GET /v1/receipts`         | List accessible receipts with search, month, category, ownership, sort, limit, and cursor filters. |
| `GET /v1/receipts/:id`     | Read one accessible receipt.                                                                       |
| `POST /v1/receipts`        | Create a receipt from validated, user-reviewed data.                                               |
| `PATCH /v1/receipts/:id`   | Update an accessible receipt.                                                                      |
| `DELETE /v1/receipts/:id`  | Delete an accessible receipt and define associated image cleanup.                                  |
| `PUT /v1/receipts/:id/image` | Upload or replace an owned receipt's image through the server.                                  |
| `GET /v1/receipts/:id/image` | View an owned receipt's image through the authenticated API.                                    |
| `GET /v1/spending/summary` | Return server-calculated totals and category breakdown by month, ownership, and currency.          |

For uploads, validate file type and size, use unique object keys, and keep the image directory private. Return an authorized image endpoint rather than saving permanent public URLs as the source of truth. A later OCR flow can use `POST /v1/scans` and `GET /v1/scans/:id` to track extraction. The current mock `extractReceipt` method should pass its result into the review form when this is integrated; it is currently discarded by the preview screen.

Use stable cursor pagination so new receipts do not cause duplicates or gaps while paging. Define common error responses for validation, unauthenticated requests, forbidden access, missing receipts, upload failures, and OCR failures. Never return another user's receipt merely because its ID is known.

## Implementation checklist

Work through Steps 2-8 for the personal-receipts app, then Step 12 for release operations. Steps 9-11 and budgets are post-release work unless the scope decision changes.

### Step 0: Backend scaffold — done

- [x] Create the sibling `receipt-manager-api` directory as an independent Git repository.
- [x] Add Node.js, TypeScript, Fastify, npm scripts, environment configuration, structured request logging, and `GET /health`.
- [x] Install dependencies, generate the lockfile, and verify the typecheck and initial tests. (No Git commit has been made yet.)

### Step 1: Decide first-release scope — done

- [x] Choose **personal-only** receipts or **households from day one**. First release is personal-only. Every receipt belongs to one authenticated user; only that user can read, edit, delete, or export it. There are no shared receipts or household memberships in the first-release schema or API.
- [x] Choose a sign-in method and provider: managed Supabase Auth with email one-time passcodes. The Expo app requests a code and exchanges it for a session. It sends the access token as `Authorization: Bearer <token>` to the API. The API verifies the token's signature against the Supabase project's JWKS (use asymmetric signing keys), and validates issuer, audience, expiry, and subject before resolving its local user record. The verified subject identifies the owner; client-supplied owner IDs are ignored. The frontend stores session tokens in SecureStore. No Supabase service-role key or JWT signing secret goes in the app.
- [x] Decide whether OCR, offline editing, export, and budgets are first-release requirements or later features. First release uses manual receipt entry and online editing. OCR, offline edits/sync, CSV/PDF export, budgets, and households are later features. The existing mock scan, sharing, export, and budget UI must be hidden or clearly marked unavailable in a release build until backed by working services.
- [x] Record these decisions here and adjust the later checklist if the scope changes. Steps 9-11 are post-release work; budgets have a separate follow-up item below. Step 8 is the working personal-receipts milestone, with Step 12 required for release.

### Step 2: Finish the backend foundation

- [x] Add linting and formatting, a CI check for typecheck/tests, and a simple deployment-ready health check.
- [x] Define the `/v1` OpenAPI contract and standard validation/error response shapes. Keep it in the backend repo.
- [x] Add documented environment variables and startup validation for future database, auth, and storage settings. Keep secrets on the server.
- [x] Make the first Git commit in the backend repo when the foundation is reviewable. An initial scaffold commit already exists (`2e21b14`); the Step 2 changes remain uncommitted for review.

### Step 3: PostgreSQL and migrations

- [x] Choose a TypeScript database query layer/ORM and migration tool. Kysely with `pg` and Kysely migrations.
- [x] Set up local PostgreSQL and document how to start it, apply migrations, and reset development data. See backend `compose.yaml` and `README.md`.
- [x] Create migrations for users, categories, and receipts. Keep households and memberships out of the first-release schema.
- [x] Choose an exact money format in PostgreSQL and on the API wire, validate currency codes, and add indexes for owner/date/filter queries. Use `numeric(18,2)` and decimal strings; EUR is seeded as the initial supported currency.
- [x] Seed the app's existing categories and add database tests for constraints and migrations. The database test runs in CI; local Docker must be running to run it here.

### Step 4: Authentication and authorization

Completed for the backend. Supabase access tokens are verified against the
project JWKS; `GET /v1/me` resolves a local user; and every current and future
`/v1` route requires authentication. Configure a Supabase project with email
OTP and an asymmetric signing key to exercise this against a real session. The
Expo OTP user interface is implemented in Step 7.

- [x] Verify Supabase access tokens using the project's asymmetric JWKS, including issuer, audience, expiry, and subject checks.
- [x] Add `GET /v1/me` and require authentication for every `/v1` route.
- [x] Test valid, missing, expired, malformed, and incorrectly signed sessions.
- [x] Resolve the authenticated user from the verified token; Step 5 enforces receipt ownership in every query and mutation.

### Step 5: Receipt API

- [x] Implement `GET /v1/categories` and receipt create/read/update/delete routes from the API table above. Scope every receipt query and mutation to the authenticated user; reject client-supplied owner IDs.
- [x] Validate merchant, date, category, currency, and amounts on the server; return consistent errors.
- [x] Implement search, month/category filters, sorting, limits, and stable cursor pagination. The first-release API returns only the authenticated user's receipts; defer ownership filters until sharing exists.
- [x] Test CRUD, filtering, pagination, and representative OpenAPI requests, including attempts to read, edit, or delete another user's receipt.

### Step 6: Private receipt images

- [x] Select private local file storage and implement `PUT /v1/receipts/:id/image` as the server upload flow. No cloud storage account or payment is needed.
- [x] Check image type and size, assign unique object keys, and keep the image directory private.
- [x] Save object keys in receipts; provide authorized image viewing access and cleanup on deletion.
- [x] Test upload and viewing permissions, invalid files, replacement, and deletion behavior.

### Step 7: Connect the Expo frontend

- [ ] Replace the demo login navigation with Supabase Auth email one-time passcodes; store native session tokens with SecureStore.
- [ ] Implement a typed HTTP `ReceiptService` using `EXPO_PUBLIC_API_URL`; keep the mock service available for UI work if useful.
- [ ] Connect receipt list, detail, create, edit, delete, categories, and image upload; handle loading, empty, and error states.
- [ ] Check the complete flow on a device/emulator, including app restart and a second user who must not see the first user's receipts.

### Step 8: Accurate spending summaries — working app milestone

- [ ] Implement `GET /v1/spending/summary` with month, category, and currency handling for the authenticated user's receipts.
- [ ] Replace the frontend's fixed-size receipt fetches used for totals with the summary API.
- [ ] Verify totals against more than 1,000 receipts and avoid adding different currencies together.
- [ ] Confirm the milestone: sign in, create a receipt with an image, list/filter, edit/delete, and see correct monthly totals after restart.

### Step 9: OCR — post-release

- [ ] Select an OCR provider and define scan job status, failures, and retry behavior.
- [ ] Add scan endpoints and persist only the data needed for review and troubleshooting.
- [ ] Pass extracted fields into the existing review form; save only after user confirmation.

### Step 10: Households and sharing — post-release

- [ ] Add household membership and invitation flows with explicit read/edit/delete permissions.
- [ ] Replace the current `ownership` flag with rules backed by household membership and test access changes when someone leaves.
- [ ] Define spending summaries and export permissions for personal versus shared receipts.

### Step 11: Offline sync and export — post-release

- [ ] Add a local queue with `pending`, `synced`, and `failed` states, retry rules, and conflict resolution for offline edits.
- [ ] Add CSV/PDF export with authenticated access and the chosen personal/household scope.
- [ ] Test reconnection, duplicate submissions, conflicts, and export completeness.

### Later: Budgets — post-release

- [ ] Define budget periods, currency rules, and whether budgets are personal or household-scoped before adding storage or API routes.
- [ ] Implement budget setup, progress calculation, and frontend states after the underlying spending summaries are accurate.

### Step 12: Release operations

- [ ] Choose hosting for the API, managed PostgreSQL, and object storage; set secrets and environment-specific configuration.
- [ ] Run migrations in the deployment process; configure backups, logs, monitoring, and restore instructions.
- [ ] Run end-to-end checks against a staging environment, then point a production frontend build at the production API.

## References

- [Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/) and [validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [PostgreSQL exact numeric types](https://www.postgresql.org/docs/16/datatype-numeric.html)
- [OpenAPI overview](https://www.openapis.org/what-is-openapi) and [GraphQL overview](https://graphql.org/)
- [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Expo authentication and secure token storage](https://docs.expo.dev/guides/authentication/)
