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

export type NormalizedEntry = {
  sourceRow: number;
  taxCode: string;
  amount: number;
  taxRate: 8 | 10;
  taxEquivalent: number;
  date: string | null;
  partner: string;
  description: string;
  mappingLabel: string;
  rateAssumed: boolean;
  taxAmountUsed: boolean;
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
  taxEquivalent: number;
  allocatedTax: number;
  afterCredit: number;
  registeredCredit: number;
  registeredBenefit: number;
};

export type CodeSummary = SupplierSummary & {
  code: string;
};

export type AnalysisResult = {
  sourceRowCount: number;
  targetEntries: NormalizedEntry[];
  ignoredRowCount: number;
  invalidTargetRowCount: number;
  assumedRateCount: number;
  taxAmountUsedCount: number;
  grossAmount: number;
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
  hasOneHundredMillionSupplier: boolean;
};
