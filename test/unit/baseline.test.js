/* The old engines don't change behind our back: sim traces, dash drawing and scene stats against
 * test/fixtures/baseline.json (npm run baseline rewrites it, only for intended changes). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../helpers/baseline');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'baseline.json'), 'utf8'));
const check = (exp, act, what) => { const d = B.diff(exp, act); assert.equal(d.length, 0, `${what} differs from the baseline:\n  ${d.slice(0, 12).join('\n  ')}`); };

test('baseline: sim traces', () => {
  for (const s of B.SIM_CASES) { const k = JSON.stringify(s); check(FIX.sim[k], B.simTrace(s), 'sim ' + k); }
});

test('baseline: dash drawing', () => {
  for (const k of Object.keys(FIX.dash)) {
    const [kind, size, radio] = k.split(' '), [w, h] = size.split('x').map(Number);
    check(FIX.dash[k], B.dashTrace(kind, w, h, !!radio), 'dash ' + k);
  }
});

for (const [id, n, ind] of B.SCENE_CASES) {
  const k = `${id} ${n} ${ind}`;
  test('baseline: scene ' + k, () => check(FIX.scene[k], B.sceneTrace(id, n, ind), 'scene ' + k));
}
