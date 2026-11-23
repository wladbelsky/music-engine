'use strict';
/* the loading splash (#splash in index.html): painted before the scripts run, gone once the user's engine is on
   screen; in WE it waits for WE's own applyUserProperties, so the default V8 of the first frame never shows */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, open } = require('./page');

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

/* in the page before its scripts: records the moment the splash starts to fade (which layout was built by then,
   how many frames of the loop had run); `props` = what a fake WE sends once the default engine has been rendered */
function watchSplash(props) {
  const S = window.__splash = { loops: 0 };
  // rAF callbacks run so far (main.js has one chain: one per frame of its loop)
  const rAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => rAF(ts => {
    // a fake WE sends its properties at the start of the 3rd frame: the default V8 has been on screen for a frame
    if (++S.loops === 3 && props) {
      S.sent = true;
      const o = {}; for (const k in props) o[k] = { value: props[k] };
      window.wallpaperPropertyListener.applyUserProperties(o);
    }
    cb(ts);
  });
  new MutationObserver(() => {
    const el = document.getElementById('splash');
    if (el && !S.seen) S.seen = { pointer: getComputedStyle(el).pointerEvents, cover: el.getBoundingClientRect().width === innerWidth };
    if (el && el.classList.contains('gone') && !S.gone) {
      const e = window.__dbg && __dbg.eng3d;
      S.gone = { layout: e && e.lay && e.lay.constructor.id, loops: S.loops, weProps: !!S.sent };
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
}

async function run(query, { we, props } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  try {
    await context.addInitScript(watchSplash, props || null);
    const P = await open(browser, query, { we, context });
    await P.page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 30000 });
    return { s: await P.page.evaluate(() => window.__splash), errors: P.errors };
  } finally { await context.close(); }
}

test('browser: the splash covers the page, lets clicks through and fades out once the requested engine is shown', async () => {
  const { s, errors } = await run('layout=steam&cylinders=2');
  assert.ok(s.seen && s.seen.cover, JSON.stringify(s));
  assert.equal(s.seen.pointer, 'none');
  assert.ok(s.gone, JSON.stringify(s));
  assert.equal(s.gone.layout, 'steam', 'faded out before the requested engine was built');
  assert.ok(s.gone.loops >= 2, `faded out in the frame that built the engine: ${JSON.stringify(s.gone)}`);
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('WE: the splash waits for the properties WE sends and fades out on the user\'s engine, not the default V8', async () => {
  const { s, errors } = await run('', { we: true, props: { layout: 'jet', cylinders: 10 } });
  assert.ok(s.gone, JSON.stringify(s));
  assert.ok(s.gone.weProps, `faded out before WE sent its properties: ${JSON.stringify(s.gone)}`);
  assert.equal(s.gone.layout, 'jet', `faded out on ${s.gone.layout}`);
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('WE: without any properties from WE the splash still goes away (cap)', async () => {
  const { s, errors } = await run('', { we: true });
  assert.ok(s.gone && s.gone.layout === 'v', JSON.stringify(s));
  assert.deepEqual(errors, [], errors.join('\n'));
});

/* in the page before its scripts: a renderer whose shader compile takes `ms` (SwiftShader has no
   KHR_parallel_shader_compile, so the real path never waits here) */
function slowShaders(ms) {
  let T3;
  Object.defineProperty(window, 'THREE', {
    configurable: true, get: () => T3,
    set(v) {
      const R = v.WebGLRenderer;
      v.WebGLRenderer = function (o) {
        const r = new R(o), has = r.extensions.has.bind(r.extensions);
        r.extensions.has = n => n === 'KHR_parallel_shader_compile' || has(n);
        r.compileAsync = () => new Promise(res => setTimeout(() => { window.__splash.compiled = { loops: window.__splash.loops, splash: !!document.getElementById('splash') && !document.getElementById('splash').classList.contains('gone') }; res(); }, ms));
        return r;
      };
      T3 = v;
    },
  });
}

test('the splash stays up while the shaders compile in the background (the loop keeps running), then fades', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  try {
    await context.addInitScript(watchSplash, null);
    await context.addInitScript(slowShaders, 1200);
    const P = await open(browser, 'layout=v&cylinders=8', { context });
    await P.page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 30000 });
    const s = await P.page.evaluate(() => window.__splash);
    assert.ok(s.compiled, 'the build never asked for a compile: ' + JSON.stringify(s));
    assert.ok(s.compiled.loops >= 3, `the loop did not run during the compile: ${JSON.stringify(s)}`);
    assert.ok(s.compiled.splash, 'the splash was gone before the engine could be drawn');
    assert.ok(s.gone.loops >= s.compiled.loops + 2, `faded before the compiled engine was on screen: ${JSON.stringify(s)}`);
    assert.deepEqual(P.errors, [], P.errors.join('\n'));
  } finally { await context.close(); }
});
