'use strict';
/* The marine diesel: crosshead kinematics, four-stroke firing and valve gear, the charge air and its blowers */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, fakeAudio } = require('../helpers/scene');
const { load } = require('../helpers/load');

test('marine: crosshead on the bore axis, rod joins crank pin and crosshead, piston at the top at the firing point', () => {
  const W = world({ dash: false });
  W.build(6, 'marine', '1');
  const e = W.e, lay = e.lay, T = W.g.THREE;
  for (const c of e.cyls) {
    let top = -Infinity, topCyc = 0;
    for (let cyc = 0; cyc < 720; cyc += 10) {
      lay.animate(c, cyc, 0); e.eng.updateMatrixWorld(true);
      assert.ok(Math.abs(c.xh.position.z) < 1e-9 && Math.abs(c.xh.position.x - c.x) < 1e-9, 'crosshead leaves its guides');
      assert.ok(Math.abs(c.piston.position.y - c.xh.position.y - 2.15 - 0.17) < 1e-9, 'piston rigid on the crosshead');
      // rod ends: big end at the crank pin, small end at the crosshead pin
      const b = cyc * Math.PI / 180, pin = new T.Vector3(c.x, 1.3 + 0.5 * Math.cos(b), 0.5 * Math.sin(b));
      const up = new T.Vector3(0, 1, 0).applyEuler(c.rod.rotation), big = c.rod.position.clone().addScaledVector(up, -1), small = c.rod.position.clone().addScaledVector(up, 1);
      assert.ok(big.distanceTo(pin) < 1e-6, `big end off the pin at ${cyc}`);
      assert.ok(small.distanceTo(c.xh.position) < 1e-6, `small end off the crosshead at ${cyc}`);
      if (c.piston.position.y > top) { top = c.piston.position.y; topCyc = cyc; }
    }
    assert.ok(topCyc === 0 || topCyc === 710, `TDC at cyc ${topCyc}`);
  }
});

test('marine: four-stroke, every cylinder once in two turns, evenly spaced, never two neighbours in a row (from 5 up)', () => {
  for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const W = world({ dash: false });
    W.build(n, 'marine', '0');
    const cyls = W.e.cyls;
    assert.ok(cyls.every(c => c.period === 720));
    const order = [...cyls].sort((a, b) => a.phase - b.phase);
    order.forEach((c, k) => assert.ok(Math.abs(c.phase - k * 720 / n) < 1e-9, `${n}: phase ${c.phase}`));
    if (n >= 5) for (let k = 0; k < n; k++) assert.notEqual(Math.abs(order[k].i - order[(k + 1) % n].i), 1, `${n}: ${order[k].i} then ${order[(k + 1) % n].i}`);
  }
});

test('marine: the charge air lags the load, the auxiliary blowers run only while it is low', () => {
  const W = world({ dash: false });
  W.build(6, 'marine', '1');
  const lay = W.e.lay, spin = () => lay.auxFans[0].rotation.z;
  W.frame(60);                                           // key on, cranking on air
  let r0 = spin(); W.frame(30); assert.ok(spin() - r0 > 0.5, 'blowers run at start');
  W.rev(4);
  assert.ok(W.sim.boost > 2, `charge air flat out ${W.sim.boost}`);
  W.frame(300); r0 = spin(); W.frame(30); assert.ok(spin() - r0 < 0.1, 'blowers stop with the turbo making the air');
  assert.ok(W.e.compressors.length === 1);
});

test('marine: the sim scale — 500 rpm at the redline on the dash (a U-boat diesel), starting air slower than a starter motor', () => {
  const g = load(), P = g.EngineTypes.get('marine').dash(7000);
  assert.equal(P.tach.map(7000), 500);
  const sim = new g.EngineSim(), a = fakeAudio(); Object.assign(sim.settings, { kind: 'marine', redline: 7000 });
  let t = 0, crankT = 0;
  for (let i = 0; i < 150; i++) { t += 1 / 30; sim.update(1 / 30, a, t); if (sim.state === 'cranking') crankT += 1 / 30; }
  assert.equal(sim.state, 'running');
  assert.ok(crankT > 1.5, `turned over on air for ${crankT.toFixed(2)} s`);
});

test('marine: two rockers per head, every one of them rocks in a cycle, and most of them in any one turn', () => {
  const W = world({ dash: false });
  W.build(8, 'marine', '0');
  const e = W.e, cyls = e.cyls;
  assert.ok(cyls.every(c => c.rockers.length === 2));
  const span = new Map(), seen = new Set();
  for (let crank = 0; crank < 720; crank += 5) {
    for (const c of cyls) {
      e.lay.animate(c, e._cyc(c, crank), crank);
      for (const r of c.rockers) {
        const a = Math.abs(r.arm.rotation.x), s0 = span.get(r) || 0;
        span.set(r, Math.max(s0, a));
        if (crank < 360 && a > 0.03) seen.add(r);
      }
    }
  }
  for (const [r, a] of span) assert.ok(a > 0.1, `a rocker only tips ${a.toFixed(3)} rad`);
  assert.ok(seen.size >= cyls.length, `only ${seen.size} of ${cyls.length * 2} rockers move in the first turn`);
});

test('marine: a flame out of the funnel on music peaks (from the world-space funnel top), none without', () => {
  const W = world({ dash: false });
  W.build(6, 'marine', '0');
  W.rev(2);
  const f = W.e.lay.funnel;
  W.frame(20, 1 / 30, () => { W.sim.flame = 1; });
  assert.ok(f.jet.visible, 'funnel flame at full flame');
  assert.ok(f.jet.material.uniforms.uOrigin.value.distanceTo(W.e.eng.localToWorld(f.tip.clone())) < 1e-6, 'flame starts at the funnel top');
  W.sim.pedalIn = false; Object.assign(W.audio, { intensity: 0.1, power: 0.1 });
  W.frame(60, 1 / 30, () => { W.sim.flame = 0; W.sim.limiter = false; });
  assert.ok(!f.jet.visible, 'funnel flame stays lit without flame');
});

test('marine: relief valves lift on ordinary fiery beats, several of them over a few seconds', () => {
  const W = world({ dash: false });
  W.build(8, 'marine', '0');
  W.rev(1);
  const lifted = new Set(), orig = W.e.lay._relief.bind(W.e.lay);
  W.e.lay._relief = (c, k) => { lifted.add(c); orig(c, k); };
  W.frame(90, 1 / 30, (W2, i) => { if (i % 10 === 0) W.sim.events.push({ type: 'backfire', k: 0.6 }); });
  assert.ok(lifted.size > 1, `only ${lifted.size} relief valve(s) lifted`);
});

test('marine: at full flame the relief valves lift about twice as often as they used to (5 in 3 s)', () => {
  const W = world({ dash: false, seed: 3 });
  W.build(8, 'marine', '0');
  W.rev(1);
  let n = 0; const orig = W.e.lay._relief.bind(W.e.lay);
  W.e.lay._relief = (c, k) => { n++; orig(c, k); };
  W.frame(90, 1 / 30, (W2, i) => { W.sim.flame = 1; if (i % 10 === 0) W.sim.events.push({ type: 'backfire', k: 0.6 }); });
  assert.ok(n >= 9, `only ${n} relief valve lifts in 3 s`);
});
