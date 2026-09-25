/* Background presets drawn once into a 2D canvas, or a user image. */
(function () {
  'use strict';
  function noiseTile(size, alpha, mono) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), im = g.createImageData(size, size);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = Math.random() * 255;
      im.data[i] = v; im.data[i + 1] = mono ? v : Math.random() * 255; im.data[i + 2] = mono ? v : Math.random() * 255;
      im.data[i + 3] = alpha * 255;
    }
    g.putImageData(im, 0, 0); return c;
  }
  function vignette(g, w, h, k) {
    const gr = g.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.3, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${k})`);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  const rgb = (c, m = 1) => `rgb(${Math.round(c[0] * 255 * m)},${Math.round(c[1] * 255 * m)},${Math.round(c[2] * 255 * m)})`;

  const PRESETS = {
    garage(g, w, h) {
      let gr = g.createLinearGradient(0, 0, 0, h * 0.7);
      gr.addColorStop(0, '#0b0c0e'); gr.addColorStop(1, '#1d1f23');
      g.fillStyle = gr; g.fillRect(0, 0, w, h * 0.7);
      g.strokeStyle = 'rgba(255,255,255,0.025)'; g.lineWidth = 2;
      for (let x = 0; x < w; x += w / 14) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h * 0.7); g.stroke(); }
      gr = g.createLinearGradient(0, h * 0.7, 0, h);
      gr.addColorStop(0, '#191a1d'); gr.addColorStop(1, '#060607');
      g.fillStyle = gr; g.fillRect(0, h * 0.7, w, h * 0.3);
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, h * 0.7, w, 2);
      // overhead spot over the engine
      gr = g.createRadialGradient(w * 0.3, h * 0.05, 0, w * 0.3, h * 0.35, h * 0.8);
      gr.addColorStop(0, 'rgba(255,236,210,0.16)'); gr.addColorStop(1, 'rgba(255,236,210,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.save(); g.translate(w * 0.3, h * 0.8); g.scale(1, 0.22);
      gr = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.3);
      gr.addColorStop(0, 'rgba(255,230,200,0.12)'); gr.addColorStop(1, 'rgba(255,230,200,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, w * 0.3, 0, Math.PI * 2); g.fill(); g.restore();
      g.fillStyle = g.createPattern(noiseTile(128, 0.05, true), 'repeat'); g.fillRect(0, 0, w, h);
      vignette(g, w, h, 0.7);
    },
    carbon(g, w, h) {
      // 2x2 twill weave: each tow shows over two cells then dives under; horizontal and vertical tows catch
      // the light differently, which gives the stepped diagonal look. Tile drawn at 2x for sharp edges.
      const S = 4, K = 2, cs = S * K, T = cs * 4;                 // tow width in CSS px, supersampling, tile size
      const t = document.createElement('canvas'); t.width = t.height = T; const c = t.getContext('2d');
      c.fillStyle = '#050506'; c.fillRect(0, 0, T, T);
      const rnd = (() => { let q = 7; return () => (q = (q * 16807) % 2147483647) / 2147483647; })();
      const tow = (x, y, horiz) => {
        const len = cs * 2, wd = cs, gw = K * 0.6;                 // gw: dark gap around the tow
        const [lo, hi] = horiz ? ['#0b0c0e', '#3a3e44'] : ['#070809', '#1f2226'];
        for (const [ox, oy] of [[0, 0], [-T, 0], [0, -T], [-T, -T]]) {
          const X = x + ox, Y = y + oy;
          if (X >= T || Y >= T || X + (horiz ? len : wd) <= 0 || Y + (horiz ? wd : len) <= 0) continue;
          const gr = horiz ? c.createLinearGradient(0, Y, 0, Y + wd) : c.createLinearGradient(X, 0, X + wd, 0);
          gr.addColorStop(0, lo); gr.addColorStop(0.5, hi); gr.addColorStop(1, lo);
          c.fillStyle = gr;
          if (horiz) c.fillRect(X + gw, Y + gw, len - 2 * gw, wd - 2 * gw); else c.fillRect(X + gw, Y + gw, wd - 2 * gw, len - 2 * gw);
          // individual fibres along the tow
          c.lineWidth = 0.5;
          for (let k = 0; k < 5; k++) {
            const p = gw + (wd - 2 * gw) * (k + 0.5) / 5, a = 0.04 + rnd() * 0.06;
            c.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 2})`;
            c.beginPath();
            if (horiz) { c.moveTo(X + gw, Y + p); c.lineTo(X + len - gw, Y + p); } else { c.moveTo(X + p, Y + gw); c.lineTo(X + p, Y + len - gw); }
            c.stroke();
          }
        }
      };
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const m = (i + j) % 4;
        if (m === 0) tow(i * cs, j * cs, true);                    // horizontal tow over cells i, i+1
        if (m === 2) tow(i * cs, j * cs, false);                   // vertical tow over cells j, j+1
      }
      const pat = g.createPattern(t, 'repeat');
      pat.setTransform(new DOMMatrix().scale(1 / K));
      g.fillStyle = pat; g.fillRect(0, 0, w, h);
      // clear-coat sheen
      let gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.07)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.03)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      gr = g.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, Math.max(w, h) * 0.6);
      gr.addColorStop(0, 'rgba(255,255,255,0.06)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      vignette(g, w, h, 0.8);
    },
    gradient(g, w, h, opt) {
      const c = opt.bgcolor || [0.12, 0.13, 0.16];
      const gr = g.createRadialGradient(w * 0.35, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
      gr.addColorStop(0, rgb(c, 1.3)); gr.addColorStop(1, rgb(c, 0.2));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      vignette(g, w, h, 0.5);
    },
  };

  class Background {
    constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); this.opt = { preset: 'garage', dim: 0.2 }; this.img = null; }
    set(o) {
      Object.assign(this.opt, o);
      if (o.image !== undefined) {
        this.img = null;
        if (o.image) { const im = new Image(); im.onload = () => { this.img = im; this.draw(); }; im.onerror = () => { this.img = null; this.draw(); }; im.src = o.image; }
      }
      this.draw();
    }
    resize(w, h, dpr) { this.w = w; this.h = h; this.dpr = dpr; this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); this.draw(); }
    draw() {
      if (!this.w) return;
      const g = this.g, w = this.w, h = this.h; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      if (this.opt.preset === 'custom' && this.img) {
        const im = this.img, s = Math.max(w / im.width, h / im.height);
        g.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s);
      } else (PRESETS[this.opt.preset] || PRESETS.garage)(g, w, h, this.opt);
      if (this.opt.dim > 0) { g.fillStyle = `rgba(0,0,0,${this.opt.dim})`; g.fillRect(0, 0, w, h); }
    }
  }
  window.Background = Background;
})();
