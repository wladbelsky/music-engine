'use strict';
/* moving parts: pistons, rods, throws, rotors, spinners; firing counts at big frame steps */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('../helpers/scene');

const W = world();
const { g, e, sim } = W;
const T = g.THREE, { CR } = g.Engine3D.GEO;
const V = (x, y, z) => new T.Vector3(x, y, z);

/* place the crank at `crank` degrees without moving it (dt ~ 0, rpm 0) */
function poseAt(crank) {
  sim.rpm = 0; e.crank = crank; e.crankTotal = crank;
  e.update(1e-6, sim, 1, 'high');
  e.root.updateMatrixWorld(true);
}
const pistonPin = c => c.bank.grp.localToWorld(V(c.x, c.piston.position.y - 0.08, c.zo));
const crankPin = c => c.throwG.localToWorld(V(0, CR, 0));

test('slider-crank layouts: the rod joins crank pin and piston pin, full stroke, TDC at the firing point', () => {
  sim.ignition = false;                  // poses only, nothing may move on its own; the later tests need the key on
  try {
  for (const [id, n] of [['inline', 4], ['v', 8], ['boxer', 6], ['w', 12], ['radial', 9], ['radial', 14], ['radial', 28], ['inline', 1]]) {
    W.build(n, id, '0');
    for (const c of e.cyls) {
      let top = -Infinity, bot = Infinity, topAt = 0;
      for (let k = 0; k < 72; k++) {
        const crank = (c.phase + k * 10) % 720;
        poseAt(crank);
        const pp = pistonPin(c), cp = crankPin(c);
        assert.ok(Math.abs(pp.distanceTo(cp) - c.rodL) < 1e-3, `${id}${n} cyl ${c.i}: rod ${pp.distanceTo(cp).toFixed(4)} vs ${c.rodL}`);
        // the rod mesh itself spans those two points
        const a = c.rod.localToWorld(V(0, c.rodL / 2, 0)), b = c.rod.localToWorld(V(0, -c.rodL / 2, 0));
        assert.ok(a.distanceTo(pp) < 1e-3 && b.distanceTo(cp) < 1e-3, `${id}${n} cyl ${c.i}: rod mesh off its pins at ${crank}`);
        const y = c.piston.position.y;
        if (y > top) { top = y; topAt = k * 10; }
        bot = Math.min(bot, y);
      }
      // TDC at the firing point; offset bores (W rows, zo) move it by asin(zo / (rod + crank)) (desaxé)
      const off = Math.asin(Math.abs(c.zo) / (c.rodL + CR)) / Math.PI * 180, dist = Math.min(topAt % 360, 360 - topAt % 360);
      assert.ok(dist <= off + 10 + 1e-9, `${id}${n} cyl ${c.i}: TDC ${dist} deg away from the firing point`);
      const L = c.rodL, e2 = c.zo * c.zo, stroke = Math.sqrt((L + CR) ** 2 - e2) - Math.sqrt((L - CR) ** 2 - e2); // 2·CR without an offset
      assert.ok(Math.abs(top - bot - stroke) < 0.005, `${id}${n} cyl ${c.i}: stroke ${(top - bot).toFixed(4)} vs ${stroke.toFixed(4)}`);
    }
  }
  } finally { sim.ignition = true; }
});

test('radial: every cylinder of a row runs on the same crank pin (master-rod style)', () => {
  for (const n of [9, 14, 27, 28]) {
    W.build(n, 'radial', '0');
    for (const crank of [0, 37, 250, 511]) {
      poseAt(crank);
      const byRow = new Map();
      for (const c of e.cyls) {
        const p = crankPin(c), r = c.bank.row;
        if (!byRow.has(r)) byRow.set(r, p); else assert.ok(byRow.get(r).distanceTo(p) < 1e-6, `radial ${n} row ${r}: pins disagree`);
      }
    }
  }
});

