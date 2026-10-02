export interface ScanFields {
  merchant?: string;
  purchaseDate?: string;
  total?: string;
  currency?: string;
  subtotal?: string;
  tax?: string;
}

const amountPattern = /(?:\d{1,3}(?:[ ,.]\d{3})+|\d+)[,.]\d{2}/g;

function parseAmount(value: string): string | undefined {
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  const decimal = Math.max(comma, dot);
  if (decimal < 0) return undefined;
  const whole = value.slice(0, decimal).replace(/[,. ]/g, "");
  const cents = value.slice(decimal + 1);
  if (!/^\d{1,16}$/.test(whole) || !/^\d{2}$/.test(cents)) return undefined;
  return `${String(BigInt(whole))}.${cents}`;
}

function lastAmount(line: string): string | undefined {
  const values = [...line.matchAll(amountPattern)];
  return values.length ? parseAmount(values[values.length - 1]![0]) : undefined;
}

function dateFromLine(line: string): string | undefined {
  const match = /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/.exec(line);
  if (!match) return undefined;
  const date = `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : undefined;
}

export function extractScanFields(text: string): ScanFields {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fields: ScanFields = {};

  const merchant = lines
    .slice(0, 5)
    .find(
      (line) =>
        /[A-Za-zÀ-ÿ]{3}/.test(line) &&
        !/^(NIF|VAT|DATA|DATE|FATURA|INVOICE|RECIBO|RECEIPT|TOTAL|SUBTOTAL)\b/i.test(
          line,
        ) &&
        !dateFromLine(line),
    );
  if (merchant) fields.merchant = merchant.slice(0, 200);

  for (const line of lines) {
    if (!fields.purchaseDate) {
      const date = dateFromLine(line);
      if (date) fields.purchaseDate = date;
    }
    if (/\bEUR\b|€/i.test(line)) fields.currency = "EUR";
    const amount = lastAmount(line);
    if (!amount) continue;
    if (/\b(subtotal|sub-total|sub total|total s\/iva)\b/i.test(line)) {
      fields.subtotal = amount;
    } else if (/\b(iva|vat|tax)\b/i.test(line) && !/\ba pagar\b/i.test(line)) {
      fields.tax = amount;
    } else if (
      /\b(total(?:\s+a\s+pagar)?|a\s+pagar|amount\s+due|grand\s+total)\b/i.test(
        line,
      ) &&
      !/\b(troco|change|desconto|discount)\b/i.test(line)
    ) {
      fields.total = amount;
    }
  }
  return fields;
}
