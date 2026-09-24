# CLAUDE.md: Engine Revs (web wallpaper for Wallpaper Engine)

Context for Claude Code / Claude when working on this project.

## About the user and communication
- The owner is Vlad. **Reply in Russian.** README.md and the WE property labels in `project.json` are in English, and so is the dev panel in `index.html`. Instrument and lamp labels are in English (STALL, REDLINE...), which is intentional.
- The user gives visual feedback in iterations. After every change, take a screenshot and look at it (see "Testing").

## What it is
An audio-reactive web wallpaper for Wallpaper Engine (WE). A 3D engine (Three.js) on the left, a 2D dashboard on the right.
The engine revs with the music (BPM + loudness), shoots flames on peaks, sways/vibrates more with RPM, and stalls after silence.
The dashboard has a tachometer with shift lights, temp and boost gauges, 8 lamps (round lamp + metal plate with screws), an ignition key, and a throttle pedal.

## Architecture (plain scripts, no build step, no ES modules)
Load order in `index.html`: `three.min.js → audio.js → sim.js → engine3d.js → layouts.js → induction.js → dash.js → bg.js → main.js`.
Each file is an IIFE exporting a class to `window`.

| File | Responsibility |
|---|---|
| `js/audio.js` | `AudioAnalyzer.push(arr128, t)`: mono bands, spectral flux, beats (adaptive threshold), BPM (autocorrelation over ~300 frames + log-gaussian prior at 120 + parabolic interpolation, folded into 80–170), `intensity`/`power` (absolute via slow AGC + relative to 20 s EMA + beat density), `silentTime`. `tick(t)` treats "no callbacks" as silence (`silentTime = t - lastPush`). Also `DemoSource` (synthetic track with sections and a pause) and `WebAudioSource` (mic/file → 64 log bands). |
| `js/sim.js` | `EngineSim.update(dt, audio, t)`. States: `off → lamptest → cranking → running ⇄ stalling → stalled`. Fields: `rpm, throttle, boost, temp, flame, kick, pedal, ignition, pedalIn, warn{}`, event queue `takeEvents()` (`backfire`, `bov`, `smoke`, `start`). `pw = max(audio.power, pedal*0.95)` drives flames and temperature. Boost = max over source classes picked from `settings.turbos/blower`: `TurboBoost` (lag, needs revs, 1.6 max), `RootsBoost` (instant, grows with rpm, 1.1 max), `VacuumOnly` (no induction: −0.65…0). `bov` events only when `turbos > 0`. |
| `js/engine3d.js` | `Engine3D.build(nCyl, layoutId, inductionCfg)` orchestrates: layout class → banks (groups rotated about X; crank axis = X, front = +X) → `_cylinder()` per cylinder (liner, piston, rod, coil) → layout hooks (case, crank, intake, front, rear) → induction parts → `_stack()` per cylinder from the layout's 5-point path → `lay.finish()` → grounding/framing. Kinematics in `update`: `cyc = (crank − c.phase) mod 720`, slider-crank with bore offset `c.zo` (W rows) and rod length `c.rodL` (radial `lift`). Everything that turns with the crank is in `spinners` (`spin(obj, ratio, off)`, accumulated angle, so ratios ≠ 1 don't jump at the 720° wrap); turbo wheels are in `compressors` (spun by boost), BOV puff origins in `bovs`. `GEO` exports the constants/`firingOrder` to the other files. Camera is fixed at three-quarter (`camDir`), fitted to the bounding box, image shifted with `setViewOffset`; then pushed back until `_extent()` (projected mesh bboxes) stays left of `FIT_RIGHT` (the old inline 8), so 32-cylinder engines stay off the dash; `lay.framePad` adds margin (radial). `_sway()` = torque roll + RPM-dependent vibration; after it, world-space `tipW/dirW` of the stack tips are computed (particles/jets use only those). `_jets()` = shader flame jets (axial billboard + scrolling fBm noise). `ParticleSystem` = fireballs/sparks (additive) and smoke (normal), sprite shape from the noise texture. |
| `js/layouts.js` | `EngineLayouts.get(id)` → class (unknown → V), `MAX_CYL = 32`. `EngineLayout` base holds the generic straight-block code; `InlineLayout`, `VLayout` (bank angle 60/72/90 from cylinders per bank), `BoxerLayout extends VLayout`, `WLayout extends VLayout` (pitch 0.64, rows `zo ±0.24`, `hw 0.78`, multiple of 4), `RadialLayout` (one bank per cylinder, `split(n)` → rows × odd per row ≤ 9, shared pin per row, `phase = tilt + pinOff + 360·(k%2)`, finned lathe barrels, rear housing, prop hub, stand in `finish()`). Statics: `id`, `normCyl(n)`, `label(n)`, `turbos` (radial false). Hooks: `banks, dims, cylinders, zOffset, buildBank, buildCase, buildCrank, buildIntake (sets e.tbPos), buildFront (sets crankPulley), buildRear, stackPath, finish, plenum, turboMount, blowerMount, topY`. **Adding a layout** = a subclass + an entry in `LAYOUTS` + the `layout` combo in `project.json` + the dev panel option. |
| `js/induction.js` | `Induction.OPTIONS` (the `turbos` combo values `0/1/2/4/sc/sc2` → `{turbos, blower}`), `parse(v)` (unknown → `'1'`), `effective(cfg, L)` (drops turbos if `!L.turbos`), `suffix(cfg)` (dash label), `parts(cfg)` → part instances built in order: `RootsBlower` (on `blowerMount()`, belt tangents from `crankPulley`, 3-lobe rotors in `spinners`, case `M.blowerCase` ghosts in cutaway, scoop or, when twincharged, a hat that becomes `e.tbPos`), `TurboSet(n)` (on `turboMount()`, charge pipes to `e.tbPos`), `AirFilter`. |
| `js/dash.js` | `Dash.draw(sim, audio, dt, t)`. Static layer (bezels, scales, plates, screws, key/pedal mounts) in an offscreen canvas, rebuilt in `_static()` on resize/setting changes. `hitTest(x, y)` → `'key' \| 'pedal' \| null`. |
| `js/bg.js` | Background presets (garage, carbon = fine 2x2 twill tile, gradient; unknown values fall back to garage) + user image (cover) + dimming. |
| `js/main.js` | `window.wallpaperPropertyListener` (applyUserProperties / applyGeneralProperties(fps) / setPaused), audio listener registration, mouse/touch/keyboard input, main loop, dev panel, URL parameters, `window.__dbg`. |

