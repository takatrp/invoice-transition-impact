import type { AnalysisResult } from './types.ts';

export type ResultStatus = {
  label: string;
  isReference: boolean;
  assumedRateCount: number;
  missingDateExcludedCount: number;
  supplierLimitReason: 'period' | 'annualized' | null;
};

export function getResultStatus(
  result: AnalysisResult,
  options: {
    assumptionsComplete: boolean;
    isAnnualized: boolean;
    annualizationFactor?: number;
  },
): ResultStatus {
  const missingDateExcludedCount = options.isAnnualized
    ? result.periodExcludedEntries.filter(
        (entry) => entry.reason === 'date_missing_or_invalid',
      ).length
    : 0;
  const annualizationFactor =
    options.annualizationFactor !== undefined
    && Number.isFinite(options.annualizationFactor)
    && options.annualizationFactor > 0
      ? options.annualizationFactor
      : 1;
  const hasAnnualizedSupplierLimitRisk =
    options.isAnnualized
    && result.bySupplier.some(
      (supplier) =>
        supplier.partner !== '仕入先未取得'
        && supplier.grossPaymentAmount * annualizationFactor > 100_000_000,
    );
  const supplierLimitReason = result.hasOneHundredMillionSupplier
    ? 'period'
    : hasAnnualizedSupplierLimitRisk
      ? 'annualized'
      : null;

  let label = '確認済みの試算';
  if (result.invalidTargetRowCount > 0) {
    label = '一部除外した参考集計';
  } else if (supplierLimitReason) {
    label = '上限未反映の参考値';
  } else if (missingDateExcludedCount > 0) {
    label = `日付不明${missingDateExcludedCount}件を除外した参考値`;
  } else if (result.assumedRateCount > 0) {
    label = '税率を仮定した参考値';
  } else if (!options.assumptionsComplete) {
    label = '未確認事項のある参考値';
  }

  return {
    label,
    isReference:
      result.invalidTargetRowCount > 0
      || supplierLimitReason !== null
      || missingDateExcludedCount > 0
      || result.assumedRateCount > 0
      || !options.assumptionsComplete,
    assumedRateCount: result.assumedRateCount,
    missingDateExcludedCount,
    supplierLimitReason,
  };
}
