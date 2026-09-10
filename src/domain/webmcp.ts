import type { AnalysisSettings, CalculationMethod, RatePreset } from './types.ts';

type ToolDefinition = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute(input: unknown): unknown;
};

type ModelContext = {
  registerTool(
    tool: ToolDefinition,
    options?: { signal?: AbortSignal },
  ): void | Promise<void>;
};

declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }
}

const allowedRates = new Set([1, 0.8, 0.7, 0.5, 0.3, 0]);
const allowedMethods = new Set<CalculationMethod>([
  'full',
  'individual',
  'proportional',
  'simplified',
]);

export function registerInvoiceComparisonTool(
  setSettings: (updater: (current: AnalysisSettings) => AnalysisSettings) => void,
): () => void {
  const context = typeof document === 'undefined' ? undefined : document.modelContext;
  if (!context?.registerTool) return () => undefined;
  const lifecycle = new AbortController();

  const tool: ToolDefinition = {
    name: 'configure_invoice_comparison',
    title: 'インボイス経過措置の比較条件を設定',
    description:
      '画面のBefore・After控除割合、仕入控除税額の計算方法、課税売上割合をまとめて変更します。CSVはアップロードしません。',
    inputSchema: {
      type: 'object',
      properties: {
        beforeRate: { type: 'number', enum: [1, 0.8, 0.7, 0.5, 0.3, 0] },
        afterRate: { type: 'number', enum: [1, 0.8, 0.7, 0.5, 0.3, 0] },
        calculationMethod: {
          type: 'string',
          enum: ['full', 'individual', 'proportional', 'simplified'],
        },
        taxableSalesRatioPercent: { type: 'number', minimum: 0, maximum: 100 },
      },
      required: ['beforeRate', 'afterRate', 'calculationMethod'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('比較条件はオブジェクトで指定してください。');
      }
      const values = input as Record<string, unknown>;
      const beforeRate = Number(values.beforeRate);
      const afterRate = Number(values.afterRate);
      const method = values.calculationMethod;
      const ratioValue = values.taxableSalesRatioPercent;
      if (!allowedRates.has(beforeRate) || !allowedRates.has(afterRate)) {
        throw new Error('控除割合は画面で選択できる値から指定してください。');
      }
      if (typeof method !== 'string' || !allowedMethods.has(method as CalculationMethod)) {
        throw new Error('計算方法が不正です。');
      }
      if (
        ratioValue !== undefined &&
        (typeof ratioValue !== 'number' || ratioValue < 0 || ratioValue > 100)
      ) {
        throw new Error('課税売上割合は0から100までで指定してください。');
      }
      const taxableSalesRatio = ratioValue === undefined ? undefined : ratioValue / 100;
      setSettings((current) => ({
        ...current,
        beforeRate: beforeRate as RatePreset,
        afterRate: afterRate as RatePreset,
        calculationMethod: method as CalculationMethod,
        taxableSalesRatio: taxableSalesRatio ?? current.taxableSalesRatio,
      }));
      return {
        status: 'configured',
        beforeRate,
        afterRate,
        calculationMethod: method,
        taxableSalesRatioPercent:
          taxableSalesRatio === undefined ? null : taxableSalesRatio * 100,
      };
    },
  };

  try {
    void Promise.resolve(
      context.registerTool(tool, { signal: lifecycle.signal }),
    ).catch(() => undefined);
  } catch {
    lifecycle.abort();
    return () => undefined;
  }

  return () => lifecycle.abort();
}
