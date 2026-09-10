import { tkcContextPack } from '../contextPacks/tkc.ts';
import type {
  AnalysisPeriod,
  AnalysisResult,
  AnalysisSettings,
  CsvData,
  EntryMapping,
  InvalidTargetEntry,
  NormalizedEntry,
  PeriodExcludedEntry,
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
):
  | { kind: 'ignored' }
  | { kind: 'invalid'; issue: InvalidTargetEntry }
  | { kind: 'valid'; entry: NormalizedEntry } {
  const rawCode = valueAt(row, mapping.taxCodeIndex);
  const taxCode = normalizeTaxCode(rawCode);
  if (!taxCode || !targetCodes.has(taxCode)) return { kind: 'ignored' };

  const rawAmountValue = valueAt(row, mapping.amountIndex);
  const rawAmount = parseSignedAmount(rawAmountValue);
  const rawDate = valueAt(row, mapping.dateIndex);
  const partner = valueAt(row, mapping.partnerIndex) || '仕入先未取得';
  const description = valueAt(row, mapping.descriptionIndex);
  if (rawAmount === null) {
    return {
      kind: 'invalid',
      issue: {
        sourceRow: rowIndex + 2,
        taxCode,
        rawAmount: rawAmountValue,
        rawDate,
        date: normalizeDate(rawDate),
        partner,
        description,
        mappingLabel: mapping.label,
        reason: rawAmountValue.trim() ? 'amount_invalid' : 'amount_missing',
      },
    };
  }
  const amount = rawAmount * mapping.sign;
  const parsedRate = parseTaxRate(valueAt(row, mapping.taxRateIndex));
  const taxRate = parsedRate ?? settings.defaultTaxRate;
  const rawTaxAmount = parseSignedAmount(valueAt(row, mapping.taxAmountIndex));
  const csvTaxAmount = rawTaxAmount !== null && rawTaxAmount !== 0
    ? Math.abs(rawTaxAmount) * Math.sign(amount || mapping.sign)
    : null;
  const taxEquivalent = taxFromAmount(amount, taxRate, settings.amountMode);

  return {
    kind: 'valid',
    entry: {
      sourceRow: rowIndex + 2,
      taxCode,
      amount,
      taxRate,
      taxEquivalent,
      date: normalizeDate(rawDate),
      partner,
      description,
      mappingLabel: mapping.label,
      rateAssumed: parsedRate === null,
      csvTaxAmount,
      taxEquivalentSource: 'amount_and_rate',
    },
  };
}

function emptySupplier(partner: string): SupplierSummary {
  return {
    partner,
    transactionCount: 0,
    grossAmount: 0,
    taxEquivalent: 0,
    allocatedTax: 0,
    beforeCredit: 0,
    afterCredit: 0,
    registeredCredit: 0,
    transitionImpact: 0,
    registeredBenefit: 0,
  };
}

function isWithinPeriod(date: string, period: AnalysisPeriod): boolean {
  return date >= period.start && date <= period.end;
}

export function analyzeCsv(
  csv: CsvData,
  mappings: EntryMapping[],
  settings: AnalysisSettings,
  period: AnalysisPeriod | null = null,
): AnalysisResult {
  const targetEntries: NormalizedEntry[] = [];
  const invalidTargetEntries: InvalidTargetEntry[] = [];
  const periodExcludedEntries: PeriodExcludedEntry[] = [];
  const rowHasTarget = new Set<number>();
  let detectedTargetCount = 0;

  csv.rows.forEach((row, rowIndex) => {
    mappings.forEach((mapping) => {
      const built = buildEntry(row, rowIndex, mapping, settings);
      if (built.kind === 'invalid') {
        detectedTargetCount += 1;
        invalidTargetEntries.push(built.issue);
        rowHasTarget.add(rowIndex);
      } else if (built.kind === 'valid') {
        detectedTargetCount += 1;
        rowHasTarget.add(rowIndex);
        if (period && !built.entry.date) {
          periodExcludedEntries.push({
            sourceRow: built.entry.sourceRow,
            taxCode: built.entry.taxCode,
            date: null,
            mappingLabel: built.entry.mappingLabel,
            reason: 'date_missing_or_invalid',
          });
        } else if (period && !isWithinPeriod(built.entry.date as string, period)) {
          periodExcludedEntries.push({
            sourceRow: built.entry.sourceRow,
            taxCode: built.entry.taxCode,
            date: built.entry.date,
            mappingLabel: built.entry.mappingLabel,
            reason: 'outside_period',
          });
        } else {
          targetEntries.push(built.entry);
        }
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
    supplier.beforeCredit += before;
    supplier.afterCredit += after;
    supplier.registeredCredit += registered;
    supplier.transitionImpact = supplier.beforeCredit - supplier.afterCredit;
    supplier.registeredBenefit = supplier.registeredCredit - supplier.afterCredit;
    bySupplierMap.set(entry.partner, supplier);

    const code = byCodeMap.get(entry.taxCode) ?? emptySupplier(entry.taxCode);
    code.transactionCount += 1;
    code.grossAmount += entry.amount;
    code.taxEquivalent += entry.taxEquivalent;
    code.allocatedTax += allocated;
    code.beforeCredit += before;
    code.afterCredit += after;
    code.registeredCredit += registered;
    code.transitionImpact = code.beforeCredit - code.afterCredit;
    code.registeredBenefit = code.registeredCredit - code.afterCredit;
    byCodeMap.set(entry.taxCode, code);
  });

  const dates = targetEntries
    .map((entry) => entry.date)
    .filter((date): date is string => date !== null)
    .sort();
  const sourceDateValues = csv.rows.map((row) => {
    const dateIndex = mappings.find((mapping) => mapping.dateIndex !== null)?.dateIndex ?? null;
    const rawDate = valueAt(row, dateIndex);
    return { rawDate, date: normalizeDate(rawDate) };
  });
  const sourceDates = sourceDateValues
    .map(({ date }) => date)
    .filter((date): date is string => date !== null)
    .sort();
  const bySupplier = [...bySupplierMap.values()].sort(
    (left, right) => right.registeredBenefit - left.registeredBenefit,
  );

  return {
    sourceRowCount: csv.rows.length,
    detectedTargetCount,
    targetEntries,
    invalidTargetEntries,
    periodExcludedEntries,
    ignoredRowCount: csv.rows.length - rowHasTarget.size,
    invalidTargetRowCount: invalidTargetEntries.length,
    assumedRateCount: targetEntries.filter((entry) => entry.rateAssumed).length,
    csvTaxAmountCount: targetEntries.filter((entry) => entry.csvTaxAmount !== null).length,
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
    sourceDateUnreadableRowCount: sourceDateValues.filter(
      ({ rawDate, date }) => rawDate !== '' && date === null,
    ).length,
    analysisPeriod: period,
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
