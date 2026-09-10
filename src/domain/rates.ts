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

export type TransitionStage = {
  currentRate: RatePreset;
  currentEndsOn: string | null;
  nextRate: RatePreset | null;
  nextStartsOn: string | null;
};

const transitionStages: ReadonlyArray<{
  startsOn: string;
  endsOn: string | null;
  rate: RatePreset;
}> = [
  { startsOn: '2023-10-01', endsOn: '2026-09-30', rate: 0.8 },
  { startsOn: '2026-10-01', endsOn: '2028-09-30', rate: 0.7 },
  { startsOn: '2028-10-01', endsOn: '2030-09-30', rate: 0.5 },
  { startsOn: '2030-10-01', endsOn: '2031-09-30', rate: 0.3 },
  { startsOn: '2031-10-01', endsOn: null, rate: 0 },
];

export function getTransitionStage(referenceDate: string): TransitionStage {
  const index = transitionStages.findIndex(
    (stage) => referenceDate >= stage.startsOn && (!stage.endsOn || referenceDate <= stage.endsOn),
  );
  const safeIndex = index >= 0 ? index : 0;
  const current = transitionStages[safeIndex];
  const next = transitionStages[safeIndex + 1] ?? null;
  return {
    currentRate: current.rate,
    currentEndsOn: current.endsOn,
    nextRate: next?.rate ?? null,
    nextStartsOn: next?.startsOn ?? null,
  };
}

export function classifyImpact(value: number): 'increase' | 'decrease' | 'none' {
  if (Math.abs(value) < 0.5) return 'none';
  return value > 0 ? 'increase' : 'decrease';
}
