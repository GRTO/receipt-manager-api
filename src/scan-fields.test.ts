import assert from "node:assert/strict";
import { test } from "node:test";

import { extractScanFields } from "./scan-fields.js";

test("extracts Portuguese receipt suggestions without treating tax as total", () => {
  assert.deepEqual(
    extractScanFields(
      `Mercado da Vila\nNIF 123456789\nData 02/10/2026\nSubtotal 1.234,00 €\nIVA 283,82 €\nTOTAL A PAGAR 1.517,82 €`,
    ),
    {
      merchant: "Mercado da Vila",
      purchaseDate: "2026-10-02",
      subtotal: "1234.00",
      tax: "283.82",
      total: "1517.82",
      currency: "EUR",
    },
  );
});

test("omits uncertain fields and rejects invalid dates", () => {
  assert.deepEqual(extractScanFields("Shop\nDate 31/02/2026\nItem 12.50"), {
    merchant: "Shop",
  });
});

test("reads an English total with decimal point", () => {
  assert.deepEqual(
    extractScanFields("Corner Store\nGrand Total 1,234.56 EUR"),
    {
      merchant: "Corner Store",
      total: "1234.56",
      currency: "EUR",
    },
  );
});

test("keeps total when a later line reports total tax", () => {
  assert.deepEqual(extractScanFields("Loja\nTOTAL 12,50 €\nTOTAL IVA 2,34 €"), {
    merchant: "Loja",
    total: "12.50",
    tax: "2.34",
    currency: "EUR",
  });
});
