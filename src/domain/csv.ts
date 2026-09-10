import { tkcContextPack } from '../contextPacks/tkc.ts';
import type { CsvData, CsvEncoding, EntryMapping } from './types.ts';

export function detectCsvEncoding(bytes: Uint8Array): CsvEncoding {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return 'UTF-8';
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'UTF-8';
  } catch {
    return 'Shift-JIS';
  }
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) {
    throw new Error('CSVの引用符が閉じられていません。元CSVを確認してください。');
  }

  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

export function validateCsvRows(rows: string[][]): void {
  if (rows.length === 0) return;
  const expected = rows[0].length;
  const invalid = rows.slice(1).findIndex((row) => row.length !== expected);
  if (invalid >= 0) {
    throw new Error(`CSVの${invalid + 2}行目は列数が見出し行と一致しません。元CSVを確認してください。`);
  }
}

export function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '');
}

export function isTkcJournalFormat(headers: string[]): boolean {
  const normalizedHeaders = new Set(headers.map(normalizeHeader));
  return tkcContextPack.journalFormatMarkers.every((aliases) =>
    aliases.some((alias) => normalizedHeaders.has(normalizeHeader(alias))),
  );
}

function findHeader(headers: string[], aliases: readonly string[]): number | null {
  const normalized = headers.map(normalizeHeader);
  const exact = normalized.findIndex((header) =>
    aliases.some((alias) => header === normalizeHeader(alias)),
  );
  if (exact >= 0) return exact;
  const partial = normalized.findIndex((header) =>
    aliases.some((alias) => header.includes(normalizeHeader(alias))),
  );
  return partial >= 0 ? partial : null;
}

function genericIndex(
  headers: string[],
  key: keyof typeof tkcContextPack.headerAliases,
): number | null {
  return findHeader(headers, tkcContextPack.headerAliases[key]);
}

export function inferMappings(headers: string[]): EntryMapping[] {
  const dateIndex = genericIndex(headers, 'date');
  const descriptionIndex = genericIndex(headers, 'description');
  const sharedPartnerIndex = genericIndex(headers, 'partner');
  const sharedRateIndex = genericIndex(headers, 'taxRate');
  const sharedTaxAmountIndex = genericIndex(headers, 'taxAmount');
  const split = tkcContextPack.splitHeaders;

  const debitTaxCode = findHeader(headers, split.debitTaxCode);
  const debitAmount = findHeader(headers, split.debitAmount);
  const creditTaxCode = findHeader(headers, split.creditTaxCode);
  const creditAmount = findHeader(headers, split.creditAmount);

  const mappings: EntryMapping[] = [];
  if (debitTaxCode !== null && debitAmount !== null) {
    mappings.push({
      label: '借方',
      taxCodeIndex: debitTaxCode,
      amountIndex: debitAmount,
      dateIndex,
      taxRateIndex: findHeader(headers, split.debitTaxRate) ?? sharedRateIndex,
      taxAmountIndex:
        findHeader(headers, split.debitTaxAmount) ?? sharedTaxAmountIndex,
      partnerIndex:
        sharedPartnerIndex ?? findHeader(headers, split.creditPartner) ?? findHeader(headers, split.debitPartner),
      descriptionIndex,
      sign: 1,
    });
  }
  if (creditTaxCode !== null && creditAmount !== null) {
    mappings.push({
      label: '貸方',
      taxCodeIndex: creditTaxCode,
      amountIndex: creditAmount,
      dateIndex,
      taxRateIndex: findHeader(headers, split.creditTaxRate) ?? sharedRateIndex,
      taxAmountIndex:
        findHeader(headers, split.creditTaxAmount) ?? sharedTaxAmountIndex,
      partnerIndex:
        sharedPartnerIndex ?? findHeader(headers, split.debitPartner) ?? findHeader(headers, split.creditPartner),
      descriptionIndex,
      sign: -1,
    });
  }
  if (mappings.length > 0) return mappings;

  return [
    {
      label: '共通',
      taxCodeIndex: genericIndex(headers, 'taxCode'),
      amountIndex: genericIndex(headers, 'amount'),
      dateIndex,
      taxRateIndex: sharedRateIndex,
      taxAmountIndex: sharedTaxAmountIndex,
      partnerIndex: sharedPartnerIndex,
      descriptionIndex,
      sign: 1,
    },
  ];
}

export async function readCsvFile(file: File): Promise<CsvData> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = detectCsvEncoding(bytes);
  const decoder = new TextDecoder(encoding === 'UTF-8' ? 'utf-8' : 'shift-jis');
  const parsed = parseCsv(decoder.decode(bytes));
  if (parsed.length < 2) {
    throw new Error('見出し行と1件以上の仕訳データがあるCSVを選んでください。');
  }
  validateCsvRows(parsed);

  return {
    fileName: file.name,
    encoding,
    headers: parsed[0].map((header) => header.replace(/^\uFEFF/, '').trim()),
    rows: parsed.slice(1),
  };
}
