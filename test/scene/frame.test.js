'use strict';
/* Engine3D.update(): what each frame does to the scene */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, meshes, IDS } = require('../helpers/scene');

/* lowest world-space vertex of the engine (all meshes) */
function lowest(W) {
  const T = W.g.THREE, v = new T.Vector3();
  let lo = Infinity;
  W.e.eng.updateMatrixWorld(true);
  for (const m of meshes(W.e.eng)) {
    if (!m.visible || m.isInstancedMesh) continue;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); if (v.y < lo) lo = v.y; }
  }
  return lo;
}

test('the rocking engine never sinks through the floor, and a still one sits on it', () => {
  for (const id of IDS) {
    const W = world({ seed: 3 });
    W.build(8, id, '1');
    W.e.sway = 2.5;                                        // the strongest setting
    let worst = Infinity;
    const sample = (W2, i) => { if (i % 6 === 0) worst = Math.min(worst, lowest(W)); };
    W.rev(0.1);
    W.frame(150, 1 / 30, (W2, i) => { W.sim.pedalIn = Math.floor(i / 20) % 2 === 0; if (i % 14 === 0) W.audio.beats.push(1); sample(W2, i); }); // blips: lean + kick, hard beats
    W.sim.pedalIn = false; W.audio.level = 0; W.audio.intensity = W.audio.power = 0;
    W.frame(200, 1 / 30, sample);                         // stall with its random jolts
    assert.ok(worst > -0.005, `${id}: sank ${(-worst * 100).toFixed(1)} cm under the floor`);
    W.sim.ignition = false;
    W.frame(150);
    assert.ok(Math.abs(W.e.mountY - W.e.baseY) < 1e-3, `${id}: still engine hovers (mountY ${W.e.mountY}, base ${W.e.baseY})`);
    assert.ok(Math.abs(lowest(W) - 0.02) < 0.01, `${id}: resting bottom at ${lowest(W)}`);
  }
});

/* how far the parts that show the beat move over a few seconds of hard beats (max - min per channel) */
function beatMotion(id, sway) {
  const W = world({ seed: 5 });
  W.build(8, id, '0');
  W.e.sway = sway;
  W.rev(0.1); W.sim.pedalIn = false;
  Object.assign(W.audio, { intensity: 0.8, power: 0.8 });
  const ch = { jolt: [], engZ: [], jx: [], jrot: [], cradle: [], chim: [], boiler: [] }, L = W.e.lay;
  W.frame(120, 1 / 30, (W2, i) => {
    if (i % 15 === 0) W.audio.beats.push(1);
    ch.jolt.push(W.e.jolt); ch.engZ.push(W.e.eng.position.z);
    if (L.J) { ch.jx.push(L.J.position.x); ch.jrot.push(L.legs[0].rotation.z); ch.cradle.push(L.W.position.x - L.J.position.x); }
    if (L.chimP) { ch.chim.push(L.chimP.rotation.z); ch.boiler.push(L.boilerP.rotation.z); }
  });
  const span = a => a.length ? Math.max(...a) - Math.min(...a) : 0;
  return Object.fromEntries(Object.entries(ch).map(([k, a]) => [k, span(a)]));
}

test('jet and steam show the beat although they barely rock: the jet stand leans on its springy legs, the boiler and chimney rock', () => {
  const jet = beatMotion('jet', 1), steam = beatMotion('steam', 1);
  assert.ok(jet.jolt > 0.8, `beat spring ${jet.jolt}`);
  assert.ok(jet.jx > 0.037 && jet.jx < 0.11, `jet surge ${jet.jx}`);            // 0.75 of the first version (0.128): it looked like it would break the stand
  assert.ok(jet.jrot > 0.022 && jet.jrot < 0.09, `jet stand legs lean ${jet.jrot}`);
  assert.ok(jet.cradle < 1e-9, 'the cradles ride with the engine');
  assert.ok(steam.chim > 0.012, `chimney ${steam.chim}`);
  assert.ok(steam.boiler > 0.004, `boiler ${steam.boiler}`);
  assert.ok(steam.engZ > 0.015, `steam bed ${steam.engZ}`);
  // sway 0 switches it all off
  const jet0 = beatMotion('jet', 0), steam0 = beatMotion('steam', 0);
  for (const [k, v] of Object.entries(jet0)) assert.ok(v < 1e-3 || k === 'jx', `jet ${k} ${v} with sway 0`);
  assert.ok(jet0.jx < 0.05, `jet surge ${jet0.jx} with sway 0`);   // only the steady thrust push, scaled by sway too
  for (const [k, v] of Object.entries(steam0)) assert.ok(v < 1e-3, `steam ${k} ${v} with sway 0`);
});

