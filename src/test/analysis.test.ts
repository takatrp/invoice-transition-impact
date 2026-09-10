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
import { classifyImpact, getTransitionStage } from '../domain/rates.ts';
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

void test('軽減8%の対象仕訳も取引金額と税率から試算する', () => {
  const parsed = parseCsv('日付,課税区分,税込金額,税率\n2026/4/1,52,108000,8%');
  const csv: CsvData = { fileName: 'reduced.csv', encoding: 'UTF-8', headers: parsed[0], rows: parsed.slice(1) };
  const result = analyzeCsv(csv, inferMappings(csv.headers), settings);
  assert.equal(result.taxEquivalent, 8_000);
  assert.equal(Math.round(result.transitionImpact), 800);
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

void test('TKC仕訳帳の月日・課税区分・消費税等を自動読取して年換算期間を求める', () => {
  const parsed = parseCsv([
    '月日,借方課税区分,借方税率,借方取引金額,借方消費税等,貸方課税区分,貸方税率,貸方取引金額,貸方消費税等,取引先名,元帳摘要',
    '2025/01/01,52,10,110000,10000,0,0,110000,0,A商店,対象仕入',
    '2025/12/31,5,10,220000,20000,0,0,220000,0,B商店,期間確認用',
  ].join('\n'));
  const csv: CsvData = {
    fileName: 'tkc-journal.csv',
    encoding: 'UTF-8',
    headers: parsed[0],
    rows: parsed.slice(1),
  };
  const result = analyzeCsv(csv, inferMappings(csv.headers), settings);

  assert.equal(result.targetEntries.length, 1);
  assert.equal(result.taxEquivalent, 10_000);
  assert.equal(result.transitionImpact, 1_000);
  assert.equal(result.sourceDateMin, '2025-01-01');
  assert.equal(result.sourceDateMax, '2025-12-31');
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

void test('経過措置適用後の可能性があるCSV税額は再利用せず、金額と税率から100%相当額を求める', () => {
  const parsed = parseCsv('課税区分,税込金額,消費税額,税率\n52,110000,8000,10%');
  const csv: CsvData = {
    fileName: 'tax.csv',
    encoding: 'UTF-8',
    headers: parsed[0],
    rows: parsed.slice(1),
  };
  const result = analyzeCsv(csv, inferMappings(csv.headers), settings);
  assert.equal(result.taxEquivalent, 10_000);
  assert.equal(result.transitionImpact, 1_000);
  assert.equal(result.csvTaxAmountCount, 1);
  assert.equal(result.targetEntries[0].csvTaxAmount, 8_000);
});

void test('対象コード全件の金額が不正でも対象なしにせず元行と理由を残す', () => {
  const parsed = parseCsv('日付,課税区分,税込金額,税率\n2026/4/1,52,,10%');
  const csv: CsvData = { fileName: 'invalid.csv', encoding: 'UTF-8', headers: parsed[0], rows: parsed.slice(1) };
  const result = analyzeCsv(csv, inferMappings(csv.headers), settings);
  assert.equal(result.detectedTargetCount, 1);
  assert.equal(result.targetEntries.length, 0);
  assert.equal(result.invalidTargetEntries.length, 1);
  assert.equal(result.invalidTargetEntries[0].sourceRow, 2);
  assert.equal(result.invalidTargetEntries[0].reason, 'amount_missing');
});

void test('一部の金額が不正なら計算可能分と除外分を分ける', () => {
  const parsed = parseCsv('日付,課税区分,税込金額,税率\n2026/4/1,52,110000,10%\n2026/4/2,72,不明,10%');
  const csv: CsvData = { fileName: 'partial.csv', encoding: 'UTF-8', headers: parsed[0], rows: parsed.slice(1) };
  const result = analyzeCsv(csv, inferMappings(csv.headers), settings);
  assert.equal(result.detectedTargetCount, 2);
  assert.equal(result.targetEntries.length, 1);
  assert.equal(result.invalidTargetEntries.length, 1);
});

void test('確認した集計期間外と日付不明の対象を年換算の分子から除外する', () => {
  const parsed = parseCsv([
    '日付,課税区分,税込金額,税率',
    '2026/04/01,52,110000,10%',
    '2025/12/31,52,110000,10%',
    ',52,110000,10%',
  ].join('\n'));
  const csv: CsvData = { fileName: 'period.csv', encoding: 'UTF-8', headers: parsed[0], rows: parsed.slice(1) };
  const result = analyzeCsv(csv, inferMappings(csv.headers), settings, { start: '2026-01-01', end: '2026-12-31' });
  assert.equal(result.detectedTargetCount, 3);
  assert.equal(result.targetEntries.length, 1);
  assert.equal(result.periodExcludedEntries.filter((entry) => entry.reason === 'outside_period').length, 1);
  assert.equal(result.periodExcludedEntries.filter((entry) => entry.reason === 'date_missing_or_invalid').length, 1);
});

void test('簡易課税等では実額仕入による直接影響だけを0円にする', () => {
  const parsed = parseCsv('日付,課税区分,税込金額,税率\n2026/4/1,52,110000,10%');
  const csv: CsvData = { fileName: 'simple.csv', encoding: 'UTF-8', headers: parsed[0], rows: parsed.slice(1) };
  const result = analyzeCsv(csv, inferMappings(csv.headers), { ...settings, calculationMethod: 'simplified' });
  assert.equal(result.taxEquivalent, 10_000);
  assert.equal(result.allocatedTax, 0);
  assert.equal(result.transitionImpact, 0);
});

void test('制度日程は2026年10月1日から現在70%・次50%になる', () => {
  assert.equal(getTransitionStage('2026-09-30').currentRate, 0.8);
  assert.deepEqual(getTransitionStage('2026-10-01'), {
    currentRate: 0.7,
    currentEndsOn: '2028-09-30',
    nextRate: 0.5,
    nextStartsOn: '2028-10-01',
  });
});

void test('比較差額の符号を増加・減少・影響なしに分類する', () => {
  assert.equal(classifyImpact(1), 'increase');
  assert.equal(classifyImpact(-1), 'decrease');
  assert.equal(classifyImpact(0), 'none');
});

void test('仕入先は11件でも全件の集計結果を返す', () => {
  const lines = ['日付,課税区分,税込金額,税率,取引先'];
  for (let index = 1; index <= 11; index += 1) lines.push(`2026/4/${String(index).padStart(2, '0')},52,11000,10%,仕入先${index}`);
  const parsed = parseCsv(lines.join('\n'));
  const csv: CsvData = { fileName: 'suppliers.csv', encoding: 'UTF-8', headers: parsed[0], rows: parsed.slice(1) };
  assert.equal(analyzeCsv(csv, inferMappings(csv.headers), settings).bySupplier.length, 11);
});

void test('1仕入先の税込対象仕入が1億円を超えた場合だけ上限警告を立てる', () => {
  const atLimit = parseCsv('日付,課税区分,税込金額,税率,取引先\n2026/4/1,52,100000000,10%,A社');
  const overLimit = parseCsv('日付,課税区分,税込金額,税率,取引先\n2026/4/1,52,100000001,10%,A社');
  const mappings = inferMappings(atLimit[0]);
  assert.equal(analyzeCsv({ fileName: 'at.csv', encoding: 'UTF-8', headers: atLimit[0], rows: atLimit.slice(1) }, mappings, settings).hasOneHundredMillionSupplier, false);
  assert.equal(analyzeCsv({ fileName: 'over.csv', encoding: 'UTF-8', headers: overLimit[0], rows: overLimit.slice(1) }, mappings, settings).hasOneHundredMillionSupplier, true);
});
