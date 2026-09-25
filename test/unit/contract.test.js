/* The contract every engine type and layout in the registries (js/core/layout.js) must keep, so a new engine
 * can be added as one file: statics, the dash profile, the sim sources, project.json in sync. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, read } = require('../helpers/load');
const { fakeAudio } = require('../helpers/scene');
const { sync, format } = require('../../tools/sync-project');

const g = load();
const { EngineTypes: TY, EngineLayouts: EL } = g;
const JUNK = ['abc', '', null, undefined, -5, 0, 0.4, 3.7, '12', 1e9, NaN, Infinity, {}];

test('project.json is in sync with the registries (npm run sync:project)', () => {
  assert.equal(read('project.json'), format(sync(JSON.parse(read('project.json')), g)));
});

test('every layout: statics, a registered type, normCyl/label on any input', () => {
  assert.ok(EL.ids().length >= 8);
  for (const L of EL.list()) {
    const tag = L.id;
    assert.equal(typeof L.id, 'string'); assert.equal(EL.get(L.id), L, tag);
    assert.ok(L.title && typeof L.title === 'string', `${tag}: title`);
    assert.equal(TY.get(L.kind).id, L.kind, `${tag}: kind ${L.kind} is not a registered type`);
    assert.equal(typeof L.turbos, 'boolean', tag); assert.equal(typeof L.blower, 'boolean', tag);
    assert.ok(L.prototype instanceof EL.base, `${tag}: extends BaseLayout`);
    for (const v of JUNK) {
      const n = L.normCyl(v);
      assert.ok(Number.isInteger(n) && n >= 1 && n <= EL.MAX_CYL, `${tag}: normCyl(${String(v)}) = ${n}`);
      assert.equal(L.normCyl(n), n, `${tag}: normCyl is idempotent at ${n}`);
      const lab = L.label(n);
      assert.ok(typeof lab === 'string' && lab.length > 0 && lab.length < 32, `${tag}: label(${n}) = ${lab}`);
    }
  }
});

test('every type: redline, glow, dash profile (tach, both gauges, lamp names)', () => {
  const lampKeys = g.Dash.LAMPS.map(l => l.key);
  for (const id of TY.ids()) {
    const T = TY.get(id);
    assert.equal(T.id, id);
    assert.ok(T.redline === null || (T.redline >= 500 && T.redline <= 15000), `${id}: redline`);
    assert.ok(Number.isInteger(T.glow.color) && T.glow.css.length === 3, `${id}: glow`);
    for (const red of [5000, 7000, 9500]) {
      const P = T.dash(red), tc = P.tach;
      assert.ok(tc.max > 0 && tc.red > 0 && tc.red <= tc.max, `${id}: tach red/max`);
      assert.ok(tc.minor > 0 && tc.minor <= tc.half && tc.half <= tc.major && tc.major <= tc.max && tc.max / tc.minor <= 200, `${id}: tach tick steps`);
      assert.ok(Math.abs(tc.map(0)) < 1e-9, `${id}: map(0) = 0`);
      let prev = -Infinity;
      for (let r = 0; r <= red * 1.1; r += 25) { const v = tc.map(r); assert.ok(Number.isFinite(v) && v >= prev, `${id}: tach map at ${r}`); prev = v; }
      assert.ok(Math.abs(tc.map(red) - tc.red) < tc.red * 0.02 + 1e-9, `${id}: map(redline) ${tc.map(red)} vs red ${tc.red}`);
      assert.equal(typeof tc.digits(tc.map(red / 2)), 'string'); assert.equal(typeof tc.text(tc.major), 'string');
      assert.ok(tc.title, `${id}: tach title`);
      for (const side of ['left', 'right']) {
        const G = P[side];
        assert.ok(G && G.title && G.min < G.max, `${id}: ${side} gauge`);
        assert.ok(G.danger > G.min && G.danger <= G.max, `${id}: ${side} danger`);
        for (const v of G.labels) assert.ok(v >= G.min && v <= G.max, `${id}: ${side} label ${v}`);
        assert.equal(typeof G.value, 'function', `${id}: ${side} value(sim)`);
        assert.ok(String(G.text((G.min + G.max) / 2)).length > 0);
      }
      for (const k of Object.keys(P.lamps)) assert.ok(lampKeys.includes(k), `${id}: lamp ${k} does not exist`);
    }
  }
});

test('every type: the sim runs a whole song with finite values and the gauge needles on their scales', () => {
  for (const id of TY.ids()) for (const ind of [{ turbos: 0, blower: false }, { turbos: 2, blower: true }]) {
    const T = TY.get(id), sim = new g.EngineSim(), a = fakeAudio();
    Object.assign(sim.settings, ind, { kind: id, redline: T.redline ?? 7000 });
    const P = T.dash(sim.settings.redline), tag = `${id} ${JSON.stringify(ind)}`;
    let seenRun = false;
    for (let i = 1; i <= 30 * 20; i++) {
      const t = i / 30, loud = t < 8 || t > 13;
      Object.assign(a, loud ? { level: 0.3, silentTime: 0, intensity: t < 5 ? 0.5 : 0.95, power: t < 5 ? 0.5 : 0.95 } : { level: 0, intensity: 0, power: 0 });
      if (loud && i % 14 === 0) a.beats.push(0.9);
      if (a.level < 0.004) a.silentTime += 1 / 30;
      sim.pedalIn = t > 15 && t < 16;
      sim.update(1 / 30, a, t);
      sim.takeEvents();
      if (sim.state === 'running') seenRun = true;
      for (const k of ['rpm', 'boost', 'temp', 'flame', 'throttle']) assert.ok(Number.isFinite(sim[k]), `${tag}: ${k} at ${t}`);
      for (const side of ['left', 'right']) {
        const G = P[side], v = G.value(sim), span = G.max - G.min;
        assert.ok(Number.isFinite(v) && v >= G.min - 0.35 * span && v <= G.max + 0.2 * span, `${tag}: ${side} ${v} off the scale at ${t}`);
      }
    }
    assert.ok(seenRun, `${tag}: never ran`);
  }
});
