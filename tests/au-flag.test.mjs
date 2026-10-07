import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { LOCALE_LABEL } from '../src/lib/i18n/locale.ts';
import { translate } from '../src/lib/i18n/ui.ts';

const source = readFileSync(new URL('../src/components/ui/Flag.svelte', import.meta.url), 'utf8');
const compiled = compile(source, { filename: 'Flag.svelte', generate: 'server' }).js.code
  .replace("'svelte/internal/server'", JSON.stringify(import.meta.resolve('svelte/internal/server')))
  .replace("'$lib/i18n/locale'", JSON.stringify(new URL('../src/lib/i18n/locale.ts', import.meta.url).href));
const { default: Flag } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('actual AU flag component renders Union Jack canton and six white stars', () => {
  const { body } = render(Flag, { props: { locale: 'au' } });
  assert.match(body, /aria-label="au"/);
  assert.match(body, /<rect[^>]*width="60"[^>]*height="42"[^>]*fill="#012169"/);
  assert.match(body, /transform="scale\(0\.5\)"/);
  assert.match(body, /stroke="#C8102E"/);
  const stars = [...body.matchAll(/<polygon points="([^"]+)" fill="#FFFFFF"/g)];
  assert.equal(stars.length, 6);
  assert.deepEqual(stars.map((star) => star[1].trim().split(/\s+/).length).sort((a, b) => a - b), [10, 14, 14, 14, 14, 14]);
});

test('AU catalogue hint uses the visible Australia label and existing English text', () => {
  assert.equal(LOCALE_LABEL.au, 'Australia');
  const hint = translate('au', 'nav.catalogHint', { label: LOCALE_LABEL.au });
  assert.equal(hint, translate('en', 'nav.catalogHint', { label: 'Australia' }));
  assert.match(hint, /Australia/);
});
