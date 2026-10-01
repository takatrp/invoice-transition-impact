import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../components/AuditChecklistNotice.tsx', import.meta.url), 'utf8');
const simulator = readFileSync(new URL('../components/InvoiceImpactSimulator.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

test('巡回監査PDFは承認済みの文字化け対策版をそのまま配布する', () => {
  const pdf = readFileSync(new URL('../../public/docs/invoice-audit-checklist.pdf', import.meta.url));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pdf.length, 908176);
  assert.equal(createHash('sha256').update(pdf).digest('hex'), '50620747118601a5f6daa59e20a3acbb16cd63fef2bd44c9c7efdf8db731a5fc');
});

test('巡回監査ボタンはCSV読込と独立してヘッダー直下に表示する', () => {
  assert.match(simulator, /<\/header>\s*<AuditChecklistNotice\s*\/>\s*<section className="transition-strip"/);
  assert.match(component, /<span>巡回監査時の注意点<\/span>/);
  assert.doesNotMatch(component, /\b(?:disabled|onClick|iframe)\b/);
});

test('PDFは安全な別タブリンクと保存リンクで開ける', () => {
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noopener noreferrer"/);
  assert.match(component, /aria-describedby="audit-checklist-open-note"/);
  assert.match(component, /id="audit-checklist-open-note">PDFを別タブで表示/);
  assert.match(component, /download="インボイス経過措置チェックシート_松本会計.pdf"/);
  assert.equal((component.match(/href=\{checklistHref\}/g) ?? []).length, 2);
});

test('PagesのサブパスとSitesのルートにビルドのベースURLを適用する', () => {
  assert.match(component, /`\$\{import\.meta\.env\.BASE_URL\}docs\/invoice-audit-checklist\.pdf`/);
  const pagesConfig = readFileSync(new URL('../../vite.pages.config.ts', import.meta.url), 'utf8');
  assert.match(pagesConfig, /base: '\/invoice-transition-impact\/'/);
  for (const [base, origin, expected] of [
    ['/invoice-transition-impact/', 'https://takatrp.github.io', 'https://takatrp.github.io/invoice-transition-impact/docs/invoice-audit-checklist.pdf'],
    ['/', 'https://invoice-transition-impact.takatrp0222.chatgpt.site', 'https://invoice-transition-impact.takatrp0222.chatgpt.site/docs/invoice-audit-checklist.pdf'],
  ]) {
    assert.equal(new URL(`${base}docs/invoice-audit-checklist.pdf`, origin).href, expected);
  }
});

test('フォーカス表示とモバイル配置を備え、既存A4縦印刷には含めない', () => {
  assert.match(css, /\.audit-checklist-button:focus-visible/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[^}]*\}[^}]*\.audit-checklist-card[^}]*flex-direction: column/);
  assert.match(css, /@media print[\s\S]*\.audit-checklist-notice,[^}]*display: none !important/);
  assert.match(css, /@page\s*\{\s*size: A4 portrait;/);
});
