'use strict';
/* Engine3D.build for every layout × forced induction × cylinder count: the scene graph, not pixels */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, meshes, IDS, INDUCTION } = require('../helpers/scene');

const W = world();
const { g, e } = W;
const { Induction, EngineLayouts: EL } = g;

function check(id, nIn, ind) {
  const tag = `${id} ${nIn} ${ind}`;
  W.build(nIn, id, ind);
  const L = EL.get(id), n = L.normCyl(nIn), eff = Induction.effective(Induction.parse(ind), L);
  assert.equal(e.n, n, tag);
  assert.equal(e.layout, id, tag);
  // cylinders (none without banks: the turbojet), and zoomie stacks on the piston layouts only
  assert.equal(e.cyls.length, e.banks.length ? n : 0, tag);
  if (id === 'steam') assert.ok(e.cyls.every(c => c.period === 180), tag);
  if (!(e.lay instanceof g.PistonLayout)) assert.equal(e.stacks.length, 0, tag);
  else {
    assert.equal(e.stacks.length, n, tag);
    for (const c of e.stacks) {
      assert.ok([c.tip.x, c.tip.y, c.tip.z].every(Number.isFinite), tag);
      assert.ok(Math.abs(c.dir.length() - 1) < 1e-6, `${tag}: stack dir not unit`);
      if (id !== 'radial') assert.ok(c.dir.y > 0.5, `${tag}: a zoomie points up (${c.dir.y})`);
      assert.ok(c.jet && c.jet.material.uniforms.uOrigin, tag);
    }
  }
  if (id === 'rotary') assert.ok(e.cyls.every(c => c.period === 360 && c.rotor));
  const gp = e.lay.glowPoint();
  if (gp) assert.ok([gp.x, gp.y, gp.z].every(Number.isFinite), `${tag}: glowPoint`);
  // forced induction parts
  if (e.lay instanceof g.PistonLayout) assert.equal(e.compressors.length, eff.turbos, `${tag}: turbo wheels`);
  else assert.equal(eff.turbos, 0, `${tag}: no induction parts`);   // its own turbocharger may spin as a compressor (marine)
  assert.equal(e.bovs.length, eff.turbos, `${tag}: BOV origins`);
  assert.deepEqual(e.parts.map(p => p.constructor.name), Induction.parts(eff).map(p => p.constructor.name), tag);
  const blower = e.parts.find(p => p.constructor.name === 'RootsBlower');
  if (eff.blower && !eff.turbos) assert.equal(blower.flaps.length, 4, `${tag}: 3 butterflies + lever`);
  if (eff.blower && eff.turbos) assert.ok(!blower.flaps, `${tag}: twincharged has a closed hat`);
  // every vertex and every matrix is finite (one NaN hides the engine)
  const ms = meshes(e.root);
  assert.ok(ms.length > 20, `${tag}: only ${ms.length} meshes`);
  for (const m of ms) {
    const p = m.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) assert.fail(`${tag}: NaN vertex in a ${m.geometry.type}`);
    assert.ok(m.matrixWorld.elements.every(Number.isFinite), `${tag}: matrix`);
  }
  // sits on the floor (rest clearance 0.02)
  assert.ok(Math.abs(e.box.min.y - 0.02) < 1e-6, `${tag}: bottom at ${e.box.min.y}`);
  assert.ok(e.foot && e.foot.length >= 9, `${tag}: foot points`);
  assert.ok(e._fitPts.length === ms.filter(m => e.eng.getObjectById(m.id)).length * 26 * 3, `${tag}: 26 fit points per engine mesh`);
}

test('every layout × every forced induction option (8 cylinders)', () => {
  for (const id of IDS) for (const ind of INDUCTION) check(id, 8, ind);
});

test('every layout × cylinder counts incl. junk', () => {
  for (const id of IDS) for (const n of [1, 2, 3, 5, 12, 16, 32, 'abc', -4, 99]) check(id, n, '1');
});

test('rebuilding does not leak scene objects', () => {
  W.build(8, 'v', '1');
  const top = e.scene.children.length;
  for (let i = 0; i < 16; i++) W.build(i % 2 ? 32 : 4, IDS[i % IDS.length], INDUCTION[i % INDUCTION.length]);
  W.build(8, 'v', '1');
  assert.equal(e.scene.children.length, top);
  assert.equal(e.scene.children.filter(o => o === e.root).length, 1);
});

test('rotary: identical parts share one geometry', () => {
  W.build(4, 'rotary', '0');
  const bodies = new Set(e.cyls.map(c => c.rotor.children[0].geometry.uuid));
  assert.equal(bodies.size, 1);
});

test('radial carries no forced induction whatever the setting', () => {
  for (const ind of INDUCTION) {
    W.build(9, 'radial', ind);
    assert.equal(e.compressors.length, 0);
    assert.equal(e.parts.length, 1);
  }
});

test('a rebuild grounds and frames the same way wherever the previous engine stopped', () => {
  for (const [id, n] of [['steam', 4], ['radial', 14], ['v', 8]]) {
    W.build(n, id, '0');
    const ref = { base: e.baseY, foot: e.foot.length, fit: Array.from(e._fitPts) };
    W.rev(1);
    W.e.crank = 200; W.e.crankTotal = 12345;   // the crank stops anywhere
    W.build(n, id, '0');
    assert.equal(e.baseY, ref.base, `${id}: baseY`);
    assert.equal(e.foot.length, ref.foot, `${id}: foot points`);
    assert.deepEqual(Array.from(e._fitPts), ref.fit, `${id}: fit points`);
    W.sim.pedalIn = false; W.sim.ignition = false; W.frame(60); W.sim.ignition = true;
  }
});