## Wallpaper Engine specifics (verified against docs.wallpaperengine.io)
- `window.wallpaperRegisterAudioListener(cb)`: 128 values (0–63 left, 64–127 right, bass→treble), ~30 Hz, usually 0..1 (occasionally >1). Register **at the end of body**, not in `onload`. `project.json` must have `general.supportsaudioprocessing: true`.
- **WE provides no BPM.** It is computed in `audio.js`.
- Properties: only changed keys arrive; always check `p.key !== undefined`. Color is the string `"r g b"` in 0..1. File path: prefix with `file:///`.
- `cylinders` used to be a combo of strings, now it is an editable slider 1–32 (a number); `main.js` accepts both and clamps. The `turbos` key is kept (now "Forced induction") so saved `0/1/2/4` still work.
- Not verified in real WE: the `condition` syntax on properties (`"background.value == 'custom'"`), the exact name of the "allow mouse input" setting, and whether the editable `cylinders` slider can deliver non-integers (the code rounds anyway).

## Pitfalls already found (don't repeat)
- **Three.js r149 UMD (`build/three.min.js`)** on purpose: WE/`file://` doesn't like ES modules; newer versions have no UMD build. Don't pull from a CDN: the wallpaper must work offline, and jsdelivr/unpkg are blocked in the sandbox (use `npm pack three@0.149.0`).
- **Additive blending on a transparent canvas** (`alpha: true`): plain `AdditiveBlending` writes alpha=1 and paints black rectangles. Use `addBlend()` (CustomBlending: RGB One/One, alpha Zero/One) and output premultiplied color with `a = 0`.
- **`setViewOffset`**: the vertical FOV spans `fullH`, so in the fit `dist` is **multiplied** by `fullH / h`.
- `silentTime` must not be accumulated from a clamped `dt`: at low FPS the stall never triggered.
- Flame particles/jets spawn from `tipW/dirW` (world space after sway), not from `tip + eng.position`.
- The plate font size is one value for all lamps, computed from the base `fs0` (not reduced cumulatively).
- **Page hang ("Page Unresponsive" in WE):** in `_estimateTempo` the parabolic peak refinement was unclamped; `best` maximizes the prior-weighted score, not `ac`, so it can sit on a slope and the shift made the lag negative → negative BPM → `while (bpm < 80) bpm *= 2` never ended. Refine only at a real local max, clamp the shift to ±0.5 lag, reject non-positive/non-finite BPM, and keep the octave folding bounded.
- **Redline from an editable slider can be anything** (typing 7 rounded to 0): `rpm / redline` became NaN, the NaN stuck in the `_sway` phases/`heat` and the engine vanished for good. `main.js` clamps redline to 500–15000; `sim`/`engine3d` also guard the divisor, and `Engine3D.update` resets non-finite accumulators. Flames and backfire pops need `rpm > FIRE_RPM` (2500) regardless of redline.
- **One rAF chain only:** `setPaused(false)` used to call `requestAnimationFrame(loop)` unconditionally; WE unpausing without a pause (or pause+unpause within one frame) stacked extra loops, each running a full frame. Use `startLoop()` (tracks `rafId`).

## Testing
Headless Chromium + SwiftShader (the sandbox has Playwright, browsers in `/opt/pw-browsers`):
```python
b = await p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
await pg.goto("file:///…/EngineRevs/index.html?demo=1&layout=v&cylinders=8&debug=true")
await pg.evaluate("document.getElementById('devpanel').style.display='none'")
state = await pg.evaluate("__dbg.sim.state")   # __dbg = {audio, sim, eng3d, dash, S}
```
- In headless mode FPS is low and `dt` is clamped to 0.1, so sim time lags wall time. Pick frames by state (for example `__dbg.sim.flame > 0.5`), not by timer.
- Key/pedal: take coordinates from `__dbg.dash.keyC` / `__dbg.dash.pedalR` and use `page.mouse`.
- URL parameters are passed straight into `applyUserProperties` (`?ignition=false&background=carbon…`).
- **Refactor regression:** `?ignition=false` with the `bg` and `dash` canvases hidden gives a deterministic engine frame (only turbo wheels move, they spin from boost even when off); diff against screenshots from before the change.
- Before finishing, check JS syntax: `node -e "new Function(fs.readFileSync(f,'utf8'))"`, and that there are no `pageerror`s.

## Delivering to the user
The working copy is on the user's PC at `C:\Users\Vladislavb\PycharmProjects\EngineRevs`. After changes, remind them to re-import `index.html` into WE (WE keeps its own copy of the project). Update `preview.jpg` (1280×720) when the visuals change.

## Ideas / not done yet
- Tune thresholds on real music (the user hasn't run it in WE yet).
- Possibly a fire sprite sheet for the fireballs if the user provides one.
