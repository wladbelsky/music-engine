/* 2D instrument cluster: tachometer, temp, boost, shift lights, warning lamps, odometer, car radio. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgbOf = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const seeded = s => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

  const LAMPS = [
    { key: 'stall', text: 'STALL', col: '#ff2a1f' },
    { key: 'lowrpm', text: 'LOW RPM', col: '#ffa81a' },
    { key: 'redline', text: 'REDLINE', col: '#ff2a1f' },
    { key: 'overheat', text: 'OVERHEAT', col: '#ff2a1f' },
    { key: 'oil', text: 'OIL PRESS', col: '#ff2a1f' },
    { key: 'battery', text: 'BATTERY', col: '#ff2a1f' },
    { key: 'check', text: 'CHECK ENG', col: '#ffb020' },
    { key: 'overboost', text: 'OVERBOOST', col: '#ffb020' },
  ];

  class Dash {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.st = document.createElement('canvas'); this.sctx = this.st.getContext('2d');
      this.redline = 7000; this.color = '#ff5a1a'; this.label = 'V8 TURBO'; this.kind = 'piston';
      this.showBpm = true; this.needle = 0; this.gaugeN = [70, 0];
      this.lampLvl = {}; LAMPS.forEach(l => this.lampLvl[l.key] = 0);
      this.showControls = true; this.keyAng = -50; this.pedalN = 0; this.pedalHover = false;
      this.odoUnits = 'km'; this.odoR = this.tripR = null;
      this.showRadio = false; this.radio = null; this.vu = 0; this.scroll = 0; this.scrollHold = 1.5; this.mText = ''; this.spec = [];
    }

    resize(w, h, dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      for (const cv of [this.c, this.st]) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      this._layout(); this._static();
    }
    set(opts) {
      let dirty = false;
      for (const k of ['kind', 'redline', 'color', 'label', 'showBpm', 'showControls', 'showRadio', 'odoUnits']) if (opts[k] !== undefined && opts[k] !== this[k]) { this[k] = opts[k]; dirty = true; }
      if (dirty && this.w) this._static();
    }

    _layout() {
      const w = this.w, h = this.h;
      // with the radio the cluster gets a bit smaller and higher, so the radio stays clear of the Windows
      // taskbar (WE tells the wallpaper nothing about it): bottom edge at about 0.94h
      const rad = this.showRadio;
      if (w / h >= 1.25) { this.R = Math.min(0.155 * w, (rad ? 0.232 : 0.24) * h); this.cx = 0.76 * w; this.cy = (rad ? 0.35 : 0.385) * h; }
      else { this.R = Math.min(0.28 * w, (rad ? 0.13 : 0.14) * h); this.cx = 0.5 * w; this.cy = (rad ? 0.615 : 0.64) * h; }
      // scales and labels from the engine type (js/core/layout.js); the sim runs in rpm, tach.map converts
      this.prof = window.EngineTypes.get(this.kind).dash(Math.max(500, this.redline || 7000));
      this.maxRpm = this.prof.tach.max;
    }

    _ang(v, max, a0, sweep) { return a0 + clamp(v / max, 0, 1.02) * sweep; }

    _static() {
      this._layout();
      const g = this.sctx, d = this.dpr, R = this.R, cx = this.cx, cy = this.cy;
      g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, this.w, this.h);
      this._bezel(g, cx, cy, R);
      // tach ticks
      const tc = this.prof.tach, max = tc.max, a0 = 0.75 * Math.PI, sw = 1.5 * Math.PI;
      g.lineCap = 'butt';
      g.strokeStyle = '#b3141a'; g.lineWidth = R * 0.075;
      g.beginPath(); g.arc(cx, cy, R * 0.9, this._ang(tc.red, max, a0, sw), a0 + sw); g.stroke();
      for (let v = 0; v <= max; v += tc.minor) {
        const a = this._ang(v, max, a0, sw), major = v % tc.major === 0, half = v % tc.half === 0;
        const r1 = R * 0.95, r0 = R * (major ? 0.8 : half ? 0.86 : 0.89);
        g.strokeStyle = v >= tc.red ? '#ff4a3a' : '#d9dde2'; g.lineWidth = major ? R * 0.022 : half ? R * 0.013 : R * 0.009;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
        if (major) {
          g.fillStyle = v >= tc.red ? '#ff4a3a' : '#e8ebef';
          g.font = `600 ${R * 0.13}px "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(tc.text(v), cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66);
        }
      }
      g.fillStyle = '#7d848c'; g.font = `500 ${R * 0.065}px "Segoe UI", Arial, sans-serif`;
      g.fillText(tc.title, cx, cy + R * 0.3);
      g.fillStyle = '#9aa1a9'; g.font = `700 ${R * 0.075}px "Segoe UI", Arial, sans-serif`;
      const lw = g.measureText(this.label).width; // long ones: "BOXER 32 SUPERCHARGED"
      if (lw > R * 1.1) g.font = `700 ${R * 0.075 * R * 1.1 / lw}px "Segoe UI", Arial, sans-serif`;
      g.fillText(this.label, cx, cy - R * 0.3);

      // small gauges
      const sr = R * 0.36;
      this.tempG = { x: cx - R * 1.2, y: cy + R * 1.02, r: sr };
      this.boostG = { x: cx + R * 1.2, y: cy + R * 1.02, r: sr };
      for (const [G, gs] of [[this.tempG, this.prof.left], [this.boostG, this.prof.right]]) this._smallStatic(g, G, gs.min, gs.max, gs.labels, gs.danger, gs.title, gs.label);
      this._odoStatic(g);

      // warning lamps: round lamp + screwed metal nameplate
      const cellW = R * 0.74, cellH = R * 0.24, gapX = R * 0.035, gapY = R * 0.07;
      const totalW = 4 * cellW + 3 * gapX, x0 = cx - totalW / 2, y0 = cy + R * 1.58;
      const lt = this.prof.lamps;
      this.lampRects = LAMPS.map((l0, i) => {
        const l = lt[l0.key] ? Object.assign({}, l0, { text: lt[l0.key] }) : l0;
        const x = x0 + (i % 4) * (cellW + gapX), y = y0 + Math.floor(i / 4) * (cellH + gapY);
        const lr = cellH * 0.42;
        const L = { l, rgb: rgbOf(l.col), lx: x + lr, ly: y + cellH / 2, lr };
        L.px = x + lr * 2 + cellH * 0.1; L.ph = cellH * 0.66; L.py = L.ly - L.ph / 2; L.pw = x + cellW - L.px;
        return L;
      });
      // one font size for all plates (fits the longest label)
      const fs0 = this.lampRects[0].ph * 0.44; let fs = fs0;
      g.font = `800 ${fs0}px "Segoe UI", Arial, sans-serif`;
      this.lampRects.forEach(L => { const tw = L.pw - L.ph * 0.95, m = g.measureText(L.l.text).width; if (m > tw) fs = Math.min(fs, fs0 * tw / m); });
      this.lampRects.forEach((L, i) => { L.fs = fs; this._plate(g, L, i); this._lampBezel(g, L); });
      this.lampBox = { x: x0, y: y0, w: totalW, h: 2 * cellH + gapY };
      this.radio = null;
      if (this.showRadio) this._radioStatic(g, x0, y0 + 2 * cellH + gapY, totalW);
      // shift light housing
      const n = 10, sp = R * 0.19;
      this.shift = []; for (let i = 0; i < n; i++) this.shift.push({ x: cx + (i - (n - 1) / 2) * sp, y: cy - R * 1.22 });
      g.fillStyle = '#0d0e10'; g.strokeStyle = '#2c3035'; g.lineWidth = 2;
      this.shiftBox = { x: cx - n * sp / 2 - sp * 0.2, y: cy - R * 1.22 - sp * 0.45, w: n * sp + sp * 0.4, h: sp * 0.9 };
      this._rr(g, this.shiftBox.x, this.shiftBox.y, this.shiftBox.w, this.shiftBox.h, sp * 0.45); g.fill(); g.stroke();
      // ignition key + throttle pedal
      this.keyC = { x: cx - R * 1.5, y: cy - R * 0.93, r: R * 0.27 };
      this.pedalR = { x: cx + R * 1.5 - R * 0.17, y: cy - R * 1.24, w: R * 0.34, h: R * 0.62 };
      if (this.showControls) { this._keyStatic(g, this.keyC); this._pedalStatic(g, this.pedalR); }
    }

    _bezel(g, cx, cy, R) {
      let gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.2, cx, cy, R * 1.12);
      gr.addColorStop(0, '#6d737b'); gr.addColorStop(0.6, '#2a2d32'); gr.addColorStop(1, '#0c0d0f');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 1.1, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R * 1.1, Math.PI * 1.1, Math.PI * 1.8); g.stroke();
      gr = g.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
      gr.addColorStop(0, '#1d2024'); gr.addColorStop(1, '#08090a');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 1.0, 0, TAU); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = R * 0.02; g.stroke();
    }

    _smallStatic(g, G, min, max, labels, danger, title, label = String) {
      const a0 = 0.8333 * Math.PI, sw = (4 / 3) * Math.PI, r = G.r;
      this._bezel(g, G.x, G.y, r);
      g.strokeStyle = '#b3141a'; g.lineWidth = r * 0.1;
      g.beginPath(); g.arc(G.x, G.y, r * 0.84, a0 + (danger - min) / (max - min) * sw, a0 + sw); g.stroke();
      for (let i = 0; i <= 12; i++) {
        const a = a0 + sw * i / 12, maj = i % 4 === 0;
        g.strokeStyle = '#cfd4d9'; g.lineWidth = maj ? r * 0.04 : r * 0.02;
        g.beginPath(); g.moveTo(G.x + Math.cos(a) * r * (maj ? 0.7 : 0.78), G.y + Math.sin(a) * r * (maj ? 0.7 : 0.78));
        g.lineTo(G.x + Math.cos(a) * r * 0.9, G.y + Math.sin(a) * r * 0.9); g.stroke();
      }
      g.fillStyle = '#d9dde2'; g.font = `600 ${r * 0.2}px "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      labels.forEach(v => { const a = a0 + (v - min) / (max - min) * sw; g.fillText(label(v), G.x + Math.cos(a) * r * 0.5, G.y + Math.sin(a) * r * 0.5); });
      g.fillStyle = '#7d848c'; g.font = `600 ${r * 0.16}px "Segoe UI", Arial, sans-serif`;
      g.fillText(title, G.x, G.y + r * 0.62);
      G.min = min; G.max = max; G.a0 = a0; G.sw = sw;
    }

    _plate(g, L, i) {
      const { px, py, pw, ph } = L, rnd = seeded(i * 7 + 3);
      // drop shadow
      g.save(); g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = ph * 0.35; g.shadowOffsetY = ph * 0.08;
      this._rr(g, px, py, pw, ph, ph * 0.14); g.fillStyle = '#6d7379'; g.fill(); g.restore();
      // brushed metal
      g.save(); this._rr(g, px, py, pw, ph, ph * 0.14); g.clip();
      let gr = g.createLinearGradient(0, py, 0, py + ph);
      gr.addColorStop(0, '#c9cdd1'); gr.addColorStop(0.35, '#eceef0'); gr.addColorStop(0.55, '#a3a8ae'); gr.addColorStop(1, '#7c8288');
      g.fillStyle = gr; g.fillRect(px, py, pw, ph);
      for (let k = 0; k < ph * 1.6; k++) {
        const yy = py + rnd() * ph, a = 0.04 + rnd() * 0.09;
        g.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(40,44,48,${a})`;
        g.lineWidth = 0.6; g.beginPath(); g.moveTo(px + rnd() * pw * 0.3, yy); g.lineTo(px + pw * (0.6 + rnd() * 0.4), yy); g.stroke();
      }
      gr = g.createLinearGradient(px, 0, px + pw, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.12)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.15)');
      g.fillStyle = gr; g.fillRect(px, py, pw, ph);
      g.restore();
      // bevel
      g.save(); this._rr(g, px + 0.5, py + 0.5, pw - 1, ph - 1, ph * 0.14);
      g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke(); g.restore();
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(px + ph * 0.15, py + 1.5); g.lineTo(px + pw - ph * 0.15, py + 1.5); g.stroke();
      // screws
      const sr = ph * 0.12, sy = py + ph / 2;
      for (const sx of [px + ph * 0.22, px + pw - ph * 0.22]) this._screw(g, sx, sy, sr, rnd() * Math.PI);
      // engraved text
      const tx0 = px + ph * 0.42, tx1 = px + pw - ph * 0.42;
      g.font = `800 ${L.fs}px "Segoe UI", Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const txc = (tx0 + tx1) / 2;
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText(L.l.text, txc, sy + 1.2);
      g.fillStyle = '#23262a'; g.fillText(L.l.text, txc, sy);
    }

    _screw(g, x, y, r, ang) {
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(x + r * 0.15, y + r * 0.2, r * 1.12, 0, TAU); g.fill();
      const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      gr.addColorStop(0, '#f4f5f6'); gr.addColorStop(0.55, '#9da3a9'); gr.addColorStop(1, '#4a4f55');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.8; g.stroke();
      g.translate(x, y); g.rotate(ang); g.lineCap = 'round';
      for (const [dx, dy] of [[1, 0], [0, 1]]) {           // phillips cross
        g.strokeStyle = '#2b2f33'; g.lineWidth = r * 0.3;
        g.beginPath(); g.moveTo(-dx * r * 0.6, -dy * r * 0.6); g.lineTo(dx * r * 0.6, dy * r * 0.6); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = r * 0.1;
        g.beginPath(); g.moveTo(-dx * r * 0.6 + r * 0.08, -dy * r * 0.6 + r * 0.1); g.lineTo(dx * r * 0.6 + r * 0.08, dy * r * 0.6 + r * 0.1); g.stroke();
      }
      g.restore();
    }

    _lampBezel(g, L) {
      const { lx, ly, lr } = L;
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(lx + lr * 0.06, ly + lr * 0.1, lr * 1.04, 0, TAU); g.fill();
      let gr = g.createLinearGradient(lx - lr, ly - lr, lx + lr, ly + lr);
      gr.addColorStop(0, '#f2f4f6'); gr.addColorStop(0.45, '#8b9197'); gr.addColorStop(0.55, '#5c6268'); gr.addColorStop(1, '#c3c8cd');
      g.fillStyle = gr; g.beginPath(); g.arc(lx, ly, lr, 0, TAU); g.fill();
      gr = g.createLinearGradient(lx - lr, ly - lr, lx + lr, ly + lr);
      gr.addColorStop(0, '#3a3e43'); gr.addColorStop(1, '#d6dade');
      g.fillStyle = gr; g.beginPath(); g.arc(lx, ly, lr * 0.84, 0, TAU); g.fill();
      g.fillStyle = '#050506'; g.beginPath(); g.arc(lx, ly, lr * 0.76, 0, TAU); g.fill();
      g.restore();
    }

    _lens(g, L, lv) {
      const { lx, ly, lr, rgb } = L, r = lr * 0.72;
      const c = (m, a = 1) => `rgba(${Math.round(Math.min(255, rgb[0] * m))},${Math.round(Math.min(255, rgb[1] * m))},${Math.round(Math.min(255, rgb[2] * m))},${a})`;
      const mixW = (t, m) => `rgb(${Math.round((rgb[0] + (255 - rgb[0]) * t) * m)},${Math.round((rgb[1] + (255 - rgb[1]) * t) * m)},${Math.round((rgb[2] + (255 - rgb[2]) * t) * m)})`;
      g.save();
      if (lv > 0.02) { // halo onto the panel
        g.globalCompositeOperation = 'lighter';
        const h = g.createRadialGradient(lx, ly, r * 0.5, lx, ly, lr * 3.2);
        h.addColorStop(0, c(1, 0.35 * lv)); h.addColorStop(1, c(1, 0));
        g.fillStyle = h; g.beginPath(); g.arc(lx, ly, lr * 3.2, 0, TAU); g.fill();
        g.globalCompositeOperation = 'source-over';
      }
      const gr = g.createRadialGradient(lx - r * 0.15, ly - r * 0.2, r * 0.05, lx, ly, r);
      gr.addColorStop(0, mixW(0.75 * lv, 0.3 + 0.7 * lv));
      gr.addColorStop(0.45, c(0.22 + 0.85 * lv));
      gr.addColorStop(1, c(0.08 + 0.4 * lv));
      g.fillStyle = gr; g.beginPath(); g.arc(lx, ly, r, 0, TAU); g.fill();
      // fresnel rings of the lens
      g.strokeStyle = `rgba(255,255,255,${0.05 + 0.08 * lv})`; g.lineWidth = 0.7;
      for (const k of [0.35, 0.6, 0.85]) { g.beginPath(); g.arc(lx, ly, r * k, 0, TAU); g.stroke(); }
      // specular
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.ellipse(lx - r * 0.32, ly - r * 0.38, r * 0.32, r * 0.16, -0.6, 0, TAU); g.fill();
      g.restore();
    }

    /* ---------- ignition key ---------- */
    _keyStatic(g, K) {
      const { x, y, r } = K;
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(x + r * 0.05, y + r * 0.1, r * 1.08, 0, TAU); g.fill();
      let gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
      gr.addColorStop(0, '#f1f3f5'); gr.addColorStop(0.45, '#8d939a'); gr.addColorStop(0.55, '#5b6167'); gr.addColorStop(1, '#c9ced3');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      gr = g.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r * 0.8);
      gr.addColorStop(0, '#2a2d31'); gr.addColorStop(1, '#0b0c0d');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 0.8, 0, TAU); g.fill();
      // position marks
      g.font = `800 ${r * 0.24}px "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [lbl, a] of [['OFF', -50], ['ON', 20], ['START', 70]]) {
        const rad = (a - 90) * Math.PI / 180;
        g.fillStyle = lbl === 'START' ? '#ff6a4a' : '#c9ced3';
        g.fillText(lbl, x + Math.cos(rad) * r * 1.45, y + Math.sin(rad) * r * 1.45);
        g.strokeStyle = '#c9ced3'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x + Math.cos(rad) * r * 0.84, y + Math.sin(rad) * r * 0.84); g.lineTo(x + Math.cos(rad) * r * 0.97, y + Math.sin(rad) * r * 0.97); g.stroke();
      }
      g.fillStyle = '#7d848c'; g.font = `700 ${r * 0.26}px "Segoe UI", Arial, sans-serif`;
      g.fillText('IGNITION', x, y + r * 1.5);
      g.restore();
    }

    _keyDraw(g, K, sim, dt) {
      const { x, y, r } = K;
      const target = !sim.ignition ? -50 : (sim.state === 'cranking' ? 70 : 20);
      this.keyAng += (target - this.keyAng) * (1 - Math.exp(-dt * 14));
      g.save(); g.translate(x, y); g.rotate(this.keyAng * Math.PI / 180);
      // barrel slot
      g.fillStyle = '#050505'; this._rr(g, -r * 0.09, -r * 0.55, r * 0.18, r * 1.1, r * 0.05); g.fill();
      // key bow (rubber head) seen from the front
      g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = r * 0.25; g.shadowOffsetY = r * 0.08;
      const bw = r * 0.52, bl = r * 1.25;
      let gr = g.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      gr.addColorStop(0, '#2c2f33'); gr.addColorStop(0.35, '#4a4e54'); gr.addColorStop(1, '#141517');
      g.fillStyle = gr; this._rr(g, -bw / 2, -bl * 0.62, bw, bl, bw * 0.45); g.fill();
      g.shadowColor = 'transparent';
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.stroke();
      // key ring hole + chrome collar
      g.fillStyle = '#0a0a0b'; g.beginPath(); g.arc(0, -bl * 0.45, bw * 0.16, 0, TAU); g.fill();
      gr = g.createRadialGradient(-r * 0.05, -r * 0.05, 0, 0, 0, r * 0.22);
      gr.addColorStop(0, '#f4f5f6'); gr.addColorStop(1, '#6a7076');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 0.2, 0, TAU); g.fill();
      g.restore();
      // tiny status LED
      const on = sim.ignition;
      g.save(); g.fillStyle = on ? '#45ff7a' : '#1a3a22'; if (on) { g.shadowColor = '#45ff7a'; g.shadowBlur = r * 0.3; }
      g.beginPath(); g.arc(x + r * 0.95, y + r * 0.95, r * 0.08, 0, TAU); g.fill(); g.restore();
    }

    /* ---------- throttle pedal ---------- */
    _pedalStatic(g, P) {
      const { x, y, w, h } = P;
      g.save();
      // floor mount
      const by = y + h * 0.88;
      let gr = g.createLinearGradient(0, by, 0, by + h * 0.12);
      gr.addColorStop(0, '#6b7178'); gr.addColorStop(1, '#25282c');
      g.fillStyle = gr; this._rr(g, x - w * 0.1, by, w * 1.2, h * 0.12, h * 0.03); g.fill();
      for (const sx of [x + w * 0.05, x + w * 0.95]) this._screw(g, sx, by + h * 0.06, h * 0.03, sx);
      g.fillStyle = '#7d848c'; g.font = `700 ${w * 0.23}px "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('THROTTLE', x + w / 2, by + h * 0.27);
      g.restore();
    }

    _pedalDraw(g, P, sim, dt) {
      const { x, y, w, h } = P, p = sim.pedal;
      this.pedalN += (p - this.pedalN) * (1 - Math.exp(-dt * 30));
      const k = this.pedalN, hinge = y + h * 0.9;
      const padH = h * 0.66 * (1 - 0.3 * k), padY = y + h * 0.08 * k + h * 0.06, padW = w * (1 - 0.06 * k);
      g.save();
      // arm
      g.fillStyle = '#3b3f44'; g.fillRect(x + w / 2 - w * 0.07, padY + padH * 0.6, w * 0.14, hinge - (padY + padH * 0.6));
      // pad
      g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = w * 0.2; g.shadowOffsetY = w * 0.05;
      const px = x + (w - padW) / 2;
      let gr = g.createLinearGradient(0, padY, 0, padY + padH);
      gr.addColorStop(0, k > 0.02 ? '#3a3d42' : '#4b4f55'); gr.addColorStop(1, '#17191c');
      g.fillStyle = gr; this._rr(g, px, padY, padW, padH, w * 0.12); g.fill();
      g.shadowColor = 'transparent';
      // metal frame + rubber ribs
      g.strokeStyle = '#9aa0a6'; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = padH * 0.035;
      for (let i = 1; i < 8; i++) { const yy = padY + padH * i / 8; g.beginPath(); g.moveTo(px + padW * 0.15, yy); g.lineTo(px + padW * 0.85, yy); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
      for (let i = 1; i < 8; i++) { const yy = padY + padH * i / 8 + padH * 0.025; g.beginPath(); g.moveTo(px + padW * 0.15, yy); g.lineTo(px + padW * 0.85, yy); g.stroke(); }
      if (k > 0.02) { // pressed glow
        g.shadowColor = this.color; g.shadowBlur = w * 0.35 * k; g.strokeStyle = this.color; g.globalAlpha = 0.4 + 0.6 * k; g.lineWidth = 2;
        this._rr(g, px, padY, padW, padH, w * 0.12); g.stroke();
      }
      g.restore();
    }

    /* ---------- odometer: ODO + TRIP drum counters between TEMP and BOOST ---------- */
    _odoStatic(g) {
      this.odoR = this.tripR = this.odoHit = null;
      if (this.odoUnits !== 'km' && this.odoUnits !== 'mi') return;
      const R = this.R, cx = this.cx, cy = this.cy, unit = this.odoUnits;
      // n drums of w×h; the last one is tenths. Window + unit label centred on cx (label/prefix widths in R)
      const row = (n, w, h, top, pre, post) => {
        const W = n * w, x = cx - (W + post - pre) / 2;
        return { x, y: top, w: W, h, n, cw: w, pre, post };
      };
      this.odoR = row(7, R * 0.094, R * 0.15, cy + R * 1.17, 0, R * 0.16);
      this.tripR = row(5, R * 0.068, R * 0.105, cy + R * 1.375, R * 0.2, R * 0.12);
      const O = this.odoR, T = this.tripR, p = R * 0.02;
      this.odoHit = { x: Math.min(O.x, T.x - T.pre) - p, y: O.y - p, w: 0, h: T.y + T.h - O.y + 2 * p };
      this.odoHit.w = Math.max(O.x + O.w + O.post, T.x + T.w + T.post) + p - this.odoHit.x;
      for (const D of [O, T]) {
        const fp = D.h * 0.16;                                   // recessed window with a chrome-ish rim
        g.save(); g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = fp * 2; g.shadowOffsetY = fp * 0.4;
        this._rr(g, D.x - fp, D.y - fp, D.w + 2 * fp, D.h + 2 * fp, fp * 1.2);
        const gr = g.createLinearGradient(0, D.y - fp, 0, D.y + D.h + fp);
        gr.addColorStop(0, '#5d636a'); gr.addColorStop(0.5, '#23262a'); gr.addColorStop(1, '#8b9197');
        g.fillStyle = gr; g.fill(); g.restore();
        g.fillStyle = '#030304'; this._rr(g, D.x - 1, D.y - 1, D.w + 2, D.h + 2, fp * 0.5); g.fill();
        g.fillStyle = '#7d848c'; g.textBaseline = 'middle';
        g.font = `700 ${D.h * 0.5}px "Segoe UI", Arial, sans-serif`;
        g.textAlign = 'left'; g.fillText(unit, D.x + D.w + fp * 1.8, D.y + D.h / 2);
        if (D.pre) { g.textAlign = 'right'; g.fillText('TRIP', D.x - fp * 1.8, D.y + D.h / 2); }
        // cylinder shading for the drums (depends only on the row), made once for the live canvas
        const sh = D.shade = this.ctx.createLinearGradient(0, D.y, 0, D.y + D.h);
        sh.addColorStop(0, 'rgba(0,0,0,0.85)'); sh.addColorStop(0.3, 'rgba(0,0,0,0.1)'); sh.addColorStop(0.45, 'rgba(255,255,255,0.06)');
        sh.addColorStop(0.7, 'rgba(0,0,0,0.12)'); sh.addColorStop(1, 'rgba(0,0,0,0.9)');
      }
    }

    // rolling number drums: a carry turns a drum only while every lower drum goes 9 → 0, like the real thing
    _drums(g, D, value) {
      const v = Math.max(0, value) * 10, h = D.h, fs = h * 0.72;
      g.save();
      g.font = `700 ${fs}px Consolas, "Courier New", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let i = 0; i < D.n; i++) {                            // i = 0: tenths (rightmost)
        const p = Math.pow(10, i), x = D.x + (D.n - 1 - i) * D.cw;
        const dig = Math.floor(v / p) % 10;
        const roll = i === 0 ? v - Math.floor(v) : Math.max(0, (v - Math.floor(v / p) * p) - (p - 1));
        g.fillStyle = i === 0 ? '#7a0f0c' : '#101113'; g.fillRect(x, D.y, D.cw, h);
        g.fillStyle = i === 0 ? '#fff4ee' : '#e9ecef';
        if (roll <= 0) { g.fillText(String(dig), x + D.cw / 2, D.y + h / 2); continue; }
        g.save(); g.beginPath(); g.rect(x, D.y, D.cw, h); g.clip();   // only a turning drum needs the clip
        const yc = D.y + h / 2 - roll * h;
        g.fillText(String(dig), x + D.cw / 2, yc);
        g.fillText(String((dig + 1) % 10), x + D.cw / 2, yc + h);
        g.restore();
      }
      g.fillStyle = D.shade; g.fillRect(D.x, D.y, D.w, h);           // cylinder shading: drums curve away top and bottom
      g.fillStyle = 'rgba(0,0,0,0.9)';                             // gaps between the drums
      for (let i = 1; i < D.n; i++) g.fillRect(D.x + i * D.cw - 0.75, D.y, 1.5, h);
      g.restore();
    }

    /* ---------- car radio: decorative volume knob + VFD "now playing" display ---------- */
    _radioStatic(g, x, top, W) {
      const R = this.R, H = R * 0.32, y = top + R * 0.07;
      if (y + H > this.h * 0.955) return;                    // would sit under the taskbar: no radio
      const cy = y + H / 2, rnd = seeded(97);
      const RD = this.radio = {
        x, y, w: W, h: H,
        knob: { x: x + R * 0.27, y: cy, r: R * 0.105 },
        glass: { x: x + R * 0.45, y: y + R * 0.055, w: W - R * 0.6, h: H - R * 0.11 },
      };
      // faceplate: black with a chrome trim
      g.save(); g.shadowColor = 'rgba(0,0,0,0.75)'; g.shadowBlur = H * 0.35; g.shadowOffsetY = H * 0.08;
      this._rr(g, x, y, W, H, H * 0.14); g.fillStyle = '#16181b'; g.fill(); g.restore();
      let gr = g.createLinearGradient(0, y, 0, y + H);
      gr.addColorStop(0, '#e4e7ea'); gr.addColorStop(0.45, '#7a8087'); gr.addColorStop(1, '#2b2e32');
      g.strokeStyle = gr; g.lineWidth = H * 0.06; this._rr(g, x, y, W, H, H * 0.14); g.stroke();
      const ix = x + H * 0.05, iy = y + H * 0.05, iw = W - H * 0.1, ih = H - H * 0.1;
      g.save(); this._rr(g, ix, iy, iw, ih, H * 0.1); g.clip();
      gr = g.createLinearGradient(0, iy, 0, iy + ih);
      gr.addColorStop(0, '#2c3035'); gr.addColorStop(0.5, '#17191c'); gr.addColorStop(1, '#0c0d0f');
      g.fillStyle = gr; g.fillRect(ix, iy, iw, ih);
      for (let k = 0; k < ih * 1.2; k++) {                  // brushed finish
        const yy = iy + rnd() * ih;
        g.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.02 + rnd() * 0.03})` : `rgba(0,0,0,${0.1 + rnd() * 0.1})`;
        g.lineWidth = 0.6; g.beginPath(); g.moveTo(ix + rnd() * iw * 0.3, yy); g.lineTo(ix + iw * (0.6 + rnd() * 0.4), yy); g.stroke();
      }
      g.restore();
      for (const sx of [x + R * 0.075, x + W - R * 0.075]) this._screw(g, sx, cy, R * 0.024, rnd() * Math.PI);

      // volume knob: knurled chrome ring + dark cap
      const K = RD.knob, kr = K.r;
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(K.x + kr * 0.06, K.y + kr * 0.14, kr * 1.06, 0, TAU); g.fill();
      gr = g.createLinearGradient(K.x - kr, K.y - kr, K.x + kr, K.y + kr);
      gr.addColorStop(0, '#f2f4f6'); gr.addColorStop(0.45, '#8b9197'); gr.addColorStop(0.55, '#5c6268'); gr.addColorStop(1, '#c3c8cd');
      g.fillStyle = gr; g.beginPath(); g.arc(K.x, K.y, kr, 0, TAU); g.fill();
      for (let i = 0; i < 44; i++) {                         // knurling
        const a = i / 44 * TAU;
        g.strokeStyle = i % 2 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(0.6, kr * 0.035);
        g.beginPath(); g.moveTo(K.x + Math.cos(a) * kr * 0.8, K.y + Math.sin(a) * kr * 0.8); g.lineTo(K.x + Math.cos(a) * kr * 0.98, K.y + Math.sin(a) * kr * 0.98); g.stroke();
      }
      gr = g.createLinearGradient(K.x, K.y - kr, K.x, K.y + kr);
      gr.addColorStop(0, '#454a50'); gr.addColorStop(1, '#0d0e10');
      g.fillStyle = gr; g.beginPath(); g.arc(K.x, K.y, kr * 0.74, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath(); g.ellipse(K.x - kr * 0.22, K.y - kr * 0.3, kr * 0.36, kr * 0.16, -0.5, 0, TAU); g.fill();
      g.restore();

      // VFD glass: recessed, with a faint dot matrix
      const G = RD.glass;
      this._rr(g, G.x, G.y, G.w, G.h, G.h * 0.12); g.fillStyle = '#040605'; g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = 2; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(G.x + G.h * 0.12, G.y + G.h + 1); g.lineTo(G.x + G.w - G.h * 0.12, G.y + G.h + 1); g.stroke();
      const [cr, cg, cb] = rgbOf(this.color), st = Math.max(2.2, R * 0.016);
      g.save(); this._rr(g, G.x, G.y, G.w, G.h, G.h * 0.12); g.clip();
      g.fillStyle = `rgba(${cr},${cg},${cb},0.07)`;
      for (let yy = G.y + st / 2; yy < G.y + G.h; yy += st) for (let xx = G.x + st / 2; xx < G.x + G.w; xx += st) g.fillRect(xx, yy, 1, 1);
      g.restore();
    }

    _radioDraw(g, sim, audio, media, dt, t) {
      const RD = this.radio, R = this.R, on = sim.state !== 'off', col = this.color;
      const [cr, cg, cb] = rgbOf(col);
      // VU ring around the knob (fast attack, slow release)
      const lv = on ? clamp(audio.level / audio.peak, 0, 1) : 0;
      this.vu += (lv - this.vu) * (1 - Math.exp(-dt * (lv > this.vu ? 25 : 3)));
      const K = RD.knob, n = 11, a0 = 0.75 * Math.PI, sw = 1.5 * Math.PI, lit = this.vu * n;
      g.save();
      for (let i = 0; i < n; i++) {
        const a = a0 + sw * i / (n - 1), f = on ? clamp(lit - i, 0, 1) : 0;
        const px = K.x + Math.cos(a) * K.r * 1.24, py = K.y + Math.sin(a) * K.r * 1.24, rr = R * 0.011;
        const c = i === n - 1 ? [255, 51, 34] : [cr, cg, cb];
        g.shadowBlur = f > 0 ? rr * 4 * f : 0; g.shadowColor = `rgb(${c})`;
        g.fillStyle = `rgba(${c},${0.12 + 0.88 * f})`;
        g.beginPath(); g.arc(px, py, rr, 0, TAU); g.fill();
      }
      g.restore();
      // pointer at ~2 o'clock, trembling a little on peaks
      const pa = -0.65 + (on ? Math.sin(t * 37) * 0.04 * this.vu * this.vu : 0);
      g.save(); g.lineCap = 'round'; g.strokeStyle = '#e8ebef'; g.lineWidth = K.r * 0.1;
      g.beginPath(); g.moveTo(K.x + Math.cos(pa) * K.r * 0.28, K.y + Math.sin(pa) * K.r * 0.28); g.lineTo(K.x + Math.cos(pa) * K.r * 0.62, K.y + Math.sin(pa) * K.r * 0.62); g.stroke();
      g.restore();
      if (!on) { this.vu = 0; return; }                     // radio runs off the ignition

      const G = RD.glass, fs = G.h * 0.5, my = G.y + G.h / 2, pad = G.h * 0.3;
      const has = !!(media && media.active(t));
      g.save(); this._rr(g, G.x, G.y, G.w, G.h, G.h * 0.12); g.clip();
      g.fillStyle = col; g.shadowColor = col; g.shadowBlur = fs * 0.45;
      g.textBaseline = 'middle';
      const font = k => `700 ${fs * k}px Consolas, "Courier New", monospace`;
      // right: track number + clock (colon blinks)
      const d = new Date(), p2 = v => String(v).padStart(2, '0');
      g.font = font(1); g.textAlign = 'right';
      const clock = p2(d.getHours()) + (d.getMilliseconds() < 500 ? ':' : ' ') + p2(d.getMinutes());
      const xr = G.x + G.w - pad; g.fillText(clock, xr, my);
      let mx1 = xr - g.measureText('00:00').width - fs * 0.7;
      if (has) {
        g.font = font(0.62); const trk = 'TRK ' + p2(media.trackNo % 100);
        g.fillText(trk, mx1, my); mx1 -= g.measureText(trk).width + fs * 0.7;
      }
      // left: play state icon or AUX
      let mx0 = G.x + pad;
      if (!has) { g.font = font(0.62); g.textAlign = 'left'; g.fillText('AUX', mx0, my); mx0 += g.measureText('AUX').width + fs * 0.7; }
      else {
        const s = fs * 0.62, ix = mx0, iy = my - s / 2;
        g.beginPath();
        if (media.state === 'paused') { g.rect(ix, iy, s * 0.32, s); g.rect(ix + s * 0.58, iy, s * 0.32, s); }
        else if (media.state === 'stopped') g.rect(ix, iy + s * 0.05, s * 0.9, s * 0.9);
        else { g.moveTo(ix, iy); g.lineTo(ix + s * 0.9, my); g.lineTo(ix, iy + s); g.closePath(); }
        g.fill(); mx0 += s + fs * 0.7;
      }
      const mw = mx1 - mx0;
      if (mw > fs) {
        const bx0 = mx0 - fs * 0.45, bx1 = mx1 + fs * 0.3;      // a little room for the glow next to the icon / TRK
        g.save(); g.beginPath(); g.rect(bx0, G.y, bx1 - bx0, G.h); g.clip();
        if (!has) {                                          // no track info: mini spectrum analyzer
          const cols = Math.max(4, Math.floor(mw / (fs * 0.42))), cw = mw / cols, bh = G.h * 0.62, b = audio.bands;
          const litP = new Path2D(), offP = new Path2D();   // one fill each: glow only on the lit segments
          for (let i = 0; i < cols; i++) {
            const i0 = Math.floor(Math.pow(i / cols, 1.6) * 60), i1 = Math.max(i0 + 1, Math.floor(Math.pow((i + 1) / cols, 1.6) * 60));
            let v = 0; for (let j = i0; j < i1; j++) v = Math.max(v, b[j]);
            v = clamp(Math.sqrt(v / audio.peak) * 0.9, 0, 1);  // AGC-relative, like the VU ring
            const sp = this.spec[i] || 0; this.spec[i] = v > sp ? v : sp * Math.exp(-dt * 5);
            const segs = Math.round(this.spec[i] * 6);
            for (let k = 0; k < 6; k++)
              (k < segs ? litP : offP).rect(mx0 + i * cw + cw * 0.15, my + bh / 2 - (k + 1) * bh / 6 + bh * 0.03, cw * 0.7, bh / 6 - bh * 0.06);
          }
          g.fill(litP);
          g.shadowBlur = 0; g.globalAlpha = 0.1; g.fill(offP); g.globalAlpha = 1;
        } else {
          const fresh = media.trackNo > 1 && t - media.changeT < 1.2;
          const txt = fresh ? 'TRACK ' + p2(media.trackNo % 100)
            : (media.artist ? media.artist + ' — ' + media.title : media.title).toUpperCase();
          g.font = font(1); g.textAlign = 'left';
          if (txt !== this.mText) { this.mText = txt; this.scroll = 0; this.scrollHold = 1.5; }
          const tw = g.measureText(txt).width;
          const playing = media.state !== 'paused' && media.state !== 'stopped';   // null = no playback event yet: like playing (▶)
          if (tw <= mw) { g.textAlign = 'center'; g.fillText(txt, mx0 + mw / 2, my); }
          else {
            const gap = g.measureText('   •   ').width, L = tw + gap;
            if (playing) {
              if (this.scrollHold > 0) this.scrollHold -= dt;
              else { this.scroll += dt * R * 0.25; if (this.scroll >= L) { this.scroll -= L; this.scrollHold = 1.5; } }
            }
            // text + glow go to an offscreen strip that fades out at both ends (a hard clip cut the glow off)
            const d = this.dpr, bw = bx1 - bx0, c = this._mq || (this._mq = document.createElement('canvas')), q = c.getContext('2d');
            const pw = Math.ceil(bw * d), ph = Math.ceil(G.h * d);
            if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
            q.setTransform(d, 0, 0, d, -bx0 * d, -G.y * d); q.clearRect(bx0, G.y, bw, G.h);
            q.font = g.font; q.textAlign = 'left'; q.textBaseline = 'middle';
            q.fillStyle = col; q.shadowColor = col; q.shadowBlur = fs * 0.45;
            const x = mx0 - this.scroll;
            q.fillText(txt + '   \u2022   ', x, my);
            if (x + L < bx1) q.fillText(txt, x + L, my);                  // wrap-around copy only when it's visible
            // opaque from just past mx0 (the first letter at rest stays whole) to 0.6 fs before mx1, zero at the ends
            const m = q.createLinearGradient(bx0, 0, bx1, 0), at = v => clamp((v - bx0) / bw, 0, 1);
            m.addColorStop(at(mx0 - fs * 0.35), 'rgba(0,0,0,0)'); m.addColorStop(at(mx0 + fs * 0.1), '#000');
            m.addColorStop(at(mx1 - fs * 0.6), '#000'); m.addColorStop(at(mx1 + fs * 0.05), 'rgba(0,0,0,0)');
            q.shadowBlur = 0; q.globalCompositeOperation = 'destination-in'; q.fillStyle = m; q.fillRect(bx0, G.y, bw, G.h);
            q.globalCompositeOperation = 'source-over';
            g.shadowBlur = 0; g.drawImage(c, bx0, G.y, bw, G.h);
          }
        }
        g.restore();
      }
      g.restore();
      // glass reflection
      const gr = g.createLinearGradient(0, G.y, 0, G.y + G.h);
      gr.addColorStop(0, 'rgba(255,255,255,0.07)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.02)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.fillStyle = gr; this._rr(g, G.x, G.y, G.w, G.h, G.h * 0.12); g.fill();
    }

    /* what the cluster covers, in CSS px (circles {x, y, r}, rects {x, y, w, h}): Engine3D keeps the engine out of it */
    keepOut() {
      if (!this.w || !this.lampBox) return [];
      const R = this.R, out = [{ x: this.cx, y: this.cy, r: R * 1.1 }, this.shiftBox, this.lampBox];
      for (const G of [this.tempG, this.boostG]) out.push({ x: G.x, y: G.y, r: G.r * 1.1 });
      if (this.odoHit) out.push(this.odoHit);
      if (this.radio) out.push({ x: this.radio.x, y: this.radio.y, w: this.radio.w, h: this.radio.h });
      if (this.showControls) {
        const K = this.keyC, P = this.pedalR;
        out.push({ x: K.x, y: K.y, r: K.r * 1.75 });                                   // OFF / ON / START around it
        out.push({ x: K.x - K.r * 0.8, y: K.y + K.r * 1.2, w: K.r * 1.6, h: K.r * 0.6 }); // IGNITION
        out.push({ x: P.x - P.w * 0.3, y: P.y, w: P.w * 1.6, h: P.h * 1.3 });           // pedal + THROTTLE
      }
      return out.map(s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v * 10) / 10])));
    }

    hitTest(x, y) {
      const O = this.odoHit;                               // works with the key/pedal hidden too: resets TRIP
      if (O && x > O.x && x < O.x + O.w && y > O.y && y < O.y + O.h) return 'odo';
      if (!this.showControls || !this.keyC) return null;
      const K = this.keyC, P = this.pedalR;
      if (Math.hypot(x - K.x, y - K.y) < K.r * 1.3) return 'key';
      if (x > P.x - P.w * 0.25 && x < P.x + P.w * 1.25 && y > P.y - P.h * 0.1 && y < P.y + P.h * 1.1) return 'pedal';
      return null;
    }

    _rr(g, x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }

    _hub(g, x, y, r) { // needle hub cap with an off-centre highlight
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      gr.addColorStop(0, '#6a7078'); gr.addColorStop(1, '#15171a');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }

    _needle(g, cx, cy, a, len, tail, width, col) {
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.shadowColor = col; g.shadowBlur = width * 3;
      g.fillStyle = col; g.beginPath();
      g.moveTo(-tail, -width); g.lineTo(len, -width * 0.25); g.lineTo(len, width * 0.25); g.lineTo(-tail, width); g.closePath(); g.fill();
      g.restore();
    }

    draw(sim, audio, dt, t, media, odo) {
      const g = this.ctx, d = this.dpr, R = this.R, cx = this.cx, cy = this.cy;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.c.width, this.c.height);
      g.drawImage(this.st, 0, 0);
      g.setTransform(d, 0, 0, d, 0, 0);
      const tc = this.prof.tach, max = tc.max, a0 = 0.75 * Math.PI, sw = 1.5 * Math.PI;
      // needle smoothing (needle has its own mass); in the tach's own units
      const off = sim.state === 'off';
      this.needle += (tc.map(sim.rpm) - this.needle) * (1 - Math.exp(-dt * 18));
      if (!isFinite(this.needle)) this.needle = 0;
      const rpm = this.needle;
      // lit arc
      g.save(); g.lineCap = 'round';
      g.strokeStyle = this.color; g.shadowColor = this.color; g.shadowBlur = R * 0.12; g.lineWidth = R * 0.02;
      if (rpm > max * 0.002 && !off) { g.beginPath(); g.arc(cx, cy, R * 0.985, a0, this._ang(rpm, max, a0, sw)); g.stroke(); }
      g.restore();
      this._needle(g, cx, cy, this._ang(rpm, max, a0, sw), R * 0.88, R * 0.16, R * 0.028, off ? '#4a3a33' : sim.limiter ? '#ffffff' : this.color);
      this._hub(g, cx, cy, R * 0.1);

      // digital readouts
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (!off) {
      g.font = `700 ${R * 0.17}px Consolas, "Courier New", monospace`;
      g.fillStyle = sim.rpm > this.redline * 0.93 ? '#ff4a3a' : '#f2f4f6';
      g.fillText(tc.digits(tc.map(sim.rpm)), cx, cy + R * 0.52);
      if (this.showBpm) {
        g.font = `600 ${R * 0.07}px Consolas, "Courier New", monospace`;
        g.fillStyle = '#8a929b';
        const bpmTxt = audio.conf > 0.12 && sim.state === 'running' ? Math.round(audio.bpm) : '---';
        g.fillText(`BPM ${bpmTxt}   LOAD ${Math.round(Math.max(audio.power, sim.pedal) * 100)}%`, cx, cy + R * 0.72);
      }
      }

      // shift lights
      const red = this.redline;
      const flashAll = sim.limiter || sim.rpm > red * 0.99;
      const blink = Math.floor(t * 12) % 2 === 0;
      this.shift.forEach((s, i) => {
        const th = red * (0.6 + i * 0.037);
        const on = flashAll ? blink : sim.rpm > th;
        const col = flashAll ? '#4aa8ff' : i < 4 ? '#35e36a' : i < 7 ? '#ffd02a' : '#ff3322';
        const rr = R * 0.065;
        g.save();
        if (on) { g.shadowColor = col; g.shadowBlur = rr * 3; g.fillStyle = col; }
        else g.fillStyle = '#1b1d20';
        g.beginPath(); g.arc(s.x, s.y, rr, 0, TAU); g.fill(); g.restore();
      });

      // small gauges
      [[this.tempG, this.prof.left], [this.boostG, this.prof.right]].forEach(([G, gs], i) => {
        const N = this.gaugeN;
        N[i] += (gs.value(sim) - N[i]) * (1 - Math.exp(-dt * (gs.rate || 10)));
        if (!isFinite(N[i])) N[i] = 0;
        const v = N[i], a = G.a0 + clamp((v - G.min) / (G.max - G.min), 0, 1) * G.sw;
        this._needle(g, G.x, G.y, a, G.r * 0.82, G.r * 0.15, G.r * 0.05, off ? '#4a3a33' : v > gs.danger ? '#ff3322' : this.color);
        this._hub(g, G.x, G.y, G.r * 0.12);
        g.font = `700 ${G.r * 0.22}px Consolas, monospace`; g.fillStyle = '#e6e9ec';
        if (!off) g.fillText(gs.text(v), G.x, G.y + G.r * 0.36);
      });

      // warning lamps
      const w = sim.warn;
      this.lampRects.forEach(L => {
        let on = !!w[L.l.key];
        if (L.l.key === 'overheat' && sim.temp > 118) on = on && blink;
        if (L.l.key === 'stall' && sim.state === 'stalling') on = Math.floor(t * 5) % 2 === 0;
        const lv = this.lampLvl[L.l.key] += ((on ? 1 : 0) - this.lampLvl[L.l.key]) * (1 - Math.exp(-dt * 25));
        this._lens(g, L, lv);
      });
      if (this.odoR && odo) {
        this._drums(g, this.odoR, odo.value(this.odoUnits, false));
        this._drums(g, this.tripR, odo.value(this.odoUnits, true));
      }
      if (this.radio) this._radioDraw(g, sim, audio, media, dt, t);
      if (this.showControls) { this._keyDraw(g, this.keyC, sim, dt); this._pedalDraw(g, this.pedalR, sim, dt); }
    }
  }
  Dash.LAMPS = LAMPS;           // lamp keys (= sim.warn keys) a type may rename
  window.Dash = Dash;
})();
