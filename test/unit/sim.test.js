'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const { fakeAudio } = require('../helpers/scene');

const MUSIC = { silentTime: 0, level: 0.3, intensity: 0.5, power: 0.5 };
const SILENCE = { level: 0, intensity: 0, power: 0 };

/* runs the sim at a fixed step; `each(sim, t)` may change the audio; returns the recorded states/events */
function make(settings = {}) {
  const g = load();
  const sim = new g.EngineSim();
  Object.assign(sim.settings, settings);
  const a = fakeAudio();
  const rec = { states: [], events: [], t: 0 };
  rec.run = (secs, audio, each, dt = 1 / 30) => {
    for (let i = 0; i < Math.round(secs / dt); i++) {
      rec.t += dt;
      if (audio) Object.assign(a, audio);
      if (a.level < 0.004) a.silentTime += dt;
      if (each) each(sim, rec.t);
      sim.update(dt, a, rec.t);
      if (rec.states[rec.states.length - 1]?.s !== sim.state) rec.states.push({ s: sim.state, t: rec.t });
      for (const e of sim.takeEvents()) rec.events.push(Object.assign({ t: rec.t, state: sim.state }, e));
    }
    return rec;
  };
  return { g, sim, a, rec };
}
const seq = rec => rec.states.map(x => x.s).join(' > ');
const finite = (sim, keys = ['rpm', 'target', 'throttle', 'boost', 'temp', 'flame', 'kick', 'pedal', 'stateT']) =>
  keys.forEach(k => assert.ok(Number.isFinite(sim[k]), `${k} = ${sim[k]}`));

test('key on with music: off > lamptest > cranking > running, with the start events', () => {
  const { rec } = make();
  rec.run(4, MUSIC);
  assert.equal(seq(rec), 'lamptest > cranking > running');
  const tRun = rec.states[2].t;
  assert.ok(tRun > 1.9 && tRun < 2.2, `running after ${tRun.toFixed(2)} s`);
  const types = rec.events.map(e => e.type);
  assert.ok(types.includes('start') && types.includes('smoke'));
});

test('silence stalls after stallDelay, sound restarts it', () => {
  const { sim, a, rec } = make({ stallDelay: 3 });
  rec.run(4, MUSIC);
  a.silentTime = 0;
  rec.run(2.9, SILENCE);
  assert.equal(sim.state, 'running', 'not before the delay');
  rec.run(3, SILENCE);
  assert.equal(sim.state, 'stalled');
  assert.ok(sim.rpm < 150);
  assert.ok(sim.warn.stall && sim.warn.battery && sim.warn.oil);
  rec.run(3, MUSIC);
  assert.equal(sim.state, 'running');
  assert.match(seq(rec), /running > stalling > stalled > cranking > running$/);
});

test('stallDelay setting is respected', () => {
  const { sim, a, rec } = make({ stallDelay: 10 });
  rec.run(4, MUSIC); a.silentTime = 0;
  rec.run(9, SILENCE);
  assert.equal(sim.state, 'running');
  rec.run(2, SILENCE);
  assert.notEqual(sim.state, 'running');
});

test('lamp test lights every lamp except the limiter; key off turns them all off', () => {
  const { sim, rec } = make();
  rec.run(0.5, MUSIC);
  assert.equal(sim.state, 'lamptest');
  for (const [k, v] of Object.entries(sim.warn)) assert.equal(v, k !== 'limiter', k);
  rec.run(3, MUSIC);
  sim.ignition = false;
  rec.run(0.1, MUSIC);
  assert.equal(sim.state, 'off');
  assert.ok(Object.values(sim.warn).every(v => v === false));
  rec.run(3, MUSIC);
  assert.ok(sim.rpm < 1, 'spins down with the key off');
});

