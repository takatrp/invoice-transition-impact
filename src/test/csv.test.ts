import assert from 'node:assert/strict';
import test from 'node:test';

import { detectCsvEncoding, inferMappings, parseCsv } from '../domain/csv.ts';

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
