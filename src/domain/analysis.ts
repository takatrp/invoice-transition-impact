import { tkcContextPack } from '../contextPacks/tkc.ts';
import type {
  AnalysisResult,
  AnalysisSettings,
  CsvData,
  EntryMapping,
  NormalizedEntry,
  SupplierSummary,
} from './types.ts';

const targetCodes = new Set<string>(tkcContextPack.affectedTaxCodes);

export function parseSignedAmount(value: string): number | null {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/[￥¥,，円\s]/g, '')
    .replace(/^\((.+)\)$/, '-$1')
    .replace(/[△▲]/g, '-');
  if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeTaxCode(value: string): string | null {
  const normalized = String(value ?? '').normalize('NFKC').trim();
  const exact = normalized.match(/^(52|62|72)$/);
  if (exact) return exact[1];
  const embedded = normalized.match(/(?:^|\D)(52|62|72)(?:\D|$)/);
  return embedded ? embedded[1] : null;
}

export function parseTaxRate(value: string): 8 | 10 | null {
  const normalized = String(value ?? '').normalize('NFKC');
  if (/軽減/.test(normalized) || /(?:^|\D)8(?:\.0+)?\s*%?(?:\D|$)/.test(normalized)) return 8;
  if (/標準/.test(normalized) || /(?:^|\D)10(?:\.0+)?\s*%?(?:\D|$)/.test(normalized)) return 10;
  return null;
}

export function normalizeDate(value: string): string | null {
  const normalized = String(value ?? '').normalize('NFKC').trim();
  let parts: number[] | null = null;
  const delimited = normalized.match(/^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?/);
  if (delimited) parts = delimited.slice(1).map(Number);
  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!parts && compact) parts = compact.slice(1).map(Number);
  if (!parts) return null;
  const [year, month, day] = parts;
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

export function taxFromAmount(
  amount: number,
  rate: 8 | 10,
  amountMode: AnalysisSettings['amountMode'],
): number {
  return amountMode === 'excluded'
    ? amount * (rate / 100)
    : amount * (rate / (100 + rate));
}

export function allocationFactor(
  taxCode: string,
  method: AnalysisSettings['calculationMethod'],
  taxableSalesRatio: number,
): number {
  const ratio = Math.min(1, Math.max(0, taxableSalesRatio));
  if (method === 'simplified') return 0;
  if (method === 'full') return 1;
  if (method === 'proportional') return ratio;
  if (taxCode === '52') return 1;
  if (taxCode === '62') return 0;
  return ratio;
}

function valueAt(row: string[], index: number | null): string {
  return index === null ? '' : String(row[index] ?? '').trim();
}

function buildEntry(
  row: string[],
  rowIndex: number,
  mapping: EntryMapping,
  settings: AnalysisSettings,
): NormalizedEntry | null | 'invalid' {
  const rawCode = valueAt(row, mapping.taxCodeIndex);
  const taxCode = normalizeTaxCode(rawCode);
  if (!taxCode || !targetCodes.has(taxCode)) return null;

  const rawAmount = parseSignedAmount(valueAt(row, mapping.amountIndex));
  if (rawAmount === null) return 'invalid';
  const amount = rawAmount * mapping.sign;
  const parsedRate = parseTaxRate(valueAt(row, mapping.taxRateIndex));
  const taxRate = parsedRate ?? settings.defaultTaxRate;
  const rawTaxAmount = parseSignedAmount(valueAt(row, mapping.taxAmountIndex));
  const taxAmountUsed = rawTaxAmount !== null && rawTaxAmount !== 0;
  const taxEquivalent = taxAmountUsed
    ? Math.abs(rawTaxAmount) * Math.sign(amount || mapping.sign)
    : taxFromAmount(amount, taxRate, settings.amountMode);

  const partner = valueAt(row, mapping.partnerIndex) || '仕入先未取得';
  return {
    sourceRow: rowIndex + 2,
    taxCode,
    amount,
    taxRate,
    taxEquivalent,
    date: normalizeDate(valueAt(row, mapping.dateIndex)),
    partner,
    description: valueAt(row, mapping.descriptionIndex),
    mappingLabel: mapping.label,
    rateAssumed: parsedRate === null && !taxAmountUsed,
    taxAmountUsed,
  };
}

function emptySupplier(partner: string): SupplierSummary {
  return {
    partner,
    transactionCount: 0,
    grossAmount: 0,
    taxEquivalent: 0,
    allocatedTax: 0,
    afterCredit: 0,
    registeredCredit: 0,
    registeredBenefit: 0,
  };
}

