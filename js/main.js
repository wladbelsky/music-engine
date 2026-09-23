/* Wiring: Wallpaper Engine properties + audio -> analyzer -> sim -> 3D + dash. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const IS_WE = typeof window.wallpaperRegisterAudioListener === 'function';

  const S = {
    cylinders: 8, layout: 'v', turbos: 1, cutaway: true,
    accent: [0.75, 0.08, 0.06], dashColor: [1, 0.35, 0.1],
    background: 'garage', bgcolor: [0.12, 0.13, 0.16], customimage: '', bgdim: 0.2,
    sensitivity: 1, sway: 1, redline: 7000, flameThr: 0.62, stallDelay: 3, animSpeed: 1,
    quality: 'high', showBpm: true, debug: false, fps: 0, showControls: true,
  };

  const audio = new AudioAnalyzer();
  const sim = new EngineSim();
  const eng3d = new Engine3D($('gl'));
  const dash = new Dash($('dash'));
  const bg = new Background($('bg'));
  const glow = $('glow');
  let paused = false, needRebuild = true;
  const MIN_REDLINE = 500, MAX_REDLINE = 15000;

  const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
  const parseColor = s => s.split(' ').map(Number);
  const engineLabel = () => {
    let n = S.cylinders; if (S.layout !== 'inline' && n % 2) n++;
    const tt = ['', ' TURBO', ' TWIN TURBO', '', ' QUAD TURBO'][S.turbos] || '';
    return (S.layout === 'inline' ? 'I' + n : S.layout === 'boxer' ? 'BOXER ' + n : 'V' + n) + tt;
  };

  function applySettings() {
    audio.gain = S.sensitivity;
    sim.settings.redline = S.redline; sim.settings.turbos = S.turbos; sim.settings.flameThr = S.flameThr; sim.settings.stallDelay = S.stallDelay;
    eng3d.setAccent(new THREE.Color(S.accent[0], S.accent[1], S.accent[2]));
    eng3d.setCutaway(S.cutaway);
    eng3d.sway = S.sway;
    dash.set({ redline: S.redline, color: hex(S.dashColor), label: engineLabel(), showBpm: S.showBpm, showControls: S.showControls });
    $('debug').style.display = S.debug ? 'block' : 'none';
  }

  /* ---------- Wallpaper Engine property listener ---------- */
  window.wallpaperPropertyListener = {
    applyUserProperties(p) {
      const v = k => p[k] !== undefined ? p[k].value : undefined;
      let bgChanged = false, rebuild = false, q = false;
      if (v('cylinders') !== undefined) { S.cylinders = parseInt(v('cylinders'), 10) || 8; rebuild = true; }
      if (v('layout') !== undefined) { S.layout = v('layout'); rebuild = true; }
      if (v('turbos') !== undefined) { const nt = parseInt(v('turbos'), 10); S.turbos = [0, 1, 2, 4].includes(nt) ? nt : 1; rebuild = true; }
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
      if (v('animspeed') !== undefined) S.animSpeed = v('animspeed') / 100;
      if (v('sway') !== undefined) S.sway = v('sway') / 100;
      if (v('quality') !== undefined) { S.quality = v('quality'); q = true; }
      if (v('showbpm') !== undefined) S.showBpm = !!v('showbpm');
      if (v('debug') !== undefined) S.debug = !!v('debug');
      if (v('ignition') !== undefined) sim.ignition = !!v('ignition');
      if (v('showcontrols') !== undefined) S.showControls = !!v('showcontrols');
      if (bgChanged) bg.set({ preset: S.background, bgcolor: S.bgcolor, dim: S.bgdim });
      if (rebuild) needRebuild = true;
      if (q) eng3d.setQuality(S.quality);
      applySettings();
    },
    applyGeneralProperties(p) { if (p.fps !== undefined) S.fps = p.fps; },
    setPaused(isPaused) { paused = isPaused; if (!paused) { last = performance.now(); startLoop(); } },
  };

  /* ---------- ignition key & throttle pedal (mouse / touch; keyboard only in a browser) ---------- */
  const press = (x, y) => {
    const hit = dash.hitTest(x, y);
    if (hit === 'key') sim.ignition = !sim.ignition;
    else if (hit === 'pedal') sim.pedalIn = true;
    return !!hit;
  };
  const release = () => { sim.pedalIn = false; };
  window.addEventListener('mousedown', e => { if (e.button === 0) press(e.clientX, e.clientY); });
  window.addEventListener('mouseup', release);
  window.addEventListener('blur', release);
  document.addEventListener('mouseleave', release);
  window.addEventListener('touchstart', e => { const t = e.changedTouches[0]; if (press(t.clientX, t.clientY)) e.preventDefault(); }, { passive: false });
  window.addEventListener('touchend', release);
  window.addEventListener('keydown', e => {
    if (e.target && /INPUT|SELECT|BUTTON/.test(e.target.tagName)) return;
    if (e.code === 'Space' || e.code === 'ArrowUp') { sim.pedalIn = true; e.preventDefault(); }
    if (e.code === 'KeyI') sim.ignition = !sim.ignition;
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'ArrowUp') release(); });

  /* ---------- size ---------- */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    bg.resize(w, h, dpr); dash.resize(w, h, dpr); eng3d.resize(w, h);
  }
  window.addEventListener('resize', resize);

  /* ---------- audio source ---------- */
  const onAudio = arr => audio.push(arr, performance.now() / 1000);
  let devSrc = null;
  if (IS_WE) window.wallpaperRegisterAudioListener(onAudio);
  else setupDev();

  function setupDev() {
    const panel = $('devpanel'); panel.style.display = 'block';
    const stopSrc = () => { if (devSrc && devSrc.stop) devSrc.stop(); if (devSrc && devSrc.id) clearInterval(devSrc.id); if (devSrc && devSrc.el) devSrc.el.pause(); devSrc = null; };
    $('dv-demo').onclick = () => { stopSrc(); devSrc = new DemoSource(onAudio); };
    $('dv-mic').onclick = async () => { stopSrc(); const s = new WebAudioSource(onAudio); try { await s.startMic(); devSrc = s; } catch (e) { alert('Microphone unavailable: ' + e.message); } };
    $('dv-file').onchange = e => { const f = e.target.files[0]; if (!f) return; stopSrc(); const s = new WebAudioSource(onAudio); s.startFile(f); devSrc = s; };
    $('dv-stop').onclick = stopSrc;
    const prop = (k, val) => window.wallpaperPropertyListener.applyUserProperties({ [k]: { value: val } });
    $('dv-cyl').onchange = e => prop('cylinders', e.target.value);
    $('dv-layout').onchange = e => prop('layout', e.target.value);
    $('dv-turbo').onchange = e => prop('turbos', e.target.value);
    $('dv-bg').onchange = e => prop('background', e.target.value);
    $('dv-img').onchange = e => { const f = e.target.files[0]; if (f) { prop('customimage', URL.createObjectURL(f)); prop('background', 'custom'); $('dv-bg').value = 'custom'; } };
    $('dv-cut').onchange = e => prop('cutaway', e.target.checked);
    $('dv-dbg').onchange = e => prop('debug', e.target.checked);
    $('dv-hide').onclick = () => panel.style.display = 'none';
    if (qs.get('demo')) devSrc = new DemoSource(onAudio);
  }

  /* ---------- initial state (URL overrides for testing) ---------- */
  const init = {};
  for (const [k, v] of qs.entries()) if (!['demo'].includes(k)) init[k] = { value: isNaN(v) ? (v === 'true' ? true : v === 'false' ? false : v) : Number(v) };
  if (init.cylinders) init.cylinders.value = String(init.cylinders.value);
  if (init.turbos) init.turbos.value = String(init.turbos.value);
  resize();
  eng3d.setQuality(S.quality);
  bg.set({ preset: S.background, bgcolor: S.bgcolor, dim: S.bgdim });
  window.wallpaperPropertyListener.applyUserProperties(init);
  if (!IS_WE) { $('dv-cyl').value = String(S.cylinders); $('dv-layout').value = S.layout; $('dv-turbo').value = String(S.turbos); $('dv-bg').value = S.background; }

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
    const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000)); last = now;
    const t = now / 1000;
    if (needRebuild) { needRebuild = false; eng3d.build(S.cylinders, S.layout, S.turbos); eng3d.setCutaway(S.cutaway); eng3d.resize(window.innerWidth, window.innerHeight); dash.set({ label: engineLabel() }); }
    audio.tick(t);
    sim.update(dt, audio, t);
    eng3d.update(dt, sim, S.animSpeed, S.quality);
    eng3d.render();
    dash.draw(sim, audio, dt, t);
    // warm glow on the background around the exhaust
    const gp = eng3d.glowScreen();
    const gi = Math.min(1, sim.flame * 0.8 + eng3d.flash * 0.6);
    if (gp && gi > 0.01) {
      glow.style.opacity = gi.toFixed(3);
      glow.style.background = `radial-gradient(circle at ${gp.x}px ${gp.y}px, rgba(255,120,30,0.35), rgba(255,80,10,0.12) 18%, rgba(0,0,0,0) 45%)`;
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
  window.__dbg = { audio, sim, eng3d, dash, S };
})();
