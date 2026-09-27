import { sql, type Kysely } from "kysely";

// Stable UUIDs preserve the existing frontend category slugs for later mapping.
const categories = [
  ["00000000-0000-4000-8000-000000000001", "groceries", "Groceries", "#4E8B5E"],
  ["00000000-0000-4000-8000-000000000002", "fuel", "Fuel", "#D2803B"],
  [
    "00000000-0000-4000-8000-000000000003",
    "restaurants",
    "Restaurants",
    "#BA5B63",
  ],
  [
    "00000000-0000-4000-8000-000000000004",
    "transportation",
    "Transportation",
    "#6079BD",
  ],
  ["00000000-0000-4000-8000-000000000005", "shopping", "Shopping", "#A566A3"],
  [
    "00000000-0000-4000-8000-000000000006",
    "electronics",
    "Electronics",
    "#4F8D9D",
  ],
  [
    "00000000-0000-4000-8000-000000000007",
    "healthcare",
    "Healthcare",
    "#C95F79",
  ],
  [
    "00000000-0000-4000-8000-000000000008",
    "entertainment",
    "Entertainment",
    "#8564BF",
  ],
  ["00000000-0000-4000-8000-000000000009", "travel", "Travel", "#2E93A5"],
  ["00000000-0000-4000-8000-00000000000a", "utilities", "Utilities", "#9B7F51"],
  ["00000000-0000-4000-8000-00000000000b", "other", "Other", "#78827E"],
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const [id, slug, name, color] of categories) {
    await sql`INSERT INTO categories (id, slug, name, color) VALUES (${id}, ${slug}, ${name}, ${color})`.execute(
      db,
    );
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const [id] of categories) {
    await sql`DELETE FROM categories WHERE id = ${id}`.execute(db);
  }
}
