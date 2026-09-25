/* Synthetic Wallpaper Engine spectra (128 values: 64 L + 64 R, bass -> treble) at ~30 Hz. */
'use strict';

/* deterministic PRNG for the jitter / noise */
function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* a kick drum at `bpm` (plus a quiet bed and hats), like the DemoSource */
function clickFrame(t, bpm, lvl = 0.8, rnd = Math.random) {
  const ph = (t * bpm / 60) % 1, arr = new Array(128).fill(0);
  const kick = Math.exp(-ph * 9) * lvl, hat = Math.exp(-((ph + 0.5) % 1) * 14) * lvl * 0.5;
  for (let i = 0; i < 64; i++) {
    let v = lvl * 0.25 * Math.exp(-i / 40) * (0.7 + 0.3 * rnd());
    if (i < 8) v += kick * (1 - i / 10);
    if (i > 36) v += hat * 0.5 * rnd();
    arr[i] = arr[i + 64] = Math.min(1, v);
  }
  return arr;
}

const silence = () => new Array(128).fill(0);
const noise = (rnd, lvl = 0.5) => { const a = new Array(128); for (let i = 0; i < 128; i++) a[i] = rnd() * lvl; return a; };

/**
 * feed(analyzer, seconds, frameFn, {t0, fps, jitter, seed}) -> end time.
 * frameFn(t, rnd) returns the 128 array. Pushes at `fps` with timing jitter like WE's callbacks.
 */
function feed(a, seconds, frameFn, { t0 = 0, fps = 30, jitter = 0.15, seed = 7 } = {}) {
  const rnd = rng(seed);
  let t = t0;
  const end = t0 + seconds;
  while (t < end) {
    a.push(frameFn(t, rnd), t);
    t += (1 / fps) * (1 + (rnd() - 0.5) * 2 * jitter);
  }
  return t;
}

module.exports = { rng, clickFrame, silence, noise, feed };