test('the pedal wakes a stalled engine and revs it; it does nothing with the key off', () => {
  const { sim, rec } = make();
  rec.run(5, SILENCE);
  assert.equal(sim.state, 'stalled');
  sim.pedalIn = true;
  rec.run(4);
  assert.equal(sim.state, 'running');
  assert.ok(sim.rpm > 6500, `rpm ${sim.rpm}`);
  const lim = sim.settings.redline * 1.03;
  let maxRpm = 0, limiter = false;
  rec.run(3, null, s => { maxRpm = Math.max(maxRpm, s.rpm); limiter = limiter || s.limiter; });
  assert.ok(maxRpm <= lim + 1, `rpm ${maxRpm} over the limiter ${lim}`);
  assert.ok(limiter && sim.warn.redline);

  const off = make();
  off.sim.ignition = false; off.sim.pedalIn = true;
  off.rec.run(2, SILENCE);
  assert.equal(off.sim.state, 'off');
  assert.equal(off.sim.pedal, 0);
});

test('releasing the pedal from high rpm pops (backfire) and, with a turbo, blows off (bov)', () => {
  for (const [turbos, bov] of [[1, true], [0, false]]) {
    const { sim, rec } = make({ turbos });
    rec.run(4, MUSIC, null);
    sim.pedalIn = true; rec.run(3);
    sim.pedalIn = false; rec.run(1, { intensity: 0.05, power: 0.05 });
    const after = rec.events.filter(e => e.t > 7);
    assert.ok(after.some(e => e.type === 'backfire'), `turbos ${turbos}: no backfire`);
    assert.equal(after.some(e => e.type === 'bov'), bov, `turbos ${turbos}: bov`);
  }
});

test('junk redline and NaN in the state never stick (the vanishing-engine bug)', () => {
  for (const red of [0, NaN, 7, -5, undefined]) {   // main.js clamps the property to 500–15000; the sim still survives these
    const { sim, rec } = make({ redline: red });
    rec.run(4, MUSIC);
    sim.pedalIn = true; rec.run(2);
    finite(sim);
  }
  const { sim, rec } = make();
  rec.run(4, MUSIC);
  for (const k of ['rpm', 'kick', 'throttle', 'pedal', 'temp', 'flame', 'stateT']) sim[k] = NaN;
  rec.run(1 / 30, MUSIC);
  finite(sim);
  assert.equal(sim.temp, sim.temp);
});

test('no flames or running pops below FIRE_RPM (2500), whatever the redline', () => {
  const { sim, rec } = make({ redline: 500, flameThr: 0.2 });
  rec.run(4, { ...MUSIC, intensity: 1, power: 1 });
  sim.pedalIn = true;
  let flame = 0;
  rec.run(4, null, s => { flame = Math.max(flame, s.flame); s.pedalIn = Math.floor(rec.t * 2) % 2 === 0; });
  assert.ok(sim.rpm < 2500);
  assert.equal(flame, 0);
  assert.equal(rec.events.filter(e => e.type === 'backfire' && e.state === 'running').length, 0);
});

test('flames come on above the threshold at high rpm and go out below it', () => {
  const { sim, rec } = make({ flameThr: 0.62 });
  rec.run(4, MUSIC);
  sim.pedalIn = true; rec.run(2, { power: 1, intensity: 1 });
  assert.ok(sim.flame > 0.5, `flame ${sim.flame}`);
  sim.pedalIn = false; rec.run(3, { power: 0.2, intensity: 0.2 });
  assert.ok(sim.flame < 0.05, `flame ${sim.flame}`);
});

/* ---------------- boost sources ---------------- */
function boostRun(settings, pedalSecs = 3) {
  const m = make(settings);
  m.rec.run(4, { ...MUSIC, intensity: 0.05, power: 0.05 });   // idle-ish
  const idle = m.sim.boost;
  const trace = [];
  m.sim.pedalIn = true;
  m.rec.run(pedalSecs, null, s => trace.push(s.boost));
  return { ...m, idle, trace, max: Math.max(...trace) };
}

test('naturally aspirated: manifold vacuum only (-0.65 … 0)', () => {
  const { idle, trace } = boostRun({ turbos: 0, blower: false });
  assert.ok(idle < -0.3, `idle ${idle}`);
  for (const b of trace) assert.ok(b >= -0.66 && b <= 0.001, `boost ${b}`);
});

