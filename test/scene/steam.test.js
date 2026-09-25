'use strict';
/* The steam engine's cylinder cocks blow out with the music (like the marine diesel's relief valves, steam instead of fire) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('../helpers/scene');

test('steam: beats and hard running blow the cylinder cocks, several cylinders over a few seconds, steam from the cocks', () => {
  const W = world({ dash: false, seed: 3 });
  W.build(4, 'steam', '0');
  W.rev(1);
  const lay = W.e.lay, S = W.e.smoke, blown = new Set(), orig = lay._blow.bind(lay);
  let n = 0;
  lay._blow = (c, k) => {
    n++; blown.add(c);
    const at = S.cursor, w = lay._w(c.drains[0]);
    orig(c, k);
    assert.ok(Math.hypot(S.pos[at * 3] - w.x, S.pos[at * 3 + 1] - w.y, S.pos[at * 3 + 2] - w.z) < 1e-6, 'burst starts at the cock');
    assert.equal(S.kind[at], W.g.EngineFX.P.STEAM);
  };
  W.frame(90, 1 / 30, (W2, i) => { W.sim.flame = 1; if (i % 10 === 0) W.sim.events.push({ type: 'backfire', k: 0.6 }); });
  assert.ok(n >= 8, `only ${n} blow-outs in 3 s`);
  assert.ok(blown.size > 1, `only ${blown.size} cylinder(s) blew`);
});

test('steam: no blow-outs on a calm run without peaks', () => {
  const W = world({ dash: false, seed: 3 });
  W.build(4, 'steam', '0');
  W.rev(1); W.sim.pedalIn = false; Object.assign(W.audio, { intensity: 0.2, power: 0.2 });
  W.frame(60);                                           // the lift-off pop has gone
  let n = 0; const orig = W.e.lay._blow.bind(W.e.lay);
  W.e.lay._blow = (c, k) => { n++; orig(c, k); };
  W.frame(150);
  assert.equal(n, 0);
});

test('steam: the firebox spits embers out of its door with the music (falling sparks, riding the rocking boiler), none on a calm run', () => {
  const W = world({ dash: false, seed: 3 });
  W.build(2, 'steam', '0');
  W.rev(1);
  const lay = W.e.lay, F = W.e.flames, T = W.g.THREE, orig = lay._embers.bind(lay);
  let n = 0;
  lay._embers = (m, k) => {
    const at = F.cursor, p = lay._w(new T.Vector3(0, 0, 0.1), lay.door);
    orig(m, k); n += m;
    assert.ok(Math.hypot(F.pos[at * 3] - p.x, F.pos[at * 3 + 1] - p.y, F.pos[at * 3 + 2] - p.z) < 0.25, 'ember starts at the firebox door');
    assert.equal(F.kind[at], W.g.EngineFX.P.SPARK);
  };
  W.frame(30, 1 / 30, () => { W.sim.flame = 1; });
  assert.ok(n >= 5, `only ${n} embers in a second at full flame`);
  const n0 = n; W.sim.events.push({ type: 'backfire', k: 0.8 }); W.frame(1, 1 / 30, () => { W.sim.flame = 1; });
  assert.ok(n - n0 >= 20, `a beat throws ${n - n0} embers`);
  W.sim.pedalIn = false; Object.assign(W.audio, { intensity: 0.2, power: 0.2 });
  W.frame(60); n = 0; W.frame(150);
  assert.equal(n, 0, 'embers on a calm run');
});