test('flame jets and fireballs start at the stack tips in world space (after sway)', () => {
  const W = world();
  const T = W.g.THREE;
  for (const id of ['v', 'inline', 'radial', 'rotary']) {
    W.build(8, id, '1');
    W.rev(1);
    W.sim.flame = 1;
    W.e.update(1 / 30, W.sim, 1, 'high');
    for (const c of W.e.stacks) {
      assert.ok(c.tipW.distanceTo(W.e.eng.localToWorld(c.tip.clone())) < 1e-9, `${id}: tipW`);
      assert.ok(c.jet.visible, `${id}: jet hidden at full flame`);
      assert.ok(c.jet.material.uniforms.uOrigin.value.distanceTo(c.tipW) < 1e-9, `${id}: jet origin`);
      assert.ok(Math.abs(c.dirW.length() - 1) < 1e-9);
    }
    const P = W.e.flames, c0 = P.cursor;
    W.e.lay._backfire(1);
    const tips = W.e.stacks.map(c => c.tipW);
    const n = (P.cursor - c0 + P.max) % P.max;
    assert.ok(n > 0, 'backfire spawns particles');
    for (let k = 0; k < n; k++) {
      const i = (c0 + k) % P.max, p = new T.Vector3(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]);
      assert.ok(tips.some(t => t.distanceTo(p) < 1e-6), `${id}: particle born away from every tip`);
    }
    W.sim.flame = 0; W.frame(30, 1 / 30, () => { W.sim.flame = 0; W.sim.pedalIn = false; W.audio.power = 0; W.audio.intensity = 0; });
    assert.ok(W.e.stacks.every(c => !c.jet.visible), `${id}: jets stay lit without flame`);
  }
});

test('every effect event is handled by every layout without errors', () => {
  const W = world();
  for (const id of IDS) {
    W.build(4, id, '2');
    W.rev(1);
    for (const type of ['backfire', 'smoke', 'bov', 'start', 'vent']) {
      W.sim.events.push({ type, k: 1 });
      W.frame(3);
    }
    const live = ps => Array.from(ps.life).filter(v => v > 0).length;
    assert.ok(live(W.e.flames) + live(W.e.smoke) > 0, `${id}: no particles at all`);
  }
});

test('steam 8: the particle pools never run full (chuffs, drain cocks, smoke, sparks)', () => {
  const W = world();
  W.build(8, 'steam', '0');
  let maxSmoke = 0, maxFire = 0;
  const live = ps => { let n = 0; for (const v of ps.life) if (v > 0) n++; return n; };
  W.frame(90, 1 / 30, () => { W.audio.level = 0.3; W.audio.silentTime = 0; maxSmoke = Math.max(maxSmoke, live(W.e.smoke)); }); // start: drain cocks
  W.sim.pedalIn = true;
  W.frame(300, 1 / 30, () => { maxSmoke = Math.max(maxSmoke, live(W.e.smoke)); maxFire = Math.max(maxFire, live(W.e.flames)); });
  assert.ok(maxSmoke > 50, `hardly any steam (${maxSmoke})`);
  assert.ok(maxSmoke < W.e.smoke.max * 0.9, `smoke pool nearly full: ${maxSmoke}/${W.e.smoke.max}`);
  assert.ok(maxFire < W.e.flames.max * 0.9, `flame pool nearly full: ${maxFire}/${W.e.flames.max}`);
});

