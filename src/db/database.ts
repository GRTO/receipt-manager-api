import {
  Kysely,
  PostgresDialect,
  type ColumnType,
  type Generated,
} from "kysely";
import { Pool } from "pg";

type CreatedAt = ColumnType<Date, undefined, never>;
type UpdatedAt = ColumnType<Date, undefined, Date | undefined>;

export interface Database {
  users: {
    id: Generated<string>;
    auth_subject: string;
    email: string;
    preferred_currency: string;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
  };
  currencies: {
    code: string;
  };
  categories: {
    id: string;
    slug: string;
    name: string;
    color: string | null;
    icon: string | null;
    created_at: CreatedAt;
  };
  receipts: {
    id: Generated<string>;
    owner_user_id: string;
    merchant: string;
    purchase_date: ColumnType<Date, string, string>;
    total: string;
    currency: string;
    category_id: string;
    notes: string | null;
    subtotal: string | null;
    tax: string | null;
    image_object_key: string | null;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
  };
}

export function createDatabase(databaseUrl: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: databaseUrl }),
    }),
  });
}
