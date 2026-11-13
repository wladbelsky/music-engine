'use strict';
/* The fire's light (stage 3 of the three r187 work): flameLight is the logical light the core and the layouts
   drive; Engine3D._placeFire() (in render()) splits it over a fixed pool of physical point lights at the layout's
   fireLights() points, with a flame shadow and a lit pool on the floor that follow it. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('../helpers/scene');
const { LAYOUT_IDS } = require('../helpers/load');

const fin = v => [v.x, v.y, v.z].every(Number.isFinite);

test('every layout: fireLights() is null or up to 3 finite world points near the fire, with weights', () => {
  for (const id of LAYOUT_IDS) {
    const W = world().build(8, id).rev(2);
    W.frame(10, 1 / 30, w => { w.sim.flame = 1; });
    const pts = W.e.lay.fireLights(), gp = W.e.lay.glowPoint();
    if (pts === null) continue;
    assert.ok(Array.isArray(pts) && pts.length >= 1 && pts.length <= 3, `${id}: ${pts && pts.length} points`);
    for (const f of pts) {
      assert.ok(fin(f.p), `${id}: point ${JSON.stringify(f.p)}`);
      assert.ok(Number.isFinite(f.w) && f.w >= 0, `${id}: weight ${f.w}`);
      // the fire is around the engine's own size from its glow point (not at the origin, not miles away)
      assert.ok(f.p.distanceTo(gp) < 6, `${id}: a fire light ${f.p.distanceTo(gp).toFixed(2)} away from the glow point`);
    }
    assert.ok(pts.reduce((a, f) => a + f.w, 0) > 0, `${id}: all weights 0`);
  }
});

test('the pool carries all of the flame light (split by weight), nothing when it is out; the floor and the shadow follow', () => {
  for (const id of ['v', 'jet', 'steam', 'electric']) {
    const W = world().build(8, id);
    const e = W.e, sum = () => e.fire.reduce((a, L) => a + L.intensity, 0);
    W.sim.ignition = false; W.frame(20); e.render();
    // with the key off: the pool carries exactly flameLight (the steam firebox stays banked, dimly lit), and
    // nothing at all where flameLight is out
    assert.ok(Math.abs(sum() - e.flameLight.intensity * e.flameK) < 1e-9, `${id}: off: the pool carries ${sum()}`);
    if (e.flameLight.intensity === 0) {
      assert.equal(e.fire[0].shadow.intensity, 0, `${id}: a flame shadow with no flame`);
      assert.ok(e.floorGlow.material.uniforms.uCol.value.every(c => c.r + c.g + c.b === 0), `${id}: the floor glows with no fire`);
    } else assert.equal(id, 'steam', `${id}: a fire light with the key off`);
    W.sim.ignition = true; W.rev(2); W.frame(10, 1 / 30, w => { w.sim.flame = 1; });
    e.render();
    const I = e.flameLight.intensity * e.flameK;
    assert.ok(I > 0, `${id}: no flame light at full flame`);
    assert.ok(Math.abs(sum() - I) < 1e-6 * I, `${id}: the pool carries ${sum()} of ${I}`);
    assert.ok(e.fire.every(L => fin(L.position) && L.color.equals(e.flameLight.color)), `${id}: a light off the fire or of another colour`);
    assert.ok(e.fire[0].shadow.intensity > 0 && e.fire[0].shadow.intensity <= 0.5, `${id}: shadow ${e.fire[0].shadow.intensity}`);
    assert.ok(e.floorGlow.material.uniforms.uCol.value.some(c => c.r > 0), `${id}: the floor stays dark under the fire`);
  }
});

test('a fixed number of fire lights in every layout (a change would recompile every shader); shadows only on high', () => {
  const W = world().build(8, 'v');
  const n = () => { let k = 0; W.e.scene.traverse(o => { if (o.isPointLight) k++; }); return k; };
  const n0 = n();
  for (const id of LAYOUT_IDS) { W.build(6, id); assert.equal(n(), n0, `${id}: ${n()} point lights`); }
  for (const [q, cast] of [['low', false], ['medium', false], ['high', true]]) {
    W.e.setQuality(q);
    assert.equal(W.e.fire[0].castShadow, cast, `${q}: flame shadow ${W.e.fire[0].castShadow}`);
    assert.equal(W.e.floorGlow.visible, q !== 'low', `${q}: floor glow ${W.e.floorGlow.visible}`);
  }
});