/* firing phases: evenly spread over the cycle (period 720, rotary 360, steam 180 = double acting) */
function gaps(cyls) {
  const per = cyls[0].period || 720, ph = cyls.map(c => ((c.phase % per) + per) % per).sort((a, b) => a - b);
  return ph.map((p, i) => (i < ph.length - 1 ? ph[i + 1] : ph[0] + per) - p);
}
test('firing is evenly spaced: inline, V, boxer, W, rotary, steam', () => {
  for (const id of ['inline', 'v', 'boxer', 'w', 'rotary', 'steam']) for (const n of [1, 2, 3, 4, 5, 6, 8, 12, 16, 32]) {
    W.build(n, id, '0');
    const per = e.cyls[0].period || 720, want = per / e.n;
    for (const d of gaps(e.cyls)) assert.ok(Math.abs(d - want) < 1e-6, `${id}${e.n}: gap ${d} vs ${want}`);
  }
});
test('radial: firing is evenly spaced within each row', () => {
  for (const n of [3, 5, 7, 9, 14, 18, 27, 28]) {
    W.build(n, 'radial', '0');
    const rows = new Map();
    for (const c of e.cyls) { const r = c.bank.row; if (!rows.has(r)) rows.set(r, []); rows.get(r).push(c); }
    for (const [r, cs] of rows) for (const d of gaps(cs)) assert.ok(Math.abs(d - 720 / cs.length) < 1e-6, `radial ${e.n} row ${r}: gap ${d}`);
  }
});
test('radial: rows interleave, no two cylinders fire together', () => {
  for (const n of [14, 18, 27, 28]) {
    W.build(n, 'radial', '0');
    for (const d of gaps(e.cyls)) assert.ok(Math.abs(d - 720 / e.n) < 1e-6, `radial ${e.n}: gap ${d.toFixed(1)} vs ${(720 / e.n).toFixed(1)}`);
  }
});

test('rotary: the apex seals follow the housing bore over the whole turn', () => {
  for (const n of [1, 2, 3]) {
    W.build(n, 'rotary', '0');
    const lay = e.lay, G = lay._rotorGeo(), bore = lay._troch(lay.R, 2000);
    for (const c of e.cyls) {
      let worst = 0;
      for (let crank = 0; crank < 720; crank += 4) {
        lay.animate(c, 0, crank); c.rotor.updateMatrix();
        for (let k = 0; k < 3; k++) {
          const [u, v] = G.ap(k), p = V(0, v, u).applyMatrix4(c.rotor.matrix);
          let d = Infinity; for (const q of bore) d = Math.min(d, Math.hypot(q.x - p.z, q.y - p.y));
          worst = Math.max(worst, d);
        }
      }
      assert.ok(worst < 0.02, `${n}-rotor #${c.i}: an apex leaves the bore by ${worst.toFixed(4)}`);
    }
  }
});

test('firings and exhaust pulses are counted on the unwrapped crank: a huge frame step skips none', () => {
  for (const [id, n] of [['v', 8], ['rotary', 2], ['steam', 4]]) {
    W.build(n, id, '1');
    W.rev(2);
    assert.equal(sim.state, 'running', `${id}: not running`);
    const c0 = e.cyls.map(c => c.nFire), tot0 = e.crankTotal;
    let pulses = 0, want = 0, multi = 0;
    const orig = e.lay.exhaustPulse;
    e.lay.exhaustPulse = (c, s) => { pulses++; return orig.call(e.lay, c, s); };
    for (let i = 0; i < 40; i++) {
      const before = e.cyls.map(c => c.nExh);
      sim.rpm = 9000;
      e.update(0.1, sim, 2, 'high');             // ~900 deg per frame: more than a whole cycle
      e.cyls.forEach((c, k) => { const d = c.nExh - before[k]; want += Math.min(3, d); if (d > 1) multi++; });
    }
    e.lay.exhaustPulse = orig;
    const per = e.cyls[0].period || 720;
    e.cyls.forEach((c, i) => {
      const w = Math.floor((e.crankTotal - c.phase) / per) - Math.floor((tot0 - c.phase) / per);
      assert.equal(c.nFire - c0[i], w, `${id}: cyl ${i} fired ${c.nFire - c0[i]}, want ${w}`);
    });
    assert.ok(multi > 0, `${id}: the test step never crossed two cycles in a frame`);
    assert.equal(pulses, want, `${id}: ${pulses} exhaust pulses, want ${want} (every crossing, max 3 per frame)`);
  }
});

