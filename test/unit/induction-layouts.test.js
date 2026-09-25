'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, LAYOUT_IDS: IDS } = require('../helpers/load');

const g = load();
const { Induction, EngineLayouts: EL } = g;
const JUNK = ['abc', NaN, undefined, null, '', -3, 0, Infinity, -Infinity, '7.6', 7.4, '  12 ', 1e9, {}, []];

test('Induction.parse: known keys, case/space tolerant, junk -> one turbo', () => {
  for (const k of Object.keys(Induction.OPTIONS)) {
    const c = Induction.parse(k);
    assert.equal(c.key, k);
    assert.equal(c.turbos, Induction.OPTIONS[k].turbos);
    assert.equal(c.blower, Induction.OPTIONS[k].blower);
  }
  assert.equal(Induction.parse(' SC2 ').key, 'sc2');
  assert.equal(Induction.parse(4).key, '4');          // old saved numeric combo values
  for (const j of ['bogus', '3', 3, null, undefined, NaN, {}]) assert.equal(Induction.parse(j).key, '1', String(j));
});

test('Induction.effective / supported: the radial and every non-piston engine carry nothing', () => {
  for (const id of IDS) {
    const L = EL.get(id), none = id === 'radial' || L.kind !== 'piston';
    assert.equal(Induction.supported(L), !none, id);
    for (const k of Object.keys(Induction.OPTIONS)) {
      const e = Induction.effective(Induction.parse(k), L);
      if (none) { assert.equal(e.turbos, 0); assert.equal(e.blower, false); } else {
        assert.equal(e.turbos, Induction.OPTIONS[k].turbos); assert.equal(e.blower, Induction.OPTIONS[k].blower);
      }
    }
  }
});

test('Induction.suffix and part order (blower before turbos, air filter only when NA)', () => {
  const suf = k => Induction.suffix(Induction.parse(k));
  assert.deepEqual(['0', '1', '2', '4', 'sc', 'sc2'].map(suf), ['', ' TURBO', ' TWIN TURBO', ' QUAD TURBO', ' SUPERCHARGED', ' TWINCHARGED']);
  const names = k => Induction.parts(Induction.parse(k)).map(p => p.constructor.name).join(',');
  assert.equal(names('0'), 'AirFilter');
  assert.equal(names('2'), 'TurboSet');
  assert.equal(names('sc'), 'RootsBlower');
  assert.equal(names('sc2'), 'RootsBlower,TurboSet');
  assert.equal(Induction.parts(Induction.parse('4'))[0].n, 4);
});

test('EngineLayouts registry: every layout, unknown -> V, statics', () => {
  assert.deepEqual(IDS.map(id => EL.get(id).id), IDS);
  for (const j of ['zzz', undefined, '', 'V', null]) assert.equal(EL.get(j).id, 'v', String(j));
  // the six piston layouts share the piston type; every other engine brings its own
  const PISTON = ['inline', 'v', 'boxer', 'w', 'radial', 'rotary'];
  for (const id of IDS) assert.equal(EL.get(id).kind, PISTON.includes(id) ? 'piston' : id, id);
  assert.ok(PISTON.every(id => IDS.includes(id)));
  assert.equal(EL.MAX_CYL, 32);
  assert.equal(typeof EL.turboScale, 'function');
});

test('normCyl: every input becomes a legal count for the layout', () => {
  const inputs = [...Array(41).keys(), ...JUNK];
  const rules = {
    inline: n => n >= 1 && n <= 32,
    v: n => n >= 2 && n <= 32 && n % 2 === 0,
    boxer: n => n >= 2 && n <= 32 && n % 2 === 0,
    w: n => n >= 8 && n <= 32 && n % 4 === 0,
    radial: n => { const s = EL.get('radial').split(n); return s.rows * s.per === n && s.per % 2 === 1 && s.per >= 3 && s.per <= 9 && n <= 32; },
    rotary: n => n >= 1 && n <= 32,
    steam: n => n >= 1 && n <= 8,
    jet: n => n >= 6 && n <= 16,
    electric: n => n >= 2 && n <= 12 && n % 2 === 0,
  };
  for (const id of IDS) for (const x of inputs) {
    const n = EL.get(id).normCyl(x);
    assert.ok(Number.isInteger(n) && (rules[id] || (m => m >= 1 && m <= 32))(n), `${id}.normCyl(${String(x)}) = ${n}`);
    assert.equal(EL.get(id).normCyl(n), n, `${id}: normCyl is idempotent at ${n}`);
  }
  // rounding and the documented fallbacks
  assert.equal(EL.get('inline').normCyl('7.6'), 8);
  assert.equal(EL.get('v').normCyl(7), 8);
  assert.equal(EL.get('w').normCyl(9), 12);
  assert.equal(EL.get('w').normCyl(2), 8);
  assert.equal(EL.get('inline').normCyl('abc'), 8);
  assert.equal(EL.get('steam').normCyl('abc'), 2);
  assert.equal(EL.get('jet').normCyl('abc'), 8);
  assert.equal(EL.get('jet').normCyl(2), 6);
  assert.equal(EL.get('electric').normCyl(5), 6);
  assert.equal(EL.get('electric').normCyl('abc'), 4);
  assert.deepEqual({ ...EL.get('radial').split(9) }, { rows: 1, per: 9 });
  assert.deepEqual({ ...EL.get('radial').split(14) }, { rows: 2, per: 7 });
  assert.deepEqual({ ...EL.get('radial').split(32) }, { rows: 4, per: 7 });
});

test('labels', () => {
  const lab = (id, n) => EL.get(id).label(n);
  assert.equal(lab('inline', 6), 'I6');
  assert.equal(lab('v', 8), 'V8');
  assert.equal(lab('boxer', 4), 'BOXER 4');
  assert.equal(lab('w', 16), 'W16');
  assert.equal(lab('radial', 9), 'RADIAL 9');
  assert.equal(lab('rotary', 2), '2-ROTOR');
  assert.equal(lab('steam', 1), 'STEAM SINGLE');
  assert.equal(lab('steam', 2), 'STEAM TWIN');
  assert.equal(lab('steam', 4), 'STEAM 4-CYL');
  assert.equal(lab('jet', 8), 'TURBOJET 8-CAN');
  assert.equal(lab('electric', 4), 'DC MOTOR 4-BRUSH');
});

test('turboScale: 1.25 … 1.6', () => {
  for (let n = 1; n <= 32; n++) { const s = EL.turboScale(n); assert.ok(s >= 1.25 && s <= 1.6); }
  assert.equal(EL.turboScale(32), 1.6);
});
