import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE scan_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      image_object_key text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      fields jsonb,
      error_code text,
      attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
      CONSTRAINT scan_jobs_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      CONSTRAINT scan_jobs_attempts CHECK (attempts >= 0 AND attempts <= 2)
    )
  `.execute(db);
  await sql`CREATE INDEX scan_jobs_owner_id_idx ON scan_jobs (owner_user_id, id)`.execute(
    db,
  );
  await sql`CREATE INDEX scan_jobs_pending_idx ON scan_jobs (created_at) WHERE status = 'pending'`.execute(
    db,
  );
  await sql`CREATE INDEX scan_jobs_expiry_idx ON scan_jobs (expires_at)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE scan_jobs`.execute(db);
}
