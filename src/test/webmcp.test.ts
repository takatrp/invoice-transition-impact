import assert from 'node:assert/strict';
import test from 'node:test';

import { registerInvoiceComparisonTool } from '../domain/webmcp.ts';
import type { AnalysisSettings } from '../domain/types.ts';

void test('WebMCPで計算方法を設定したとき確認済み状態を解除する', () => {
  let executeTool: ((input: unknown) => unknown) | null = null;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      modelContext: {
        registerTool(tool: { execute(input: unknown): unknown }) {
          executeTool = tool.execute;
        },
      },
    },
  });

  let settings: AnalysisSettings = {
    beforeRate: 0.8,
    afterRate: 0.7,
    amountMode: 'included',
    defaultTaxRate: 10,
    calculationMethod: 'full',
    taxableSalesRatio: 1,
  };
  let confirmationInvalidated = false;
  const unregister = registerInvoiceComparisonTool(
    (updater) => {
      settings = updater(settings);
    },
    () => {
      confirmationInvalidated = true;
    },
  );

  assert.ok(executeTool);
  (executeTool as (input: unknown) => unknown)({
    beforeRate: 0.8,
    afterRate: 0.7,
    calculationMethod: 'proportional',
    taxableSalesRatioPercent: 50,
  });

  assert.equal(settings.calculationMethod, 'proportional');
  assert.equal(settings.taxableSalesRatio, 0.5);
  assert.equal(confirmationInvalidated, true);

  unregister();
  Reflect.deleteProperty(globalThis, 'document');
});