export function analyzeCsv(
  csv: CsvData,
  mappings: EntryMapping[],
  settings: AnalysisSettings,
): AnalysisResult {
  const targetEntries: NormalizedEntry[] = [];
  let invalidTargetRowCount = 0;
  const rowHasTarget = new Set<number>();

  csv.rows.forEach((row, rowIndex) => {
    mappings.forEach((mapping) => {
      const entry = buildEntry(row, rowIndex, mapping, settings);
      if (entry === 'invalid') {
        invalidTargetRowCount += 1;
        rowHasTarget.add(rowIndex);
      } else if (entry) {
        targetEntries.push(entry);
        rowHasTarget.add(rowIndex);
      }
    });
  });

  const bySupplierMap = new Map<string, SupplierSummary>();
  const byCodeMap = new Map<string, SupplierSummary>();
  let grossAmount = 0;
  let taxEquivalent = 0;
  let allocatedTax = 0;
  let beforeCredit = 0;
  let afterCredit = 0;
  let registeredCredit = 0;

  targetEntries.forEach((entry) => {
    const factor = allocationFactor(
      entry.taxCode,
      settings.calculationMethod,
      settings.taxableSalesRatio,
    );
    const allocated = entry.taxEquivalent * factor;
    const before = allocated * settings.beforeRate;
    const after = allocated * settings.afterRate;
    const registered = allocated;
    grossAmount += entry.amount;
    taxEquivalent += entry.taxEquivalent;
    allocatedTax += allocated;
    beforeCredit += before;
    afterCredit += after;
    registeredCredit += registered;

    const supplier = bySupplierMap.get(entry.partner) ?? emptySupplier(entry.partner);
    supplier.transactionCount += 1;
    supplier.grossAmount += entry.amount;
    supplier.taxEquivalent += entry.taxEquivalent;
    supplier.allocatedTax += allocated;
    supplier.afterCredit += after;
    supplier.registeredCredit += registered;
    supplier.registeredBenefit = supplier.registeredCredit - supplier.afterCredit;
    bySupplierMap.set(entry.partner, supplier);

    const code = byCodeMap.get(entry.taxCode) ?? emptySupplier(entry.taxCode);
    code.transactionCount += 1;
    code.grossAmount += entry.amount;
    code.taxEquivalent += entry.taxEquivalent;
    code.allocatedTax += allocated;
    code.afterCredit += after;
    code.registeredCredit += registered;
    code.registeredBenefit = code.registeredCredit - code.afterCredit;
    byCodeMap.set(entry.taxCode, code);
  });

  const dates = targetEntries
    .map((entry) => entry.date)
    .filter((date): date is string => date !== null)
    .sort();
  const sourceDates = csv.rows
    .flatMap((row) =>
      mappings.map((mapping) => normalizeDate(valueAt(row, mapping.dateIndex))),
    )
    .filter((date): date is string => date !== null)
    .sort();
  const bySupplier = [...bySupplierMap.values()].sort(
    (left, right) => right.registeredBenefit - left.registeredBenefit,
  );

  return {
    sourceRowCount: csv.rows.length,
    targetEntries,
    ignoredRowCount: csv.rows.length - rowHasTarget.size,
    invalidTargetRowCount,
    assumedRateCount: targetEntries.filter((entry) => entry.rateAssumed).length,
    taxAmountUsedCount: targetEntries.filter((entry) => entry.taxAmountUsed).length,
    grossAmount,
    taxEquivalent,
    allocatedTax,
    beforeCredit,
    afterCredit,
    registeredCredit,
    transitionImpact: beforeCredit - afterCredit,
    registeredBenefit: registeredCredit - afterCredit,
    bySupplier,
    byCode: [...byCodeMap.entries()]
      .map(([code, summary]) => ({ ...summary, code }))
      .sort((left, right) => left.code.localeCompare(right.code)),
    dateMin: dates.at(0) ?? null,
    dateMax: dates.at(-1) ?? null,
    sourceDateMin: sourceDates.at(0) ?? null,
    sourceDateMax: sourceDates.at(-1) ?? null,
    hasOneHundredMillionSupplier: bySupplier.some(
      (supplier) => supplier.partner !== '仕入先未取得' && supplier.grossAmount > 100_000_000,
    ),
  };
}

export function formatYen(value: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function spanDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}