test('turbo: lags, needs revs, tops out at 1.6', () => {
  const { idle, trace, max, sim } = boostRun({ turbos: 1 });
  assert.ok(idle < 0.2, `idle ${idle}`);
  assert.ok(trace[9] < 0.8, `already ${trace[9]} bar 0.3 s after the pedal`);
  assert.ok(max > 1.4 && max <= 1.6 + 1e-9, `max ${max}`);
  assert.equal(sim.maxBoost, 1.6);
});

test('Roots blower: nearly instant; twincharged is the max of both', () => {
  const sc = boostRun({ turbos: 0, blower: true });
  const tb = boostRun({ turbos: 1 });
  assert.ok(sc.trace[9] > tb.trace[9] + 0.3, `blower ${sc.trace[9]} vs turbo ${tb.trace[9]} at 0.3 s`);
  assert.ok(sc.max <= 1.1 + 1e-9, `blower max ${sc.max}`);
  const tw = boostRun({ turbos: 2, blower: true });
  assert.ok(tw.trace[9] >= sc.trace[9] - 0.05 && tw.max >= tb.max - 0.05, 'twincharged ≥ each');
  const srcs = tw.sim._sources();
  assert.equal(srcs.length, 2);
  assert.ok(Math.abs(tw.sim.boost - Math.max(...srcs.map(s => s.v))) < 1e-12);
});

test('steam: boiler pressure rests at 7.5 with the key on, vents near the top at most every 3 s', () => {
  const m = make({ kind: 'steam', turbos: 0 });
  m.sim.ignition = false; m.rec.run(20, SILENCE);
  assert.ok(Math.abs(m.sim.boost) < 0.05, `off: ${m.sim.boost}`);
  m.sim.ignition = true; m.rec.run(20, SILENCE);
  assert.equal(m.sim.state, 'stalled');
  assert.ok(Math.abs(m.sim.boost - 7.5) < 0.1, `banked fire: ${m.sim.boost}`);
  assert.equal(m.sim.maxBoost, 14);
  m.sim.pedalIn = true;
  let max = 0;
  m.rec.run(20, { ...MUSIC, power: 1, intensity: 1 }, s => { max = Math.max(max, s.boost); });
  const vents = m.rec.events.filter(e => e.type === 'vent').map(e => e.t);
  assert.ok(vents.length >= 2, `vents: ${vents.length}`);
  for (let i = 1; i < vents.length; i++) assert.ok(vents[i] - vents[i - 1] >= 3 - 1e-9, 'vent cooldown');
  assert.ok(max < 16, `pressure ${max} over the gauge`);
  assert.ok(!m.rec.events.some(e => e.type === 'bov'), 'no blow-off valve on a steam engine');
});

test('jet: EGT lights off while cranking, scale 8.5; unknown kind falls back to piston', () => {
  const m = make({ kind: 'jet' });
  let crankMax = 0;
  m.rec.run(2.5, MUSIC, s => { if (s.state === 'cranking') crankMax = Math.max(crankMax, s.boost); });
  assert.ok(crankMax > 1.2, `light-off EGT ${crankMax}`);
  assert.equal(m.sim.maxBoost, 8.5);
  m.sim.pedalIn = true; m.rec.run(5);
  assert.ok(m.sim.boost > 6 && m.sim.boost < 9.5, `EGT ${m.sim.boost}`);

  const u = make({ kind: 'zzz', turbos: 1 });
  u.rec.run(1, MUSIC);
  assert.equal(u.sim.maxBoost, 1.6);
  assert.equal(u.sim._sources().length, 1);
});

test('switching kind / induction at runtime swaps the sources without jumps to NaN', () => {
  const { sim, rec } = make();
  rec.run(4, MUSIC);
  for (const s of [{ kind: 'steam' }, { kind: 'jet' }, { kind: 'piston', turbos: 2, blower: true }, { turbos: 0, blower: false }]) {
    Object.assign(sim.settings, s);
    rec.run(0.5, MUSIC);
    finite(sim);
  }
});
