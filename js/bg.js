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
    dyno(g, w, h) {
      let gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#05080d'); gr.addColorStop(0.62, '#0a1320'); gr.addColorStop(1, '#03050a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const hy = h * 0.62, vx = w * 0.3;
      g.strokeStyle = 'rgba(60,170,255,0.18)'; g.lineWidth = 1;
      for (let i = -30; i <= 30; i++) { g.beginPath(); g.moveTo(vx, hy); g.lineTo(vx + i * w * 0.08, h); g.stroke(); }
      for (let k = 1; k < 18; k++) { const y = hy + (h - hy) * Math.pow(k / 18, 2.2); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      gr = g.createRadialGradient(vx, hy, 0, vx, hy, w * 0.5);
      gr.addColorStop(0, 'rgba(60,160,255,0.2)'); gr.addColorStop(1, 'rgba(60,160,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      vignette(g, w, h, 0.75);
    },
    carbon(g, w, h) {
      const t = document.createElement('canvas'); t.width = t.height = 24; const c = t.getContext('2d');
      c.fillStyle = '#0c0d0f'; c.fillRect(0, 0, 24, 24);
      const cell = (x, y, vert) => {
        const gr = vert ? c.createLinearGradient(x, y, x + 12, y) : c.createLinearGradient(x, y, x, y + 12);
        gr.addColorStop(0, '#16181b'); gr.addColorStop(0.5, '#2a2d32'); gr.addColorStop(1, '#101113');
        c.fillStyle = gr; c.fillRect(x + 0.5, y + 0.5, 11, 11);
      };
      cell(0, 0, true); cell(12, 0, false); cell(0, 12, false); cell(12, 12, true);
      g.fillStyle = g.createPattern(t, 'repeat'); g.fillRect(0, 0, w, h);
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.06)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.03)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      vignette(g, w, h, 0.8);
    },
    asphalt(g, w, h) {
      g.fillStyle = '#121315'; g.fillRect(0, 0, w, h);
      g.fillStyle = g.createPattern(noiseTile(256, 0.12, true), 'repeat'); g.fillRect(0, 0, w, h);
      let gr = g.createRadialGradient(w * 0.85, -h * 0.1, 0, w * 0.85, -h * 0.1, h * 1.1);
      gr.addColorStop(0, 'rgba(255,150,50,0.28)'); gr.addColorStop(1, 'rgba(255,150,50,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(230,200,80,0.18)'; g.lineWidth = h * 0.012; g.setLineDash([h * 0.08, h * 0.06]);
      g.beginPath(); g.moveTo(0, h * 0.93); g.lineTo(w, h * 0.86); g.stroke(); g.setLineDash([]);
      vignette(g, w, h, 0.75);
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
