'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');

function dash(w, h, opts = {}) {
  const g = load(), d = new g.Dash(g.fakeCanvas());
  d.set(opts); d.resize(w, h, 1);
  return { g, d };
}
const inShape = (s, x, y) => (s.r !== undefined ? Math.hypot(x - s.x, y - s.y) <= s.r : x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);

test('tach profiles: piston rpm as is, steam 0–200 rpm at the redline, jet % rpm (idle 60 %, redline 100 %)', () => {
  const p = dash(1920, 1080, { kind: 'piston', redline: 7000 }).d.prof.tach;
  assert.equal(p.map(3456), 3456);
  assert.equal(p.max, 8000);
  const s = dash(1920, 1080, { kind: 'steam', redline: 7000 }).d.prof.tach;
  assert.equal(s.map(7000), 200);
  assert.equal(s.map(0), 0);
  const j = dash(1920, 1080, { kind: 'jet', redline: 7000 }).d.prof.tach;
  assert.ok(Math.abs(j.map(850) - 60) < 1e-9);
  assert.ok(Math.abs(j.map(7000) - 100) < 1e-9);
  assert.equal(j.map(0), 0);
  for (const t of [p, s, j]) {
    let prev = -Infinity;
    for (let r = 0; r <= 8000; r += 50) { const v = t.map(r); assert.ok(v >= prev, `map not monotonic at ${r}`); prev = v; }
  }
  const u = dash(1920, 1080, { kind: 'zzz' }).d.prof;
  assert.equal(u.right.title, 'BOOST bar', 'unknown kind -> piston scales');
  assert.equal(dash(1920, 1080, { kind: 'steam' }).d.prof.right.max, 16);
  assert.equal(dash(1920, 1080, { kind: 'jet' }).d.prof.right.max, 10);
});

test('hitTest: key, pedal and odometer in their spots; odo works with the controls hidden', () => {
  for (const [w, h] of [[1920, 1080], [2560, 1080], [1080, 1920]]) {
    const { d } = dash(w, h);
    assert.equal(d.hitTest(d.keyC.x, d.keyC.y), 'key');
    assert.equal(d.hitTest(d.pedalR.x + d.pedalR.w / 2, d.pedalR.y + d.pedalR.h / 2), 'pedal');
    const O = d.odoHit;
    assert.ok(O, 'odometer hit box');
    assert.equal(d.hitTest(O.x + O.w / 2, O.y + O.h / 2), 'odo');
    assert.equal(d.hitTest(5, 5), null);
    d.set({ showControls: false });
    assert.equal(d.hitTest(d.keyC.x, d.keyC.y), null);
    assert.equal(d.hitTest(O.x + O.w / 2, O.y + O.h / 2), 'odo');
    d.set({ odoUnits: 'off' });
    assert.equal(d.hitTest(O.x + O.w / 2, O.y + O.h / 2), null, 'hidden odometer has no hit box');
  }
});

test('keepOut covers the tach, the key/pedal only when shown, the radio only when it fits', () => {
  const { d } = dash(1920, 1080);
  const ko = d.keepOut();
  assert.ok(ko.some(s => inShape(s, d.cx, d.cy)), 'tach centre');
  assert.ok(ko.some(s => inShape(s, d.keyC.x, d.keyC.y)), 'key');
  assert.ok(ko.some(s => inShape(s, d.pedalR.x + d.pedalR.w / 2, d.pedalR.y + d.pedalR.h / 2)), 'pedal');
  for (const s of ko) for (const v of Object.values(s)) assert.ok(Number.isFinite(v));
  d.set({ showControls: false });
  assert.ok(!d.keepOut().some(s => inShape(s, d.keyC.x, d.keyC.y)), 'no key area when hidden');

  const r = dash(1920, 1080, { showRadio: true }).d;
  assert.ok(r.radio, 'radio fits on 16:9');
  assert.ok(r.radio.y + r.radio.h <= 1080 * 0.955, 'clear of the taskbar');
  assert.ok(r.keepOut().some(s => s.w === Math.round(r.radio.w * 10) / 10), 'radio in keepOut');
  assert.equal(dash(1920, 1080, { showRadio: false }).d.radio, null);
  // everything the dash draws stays on the right in landscape
  for (const s of dash(1920, 1080, { showRadio: true }).d.keepOut()) assert.ok((s.r !== undefined ? s.x - s.r : s.x) > 1920 * 0.45, JSON.stringify(s));
});

test('draw() runs for every kind and state without throwing', () => {
  const g = load();
  const audio = new g.AudioAnalyzer(), media = new g.MediaInfo(), odo = new g.Odometer();
  media.mock('Artist', 'A very long title that has to scroll across the display');
  for (const kind of ['piston', 'steam', 'jet']) for (const showRadio of [false, true]) {
    const d = new g.Dash(g.fakeCanvas());
    d.set({ kind, showRadio }); d.resize(1600, 900, 1);
    const sim = new g.EngineSim();
    sim.settings.kind = kind;
    for (let i = 0; i < 90; i++) { sim.pedalIn = i > 60; sim.update(1 / 30, audio, i / 30); d.draw(sim, audio, 1 / 30, i / 30, media, odo); }
    assert.ok(Number.isFinite(d.needle));
  }
});
