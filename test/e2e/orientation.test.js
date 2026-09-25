'use strict';
/* a phone turned to landscape and back: the page must not stay zoomed out with the canvases in its top-left corner
   (the dash canvas used to get a fixed CSS size from innerWidth/innerHeight, which follow the pinch zoom) */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, open } = require('./page');

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test('portrait -> landscape -> portrait on a phone keeps the page at scale 1 and the canvases full screen', async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 780 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const P = await open(browser, 'layout=jet&cylinders=12', { context });
  const state = () => P.page.evaluate(() => {
    const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return { scale: visualViewport.scale, iw: innerWidth, ih: innerHeight, dash: [__dbg.dash.w, __dbg.dash.h], eng: [__dbg.eng3d.w, __dbg.eng3d.h],
      css: { bg: r('bg'), gl: r('gl'), dash: r('dash') } };
  });
  const settle = async (w, h) => {
    await P.page.setViewportSize({ width: w, height: h });
    await P.page.waitForFunction(([w2, h2]) => __dbg.dash.w === w2 && __dbg.dash.h === h2, [w, h], { timeout: 10000 }).catch(() => {});
    await P.page.waitForTimeout(400);                    // the delayed orientationchange resize, one more frame
  };
  for (const [w, h] of [[780, 412], [412, 780], [780, 412], [412, 780]]) {
    await settle(w, h);
    const s = await state();
    const tag = `${w}x${h}: ${JSON.stringify(s)}`;
    assert.ok(Math.abs(s.scale - 1) < 1e-3, `zoomed out, ${tag}`);
    assert.deepEqual([s.iw, s.ih], [w, h], tag);
    assert.deepEqual([...s.dash], [w, h], tag);
    assert.deepEqual([...s.eng], [w, h], tag);
    for (const k of ['bg', 'gl', 'dash']) assert.deepEqual(s.css[k], [w, h], `${k} canvas, ${tag}`);
  }
  assert.deepEqual(P.errors, [], P.errors.join('\n'));
  await context.close();
});
