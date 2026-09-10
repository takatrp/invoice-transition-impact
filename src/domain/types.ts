export type CsvEncoding = 'UTF-8' | 'Shift-JIS';

export type AmountMode = 'included' | 'excluded';

export type CalculationMethod =
  | 'full'
  | 'individual'
  | 'proportional'
  | 'simplified';

export type RatePreset = 1 | 0.8 | 0.7 | 0.5 | 0.3 | 0;

export type CsvData = {
  fileName: string;
  encoding: CsvEncoding;
  headers: string[];
  rows: string[][];
  /** Each data record's one-based starting physical line in the source CSV. */
  rowStartLines?: number[];
};

export type EntryMapping = {
  label: string;
  taxCodeIndex: number | null;
  amountIndex: number | null;
  dateIndex: number | null;
  taxRateIndex: number | null;
  taxAmountIndex: number | null;
  partnerIndex: number | null;
  descriptionIndex: number | null;
  sign: 1 | -1;
};

export type InvalidTargetReason = 'amount_missing' | 'amount_invalid';

export type InvalidTargetEntry = {
  sourceRow: number;
  sourceRecord: number;
  taxCode: string;
  rawAmount: string;
  rawDate: string;
  date: string | null;
  partner: string;
  description: string;
  mappingLabel: string;
  reason: InvalidTargetReason;
};

export type PeriodExcludedEntry = {
  sourceRow: number;
  sourceRecord: number;
  taxCode: string;
  date: string | null;
  mappingLabel: string;
  reason: 'date_missing_or_invalid' | 'outside_period';
};

export type AnalysisPeriod = {
  start: string;
  end: string;
};

export type NormalizedEntry = {
  sourceRow: number;
  sourceRecord: number;
  taxCode: string;
  amount: number;
  grossPaymentAmount: number;
  taxRate: 8 | 10;
  taxEquivalent: number;
  date: string | null;
  partner: string;
  description: string;
  mappingLabel: string;
  rateAssumed: boolean;
  csvTaxAmount: number | null;
  taxEquivalentSource: 'amount_and_rate';
};

export type AnalysisSettings = {
  beforeRate: RatePreset;
  afterRate: RatePreset;
  amountMode: AmountMode;
  defaultTaxRate: 8 | 10;
  calculationMethod: CalculationMethod;
  taxableSalesRatio: number;
};

export type SupplierSummary = {
  partner: string;
  transactionCount: number;
  grossAmount: number;
  grossPaymentAmount: number;
  taxEquivalent: number;
  allocatedTax: number;
  beforeCredit: number;
  afterCredit: number;
  registeredCredit: number;
  transitionImpact: number;
  registeredBenefit: number;
};

export type CodeSummary = SupplierSummary & {
  code: string;
};

export type AnalysisResult = {
  sourceRowCount: number;
  detectedTargetCount: number;
  targetEntries: NormalizedEntry[];
  invalidTargetEntries: InvalidTargetEntry[];
  periodExcludedEntries: PeriodExcludedEntry[];
  ignoredRowCount: number;
  invalidTargetRowCount: number;
  assumedRateCount: number;
  csvTaxAmountCount: number;
  grossAmount: number;
  grossPaymentAmount: number;
  taxEquivalent: number;
  allocatedTax: number;
  beforeCredit: number;
  afterCredit: number;
  registeredCredit: number;
  transitionImpact: number;
  registeredBenefit: number;
  bySupplier: SupplierSummary[];
  byCode: CodeSummary[];
  dateMin: string | null;
  dateMax: string | null;
  sourceDateMin: string | null;
  sourceDateMax: string | null;
  sourceDateUnreadableRowCount: number;
  analysisPeriod: AnalysisPeriod | null;
  hasOneHundredMillionSupplier: boolean;
};
