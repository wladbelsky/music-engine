/* Wiring: Wallpaper Engine properties + audio -> analyzer -> sim -> 3D + dash (+ odometer). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const IS_WE = typeof window.wallpaperRegisterAudioListener === 'function';
  // File picker filter. Android Chrome (ui/android SelectFileDialog) turns the accept list into MIME types and asks
  // for the microphone if any is audio/…, for the camera if any is image/… or video/… (.webm), before the picker
  // opens: audio/* asked for the microphone, the extension list for both. application/octet-stream alone asks for
  // nothing and lists every file, so Android gets that; elsewhere the extensions filter the dialog.
  const ANDROID = /Android/i.test(navigator.userAgent);
  const pickerAccept = exts => ANDROID ? 'application/octet-stream' : exts;

  const S = {
    cylinders: 8, layout: 'v', induction: Induction.parse('1'), cutaway: true,
    accent: [0.75, 0.08, 0.06], dashColor: [1, 0.35, 0.1],
    background: 'garage', bgcolor: [0.12, 0.13, 0.16], customimage: '', bgdim: 0.2,
    sensitivity: 1, sway: 1, redline: 7000, flameThr: 0.62, stallDelay: 3, animSpeed: 1,
    quality: 'high', showBpm: true, debug: false, fps: 0, showControls: true,
    showRadio: false,                 // off by default (WE property / ?showradio=true / dev panel)
    odoUnits: 'km',                   // 'km' | 'mi' | 'off' (hidden, still counts)
  };

  const audio = new AudioAnalyzer();
  const sim = new EngineSim();
  const eng3d = new Engine3D($('gl'));
  const dash = new Dash($('dash'));
  const bg = new Background($('bg'));
  const media = new MediaInfo();
  const odo = new Odometer();
  const glow = $('glow');
  let paused = false, needRebuild = true;
  const MIN_REDLINE = 500, MAX_REDLINE = 15000;

  // browser only: the settings panel choices survive a reload (WE keeps its own property values)
  const STORE = 'music-engine.settings';
  const saved = (() => { if (IS_WE) return {}; try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  const remember = (k, v) => { saved[k] = v; try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) { /* private mode etc. */ } };
  const raw = {};                     // last raw (WE-format) value per property key, for the settings panel
  let syncPanel = () => {};

  const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
  const parseColor = s => s.split(' ').map(Number);
  const layoutCls = () => EngineLayouts.get(S.layout);
  const induction = () => Induction.effective(S.induction, layoutCls()); // what this layout can carry
  const type = () => EngineTypes.get(layoutCls().kind);                  // behaviour + instruments (js/core/layout.js)
  const kind = () => type().id;
  // some types run the sim on a fixed internal scale; the dash shows their own units
  const redline = () => type().redline ?? S.redline;
  const engineLabel = () => { const L = layoutCls(); return L.label(L.normCyl(S.cylinders)) + Induction.suffix(induction()); };

  function applySettings() {
    audio.gain = S.sensitivity;
    const ind = induction();
    sim.settings.kind = kind();
    sim.settings.redline = redline(); sim.settings.turbos = ind.turbos; sim.settings.blower = ind.blower; sim.settings.flameThr = S.flameThr; sim.settings.stallDelay = S.stallDelay;
    eng3d.setAccent(new THREE.Color(S.accent[0], S.accent[1], S.accent[2]));
    eng3d.setCutaway(S.cutaway);
    eng3d.sway = S.sway;
    dash.set({ kind: kind(), redline: redline(), color: hex(S.dashColor), label: engineLabel(), showBpm: S.showBpm, showControls: S.showControls, showRadio: S.showRadio, odoUnits: S.odoUnits });
    eng3d.setKeepOut(dash.keepOut());   // the engine stays clear of what the dash draws (radio, key/pedal, odometer...)
    $('debug').style.display = S.debug ? 'block' : 'none';
    if (!IS_WE && $('dv-turbos')) $('dv-turbos').disabled = !Induction.supported(layoutCls()); // e.g. radial: always naturally aspirated
    if (!IS_WE && $('dv-redline')) $('dv-redline').disabled = type().redline != null;            // steam / jet...: fixed internal scale
  }

  /* ---------- Wallpaper Engine property listener ---------- */
  window.wallpaperPropertyListener = {
    applyUserProperties(p) {
      const v = k => p[k] !== undefined ? p[k].value : undefined;
      let bgChanged = false, rebuild = false, q = false;
      for (const k in p) if (p[k] && p[k].value !== undefined) raw[k] = p[k].value;
      if (v('cylinders') !== undefined) { // editable slider (was a combo of strings): clamp, the layout rounds it
        const c = Math.round(Number(v('cylinders')));
        S.cylinders = isFinite(c) ? Math.max(1, Math.min(EngineLayouts.MAX_CYL, c)) : 8; rebuild = true;
      }
      if (v('layout') !== undefined) { S.layout = v('layout'); rebuild = true; }
      if (v('turbos') !== undefined) { S.induction = Induction.parse(v('turbos')); rebuild = true; }
      if (v('cutaway') !== undefined) S.cutaway = !!v('cutaway');
      if (v('accentcolor') !== undefined) S.accent = parseColor(v('accentcolor'));
      if (v('dashcolor') !== undefined) S.dashColor = parseColor(v('dashcolor'));
      if (v('background') !== undefined) { S.background = v('background'); bgChanged = true; }
      if (v('bgcolor') !== undefined) { S.bgcolor = parseColor(v('bgcolor')); bgChanged = true; }
      if (v('customimage') !== undefined) {
        const f = v('customimage');
        S.customimage = f ? (/^(file|https?|blob|data):/.test(f) ? f : 'file:///' + f) : '';
        bg.set({ image: S.customimage }); bgChanged = true;
      }
      if (v('bgdim') !== undefined) { S.bgdim = v('bgdim') / 100; bgChanged = true; }
      if (v('sensitivity') !== undefined) S.sensitivity = v('sensitivity') / 100;
      if (v('redline') !== undefined) { // editable slider: typed values can be anything, keep it sane
        const r = Math.round(Number(v('redline')) / 250) * 250;
        if (isFinite(r)) S.redline = Math.max(MIN_REDLINE, Math.min(MAX_REDLINE, r));
      }
      if (v('flamethreshold') !== undefined) S.flameThr = v('flamethreshold') / 100;
      if (v('stalldelay') !== undefined) S.stallDelay = v('stalldelay');
      if (v('animspeed') !== undefined) { const a = Number(v('animspeed')) / 100; S.animSpeed = isFinite(a) ? Math.max(0, a) : 1; } // editable: junk → default, never backwards
      if (v('sway') !== undefined) { const w = Number(v('sway')) / 100; S.sway = isFinite(w) ? Math.max(0, w) : 1; } // editable: junk → default
      if (v('quality') !== undefined) { S.quality = v('quality'); q = true; }
      if (v('showbpm') !== undefined) S.showBpm = !!v('showbpm');
      if (v('debug') !== undefined) S.debug = !!v('debug');
      if (v('ignition') !== undefined) sim.ignition = !!v('ignition');
      if (v('showcontrols') !== undefined) S.showControls = !!v('showcontrols');
      if (v('showradio') !== undefined) S.showRadio = !!v('showradio');
      if (v('odounits') !== undefined) S.odoUnits = ['mi', 'off'].includes(v('odounits')) ? v('odounits') : 'km';
      if (bgChanged) bg.set({ preset: S.background, bgcolor: S.bgcolor, dim: S.bgdim });
      if (rebuild) needRebuild = true;
      if (q) eng3d.setQuality(S.quality);
      applySettings();
    },
    applyGeneralProperties(p) { if (p.fps !== undefined) S.fps = p.fps; },
    setPaused(isPaused) { paused = isPaused; if (paused) odo.flush(); else { last = performance.now(); startLoop(); } },
  };

  /* ---------- ignition key, throttle pedal, odometer (mouse / touch; keyboard only in a browser) ---------- */
  const toggleIgnition = () => { // in a browser the key position is kept like a panel setting; in WE the property rules
    sim.ignition = !sim.ignition; raw.ignition = sim.ignition;
    if (!IS_WE) { remember('ignition', sim.ignition); syncPanel(); }
  };
  const onPanel = e => !!(e.target && e.target.closest && e.target.closest('#devpanel, #dv-show')); // panel controls can sit over the key
  const press = (x, y) => {
    const hit = dash.hitTest(x, y);
    if (hit === 'key') toggleIgnition();
    else if (hit === 'pedal') sim.pedalIn = true;
    else if (hit === 'odo') odo.resetTrip();
    return !!hit;
  };
  const release = () => { sim.pedalIn = false; };
  window.addEventListener('mousedown', e => { if (e.button === 0 && !onPanel(e)) press(e.clientX, e.clientY); });
  window.addEventListener('mouseup', release);
  window.addEventListener('blur', release);
  document.addEventListener('mouseleave', release);
  window.addEventListener('touchstart', e => { if (onPanel(e)) return; const t = e.changedTouches[0]; if (press(t.clientX, t.clientY)) e.preventDefault(); }, { passive: false });
  window.addEventListener('touchend', release);
  window.addEventListener('keydown', e => {
    if (e.target && /INPUT|SELECT|BUTTON/.test(e.target.tagName)) return;
    if (e.code === 'Space' || e.code === 'ArrowUp') { sim.pedalIn = true; e.preventDefault(); }
    if (e.code === 'KeyI') toggleIgnition();
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'ArrowUp') release(); });
  // the odometer saves every 10 s while it moves; flush whatever is left when the page goes away
  document.addEventListener('visibilitychange', () => { if (document.hidden) odo.flush(); });
  window.addEventListener('pagehide', () => odo.flush());

  /* ---------- size ---------- */
  // the layout viewport (the canvases' 100%), not innerWidth/innerHeight: on a phone those follow the pinch zoom,
  // and a canvas sized from a zoomed-out value kept the page zoomed out after landscape -> portrait
  function viewSize() {
    const de = document.documentElement;
    return [de.clientWidth || window.innerWidth, de.clientHeight || window.innerHeight];
  }
  function resize() {
    const [w, h] = viewSize(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    bg.resize(w, h, dpr); dash.resize(w, h, dpr); eng3d.setKeepOut(dash.keepOut()); eng3d.resize(w, h);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 300)); // some phones report the old size in 'resize'

  /* ---------- settings panel (browser): every WE property, mirrors project.json ---------- */
  // values are raw WE values (%, "r g b" colours...), so the panel goes through applyUserProperties like WE does
  const PANEL = [
    ['Engine', [
      { k: 'ignition', t: 'bool', l: 'ignition', d: true },
      { k: 'layout', t: 'select', l: 'layout', d: 'v', o: EngineLayouts.list().map(L => [L.id, L.title || L.id]) },
      { k: 'cylinders', t: 'number', l: 'cylinders', d: 8, min: 1, max: 32 },
      { k: 'turbos', t: 'select', l: 'induction', d: '1', o: [['0', 'none'], ['1', 'turbo'], ['2', 'twin turbo'], ['4', 'quad turbo'], ['sc', 'supercharger'], ['sc2', 'twincharged']] },
      { k: 'cutaway', t: 'bool', l: 'cutaway', d: true },
      { k: 'accentcolor', t: 'color', l: 'valve covers', d: '0.75 0.08 0.06' },
    ]],
    ['Behaviour', [
      { k: 'sensitivity', t: 'range', l: 'sensitivity %', d: 100, min: 25, max: 300 },
      { k: 'redline', t: 'range', l: 'rev limiter', d: 7000, min: 5000, max: 9500, step: 250 },
      { k: 'flamethreshold', t: 'range', l: 'flame threshold', d: 62, min: 20, max: 95 },
      { k: 'stalldelay', t: 'range', l: 'stall after, s', d: 3, min: 1, max: 15 },
      { k: 'animspeed', t: 'range', l: 'crank anim %', d: 100, min: 25, max: 200 },
      { k: 'sway', t: 'range', l: 'sway %', d: 100, min: 0, max: 250 },
      { k: 'quality', t: 'select', l: 'quality', d: 'high', o: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
    ]],
    ['Dash', [
      { k: 'dashcolor', t: 'color', l: 'backlight', d: '1 0.35 0.1' },
      { k: 'showbpm', t: 'bool', l: 'BPM/load', d: true },
      { k: 'showcontrols', t: 'bool', l: 'key & pedal', d: true },
      { k: 'showradio', t: 'bool', l: 'radio', d: false },
      { k: 'odounits', t: 'select', l: 'odometer', d: 'km', o: [['km', 'km'], ['mi', 'miles'], ['off', 'hidden']] },
      { k: 'debug', t: 'bool', l: 'debug', d: false },
    ]],
    ['Background', [
      { k: 'background', t: 'select', l: '', d: 'garage', o: [['garage', 'Garage'], ['carbon', 'Carbon'], ['gradient', 'Gradient'], ['custom', 'Custom image']] },
      { k: 'bgcolor', t: 'color', l: 'gradient', d: '0.12 0.13 0.16' },
      { k: 'customimage', t: 'file', l: 'image' },
      { k: 'bgdim', t: 'range', l: 'dimming %', d: 20, min: 0, max: 90 },
    ]],
  ];
  const toRgb = h => [1, 3, 5].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

  function buildPanel(apply) {
    const root = $('dv-props'), el = (tag, a = {}) => Object.assign(document.createElement(tag), a);
    const ctl = {};
    const prop = (k, v, keep = true, src = null) => { apply(k, v, keep); syncPanel(src); }; // show what was applied (clamped / fallback)
    for (const [group, items] of PANEL) {
      const row = el('div', { className: 'row' }); row.append(group + ':');
      for (const it of items) {
        const id = 'dv-' + it.k, lab = el('label');
        let c;
        if (it.t === 'select') { c = el('select', { id }); for (const [v, txt] of it.o) c.append(el('option', { value: v, textContent: txt })); c.onchange = () => prop(it.k, c.value, !(it.k === 'background' && c.value === 'custom')); } // the image itself can't be kept
        else if (it.t === 'bool') { c = el('input', { id, type: 'checkbox' }); c.onchange = () => prop(it.k, c.checked); }
        else if (it.t === 'number') { c = el('input', { id, type: 'number', min: it.min, max: it.max, style: 'width:4em' }); c.onchange = () => prop(it.k, Number(c.value)); }
        else if (it.t === 'color') { c = el('input', { id, type: 'color' }); c.oninput = () => prop(it.k, toRgb(c.value), true, c); }
        else if (it.t === 'file') {
          c = el('input', { id, type: 'file', accept: pickerAccept('.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif') });
          c.onchange = () => { const f = c.files[0]; if (f) { prop('customimage', URL.createObjectURL(f), false); prop('background', 'custom', false); } };
        } else { // range + live value
          c = el('input', { id, type: 'range', min: it.min, max: it.max, step: it.step || 1, style: 'width:7em' });
          const out = el('span', { className: 'val' }); c.out = out;
          c.oninput = () => prop(it.k, Number(c.value), true, c);
        }
        ctl[it.k] = { it, c };
        if (it.t === 'bool') lab.append(c, ' ' + it.l); else lab.append(it.l ? it.l + ' ' : '', c);
        if (c.out) lab.append(' ', c.out);
        row.append(lab);
      }
      root.append(row);
    }
    // controls show the applied value: clamped numbers, and the fallback for junk select values
    const applied = { layout: () => layoutCls().id, turbos: () => S.induction.key, odounits: () => S.odoUnits, background: () => S.background, quality: () => S.quality, cylinders: () => S.cylinders, redline: () => S.redline, ignition: () => sim.ignition };
    syncPanel = (skip = null) => {
      for (const k in ctl) {
        const { it, c } = ctl[k];
        if (it.t === 'file' || c === skip) { if (c.out) c.out.textContent = k === 'redline' ? S.redline : c.value; continue; }
        const v = applied[k] ? applied[k]() : raw[k] !== undefined ? raw[k] : it.d;
        if (it.t === 'bool') c.checked = !!v;
        else if (it.t === 'color') c.value = hex(parseColor(String(v)));
        else if (it.t === 'select') c.value = it.o.some(o => o[0] === String(v)) ? String(v) : it.d;
        else { c.value = String(v); if (c.out) c.out.textContent = k === 'redline' ? S.redline : c.value; }
      }
    };
  }

  /* ---------- audio source ---------- */
  const onAudio = arr => audio.push(arr, performance.now() / 1000);
  let devSrc = null;
  if (IS_WE) window.wallpaperRegisterAudioListener(onAudio);
  else setupDev();
  // media integration (now playing): register right away, like the audio listener
  for (const [fn, cb] of [['wallpaperRegisterMediaStatusListener', e => media.onStatus(e)],
    ['wallpaperRegisterMediaPropertiesListener', e => media.onProps(e)],
    ['wallpaperRegisterMediaPlaybackListener', e => media.onPlayback(e)]]) {
    if (typeof window[fn] === 'function') window[fn](cb);
  }

  function setupDev() {
    const panel = $('devpanel'); panel.style.display = 'block';
    const stopSrc = () => { if (devSrc && devSrc.stop) devSrc.stop(); if (devSrc && devSrc.id) clearInterval(devSrc.id); if (devSrc && devSrc.el) devSrc.el.pause(); devSrc = null; media.clear(); };
    $('dv-demo').onclick = () => { stopSrc(); devSrc = new DemoSource(onAudio); };
    $('dv-mic').onclick = async () => { stopSrc(); const s = new WebAudioSource(onAudio); try { await s.startMic(); devSrc = s; } catch (e) { alert('Microphone unavailable: ' + e.message); } };
    $('dv-file').accept = pickerAccept($('dv-file').accept);
    $('dv-file').onchange = e => { const f = e.target.files[0]; if (!f) return; stopSrc(); const s = new WebAudioSource(onAudio); s.startFile(f); devSrc = s; media.fromFile(f.name, s.el); };
    $('dv-stop').onclick = stopSrc;
    const prop = (k, val, keep = true) => { window.wallpaperPropertyListener.applyUserProperties({ [k]: { value: val } }); if (keep) remember(k, val); };
    buildPanel(prop);
    $('dv-trip').onclick = () => odo.resetTrip();
    $('dv-odo0').onclick = () => { if (confirm('Reset the odometer to zero?')) odo.reset(); };
    $('dv-reset').onclick = () => { try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ } location.reload(); };
    // hidden panel leaves a small "Settings" button in the corner; D toggles it too
    const showPanel = on => { panel.style.display = on ? 'block' : 'none'; $('dv-show').style.display = on ? 'none' : 'block'; };
    $('dv-hide').onclick = () => showPanel(false);
    $('dv-show').onclick = () => showPanel(true);
    window.addEventListener('keydown', e => {
      if (e.code === 'KeyD' && !(e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) showPanel(panel.style.display === 'none');
    });
    if (qs.get('demo')) devSrc = new DemoSource(onAudio);
  }

  /* ---------- initial state: saved panel settings, then URL overrides (testing) ---------- */
  const init = {};
  for (const k in saved) init[k] = { value: saved[k] };
  for (const [k, v] of qs.entries()) if (!['demo'].includes(k)) init[k] = { value: isNaN(v) ? (v === 'true' ? true : v === 'false' ? false : v) : Number(v) };
  if (init.cylinders) init.cylinders.value = String(init.cylinders.value);
  if (init.turbos) init.turbos.value = String(init.turbos.value);
  resize();
  eng3d.setQuality(S.quality);
  bg.set({ preset: S.background, bgcolor: S.bgcolor, dim: S.bgdim });
  window.wallpaperPropertyListener.applyUserProperties(init);
  syncPanel();

  /* ---------- loop ---------- */
  // exactly one rAF chain: WE may send setPaused(false) without a pause before it, or pause+unpause
  // within one frame; blindly calling requestAnimationFrame there stacked extra loops, each doing a full frame
  let last = performance.now(), dbgT = 0, rafId = 0;
  function startLoop() { if (!rafId) rafId = requestAnimationFrame(loop); }
  function loop(now) {
    rafId = 0;
    if (paused) return;
    rafId = requestAnimationFrame(loop);
    if (S.fps > 0 && now - last < 1000 / S.fps - 2) return;
    const step = Math.max(0, (now - last) / 1000), dt = Math.min(0.1, Math.max(0.001, step)); last = now;
    const t = now / 1000;
    if (needRebuild) { needRebuild = false; eng3d.build(S.cylinders, S.layout, S.induction); eng3d.setCutaway(S.cutaway); eng3d.resize(...viewSize()); dash.set({ label: engineLabel() }); }
    audio.tick(t);
    sim.update(dt, audio, t);
    odo.update(Math.min(step, 1), sim, now); // real time (low FPS caps), but not a whole hidden-tab gap
    eng3d.update(dt, sim, S.animSpeed, S.quality);
    eng3d.render();
    dash.draw(sim, audio, dt, t, media, odo);
    // glow on the background around the exhaust (warm for fire, the type's own colour otherwise)
    const gp = eng3d.glowScreen();
    const gi = Math.min(1, sim.flame * 0.8 + eng3d.flash * 0.6);
    if (gp && gi > 0.01) {
      const [r, g, b] = (type().glow || {}).css || [255, 120, 30], r2 = Math.round(r), g2 = Math.round(g * 80 / 120), b2 = Math.round(b / 3);
      glow.style.opacity = gi.toFixed(3);
      glow.style.background = `radial-gradient(circle at ${gp.x}px ${gp.y}px, rgba(${r},${g},${b},0.35), rgba(${r2},${g2},${b2},0.12) 18%, rgba(0,0,0,0) 45%)`;
    } else glow.style.opacity = 0;
    if (S.debug && t - dbgT > 0.1) { dbgT = t; drawDebug(); }
  }

  function drawDebug() {
    const d = $('debug');
    const bars = Array.from(audio.bands).map(v => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(v * 8))]).join('');
    d.textContent =
      `state ${sim.state}  rpm ${sim.rpm.toFixed(0)}  target ${sim.target.toFixed(0)}\n` +
      `bpm ${audio.bpm.toFixed(1)} (raw ${audio.rawBpm.toFixed(1)})  conf ${audio.conf.toFixed(2)}\n` +
      `level ${audio.level.toFixed(3)}  short ${audio.shortLoud.toFixed(3)}  long ${audio.longLoud.toFixed(3)}  peak ${audio.peak.toFixed(3)}\n` +
      `intensity ${audio.intensity.toFixed(2)}  power ${audio.power.toFixed(2)}  density ${audio.density.toFixed(2)}  silent ${audio.silentTime.toFixed(1)}s\n` +
      `flame ${sim.flame.toFixed(2)}  boost ${sim.boost.toFixed(2)}  temp ${sim.temp.toFixed(1)}\n` + bars;
  }

  startLoop();
  window.__dbg = { audio, sim, eng3d, dash, media, odo, S };
})();
