import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rankMatches, rankScoredMatches, selectAutomaticMatch } from '../src/lib/search.ts';

const cases = JSON.parse(readFileSync(new URL('./fixtures/safe-matching.json', import.meta.url), 'utf8'));

for (const fixture of cases) {
  test(fixture.name, () => {
    for (const products of [fixture.products, [...fixture.products].reverse()]) {
      assert.deepEqual(rankScoredMatches(products, fixture.query).map(({ score, it }) => [score, it.id]), fixture.scores);
      assert.deepEqual(rankMatches(products, fixture.query).map((p) => p.id), fixture.scores.map(([, id]) => id));
      assert.equal(selectAutomaticMatch(products, fixture.query)?.id ?? null, fixture.automatic);
    }
  });
}
