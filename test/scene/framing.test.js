'use strict';
/* camera fit: the engine is in the frame, big enough, and never under anything the dash draws (Dash.keepOut) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, IDS } = require('../helpers/scene');

const SIZES = [[1920, 1080], [1600, 900], [2560, 1080], [3840, 1080], [1280, 1024], [900, 1600], [1080, 1920]];

function project(W) {
  const T = W.g.THREE, P = W.e._fitPts, v = new T.Vector3(), out = [];
  W.e.camera.updateMatrixWorld();
  for (let i = 0; i < P.length; i += 3) { v.set(P[i], P[i + 1], P[i + 2]).project(W.e.camera); out.push([v.x, v.y]); }
  return out;
}
const hit = (s, x, y, m) => (s.r !== undefined ? Math.hypot(x - s.x, y - s.y) < s.r + m : x > s.x - m && x < s.x + s.w + m && y > s.y - m && y < s.y + s.h + m);

test('every layout, the longest build: in frame, sized sensibly, off the dash (radio / key&pedal on and off)', () => {
  const W = world();
  for (const id of IDS) {
    W.build(32, id, '2');
    for (const [w, h] of SIZES) for (const showRadio of [false, true]) for (const showControls of [true, false]) {
      W.resize(w, h); W.dashSet({ showRadio, showControls });
      const tag = `${id} ${w}x${h} radio ${showRadio} controls ${showControls}`;
      const pts = project(W), ko = W.d.keepOut(), m = 0.012 * w - 0.5;
      let mnx = 9, mxx = -9, mny = 9, mxy = -9;
      for (const [x, y] of pts) {
        mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y);
        const px = (x + 1) / 2 * w, py = (1 - y) / 2 * h;
        const s = ko.find(k => hit(k, px, py, m));
        if (s) assert.fail(`${tag}: engine point at (${px.toFixed(0)}, ${py.toFixed(0)}) under the dash ${JSON.stringify(s)}`);
      }
      assert.ok(mnx > -1 && mxx < 1 && mny > -1 && mxy < 1, `${tag}: out of frame ${[mnx, mxx, mny, mxy].map(v => v.toFixed(2))}`);
      const portrait = w / h < 1.25;
      const size = portrait ? mxx - mnx : Math.max(mxx - mnx, mxy - mny);      // a radial is round: judge by its larger side
      assert.ok(size > (portrait ? 0.8 : 0.45), `${tag}: engine too small (${size.toFixed(2)} NDC)`);
      if (!portrait) assert.ok((mnx + mxx) / 2 < 0, `${tag}: engine not on the left`);
      else assert.ok((mny + mxy) / 2 > 0, `${tag}: engine not above the dash`);
    }
  }
});

test('before the dash reports its areas: the old FIT_RIGHT limit (landscape)', () => {
  const W = world({ dash: false });
  for (const id of ['inline', 'w', 'jet']) {
    W.build(32, id, '0');
    for (const [w, h] of [[1920, 1080], [2560, 1080]]) {
      W.resize(w, h);
      const mx = Math.max(...project(W).map(p => p[0]));
      assert.ok(mx <= 0.14 + 1e-6, `${id} ${w}x${h}: right edge ${mx}`);
    }
  }
});

test('setKeepOut reframes only when the areas change; the flame glow maps into the frame', () => {
  const W = world();
  W.build(8, 'v', '1');
  let frames = 0;
  const orig = W.e._frame.bind(W.e);
  W.e._frame = () => { frames++; orig(); };
  W.e.setKeepOut(W.d.keepOut());
  assert.equal(frames, 0);
  W.dashSet({ showRadio: true });
  assert.equal(frames, 1);
  for (const id of IDS) {
    W.build(8, id, '1');
    W.rev(1);
    const gp = W.e.glowScreen();
    if (gp) assert.ok(gp.x >= 0 && gp.x <= W.w && gp.y >= 0 && gp.y <= W.h, `${id}: glow at ${gp.x},${gp.y}`);
  }
});
