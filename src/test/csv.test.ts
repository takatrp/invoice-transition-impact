import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectCsvEncoding,
  inferMappings,
  isTkcJournalFormat,
  parseCsv,
  validateCsvRows,
} from '../domain/csv.ts';

void test('引用符、カンマ、セル内改行を含むCSVを読む', () => {
  const rows = parseCsv('課税区分,摘要,金額\r\n52,"会議費,\n軽食",11000\r\n');
  assert.deepEqual(rows, [
    ['課税区分', '摘要', '金額'],
    ['52', '会議費,\n軽食', '11000'],
  ]);
});

void test('UTF-8 BOMを認識する', () => {
  assert.equal(detectCsvEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x31])), 'UTF-8');
});

void test('閉じていない引用符をエラーにする', () => {
  assert.throws(() => parseCsv('課税区分,摘要\n52,"未完了'), /引用符が閉じられていません/);
});

void test('見出しと列数が違う行をエラーにする', () => {
  assert.throws(() => validateCsvRows([['a', 'b'], ['1']]), /2行目/);
});

void test('一般的な単一列形式を自動対応する', () => {
  const headers = ['取引年月日', '課税区分', '税込金額', '税率', '取引先'];
  const [mapping] = inferMappings(headers);
  assert.equal(mapping.taxCodeIndex, 1);
  assert.equal(mapping.amountIndex, 2);
  assert.equal(mapping.taxRateIndex, 3);
  assert.equal(mapping.partnerIndex, 4);
});

void test('借方・貸方形式は二つの読み取り設定を作る', () => {
  const headers = [
    '取引年月日',
    '借方税区分コード',
    '借方取引金額',
    '借方補助名',
    '貸方税区分コード',
    '貸方取引金額',
    '貸方補助名',
  ];
  const mappings = inferMappings(headers);
  assert.equal(mappings.length, 2);
  assert.equal(mappings[0].label, '借方');
  assert.equal(mappings[0].partnerIndex, 3);
  assert.equal(mappings[1].label, '貸方');
  assert.equal(mappings[1].sign, -1);
});

void test('実際のTKC仕訳帳49列形式から必要な列を自動設定する', () => {
  const headers = [
    '月日',
    '伝票番号',
    '借方課税区分',
    '借方消費税額自動計算か否か',
    '借方税率',
    '借方取引金額',
    '借方消費税等',
    '貸方課税区分',
    '貸方消費税額自動計算か否か',
    '貸方税率',
    '貸方取引金額',
    '貸方消費税等',
    '取引先名',
    '元帳摘要',
  ];
  const mappings = inferMappings(headers);

  assert.equal(isTkcJournalFormat([
    '月日',
    '借方課税区分',
    '借方取引金額',
    '貸方課税区分',
    '貸方取引金額',
    '取引先名',
  ]), true);
  assert.deepEqual(mappings.map((mapping) => ({
    label: mapping.label,
    date: mapping.dateIndex,
    taxCode: mapping.taxCodeIndex,
    rate: mapping.taxRateIndex,
    amount: mapping.amountIndex,
    taxAmount: mapping.taxAmountIndex,
    partner: mapping.partnerIndex,
    description: mapping.descriptionIndex,
  })), [
    { label: '借方', date: 0, taxCode: 2, rate: 4, amount: 5, taxAmount: 6, partner: 12, description: 13 },
    { label: '貸方', date: 0, taxCode: 7, rate: 9, amount: 10, taxAmount: 11, partner: 12, description: 13 },
  ]);
});
