'use strict';
/* The marine diesel: crosshead kinematics, two-stroke firing, the scavenge air and its blowers */
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
      const b = cyc / 2 * Math.PI / 180, pin = new T.Vector3(c.x, 1.3 + 0.5 * Math.cos(b), 0.5 * Math.sin(b));
      const up = new T.Vector3(0, 1, 0).applyEuler(c.rod.rotation), big = c.rod.position.clone().addScaledVector(up, -1), small = c.rod.position.clone().addScaledVector(up, 1);
      assert.ok(big.distanceTo(pin) < 1e-6, `big end off the pin at ${cyc}`);
      assert.ok(small.distanceTo(c.xh.position) < 1e-6, `small end off the crosshead at ${cyc}`);
      if (c.piston.position.y > top) { top = c.piston.position.y; topCyc = cyc; }
    }
    assert.ok(topCyc === 0 || topCyc === 710, `TDC at cyc ${topCyc}`);
  }
});

test('marine: two-stroke, every cylinder once per turn, evenly spaced, never two neighbours in a row (from 5 up)', () => {
  for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const W = world({ dash: false });
    W.build(n, 'marine', '0');
    const cyls = W.e.cyls;
    assert.ok(cyls.every(c => c.period === 360));
    const order = [...cyls].sort((a, b) => a.phase - b.phase);
    order.forEach((c, k) => assert.ok(Math.abs(c.phase - k * 360 / n) < 1e-9, `${n}: phase ${c.phase}`));
    if (n >= 5) for (let k = 0; k < n; k++) assert.notEqual(Math.abs(order[k].i - order[(k + 1) % n].i), 1, `${n}: ${order[k].i} then ${order[(k + 1) % n].i}`);
  }
});

test('marine: the scavenge air lags the load, the auxiliary blowers run only while it is low', () => {
  const W = world({ dash: false });
  W.build(6, 'marine', '1');
  const lay = W.e.lay, spin = () => lay.auxFans[0].rotation.z;
  W.frame(60);                                           // key on, cranking on air
  let r0 = spin(); W.frame(30); assert.ok(spin() - r0 > 0.5, 'blowers run at start');
  W.rev(4);
  assert.ok(W.sim.boost > 2, `scavenge air flat out ${W.sim.boost}`);
  W.frame(300); r0 = spin(); W.frame(30); assert.ok(spin() - r0 < 0.1, 'blowers stop with the turbo making the air');
  assert.ok(W.e.compressors.length === 1);
});

test('marine: the sim scale — 120 rpm at the redline on the dash, starting air slower than a starter motor', () => {
  const g = load(), P = g.EngineTypes.get('marine').dash(7000);
  assert.equal(P.tach.map(7000), 120);
  const sim = new g.EngineSim(), a = fakeAudio(); Object.assign(sim.settings, { kind: 'marine', redline: 7000 });
  let t = 0, crankT = 0;
  for (let i = 0; i < 150; i++) { t += 1 / 30; sim.update(1 / 30, a, t); if (sim.state === 'cranking') crankT += 1 / 30; }
  assert.equal(sim.state, 'running');
  assert.ok(crankT > 1.5, `turned over on air for ${crankT.toFixed(2)} s`);
});
