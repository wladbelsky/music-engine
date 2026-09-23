/* 2D instrument cluster: tachometer, temp, boost, shift lights, warning lamps. */
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
      this.redline = 7000; this.color = '#ff5a1a'; this.label = 'V8 TURBO';
      this.showBpm = true; this.needle = 0; this.tempN = 70; this.boostN = 0;
      this.lampLvl = {}; LAMPS.forEach(l => this.lampLvl[l.key] = 0);
      this.showControls = true; this.keyAng = -50; this.pedalN = 0; this.pedalHover = false;
    }

    resize(w, h, dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      for (const cv of [this.c, this.st]) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      this.c.style.width = w + 'px'; this.c.style.height = h + 'px';
      this._layout(); this._static();
    }
    set(opts) {
      let dirty = false;
      for (const k of ['redline', 'color', 'label', 'showBpm', 'showControls']) if (opts[k] !== undefined && opts[k] !== this[k]) { this[k] = opts[k]; dirty = true; }
      if (dirty && this.w) this._static();
    }

    _layout() {
      const w = this.w, h = this.h;
      if (w / h >= 1.25) { this.R = Math.min(0.155 * w, 0.24 * h); this.cx = 0.76 * w; this.cy = 0.385 * h; }
      else { this.R = Math.min(0.28 * w, 0.14 * h); this.cx = 0.5 * w; this.cy = 0.64 * h; }
      this.maxRpm = Math.ceil((this.redline + 1000) / 1000) * 1000;
    }

    _ang(v, max, a0, sweep) { return a0 + clamp(v / max, 0, 1.02) * sweep; }

    _static() {
      this._layout();
      const g = this.sctx, d = this.dpr, R = this.R, cx = this.cx, cy = this.cy;
      g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, this.w, this.h);
      // instrument positions first: the cable conduits run behind everything
      const sr = R * 0.36;
      this.tempG = { x: cx - R * 1.2, y: cy + R * 1.02, r: sr };
      this.boostG = { x: cx + R * 1.2, y: cy + R * 1.02, r: sr };
      const cellW = R * 0.74, cellH = R * 0.24, gapX = R * 0.035, gapY = R * 0.07;
      const totalW = 4 * cellW + 3 * gapX, x0 = cx - totalW / 2, y0 = cy + R * 1.58;
      this.keyC = { x: cx - R * 1.5, y: cy - R * 0.93, r: R * 0.27 };
      this.pedalR = { x: cx + R * 1.5 - R * 0.17, y: cy - R * 1.24, w: R * 0.34, h: R * 0.62 };
      this._harness(g, x0, x0 + totalW, y0, y0 + cellH + gapY / 2);
      this._bezel(g, cx, cy, R);
      // tach ticks
      const max = this.maxRpm, a0 = 0.75 * Math.PI, sw = 1.5 * Math.PI;
      g.lineCap = 'butt';
      g.strokeStyle = '#b3141a'; g.lineWidth = R * 0.075;
      g.beginPath(); g.arc(cx, cy, R * 0.9, this._ang(this.redline, max, a0, sw), a0 + sw); g.stroke();
      for (let v = 0; v <= max; v += 250) {
        const a = this._ang(v, max, a0, sw), major = v % 1000 === 0, half = v % 500 === 0;
        const r1 = R * 0.95, r0 = R * (major ? 0.8 : half ? 0.86 : 0.89);
        g.strokeStyle = v >= this.redline ? '#ff4a3a' : '#d9dde2'; g.lineWidth = major ? R * 0.022 : R * 0.009;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
        if (major) {
          g.fillStyle = v >= this.redline ? '#ff4a3a' : '#e8ebef';
          g.font = `600 ${R * 0.13}px "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(v / 1000), cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66);
        }
      }
      g.fillStyle = '#7d848c'; g.font = `500 ${R * 0.065}px "Segoe UI", Arial, sans-serif`;
      g.fillText('RPM × 1000', cx, cy + R * 0.3);
      g.fillStyle = '#9aa1a9'; g.font = `700 ${R * 0.075}px "Segoe UI", Arial, sans-serif`;
      g.fillText(this.label, cx, cy - R * 0.3);

      // small gauges
      this._smallStatic(g, this.tempG, 60, 130, [60, 80, 100, 120], 110, 'TEMP °C');
      this._smallStatic(g, this.boostG, -1, 2, [-1, 0, 1, 2], 1.5, 'BOOST bar');

      // warning lamps: round lamp + screwed metal nameplate
      this.lampRects = LAMPS.map((l, i) => {
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
      // shift light housing
      const n = 10, sp = R * 0.19;
      this.shift = []; for (let i = 0; i < n; i++) this.shift.push({ x: cx + (i - (n - 1) / 2) * sp, y: cy - R * 1.22 });
      g.fillStyle = '#0d0e10'; g.strokeStyle = '#2c3035'; g.lineWidth = 2;
      this._rr(g, cx - n * sp / 2 - sp * 0.2, cy - R * 1.22 - sp * 0.45, n * sp + sp * 0.4, sp * 0.9, sp * 0.45); g.fill(); g.stroke();
      // ignition key + throttle pedal
      if (this.showControls) { this._keyStatic(g, this.keyC); this._pedalStatic(g, this.pedalR); }
    }

    /* ---------- cable conduits (corrugated loom) linking the instruments ---------- */
    _harness(g, xl, xr, y0, busY) {
      const R = this.R, cx = this.cx, cy = this.cy, w = this.w, T = this.tempG, B = this.boostG;
      const thick = R * 0.1, thin = R * 0.075, off = R * 0.6; // off: how far the bundle runs past the right edge
      const ctl = this.showControls, K = this.keyC, P = this.pedalR;
      // every line gathers right of the tach and leaves through the right edge as one bundle;
      // slots top -> bottom, so lines joining from above/behind the tach never cross the ones coming up from below
      const lines = (ctl ? ['pedal', 'key'] : []).concat(['tach', 'temp', 'boost', 'bus']);
      const wd = { pedal: thin, key: thin, tach: thin, temp: thin, boost: thin, bus: thick };
      const pack = 0.95, span = lines.reduce((a, k) => a + wd[k] * pack, 0), sy = {};
      lines.reduce((y, k) => { sy[k] = y + wd[k] * pack / 2; return y + wd[k] * pack; }, cy + R * 0.3 - span / 2);
      const out = k => [w + off, sy[k] + R * 0.04];                                   // off the right edge
      const up = (k, x) => [[x, sy[k] + R * 0.12], [x + R * 0.12, sy[k]], out(k)];     // rise at x, turn right
      const run = (k, pts) => this._conduit(g, pts, wd[k], []);

      // ignition switch -> tach; key and tach lines come out from behind the right side of the tach
      if (ctl) this._conduit(g, [[K.x, K.y], [K.x + R * 0.45, K.y + R * 0.12], [cx - R * 0.8, cy - R * 0.35]], thin, []);
      for (const k of ctl ? ['key', 'tach'] : ['tach']) run(k, [[cx + R * 0.8, sy[k]], [cx + R * 1.1, sy[k]], out(k)]);
      // throttle pedal: down past the left of the THROTTLE label
      if (ctl) run('pedal', [[P.x + P.w * 0.15, P.y + P.h * 0.94], [cx + R * 1.22, cy - R * 0.45], [cx + R * 1.22, sy.pedal - R * 0.12], [cx + R * 1.34, sy.pedal], out('pedal')]);
      // temp: along the gap above the lamps, then up behind the boost gauge
      run('temp', [[T.x, T.y], [T.x + R * 0.3, cy + R * 1.49], [cx + R * 1.1, cy + R * 1.49], [cx + R * 1.3, cy + R * 1.15], ...up('temp', cx + R * 1.3)]);
      // boost: straight up out of the gauge
      run('boost', [[B.x + R * 0.22, B.y], [B.x + R * 0.22, B.y - R * 0.3], ...up('boost', B.x + R * 0.22)]);
      // lamp bus: between the two lamp rows, up past the last lamp and behind the boost gauge
      run('bus', [[xl + R * 0.2, busY], [cx + R * 1.3, busY], [cx + R * 1.5, busY - R * 0.25], [cx + R * 1.5, cy + R * 1.1], ...up('bus', cx + R * 1.5)]);
      // strap across the bundle once everything has joined
      const top = sy[lines[0]] - wd[lines[0]] / 2, bot = sy[lines[lines.length - 1]] + wd[lines[lines.length - 1]] / 2;
      const stx = cx + R * 1.68;
      if (stx < w) this._strap(g, stx, (top + bot) / 2 + R * 0.04, bot - top, R * 0.07, Math.PI / 2);
    }

    _strap(g, x, y, len, t, ang) { // metal strap across a bundle, screwed to the panel at both ends
      const e = t * 1.4;
      g.save(); g.translate(x, y); g.rotate(ang);
      g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = t * 0.8; g.shadowOffsetY = t * 0.3;
      const gr = g.createLinearGradient(0, -t / 2, 0, t / 2);
      gr.addColorStop(0, '#5c6268'); gr.addColorStop(0.35, '#e6e9ec'); gr.addColorStop(0.7, '#9aa0a6'); gr.addColorStop(1, '#4a4f55');
      g.fillStyle = gr; this._rr(g, -len / 2 - e, -t / 2, len + 2 * e, t, t * 0.3); g.fill();
      g.shadowColor = 'transparent';
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.8; g.stroke();
      this._screw(g, -len / 2 - e * 0.5, 0, t * 0.32, 1); this._screw(g, len / 2 + e * 0.5, 0, t * 0.32, 2);
      g.restore();
    }

    _spline(pts, n) { // Catmull-Rom through the control points -> polyline, n samples per segment
      const out = [], m = pts.length - 1;
      for (let i = 0; i < m; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(m, i + 2)];
        for (let k = 0; k < n; k++) {
          const t = k / n, t2 = t * t, t3 = t2 * t;
          out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3)));
        }
      }
      out.push(pts[m].slice()); return out;
    }

    _conduit(g, pts, wd, clamps) {
      const N = 24, P = this._spline(pts, N);
      const path = () => { g.beginPath(); g.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) g.lineTo(P[i][0], P[i][1]); };
      g.save(); g.lineJoin = 'round'; g.lineCap = 'butt';
      // body + soft shadow on the panel
      g.shadowColor = 'rgba(0,0,0,0.75)'; g.shadowBlur = wd * 0.9; g.shadowOffsetX = wd * 0.15; g.shadowOffsetY = wd * 0.45;
      path(); g.strokeStyle = '#0b0c0e'; g.lineWidth = wd; g.stroke();
      g.shadowColor = 'transparent';
      // round shading: stacked strokes from the dark rim to the lit core
      for (const [k, c] of [[0.82, '#1e2125'], [0.58, '#2c3035'], [0.32, '#3e434a']]) { path(); g.strokeStyle = c; g.lineWidth = wd * k; g.stroke(); }
      // corrugation: dark grooves + a thin lit crest on each rib
      const pitch = wd * 0.32;
      g.setLineDash([pitch * 0.4, pitch * 0.6]);
      path(); g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = wd; g.stroke();
      g.setLineDash([pitch * 0.14, pitch * 0.86]); g.lineDashOffset = -pitch * 0.45;
      path(); g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = wd * 0.8; g.stroke();
      g.setLineDash([]);
      path(); g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = wd * 0.12; g.stroke();
      g.restore();
      clamps.forEach((s, i) => {
        const j = Math.min(P.length - 2, Math.round(s * N)), a = Math.atan2(P[j + 1][1] - P[j][1], P[j + 1][0] - P[j][0]);
        this._pclip(g, P[j][0], P[j][1], a, wd, i + j);
      });
    }

    _pclip(g, x, y, a, wd, seed) { // metal P-clip holding the conduit to the panel
      const bw = wd * 0.6, bh = wd * 0.62;
      g.save(); g.translate(x, y); g.rotate(a);
      g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = wd * 0.5; g.shadowOffsetY = wd * 0.2;
      const gr = g.createLinearGradient(0, -bh, 0, bh);
      gr.addColorStop(0, '#5c6268'); gr.addColorStop(0.3, '#e6e9ec'); gr.addColorStop(0.6, '#9aa0a6'); gr.addColorStop(1, '#4a4f55');
      g.fillStyle = gr;
      this._rr(g, -bw / 2, -bh, bw, bh * 2, bw * 0.3); g.fill();                 // band over the tube
      this._rr(g, -bw * 0.95, bh * 0.55, bw * 1.9, wd * 0.75, wd * 0.2); g.fill(); // tab
      g.shadowColor = 'transparent';
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.8; g.stroke();
      this._screw(g, 0, bh * 0.55 + wd * 0.37, wd * 0.22, seed);
      g.restore();
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

    _smallStatic(g, G, min, max, labels, danger, title) {
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
      labels.forEach(v => { const a = a0 + (v - min) / (max - min) * sw; g.fillText(String(v), G.x + Math.cos(a) * r * 0.5, G.y + Math.sin(a) * r * 0.5); });
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

    hitTest(x, y) {
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

    _needle(g, cx, cy, a, len, tail, width, col) {
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.shadowColor = col; g.shadowBlur = width * 3;
      g.fillStyle = col; g.beginPath();
      g.moveTo(-tail, -width); g.lineTo(len, -width * 0.25); g.lineTo(len, width * 0.25); g.lineTo(-tail, width); g.closePath(); g.fill();
      g.restore();
    }

    draw(sim, audio, dt, t) {
      const g = this.ctx, d = this.dpr, R = this.R, cx = this.cx, cy = this.cy;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.c.width, this.c.height);
      g.drawImage(this.st, 0, 0);
      g.setTransform(d, 0, 0, d, 0, 0);
      const max = this.maxRpm, a0 = 0.75 * Math.PI, sw = 1.5 * Math.PI;
      // needle smoothing (needle has its own mass)
      const off = sim.state === 'off';
      this.needle += (sim.rpm - this.needle) * (1 - Math.exp(-dt * 18));
      const rpm = this.needle;
      // lit arc
      g.save(); g.lineCap = 'round';
      g.strokeStyle = this.color; g.shadowColor = this.color; g.shadowBlur = R * 0.12; g.lineWidth = R * 0.02;
      if (rpm > 20 && !off) { g.beginPath(); g.arc(cx, cy, R * 0.985, a0, this._ang(rpm, max, a0, sw)); g.stroke(); }
      g.restore();
      this._needle(g, cx, cy, this._ang(rpm, max, a0, sw), R * 0.88, R * 0.16, R * 0.028, off ? '#4a3a33' : sim.limiter ? '#ffffff' : this.color);
      let gr = g.createRadialGradient(cx - R * 0.03, cy - R * 0.03, 0, cx, cy, R * 0.1);
      gr.addColorStop(0, '#6a7078'); gr.addColorStop(1, '#15171a');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 0.1, 0, TAU); g.fill();

      // digital readouts
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (!off) {
      g.font = `700 ${R * 0.17}px Consolas, "Courier New", monospace`;
      g.fillStyle = sim.rpm > this.redline * 0.93 ? '#ff4a3a' : '#f2f4f6';
      g.fillText(String(Math.round(sim.rpm / 10) * 10).padStart(4, ' '), cx, cy + R * 0.52);
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
      this.tempN += (sim.temp - this.tempN) * (1 - Math.exp(-dt * 4));
      this.boostN += (sim.boost - this.boostN) * (1 - Math.exp(-dt * 10));
      for (const [G, v, dg] of [[this.tempG, this.tempN, 110], [this.boostG, this.boostN, 1.5]]) {
        const a = G.a0 + clamp((v - G.min) / (G.max - G.min), 0, 1) * G.sw;
        this._needle(g, G.x, G.y, a, G.r * 0.82, G.r * 0.15, G.r * 0.05, off ? '#4a3a33' : v > dg ? '#ff3322' : this.color);
        g.fillStyle = '#23262a'; g.beginPath(); g.arc(G.x, G.y, G.r * 0.12, 0, TAU); g.fill();
        g.font = `700 ${G.r * 0.22}px Consolas, monospace`; g.fillStyle = '#e6e9ec';
        if (!off) g.fillText(G === this.tempG ? Math.round(v) : (v >= 0 ? '+' : '') + v.toFixed(2), G.x, G.y + G.r * 0.36);
      }

      // warning lamps
      const w = sim.warn;
      this.lampRects.forEach(L => {
        let on = !!w[L.l.key];
        if (L.l.key === 'overheat' && sim.temp > 118) on = on && blink;
        if (L.l.key === 'stall' && sim.state === 'stalling') on = Math.floor(t * 5) % 2 === 0;
        const lv = this.lampLvl[L.l.key] += ((on ? 1 : 0) - this.lampLvl[L.l.key]) * (1 - Math.exp(-dt * 25));
        this._lens(g, L, lv);
      });
      if (this.showControls) { this._keyDraw(g, this.keyC, sim, dt); this._pedalDraw(g, this.pedalR, sim, dt); }
    }
  }
  window.Dash = Dash;
})();
