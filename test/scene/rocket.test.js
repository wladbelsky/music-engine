'use strict';
/* The rocket: cluster layout, plumes from the nozzle exits, the start sequence, the chamber pressure */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, fakeAudio } = require('../helpers/scene');
const { load } = require('../helpers/load');

test('rocket: cluster of 1..12 (more is clamped), nozzles never overlap and sit inside the thrust frame, the lowest bell clears the floor', () => {
  for (let n = 1; n <= 12; n++) {
    const W = world({ dash: false });
    W.build(n, 'rocket', '0');
    const lay = W.e.lay, en = lay.engines;
    assert.equal(en.length, n);
    assert.equal(W.e.cyls.length, 0);
    const exitD = 2 * 0.62 * lay.s;
    for (let i = 0; i < n; i++) {
      const a = en[i].g.position;
      assert.ok(Math.hypot(a.y, a.z) + exitD / 2 <= lay.cR + 1e-9, `${n}: engine ${i} outside the cluster radius`);
      for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(a.y - en[j].g.position.y, a.z - en[j].g.position.z) >= exitD - 1e-9, `${n}: engines ${i} and ${j} overlap`);
    }
    assert.ok(Math.abs(W.e.box.min.y - 0.02) < 1e-6);
  }
  const W = world({ dash: false });
  W.build(32, 'rocket', '0');
  assert.equal(W.e.lay.engines.length, 12);
});

test('rocket: plumes start at the nozzle exits and follow the gimbals; the ignition flashes green', () => {
  const W = world({ dash: false });
  W.build(9, 'rocket', '0');
  const lay = W.e.lay;
  W.frame(40);                                             // lamp test, chill-down
  assert.ok(lay.plumes.every(p => !p.visible), 'no plume while chilling down');
  W.rev(2);
  assert.ok(lay.plumes.every(p => p.visible), 'all plumes lit');
  lay.engines.forEach((en, i) => {
    const u = lay.plumes[i].material.uniforms;
    assert.ok(u.uOrigin.value.distanceTo(lay._exitW(en, -0.02)) < 1e-6, 'plume origin at the exit');
    assert.ok(u.uDir.value.x < -0.99, 'plume points aft');
  });
  W.sim.emit('start'); W.frame(1);
  assert.ok(lay.plumes[0].material.uniforms.uTint.value.g > 1.3, 'green ignition tint');
  const r0 = lay.engines.map(e => e.g.rotation.y);
  W.frame(12, 1 / 30, (W2, i) => { if (i === 0) W.audio.beats.push(1); });
  assert.ok(lay.engines.some((e, i) => Math.abs(e.g.rotation.y - r0[i]) > 0.005), 'beats swing the gimbals');
});

test('rocket: chamber pressure is zero with the key off, overshoots at light-off, thrust 40 % at idle on the dash', () => {
  const g = load(), sim = new g.EngineSim(), a = fakeAudio(), P = g.EngineTypes.get('rocket').dash(7000);
  assert.ok(Math.abs(P.tach.map(850) - 40) < 1e-9 && Math.abs(P.tach.map(7000) - 100) < 1e-9);
  Object.assign(sim.settings, { kind: 'rocket', redline: 7000 });
  sim.ignition = false; let t = 0;
  for (let i = 0; i < 30; i++) { t += 1 / 30; sim.update(1 / 30, a, t); }
  assert.ok(Math.abs(sim.boost) < 0.01, `key off: ${sim.boost}`);
  sim.ignition = true; let peakCrank = 0;
  for (let i = 0; i < 120; i++) { t += 1 / 30; sim.update(1 / 30, a, t); if (sim.state === 'cranking') peakCrank = Math.max(peakCrank, sim.boost); }
  assert.equal(sim.state, 'running');
  assert.ok(peakCrank > 2, `light-off pressure ${peakCrank}`);
});
