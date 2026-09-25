'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const S = require('../helpers/signals');

const analyzer = () => new (load().AudioAnalyzer)();
const click = (bpm, lvl = 0.8) => (t, r) => S.clickFrame(t, bpm, lvl, r);

test('BPM of a steady click track is found within ±3', () => {
  for (const bpm of [90, 100, 110, 128, 140, 150, 165]) {
    const a = analyzer();
    S.feed(a, 25, click(bpm), { t0: 1 });
    assert.ok(Math.abs(a.bpm - bpm) < 3, `${bpm} bpm detected as ${a.bpm.toFixed(1)}`);
    assert.ok(a.conf > 0.5, `confidence ${a.conf} at ${bpm}`);
  }
});

test('tempos outside 80–170 are folded by octaves', () => {
  for (const [bpm, want] of [[60, 120], [200, 100], [240, 120]]) {
    const a = analyzer();
    S.feed(a, 25, click(bpm), { t0: 1 });
    assert.ok(Math.abs(a.bpm - want) < 3, `${bpm} -> ${a.bpm.toFixed(1)}, want ${want}`);
  }
});

test('a tempo change is followed within ~12 s', () => {
  const a = analyzer();
  const t = S.feed(a, 20, click(100), { t0: 1 });
  S.feed(a, 12, click(150), { t0: t });
  assert.ok(Math.abs(a.bpm - 150) < 3, `still at ${a.bpm.toFixed(1)}`);
});

test('junk input never hangs and keeps bpm finite in 80–170 (the "Page Unresponsive" bug)', () => {
  const rnd = S.rng(3);
  const frames = [
    () => S.noise(rnd, 1),
    () => new Array(128).fill(0.5),                                    // flat
    t => (Math.floor(t * 30) % 97 === 0 ? new Array(128).fill(1) : S.silence()), // rare impulses
    () => new Array(128).fill(NaN),
    () => new Array(128).fill(undefined),
    () => [],                                                          // short array
    () => S.noise(rnd, 1).map(v => -v),                                // negative
    () => S.noise(rnd, 40),                                            // way over 1
    t => (Math.sin(t * 7) > 0.99 ? S.noise(rnd, 3) : S.noise(rnd, 0.02)),
  ];
  for (const [i, f] of frames.entries()) {
    // precomputed here, pushed inside the vm with a time limit: an endless loop becomes a failure, not a hung run
    const seq = [];
    for (let t = 1; t < 31; t += 1 / 30) seq.push([f(t, rnd), t]);
    const g = load();
    g.seq = seq;
    try { g.run('globalThis.a = new AudioAnalyzer(); for (const [arr, t] of seq) a.push(arr, t);', 5000); }
    catch (e) { assert.fail(`frame kind ${i}: ${e.message}`); }
    const a = g.a;
    assert.ok(Number.isFinite(a.bpm) && a.bpm >= 80 && a.bpm <= 170, `kind ${i}: bpm ${a.bpm}`);
    for (const k of ['intensity', 'power', 'level', 'conf', 'density']) assert.ok(Number.isFinite(a[k]), `kind ${i}: ${k} = ${a[k]}`);
  }
});

test('irregular callback timing (duplicate timestamps, gaps, clock jumps back) stays sane', () => {
  const a = analyzer();
  const rnd = S.rng(5);
  let t = 1;
  for (let i = 0; i < 3000; i++) {
    const r = rnd();
    t += r < 0.05 ? 0 : r < 0.08 ? 2 : r < 0.09 ? -0.5 : 1 / 30;
    a.push(S.clickFrame(t, 128, 0.8, rnd), t);
  }
  assert.ok(Number.isFinite(a.bpm) && a.bpm >= 80 && a.bpm <= 170, `bpm ${a.bpm}`);
});

test('silence: silentTime grows on quiet frames and resets on sound', () => {
  const a = analyzer();
  assert.ok(a.silentTime >= 3, 'starts silent so the engine starts stalled');
  let t = S.feed(a, 2, click(120), { t0: 1 });
  assert.equal(a.silentTime, 0);
  t = S.feed(a, 4, S.silence, { t0: t });
  assert.ok(a.silentTime > 3.5 && a.silentTime < 4.5, `silentTime ${a.silentTime}`);
  S.feed(a, 0.2, click(120), { t0: t });
  assert.equal(a.silentTime, 0);
});

test('tick(): no callbacks at all counts as silence and clears the bands', () => {
  const a = analyzer();
  const t = S.feed(a, 3, click(120), { t0: 1 });
  assert.ok(a.bands.some(v => v > 0));
  a.tick(t + 0.2);                             // a normal gap between callbacks: nothing happens
  assert.ok(a.level > 0);
  a.tick(t + 5);
  assert.ok(a.silentTime >= 5 - 1e-9, `silentTime ${a.silentTime}`);
  assert.equal(a.level, 0);
  assert.ok(a.bands.every(v => v === 0), 'bands cleared');
  const p = a.power;
  for (let i = 1; i < 60; i++) a.tick(t + 5 + i / 30);
  assert.ok(a.power < p * 0.2, 'power decays without callbacks');
});

test('beats are queued once and louder music gives more power', () => {
  const a = analyzer();
  S.feed(a, 6, click(120), { t0: 1 });
  const beats = a.takeBeats();
  assert.ok(beats.length >= 8, `only ${beats.length} beats in 6 s at 120`);
  assert.ok(beats.every(k => k >= 0 && k <= 1));
  assert.equal(a.takeBeats().length, 0);

  const quiet = analyzer(), loud = analyzer();
  S.feed(quiet, 25, click(128, 0.8), { t0: 1 });        // long enough for the slow AGC to settle
  S.feed(loud, 25, click(128, 0.8), { t0: 1 });
  S.feed(quiet, 3, click(128, 0.15), { t0: 26 });       // the music drops
  S.feed(loud, 3, click(128, 0.8), { t0: 26 });
  for (const a2 of [quiet, loud]) for (const k of ['intensity', 'power', 'density']) assert.ok(a2[k] >= 0 && a2[k] <= 1, `${k} ${a2[k]}`);
  assert.ok(loud.power > quiet.power + 0.2, `loud ${loud.power} vs quiet ${quiet.power}`);
});

test('gain (sensitivity) scales the input', () => {
  const lo = analyzer(), hi = analyzer();
  lo.gain = 0.25; hi.gain = 3;
  S.feed(lo, 1, click(120, 0.3), { t0: 1 });
  S.feed(hi, 1, click(120, 0.3), { t0: 1 });
  assert.ok(hi.shortLoud > lo.shortLoud * 4);
  assert.ok(hi.bands.every(v => v <= 1.5), 'bands are capped at 1.5');
});
