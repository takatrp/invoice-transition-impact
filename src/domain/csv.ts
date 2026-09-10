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

export type ParsedCsv = {
  rows: string[][];
  startLines: number[];
};

export function parseCsvWithMeta(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  const startLines: number[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let physicalLine = 1;
  let recordStartLine = 1;

  function pushRecord(): void {
    if (row.some((cell) => cell.trim() !== '')) {
      rows.push(row);
      startLines.push(recordStartLine);
    }
  }

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
        if (char === '\n') physicalLine += 1;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      pushRecord();
      row = [];
      field = '';
      physicalLine += 1;
      recordStartLine = physicalLine;
    } else {
      field += char;
    }
  }

  if (quoted) {
    throw new Error(`CSVの${recordStartLine}行目から始まるレコードの引用符が閉じられていません。元CSVを確認してください。`);
  }

  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    pushRecord();
  }

  return { rows, startLines };
}

export function parseCsv(text: string): string[][] {
  return parseCsvWithMeta(text).rows;
}

export function validateCsvRows(rows: string[][], startLines?: number[]): void {
  if (rows.length === 0) return;
  const expected = rows[0].length;
  const invalid = rows.slice(1).findIndex((row) => row.length !== expected);
  if (invalid >= 0) {
    const physicalLine = startLines?.[invalid + 1] ?? invalid + 2;
    throw new Error(`CSVの${physicalLine}行目から始まるレコードは列数が見出し行と一致しません。元CSVを確認してください。`);
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

function findExactHeader(headers: string[], aliases: readonly string[]): number | null {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  const exact = headers.map(normalizeHeader).findIndex((header) => normalizedAliases.has(header));
  return exact >= 0 ? exact : null;
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
  const genericPartnerIndex = genericIndex(headers, 'partner');
  const genericRateIndex = genericIndex(headers, 'taxRate');
  const genericTaxAmountIndex = genericIndex(headers, 'taxAmount');
  // In split debit/credit journals, only an exact generic header is shared.
  // A partial match such as 借方税率 must never be reused on the credit side.
  const sharedPartnerIndex = findExactHeader(headers, tkcContextPack.headerAliases.partner);
  const sharedRateIndex = findExactHeader(headers, tkcContextPack.headerAliases.taxRate);
  const sharedTaxAmountIndex = findExactHeader(headers, tkcContextPack.headerAliases.taxAmount);
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
        sharedPartnerIndex ?? findHeader(headers, split.debitPartner) ?? findHeader(headers, split.creditPartner),
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
        sharedPartnerIndex ?? findHeader(headers, split.creditPartner) ?? findHeader(headers, split.debitPartner),
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
      taxRateIndex: genericRateIndex,
      taxAmountIndex: genericTaxAmountIndex,
      partnerIndex: genericPartnerIndex,
      descriptionIndex,
      sign: 1,
    },
  ];
}

export async function readCsvFile(file: File): Promise<CsvData> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = detectCsvEncoding(bytes);
  const decoder = new TextDecoder(encoding === 'UTF-8' ? 'utf-8' : 'shift-jis');
  const parsed = parseCsvWithMeta(decoder.decode(bytes));
  if (parsed.rows.length < 2) {
    throw new Error('見出し行と1件以上の仕訳データがあるCSVを選んでください。');
  }
  validateCsvRows(parsed.rows, parsed.startLines);

  return {
    fileName: file.name,
    encoding,
    headers: parsed.rows[0].map((header) => header.replace(/^\uFEFF/, '').trim()),
    rows: parsed.rows.slice(1),
    rowStartLines: parsed.startLines.slice(1),
  };
}
