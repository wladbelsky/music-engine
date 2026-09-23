/* Audio analysis for Wallpaper Engine spectrum data.
 * Input: 128 floats (64 L + 64 R bands, bass->treble), ~30 Hz.
 * Output: bpm, confidence, beat events, loudness/intensity, silence time. */
(function () {
  'use strict';

  const RING = 512;          // onset history frames (~17 s @30Hz)
  const AC_FRAMES = 300;     // frames used for tempo autocorrelation (~10 s)

  class AudioAnalyzer {
    constructor() {
      this.gain = 1.0;
      this.bands = new Float32Array(64);
      this.prev = new Float32Array(64);
      this.flux = new Float32Array(RING);
      this.ftime = new Float64Array(RING);
      this.fIdx = 0; this.fCount = 0;

      this.level = 0;        // instantaneous weighted level
      this.bass = 0; this.mid = 0; this.high = 0;
      this.shortLoud = 0;    // ~150 ms EMA
      this.longLoud = 0.05;  // ~20 s EMA
      this.peak = 0.25;      // slow AGC peak
      this.silentTime = 10;  // start "silent" -> engine starts stalled
      this.lastPush = 0;
      this.lastT = 0;

      this.bpm = 120; this.rawBpm = 0; this.conf = 0;
      this._cand = 0; this._candCount = 0;
      this._lastTempoT = 0;

      this.beats = [];       // timestamps of recent beats
      this.lastBeatT = -10;
      this.beatStrength = 0; // 0..1 of the last beat
      this._beatQueue = [];  // beats not yet consumed by the sim

      this.intensity = 0; this.power = 0; this.density = 0;
      this.clipFrames = 0;
    }

    /* arr: Array(128). t: seconds (performance.now()/1000) */
    push(arr, t) {
      const dt = this.lastT ? Math.min(0.2, Math.max(0.005, t - this.lastT)) : 1 / 30;
      this.lastT = t; this.lastPush = t;
      const g = this.gain;
      let bass = 0, mid = 0, high = 0, flux = 0, over = 0;
      for (let i = 0; i < 64; i++) {
        const raw = ((arr[i] || 0) + (arr[i + 64] || 0)) * 0.5;
        if (raw > 1) over++;
        const b = Math.min(1.5, raw * g);
        const d = b - this.prev[i];
        if (d > 0) flux += d * (i < 6 ? 2.2 : i < 16 ? 1.2 : 0.6);
        this.prev[i] = b; this.bands[i] = b;
        if (i < 6) bass += b; else if (i < 30) mid += b; else high += b;
      }
      this.clipFrames = over > 3 ? this.clipFrames + 1 : Math.max(0, this.clipFrames - 1);
      bass /= 6; mid /= 24; high /= 34;
      this.bass = bass; this.mid = mid; this.high = high;
      const level = bass * 0.5 + mid * 0.35 + high * 0.15;
      this.level = level;

      // loudness trackers
      const aS = 1 - Math.exp(-dt / 0.15), aL = 1 - Math.exp(-dt / 20);
      this.shortLoud += (level - this.shortLoud) * aS;
      if (level > 0.004) this.longLoud += (level - this.longLoud) * aL;
      this.peak = Math.max(this.shortLoud, this.peak * Math.exp(-dt / 40), 0.12);

      // silence
      if (level < 0.004) this.silentTime += dt; else this.silentTime = 0;

      // onset ring
      this.flux[this.fIdx] = flux; this.ftime[this.fIdx] = t;
      this.fIdx = (this.fIdx + 1) % RING; this.fCount = Math.min(RING, this.fCount + 1);

      this._detectBeat(flux, t, level);
      if (t - this._lastTempoT > 0.5) { this._lastTempoT = t; this._estimateTempo(); }
      this._updateIntensity(t);
    }

    _hist(n) { // last n flux values, oldest first
      n = Math.min(n, this.fCount);
      const out = new Float32Array(n);
      for (let k = 0; k < n; k++) out[k] = this.flux[(this.fIdx - n + k + RING * 2) % RING];
      return out;
    }

    _detectBeat(flux, t, level) {
      const h = this._hist(36);
      if (h.length < 10) return;
      let m = 0; for (let i = 0; i < h.length; i++) m += h[i]; m /= h.length;
      let v = 0; for (let i = 0; i < h.length; i++) v += (h[i] - m) * (h[i] - m); v = Math.sqrt(v / h.length);
      const thr = m + 1.4 * v + 0.02;
      const minGap = Math.max(0.22, 60 / (this.bpm * 2.2));
      if (flux > thr && level > 0.01 && t - this.lastBeatT > minGap) {
        this.lastBeatT = t;
        this.beatStrength = Math.min(1, (flux - m) / (v * 4 + 0.08));
        this.beats.push(t);
        this._beatQueue.push(this.beatStrength);
      }
      while (this.beats.length && t - this.beats[0] > 4) this.beats.shift();
    }

    takeBeats() { const q = this._beatQueue; this._beatQueue = []; return q; }

    _estimateTempo() {
      const n = Math.min(AC_FRAMES, this.fCount);
      if (n < 120) return;
      // frame period from timestamps
      const tNew = this.ftime[(this.fIdx - 1 + RING) % RING];
      const tOld = this.ftime[(this.fIdx - n + RING * 2) % RING];
      const fp = (tNew - tOld) / (n - 1);
      if (!(fp > 0.005 && fp < 0.1)) return;
      const x = this._hist(n);
      let mean = 0; for (let i = 0; i < n; i++) mean += x[i]; mean /= n;
      let e0 = 0; for (let i = 0; i < n; i++) { x[i] -= mean; e0 += x[i] * x[i]; }
      if (e0 < 1e-6) { this.conf *= 0.8; return; }

      const lagMin = Math.max(2, Math.floor(60 / (200 * fp)));
      const lagMax = Math.min(Math.floor(n / 2), Math.ceil(60 / (50 * fp)));
      const ac = new Float32Array(lagMax * 2 + 3);
      for (let L = 1; L < ac.length && L < n - 1; L++) {
        let s = 0; for (let i = L; i < n; i++) s += x[i] * x[i - L];
        ac[L] = s / e0;
      }
      let best = -1, bestS = -1e9;
      for (let L = lagMin; L <= lagMax; L++) {
        const bpm = 60 / (L * fp);
        const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
        const harm = (2 * L < ac.length ? 0.5 * ac[2 * L] : 0);
        const s = (ac[L] + harm) * prior;
        if (s > bestS) { bestS = s; best = L; }
      }
      if (best < 0) return;
      // parabolic interpolation around peak. `best` maximizes the prior-weighted score, not ac itself,
      // so it may not be a local max of ac: only refine at a real peak and keep the shift within half a lag
      // (an unclamped shift once gave a negative lag -> negative bpm -> the folding loop below never ended)
      let Lf = best;
      const a = ac[best - 1], b = ac[best], c = ac[best + 1] || 0;
      const den = a - 2 * b + c;
      if (den < 0 && b >= a && b >= c) Lf = best + Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den));
      let bpm = 60 / (Lf * fp);
      if (!(bpm > 0 && isFinite(bpm))) return;
      for (let i = 0; i < 8 && bpm < 80; i++) bpm *= 2;
      for (let i = 0; i < 8 && bpm > 170; i++) bpm /= 2;
      const conf = Math.max(0, Math.min(1, ac[best] * 1.6));
      this.rawBpm = bpm;
      this.conf += (conf - this.conf) * 0.35;
      if (conf < 0.12) return;

      const rel = Math.abs(bpm - this.bpm) / this.bpm;
      if (rel < 0.06) {
        this.bpm += (bpm - this.bpm) * 0.35; this._candCount = 0;
      } else {
        if (this._candCount > 0 && Math.abs(bpm - this._cand) / this._cand < 0.06) this._candCount++;
        else { this._cand = bpm; this._candCount = 1; }
        if (this._candCount >= 3 || (this.conf < 0.2 && this._candCount >= 2)) { this.bpm = this._cand; this._candCount = 0; }
      }
    }

    _updateIntensity(t) {
      const abs = Math.min(1, this.shortLoud / this.peak);
      const rel = Math.min(1, Math.max(0, (this.shortLoud / (this.longLoud + 1e-3) - 0.6) / 0.9));
      const beatsPerSec = this.beats.length / 4;
      this.density = Math.min(1, beatsPerSec / Math.max(1, this.bpm / 60));
      const bpmN = Math.min(1, Math.max(0, (this.bpm - 80) / 90));
      const raw = 0.5 * abs + 0.3 * rel + 0.2 * this.density;
      this.intensity += (raw - this.intensity) * 0.25;
      this.power = Math.min(1, this.intensity * 0.72 + bpmN * this.conf * 0.18 + this.density * 0.1);
    }

    /* call every animation frame: handles "no callbacks at all" as silence */
    tick(t) {
      if (t - this.lastPush > 0.35) {
        this.silentTime = Math.max(this.silentTime, t - this.lastPush);
        this.shortLoud *= 0.9; this.intensity *= 0.95; this.power *= 0.95;
        this.level = 0;
      }
      this._lastTick = t;
    }
  }

  /* ---------- Dev sources (browser without Wallpaper Engine) ---------- */

  class DemoSource { // synthetic song: sections with different tempo/energy + silence
    constructor(cb) {
      this.cb = cb; this.t0 = performance.now() / 1000; this.phase = 0; this.lastT = 0;
      this.sections = [
        { dur: 10, bpm: 100, lvl: 0.35, hats: 0.2 },
        { dur: 10, bpm: 128, lvl: 0.55, hats: 0.5 },
        { dur: 12, bpm: 150, lvl: 0.95, hats: 0.9 },
        { dur: 6, bpm: 128, lvl: 0.25, hats: 0.1 },
        { dur: 5, bpm: 0, lvl: 0, hats: 0 },
      ];
      this.id = setInterval(() => this.step(), 1000 / 30);
    }
    stop() { clearInterval(this.id); }
    step() {
      const now = performance.now() / 1000;
      const dt = this.lastT ? now - this.lastT : 1 / 30; this.lastT = now;
      const total = this.sections.reduce((a, s) => a + s.dur, 0);
      let tt = (now - this.t0) % total, s = this.sections[0];
      for (const sec of this.sections) { if (tt < sec.dur) { s = sec; break; } tt -= sec.dur; }
      const arr = new Array(128).fill(0);
      if (s.bpm > 0) {
        this.phase += dt * s.bpm / 60;
        const ph = this.phase % 1;
        const kick = Math.exp(-ph * 9) * s.lvl;
        const hat = Math.exp(-((ph + 0.5) % 1) * 14) * s.hats;
        for (let i = 0; i < 64; i++) {
          const base = s.lvl * 0.25 * Math.exp(-i / 40) * (0.7 + 0.3 * Math.random());
          let v = base;
          if (i < 8) v += kick * (1 - i / 10);
          if (i > 36) v += hat * 0.5 * Math.random();
          arr[i] = arr[i + 64] = Math.min(1, v);
        }
      }
      this.cb(arr);
    }
  }

  class WebAudioSource { // mic or <audio> file -> 64 log bands
    constructor(cb) { this.cb = cb; }
    async startMic() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._init(ctx => ctx.createMediaStreamSource(stream), false);
    }
    startFile(file) {
      const el = new Audio(URL.createObjectURL(file));
      el.loop = true; el.play();
      this.el = el;
      this._init(ctx => ctx.createMediaElementSource(el), true);
    }
    _init(mk, toOut) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.5;
      const src = mk(ctx); src.connect(an); if (toOut) an.connect(ctx.destination);
      const data = new Float32Array(an.frequencyBinCount);
      const binHz = ctx.sampleRate / an.fftSize;
      const edges = []; for (let i = 0; i <= 64; i++) edges.push(30 * Math.pow(16000 / 30, i / 64));
      this.id = setInterval(() => {
        an.getFloatFrequencyData(data);
        const arr = new Array(128);
        for (let b = 0; b < 64; b++) {
          const lo = Math.floor(edges[b] / binHz), hi = Math.max(lo + 1, Math.ceil(edges[b + 1] / binHz));
          let s = 0; for (let k = lo; k < hi; k++) s += Math.pow(10, data[k] / 20);
          const db = 20 * Math.log10(s / (hi - lo) + 1e-9);
          const v = Math.max(0, Math.min(1, (db + 75) / 60));
          arr[b] = arr[b + 64] = v * v;
        }
        this.cb(arr);
      }, 1000 / 30);
    }
  }

  window.AudioAnalyzer = AudioAnalyzer;
  window.DemoSource = DemoSource;
  window.WebAudioSource = WebAudioSource;
})();
