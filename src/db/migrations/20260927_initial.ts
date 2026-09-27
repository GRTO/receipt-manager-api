import { sql, type Kysely } from "kysely";

// Keep migrations independent of the application's current Database interface.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE currencies (
      code varchar(3) PRIMARY KEY,
      CONSTRAINT currencies_code_format CHECK (code ~ '^[A-Z]{3}$')
    )
  `.execute(db);
  await sql`INSERT INTO currencies (code) VALUES ('EUR')`.execute(db);

  await sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      auth_subject uuid NOT NULL UNIQUE,
      email varchar(320) NOT NULL,
      preferred_currency varchar(3) NOT NULL DEFAULT 'EUR' REFERENCES currencies(code),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT users_email_nonempty CHECK (length(trim(email)) > 0)
    )
  `.execute(db);

  await sql`
    CREATE TABLE categories (
      id uuid PRIMARY KEY,
      slug varchar(50) NOT NULL UNIQUE,
      name varchar(100) NOT NULL,
      color varchar(7),
      icon varchar(100),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z][a-z0-9-]*$'),
      CONSTRAINT categories_name_nonempty CHECK (length(trim(name)) > 0),
      CONSTRAINT categories_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
    )
  `.execute(db);

  await sql`
    CREATE TABLE receipts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      merchant varchar(200) NOT NULL,
      purchase_date date NOT NULL,
      total numeric(18,2) NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'EUR' REFERENCES currencies(code),
      category_id uuid NOT NULL REFERENCES categories(id),
      notes varchar(2000),
      subtotal numeric(18,2),
      tax numeric(18,2),
      image_object_key text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT receipts_merchant_nonempty CHECK (length(trim(merchant)) > 0),
      CONSTRAINT receipts_total_nonnegative CHECK (total >= 0),
      CONSTRAINT receipts_subtotal_nonnegative CHECK (subtotal IS NULL OR subtotal >= 0),
      CONSTRAINT receipts_tax_nonnegative CHECK (tax IS NULL OR tax >= 0),
      CONSTRAINT receipts_image_key_nonempty CHECK (image_object_key IS NULL OR length(trim(image_object_key)) > 0)
    )
  `.execute(db);

  await sql`CREATE INDEX receipts_owner_date_id_idx ON receipts (owner_user_id, purchase_date DESC, id DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX receipts_owner_category_date_id_idx ON receipts (owner_user_id, category_id, purchase_date DESC, id DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX receipts_owner_currency_date_idx ON receipts (owner_user_id, currency, purchase_date)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE receipts`.execute(db);
  await sql`DROP TABLE categories`.execute(db);
  await sql`DROP TABLE users`.execute(db);
  await sql`DROP TABLE currencies`.execute(db);
}
