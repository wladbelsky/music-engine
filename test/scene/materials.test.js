'use strict';
/* Physical materials (stage 5 of the three r187 work): a clear coat on the accent paint, a heat tint (thin-film
   iridescence) on the hot exhaust metal that grows with the heat but never reaches 0 (a feature switched off and on
   again recompiles the shader: a hitch in the middle of the music). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('../helpers/scene');

// the heat-tinted material of each engine that has one, and how hot it gets
const TINTED = { v: e => e.mats.header, jet: e => e.lay.pipeMat, rocket: e => e.lay.nozzleMat };

test('the accent paint is clear-coated and keeps the accent colour', () => {
  const W = world().build(8, 'v'), c = W.e.mats.cover;
  assert.ok(c.isMeshPhysicalMaterial && c.clearcoat > 0, 'no clear coat on the cover');
  W.e.setAccent(new W.g.THREE.Color(0.1, 0.6, 0.2));
  assert.deepEqual([c.color.r, c.color.g, c.color.b].map(v => +v.toFixed(3)), [0.1, 0.6, 0.2]);
});

test('the heat tint is there cold, grows with the heat and never switches off', () => {
  for (const [id, mat] of Object.entries(TINTED)) {
    const W = world().build(8, id), m = mat(W.e);
    assert.ok(m.isMeshPhysicalMaterial, `${id}: not a physical material`);
    W.sim.ignition = false; W.frame(10);
    const cold = m.iridescence;
    assert.ok(cold > 0, `${id}: no tint cold (${cold})`);
    let min = cold;
    W.sim.ignition = true; W.rev(3); W.frame(90, 1 / 30, w => { w.sim.flame = 1; w.sim.throttle = 1; min = Math.min(min, m.iridescence); });
    assert.ok(m.iridescence > cold + 0.2, `${id}: the tint does not grow with the heat (${cold} → ${m.iridescence})`);
    assert.ok(min > 0 && m.iridescence <= 1, `${id}: tint out of range (min ${min}, hot ${m.iridescence})`);
  }
});

test('additive glows are tone mapped like the fire shaders (the electric glows were raw: white blobs, no bloom)', () => {
  const { LAYOUT_IDS } = require('../helpers/load');
  for (const id of LAYOUT_IDS) {
    const W = world().build(8, id), T = W.g.THREE, raw = [];
    W.e.scene.traverse(o => {
      for (const m of [].concat(o.material || [])) if (m.blending === T.CustomBlending && m.blendDst === T.OneFactor && !m.isShaderMaterial && m.toneMapped === false) raw.push(`${o.type} ${m.type}`);
    });
    assert.deepEqual(raw, [], `${id}: additive glows outside the tone mapping`);
  }
});
