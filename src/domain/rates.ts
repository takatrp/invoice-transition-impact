import type { RatePreset } from './types.ts';

export const transitionRateOptions: ReadonlyArray<{
  value: RatePreset;
  label: string;
  shortLabel: string;
}> = [
  { value: 1, label: '100％（登録事業者と同等）', shortLabel: '100％' },
  { value: 0.8, label: '80％（2026年9月まで）', shortLabel: '80％' },
  { value: 0.7, label: '70％（2026年10月～2028年9月）', shortLabel: '70％' },
  { value: 0.5, label: '50％（2028年10月～2030年9月）', shortLabel: '50％' },
  { value: 0.3, label: '30％（2030年10月～2031年9月）', shortLabel: '30％' },
  { value: 0, label: '0％（2031年10月以後）', shortLabel: '0％' },
];

export function rateLabel(value: RatePreset): string {
  return transitionRateOptions.find((option) => option.value === value)?.shortLabel ?? `${value * 100}％`;
}
