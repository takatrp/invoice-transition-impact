import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocationFactor,
  analyzeCsv,
  normalizeDate,
  normalizeTaxCode,
  parseSignedAmount,
  spanDays,
  taxFromAmount,
} from '../domain/analysis.ts';
import { inferMappings, parseCsv } from '../domain/csv.ts';
import type { AnalysisSettings, CsvData } from '../domain/types.ts';

const settings: AnalysisSettings = {
  beforeRate: 0.8,
  afterRate: 0.7,
  amountMode: 'included',
  defaultTaxRate: 10,
  calculationMethod: 'full',
  taxableSalesRatio: 1,
};

void test('80%から70%への変更は税込110万円の10%仕入で1万円の影響になる', () => {
  const parsed = parseCsv('日付,課税区分,税込金額,税率,取引先\n2026/4/1,52,"1,100,000",10%,A社');
  const csv: CsvData = {
    fileName: 'sample.csv',
    encoding: 'UTF-8',
    headers: parsed[0],
    rows: parsed.slice(1),
  };
  const result = analyzeCsv(csv, inferMappings(csv.headers), settings);
  assert.equal(Math.round(result.taxEquivalent), 100_000);
  assert.equal(Math.round(result.transitionImpact), 10_000);
  assert.equal(Math.round(result.registeredBenefit), 30_000);
  assert.equal(result.sourceDateMin, '2026-04-01');
  assert.equal(result.sourceDateMax, '2026-04-01');
});

void test('軽減8%は税込108万円から8万円を仕入税額相当額にする', () => {
  assert.equal(taxFromAmount(1_080_000, 8, 'included'), 80_000);
});

void test('年間換算用の期間は対象仕訳だけでなく元CSV全体の日付から求める', () => {
  const parsed = parseCsv([
    '日付,課税区分,税込金額,税率,取引先',
    '2026/01/01,52,110000,10%,A社',
    '2026/12/31,5,220000,10%,登録済み商事',
  ].join('\n'));
  const csv: CsvData = {
    fileName: 'year.csv',
    encoding: 'UTF-8',
    headers: parsed[0],
    rows: parsed.slice(1),
  };
  const result = analyzeCsv(csv, inferMappings(csv.headers), settings);
  assert.equal(result.dateMin, '2026-01-01');
  assert.equal(result.dateMax, '2026-01-01');
  assert.equal(result.sourceDateMin, '2026-01-01');
  assert.equal(result.sourceDateMax, '2026-12-31');
  assert.equal(spanDays(result.sourceDateMin, result.sourceDateMax), 365);
});

void test('個別対応方式では52を全額、62を対象外、72を共通対応にする', () => {
  assert.equal(allocationFactor('52', 'individual', 0.6), 1);
  assert.equal(allocationFactor('62', 'individual', 0.6), 0);
  assert.equal(allocationFactor('72', 'individual', 0.6), 0.6);
  assert.equal(allocationFactor('52', 'proportional', 0.6), 0.6);
  assert.equal(allocationFactor('52', 'simplified', 1), 0);
});

void test('全角・説明付きコード、符号付き金額、日付を正規化する', () => {
  assert.equal(normalizeTaxCode('課税 ５２'), '52');
  assert.equal(parseSignedAmount('△1,234円'), -1234);
  assert.equal(normalizeDate('2026年10月1日'), '2026-10-01');
  assert.equal(normalizeDate('20260230'), null);
});

void test('税額列がある場合は金額からの再計算より税額列を優先する', () => {
  const parsed = parseCsv('課税区分,税込金額,消費税額,税率\n52,110000,9999,10%');
  const csv: CsvData = {
    fileName: 'tax.csv',
    encoding: 'UTF-8',
    headers: parsed[0],
    rows: parsed.slice(1),
  };
  const result = analyzeCsv(csv, inferMappings(csv.headers), settings);
  assert.equal(result.taxEquivalent, 9999);
  assert.equal(result.taxAmountUsedCount, 1);
});