test('crank-linked spinners never jump at the 720° wrap; pitch-capped spinners never strobe', () => {
  W.build(9, 'radial', '0');              // prop hub: ratio 0.6, pitch 120
  W.rev(1);
  assert.equal(sim.state, 'running');
  const hub = e.spinners.find(s => s.pitch === 120);
  assert.ok(hub, 'prop hub spinner');
  for (const rpm of [800, 3000, 9000]) {
    sim.rpm = rpm;
    const a0 = hub.a;
    e.update(1 / 30, sim, 2, 'high');
    const step = Math.abs(((hub.a - a0 + 540) % 360) - 180);
    assert.ok(step <= 0.4 * 120 + 1e-9, `hub step ${step} at ${rpm}`);
    assert.ok(Math.abs(hub.over - 0.6 * rpm / 60 * 360 * 0.085 * 2 / 30 / 120) < 1e-6, 'over = the real step in pitches');
  }
  W.build(8, 'jet', '0');
  W.rev(1);
  const spool = e.spinners.find(s => s.pitch === 18);
  assert.ok(spool, 'jet spool spinner (pitch 18)');
  sim.rpm = 7000; e.update(1 / 30, sim, 2, 'high');
  assert.ok(spool.over > 0.4, 'spool is fast enough to be capped');

  W.build(8, 'v', 'sc');                  // blower rotors are crank-linked (overdriven): no cap, no jumps
  const linked = e.spinners.filter(s => !s.pitch);
  assert.ok(linked.length >= 4);
  e.crank = 715; sim.rpm = 3000;
  const before = linked.map(s => s.a);
  e.update(1 / 30, sim, 1, 'high');       // crosses 720 -> 0
  const dCrank = 3000 / 60 * 360 * 0.085 / 30;
  linked.forEach((s, i) => {
    const step = (((s.a - before[i]) % 360) + 360) % 360, want = (((dCrank * s.ratio) % 360) + 360) % 360;
    assert.ok(Math.abs(step - want) < 1e-6, `spinner ratio ${s.ratio}: stepped ${step}, want ${want}`);
  });
});

test('turbo wheels spin with boost and never step more than 0.4 of a blade', () => {
  W.build(8, 'v', '4');
  const w = e.compressors[0];
  const step = dt => { const r0 = w.rotation.x; e.update(dt, sim, 1, 'high'); return w.rotation.x - r0; };
  sim.ignition = false;
  W.frame(90);                            // key off: no boost
  assert.equal(sim.state, 'off');
  const idle = step(1 / 300), boost0 = sim.boost;
  sim.ignition = true;
  W.rev(3);                               // full throttle: the turbos spool up
  assert.equal(sim.state, 'running');
  assert.ok(sim.boost > 1.3 && boost0 < 0.1, `boost ${boost0} -> ${sim.boost}`);
  const spooled = step(1 / 300);          // a small step stays under the cap, so it shows the boost
  assert.ok(idle > 0, 'wheels turn slowly without boost');
  assert.ok(spooled > 2 * idle, `wheel step ${spooled} at ${sim.boost.toFixed(2)} bar vs ${idle} at ${boost0.toFixed(2)} bar`);
  for (let i = 0; i < 5; i++) assert.ok(step(1 / 30) <= 0.4 * Math.PI / 4 + 1e-9, 'step over 0.4 blade at 30 fps');
});
