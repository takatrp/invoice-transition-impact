import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../public/analytics.js', import.meta.url), 'utf8');
function context(url: string) {
  const scripts: unknown[] = [];
  const window: { dataLayer?: IArguments[] } = {};
  return { window, location: new URL(url), scripts, document: {
    referrer: 'https://example.com/?private=secret',
    createElement: () => ({}), head: { appendChild: (s: unknown) => scripts.push(s) },
  } };
}
test('公開先のみで一度だけGA4を初期化しクエリ・ハッシュを送信しない', () => {
  for (const url of ['https://takatrp.github.io/invoice-transition-impact/?secret=1#private', 'https://invoice-transition-impact.takatrp0222.chatgpt.site/?secret=1']) {
    const c = context(url);
    runInNewContext(source, c); runInNewContext(source, c);
    assert.equal(c.scripts.length, 1);
    assert.equal(c.window.dataLayer?.length, 2);
    const params = c.window.dataLayer![1][2];
    assert.equal(params.page_location, c.location.origin + c.location.pathname);
    assert.equal(params.page_referrer, 'https://example.com/');
    assert.equal(params.allow_google_signals, false);
  }
});
test('開発環境と別ツールではGA4を読み込まない', () => {
  for (const url of ['http://localhost:3000/', 'https://takatrp.github.io/another-tool/']) {
    const c = context(url); runInNewContext(source, c);
    assert.equal(c.scripts.length, 0);
  }
});
