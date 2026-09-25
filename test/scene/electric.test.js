'use strict';
/* The DC motor: brushes as "cylinders", commutation sparks, arcs and the flashover, the starting current */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, fakeAudio } = require('../helpers/scene');
const { load } = require('../helpers/load');

test('electric: one brush per pole between the poles, a commutation pulse per segment per brush', () => {
  for (const n of [2, 4, 8, 12]) {
    const W = world({ dash: false });
    W.build(n, 'electric', '1');
    const e = W.e, lay = e.lay;
    assert.equal(e.cyls.length, n);
    assert.ok(e.cyls.every(c => c.period === 360 / 40 && c.moving.length === 0));
    // brush i sits half a pole pitch round from pole i: the neutral zone
    e.cyls.forEach((c, i) => assert.ok(Math.abs(c.g.rotation.x - (i + 0.5) * 2 * Math.PI / n) < 1e-9));
    // count the pulses at a steady, slow speed (under the core's 3-per-frame cap)
    let pulses = 0; const orig = lay.exhaustPulse.bind(lay);
    lay.exhaustPulse = (c, sim) => { pulses++; orig(c, sim); };
    W.sim.state = 'running'; W.sim.ignition = true;
    const t0 = e.crankTotal;
    for (let i = 0; i < 60; i++) { W.sim.rpm = 900; e.update(1 / 30, W.sim, 1, 'high'); }
    const turns = (e.crankTotal - t0) / 360;
    assert.ok(Math.abs(pulses - turns * 40 * n) <= n + 1, `${n}: ${pulses} pulses for ${turns.toFixed(2)} turns`);
  }
});

test('electric: sparks at load, arcs and a flashover ring on peaks, all in world space and finite', () => {
  const W = world({ dash: false });
  W.build(6, 'electric', '0');
  W.rev(1.5);
  const e = W.e, lay = e.lay, P = e.flames;
  const alive = () => { let a = 0; for (let i = 0; i < P.max; i++) if (P.life[i] > 0) a++; return a; };
  assert.ok(alive() > 10, `sparks at full load: ${alive()}`);
  W.frame(10, 1 / 30, () => { W.sim.flame = 1; });
  assert.ok(lay.arcs.some(a => a.visible), 'arcs on a music peak');
  for (const a of lay.arcs) if (a.visible) assert.ok([...a.geometry.attributes.position.array].every(Number.isFinite));
  W.sim.emit('backfire', 1);
  W.frame(1);
  assert.ok(lay.ring > 0.5 && lay.rings.every(r => r.visible), 'flashover ring');
  assert.ok(e.flash > 0.3, 'flash');
  W.sim.pedalIn = false; Object.assign(W.audio, { intensity: 0.1, power: 0.1 });   // off the limiter (its pops flash over too)
  W.frame(45);
  assert.ok(lay.ring < 0.05 && lay.rings.every(r => !r.visible), 'the ring dies out');
});

test('electric: the starting current surges, then follows the load; no backfire pops while it coasts down', () => {
  const g = load(), sim = new g.EngineSim(), a = fakeAudio();
  sim.settings.kind = 'electric'; sim.settings.redline = 7000;
  let peak = 0, t = 0, pops = 0;
  const step = n => { for (let i = 0; i < n; i++) { t += 1 / 30; if (a.level < 0.004) a.silentTime += 1 / 30; sim.update(1 / 30, a, t); for (const ev of sim.takeEvents()) if (ev.type === 'backfire') pops++; if (sim.state === 'cranking') peak = Math.max(peak, sim.boost); } };
  step(90);
  assert.equal(sim.state, 'running');
  assert.ok(peak > 250, `starting current ${peak}`);
  Object.assign(a, { intensity: 0.2, power: 0.2 }); step(60);
  assert.ok(sim.boost > 40 && sim.boost < 200, `light load ${sim.boost}`);
  pops = 0; Object.assign(a, { level: 0, intensity: 0, power: 0 }); step(200);
  assert.equal(sim.state, 'stalled');
  assert.equal(pops, 0, 'no pops from a motor');
});

test('electric: runs straight up without a starter: no rpm jump when it "starts", no starter shake, no jolt, no smoke', () => {
  const W = world({ dash: false });
  W.build(4, 'electric', '0');
  Object.assign(W.audio, { level: 0.3, silentTime: 0, intensity: 0.3, power: 0.3 });
  let prev = 0, prevState = W.sim.state, maxRoll = 0, rock = 0, jump = 0, smoke = 0;
  const orig = W.e.lay.onEvent.bind(W.e.lay);
  W.e.lay.onEvent = (ev, sim) => { if (ev.type === 'smoke') smoke++; orig(ev, sim); };
  W.frame(120, 1 / 30, () => {
    const s = W.sim;
    // on the switch to running it just keeps accelerating towards the music's target (one normal step), no reset
    if (prevState === 'cranking' && s.state === 'running') jump = (s.rpm - prev) - 0.2 * Math.max(0, s.target - prev);
    if (s.state === 'cranking') maxRoll = Math.max(maxRoll, Math.abs(W.e.eng.rotation.x));
    rock = Math.max(rock, W.e.rock);
    prev = s.rpm; prevState = s.state;
  });
  assert.equal(W.sim.state, 'running');
  assert.ok(jump < 1, `rpm jumped ${jump.toFixed(0)} past a normal step as it went to running`);
  assert.ok(maxRoll < 0.003, `starter shake ${maxRoll}`);
  assert.equal(rock, 0, 'a start jolt');
  assert.equal(smoke, 0, 'smoke at start');
});