test('cutaway shows the moving parts and ghosts the block; off hides them', () => {
  const W = world();
  for (const id of IDS) {
    W.build(6, id, 'sc');
    const M = W.e.mats;
    W.e.setCutaway(false);
    assert.ok(W.e.cyls.every(c => c.moving.every(o => !o.visible)), `${id}: moving parts visible without cutaway`);
    assert.equal(M.block.transparent, false); assert.equal(M.block.opacity, 1);
    assert.ok((W.e._edgeList || []).every(l => !l.visible));
    W.e.setCutaway(true);
    assert.ok(W.e.cyls.every(c => c.moving.every(o => o.visible)), `${id}: moving parts hidden in cutaway`);
    assert.equal(M.block.transparent, true); assert.ok(M.block.opacity < 0.5);
    assert.equal(M.blowerCase.transparent, true);
    assert.ok((W.e._edgeList || []).every(l => l.visible));
    let ghosts = false; W.e.eng.traverse(o => { if (o.isMesh && o.material === M.block) ghosts = true; });
    if (ghosts) assert.ok((W.e._edgeList || []).length > 0, `${id}: no ghost edges`);   // (the rocket has no casing to ghost)
  }
});

test('butterflies open with the throttle and close when the engine stops', () => {
  const W = world();
  W.build(8, 'v', 'sc');
  const flaps = W.e.parts[0].flaps;
  W.frame(10);
  assert.ok(flaps.every(f => Math.abs(f.rotation.z) < 1e-6), 'closed while off/lamptest');
  W.rev(2);
  const open = flaps[0].rotation.z * 180 / Math.PI;
  assert.ok(open > 60 && open <= 85 + 1e-9, `open ${open.toFixed(1)}°`);
  assert.ok(flaps.every(f => f.rotation.z === flaps[0].rotation.z), 'all on one shaft');
  W.sim.ignition = false; W.frame(30);
  assert.ok(flaps[0].rotation.z < 0.05, 'closed with the key off');
});

test('combustion glow: a cylinder glows right after it fires, never with the engine off', () => {
  const W = world();
  W.build(4, 'inline', '0');
  W.rev(0.5);
  W.sim.pedalIn = false;
  let glowed = 0;
  W.frame(60, 1 / 60, () => { if (W.e.cyls.some(c => c.pm.emissiveIntensity > 0.3)) glowed++; });
  assert.ok(glowed > 10, `glowed in ${glowed}/60 frames`);
  W.sim.ignition = false; W.frame(30);
  assert.ok(W.e.cyls.every(c => c.pm.emissiveIntensity === 0));
});

test('NaN or a zero redline never sticks in the engine (the vanishing-engine bug)', () => {
  const W = world();
  for (const id of ['v', 'jet', 'steam']) {
    W.build(8, id, '1');
    W.rev(1);
    for (const poison of [s => { s.rpm = NaN; }, s => { s.settings.redline = 0; }, s => { s.kick = Infinity; }, s => { s.boost = NaN; }]) {
      poison(W.sim);
      W.e.update(1 / 30, W.sim, 1, 'high');
      W.sim.settings.redline = 7000;
      W.frame(3);
      for (const k of ['crank', 'crankTotal', 'heat', 'flash', 'rock', 'lean', 'vibA', 'ph1', 'ph2', 'ph3', 'phI', 'lift', 'mountY'])
        assert.ok(Number.isFinite(W.e[k]), `${id}: ${k} = ${W.e[k]}`);
      const r = W.e.eng.rotation, p = W.e.eng.position;
      assert.ok([r.x, r.y, r.z, p.x, p.y, p.z].every(Number.isFinite), `${id}: engine transform`);
      assert.ok(W.e.spinners.every(s => Number.isFinite(s.a)));
    }
  }
});

test('animation speed and quality settings: no errors, sparks only above low quality', () => {
  const W = world();
  W.build(8, 'v', '1');
  W.rev(1);
  for (const q of ['low', 'medium', 'high']) {
    W.e.setQuality(q);
    for (const anim of [0, 0.25, 2]) W.frame(5, 1 / 30, () => { W.sim.flame = 1; }, anim, q);
  }
  assert.equal(W.e.ground.visible, true);
  W.e.setQuality('low');
  assert.equal(W.e.ground.visible, false);
});
