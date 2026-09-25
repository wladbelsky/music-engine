# Music Engine: audio-reactive wallpaper for Wallpaper Engine

A web wallpaper with a 3D engine. The engine revs up to the music, and on the most powerful moments flames shoot out of the exhaust. On the right is a dashboard: tachometer, temperature, boost, warning lamps, an ignition key, a throttle pedal, an odometer and a car radio that shows what's playing.

**[Get it on Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3806831743)** · **[Live demo](https://wladbelsky.github.io/music-engine/)**

![preview](preview.jpg)

## Controls

| Element | Action |
|---|---|
| **Ignition key** (left, above the tachometer) | Click to toggle OFF/ON. When switched on, all lamps light up for ~1 s as a bulb check, then the starter cranks the engine and it starts. When switched off, the engine stalls, the gauges go dark, and it ignores the music. |
| **Throttle pedal** (right, above the tachometer) | While the mouse button is held, RPM climbs all the way to the rev limiter: you get flames, backfire "pops" when you lift off, and the hiss of the blow-off valve. The pedal works without music too and can restart a stalled engine on its own. |
| Keyboard (browser only) | `Space` or `↑` act as the pedal, `I` turns the key. |

## Settings (wallpaper properties panel in WE)

- **Ignition on**: key position at startup.
- **Show key and throttle pedal**.
- **Car radio** (off by default): a 1-DIN head unit under the lamps. It shows the current track as a scrolling line (▶/❚❚/■, track number, clock). The data comes from WE's media integration, which you enable in **WE settings → Media integration**; it works with any player that shows up in the Windows media overlay (Spotify, browsers, AIMP…). Without track info the display shows `AUX` and a small spectrum analyzer. The volume knob is decorative: its LED ring works as a level meter. The radio runs off the ignition.
- **Layout**: inline, V, boxer, W (two narrow VR banks with staggered cylinders, like the VW W12 / Bugatti W16), radial (an aircraft star engine on a stand, flames from short stubs all round), rotary (Wankel: triangular rotors orbit the eccentric shaft inside epitrochoid housings, visible in cutaway mode; one exhaust stack per rotor), or one of the other engines:
  - **Steam engine**: a horizontal mill engine with a vertical boiler. Double-acting cylinders with crossheads, connecting rods and disc cranks, slide valves worked by eccentrics, a spoked flywheel and a Watt flyball governor whose balls fly out with the revs. The exhaust goes up the chimney, so every stroke is a chuff of steam; on the loud parts the fire roars (the firebox door glows, sparks and thick smoke from the chimney). When the boiler pressure reaches the top of the gauge the safety valve blows off; on start-up the drain cocks spit steam. The shaft turns at the speed the dash shows (up to 200 rpm). It doesn't rock on its foundation, so it shows the beat otherwise: the boiler rocks and the chimney whips, the bed shudders along the cylinders, the governor balls jump.
  - **Turbojet (afterburner)**: an engine on a display stand. In cutaway mode you see the compressor stages, the combustor cans, the turbine and the flame holders; the spool spins with the revs (the spinner has a painted spiral). On the loud parts the afterburner lights: a long plume with shock diamonds, and the nozzle petals open. The stand gives with the thrust: its legs lean forward and the engine rides on top, and every beat kicks it forward and lets it swing back.
  - **Electric (DC motor)**: an industrial brushed DC motor on a bedplate, the commutator end facing you through an open end bracket. The "cylinders" are the brushes (2–12, one per pole, between the poles). Every commutator segment passing a brush can throw a blue spark, more under load; on the loud parts blue arcs jump from the brushes to the commutator, and a big beat makes a flashover: a ring of fire round the commutator. It runs straight up on its starting current (no starter, no backfires); every beat twists the frame on its feet. The dash shows RPM × 100, the armature current (A) and the winding temperature.
  - **Marine diesel**: a slow four-stroke crosshead engine, as tall as a person, with platforms, yellow railings and a ladder. On top is the open valve gear of the old submarine and ship diesels: two rockers across every head (exhaust and intake) tipping in turn on pedestals, coil valve springs, pushrods down to an open camshaft. Crank, connecting rods, crossheads and piston rods move in cutaway mode; the exhaust drives a turbocharger at the front end, the auxiliary blowers run while the charge air is low. It starts on compressed air (the indicator cocks blow) and puffs smoke up the funnel with every exhaust; on the loud parts every exhaust flares a flame out of the funnel (it glows hot), with black smoke and soot, and beats (and, now and then, a hard-running cylinder) lift the cylinder relief valves (flames out sideways) and make the funnel belch fireballs. The shaft turns at the speed the dash shows, up to 500 rpm like a U-boat diesel.
  - **Rocket**: liquid-fuel rocket engines on a horizontal test stand, 1 to 12 of them (a single engine, a ring, 8 + 1 like a Falcon 9, up to 3 + 9). Each has a bell nozzle that glows with heat, a turbopump with a smoky gas generator exhaust and gimbal actuators. The start sequence chills down first (vapour from the nozzles), then lights with a green flash; the plumes have shock diamonds and flare on the loud parts, beats swing the engines on their gimbals, the shutdown leaves an oxidiser-rich cloud. The dash shows thrust in % (40 % at idle) and the chamber pressure.
- **Number of cylinders**: 1–32. The layout rounds it up where needed: V and boxer to an even number, W to a multiple of 4 (8 minimum), radial to an odd number per row with up to 9 per row (5 → 5, 8 → 9, 14 → 2 rows of 7, 18 → 2 × 9, 28+ → 4 × 7). For the rotary the number is the rotor count (2 = like a 13B, 3 = 20B, 4 = 26B). Steam: 1–8 cylinders. Turbojet: the number of combustor cans, 6–16. Electric: brushes, 2–12 (even). Marine diesel: 4–12 cylinders. Rocket: engines, 1–12.
- **Forced induction**: none, turbo, twin turbo, quad turbo, supercharger (Roots blower) or twincharged (blower + twin turbos).
  - Turbo size barely depends on the cylinder count (the block's height and width don't either), so a small engine gets proper-size turbos; they grow a little on big engines (V12, V16). Twin and quad setups use the same size as a single. Boost comes with lag and needs revs; lifting off gives the blow-off valve hiss.
  - The Roots blower sits on the intake and is belt-driven from the crank; its rotors show in cutaway mode. On top is a butterfly injector hat: three round butterflies (in the valve cover colour) that open with the throttle, so they follow the pedal and loud parts of the music. Boost is instant and grows with RPM, and there is no blow-off valve.
  - Twincharged: the blower gives boost right away, the turbos take over higher up and blow into a hat on the blower.
  - None: an air filter, and the boost gauge shows manifold vacuum.
  - The radial is always naturally aspirated: the setting is hidden for it (disabled in the settings panel), any saved option acts as none and the boost gauge shows manifold vacuum.
  - The steam engine, turbojet, electric motor, marine diesel and rocket have no forced induction options either (the marine diesel has its own turbocharger); the setting is hidden for them too.
- **Cutaway block**: a semi-transparent block that shows the pistons, connecting rods and crankshaft.
- **Valve cover color**, **gauge backlight color**.
- **Background**: Garage, Carbon, Gradient (custom color), Custom image. Plus background dimming.
- **Audio sensitivity**, **rev limiter**, **flame threshold** (lower means more frequent flames).
- **Stall after silence, s**.
- **Crankshaft animation speed**, **engine sway strength**.
- **Graphics quality**: low, medium, high. If the wallpaper loads your system too much, also cap the FPS in the WE settings.
- **Show BPM and load**, **debug info** (BPM, confidence, loudness, engine state).
- **Odometer**: kilometers, miles or hidden. The ODO and TRIP drum counters under the tachometer add mileage while the engine runs, faster at higher RPM (about 30 km/h per 1000 rpm). Click the counter to reset TRIP. Mileage is kept in the wallpaper's local storage. In Wallpaper Engine that storage belongs to each monitor, and WE may clear it (screensaver mode, cache reset), so treat it as best effort.

## Warning lamps

| Lamp | When it lights up |
|---|---|
| STALL | The engine has stalled: silence longer than the configured time and the pedal is not pressed |
| LOW RPM | RPM stays low for a long time (quiet or slow music) |
| REDLINE | RPM at the rev limiter |
| OVERHEAT | Sustained peak load. Blinks above 118 °C |
| OIL PRESS | RPM below 500: the engine has stalled or the starter is cranking |
| BATTERY | The engine has stalled or the starter is cranking |
| CHECK ENG | The music is loud, but the analyzer can't lock onto the beat for several seconds |
| OVERBOOST | Boost stays near maximum for more than a second |

The steam engine and the turbojet use their own dash scales: steam shows the shaft rpm (0–250, red from 200) and the boiler pressure (STEAM bar) instead of boost; the turbojet shows % RPM (idle about 60 %, 100 % at the top) and the exhaust gas temperature (EGT, °C) instead of boost, and the oil temperature on the left gauge. Some lamps are renamed: steam OVERBOOST → SAFETY VLV (the safety valve is blowing off); turbojet STALL → FLAMEOUT, BATTERY → STARTER, OVERBOOST → EGT HIGH. The electric motor, the marine diesel and the rocket have their own scales and lamp names too (for example BREAKER / CONTACTOR / OVERCURRENT, SHUTDOWN / START AIR / CHARGE HIGH, CUTOFF / IGNITER / CHAMBER HIGH). The rev limiter setting only applies to the piston engines.

## How it works

- About 30 times per second WE passes the audio spectrum (64 bands per channel). BPM is computed by the wallpaper itself: it looks for the repetition period of the beats from energy jumps in the bass (autocorrelation over a ~10 s window).
- RPM is made up of loudness, BPM, beat density, kicks on strong beats and the throttle pedal.
- Flames appear when the "power" (loudness relative to the track + BPM + beat density) is above the threshold. They are drawn as shader jets with procedural turbulence, plus fireballs on backfires and sparks. The same moments stoke the steam engine's fire and light the turbojet's afterburner.

## Testing without Wallpaper Engine

Open `index.html` in Chrome. A **Settings** panel will appear: demo beat, microphone, audio file, engine and background selection. **Hide** leaves a small **Settings** button in the top-left corner to bring it back; `D` toggles the panel too. The panel has every setting of the WE version and remembers them between visits (except a custom background image); URL parameters override them without being saved. It also has buttons to reset TRIP, the odometer and the saved settings. The radio is off by default: tick `radio` (or add `?showradio=true`); it shows the name of the audio file you picked (`Artist - Title.mp3` is split into artist and title), otherwise `AUX`.
The microphone requires a local server:

```
python -m http.server 8000
# http://localhost:8000/?debug=true
```

Parameters can be passed in the URL: `?demo=1&layout=radial&cylinders=9&turbos=sc&background=carbon&ignition=false`.

## Tests

The wallpaper itself has no build step; `package.json` is only for the tests (Node 22+).

```
npm install
npx playwright install chromium   # once: the browser for test:e2e
npm run test:unit    # unit + scene tests in Node, ~30 s, no browser
npm run test:e2e     # the page in headless Chromium with SwiftShader WebGL, ~4 min
npm run baseline     # re-record test/fixtures/baseline.json (only after an intended change to an engine)
npm run sync:project # rewrite the layout combo and conditions in project.json from the engine registry
```

- `test/unit`: audio analysis (BPM, silence, junk input), the engine state machine and boost sources, layouts' cylinder rules, forced induction, odometer, radio info, dash scales and hit areas, and `project.json` ↔ code ↔ settings panel consistency. `contract.test.js` checks every registered engine type and layout (statics, dash profile, a whole song through the sim, project.json in sync); `baseline.test.js` compares sim traces, the dash's drawing calls and scene numbers of the existing engines with `test/fixtures/baseline.json`, so a change for one engine can't quietly alter another.
- `test/scene`: the real Three.js scene graph built in Node without WebGL: every layout × induction × cylinder count, kinematics (rods on their pins, stroke, firing order, rotor apexes, crossheads), camera fit against the dash, the engine staying on the floor, flames at the stack tips, cutaway, NaN resilience, and the engine-specific effects (brush sparks, gimbals, the beat motion of the jet and steam engines).
- `test/e2e`: rendering checked by rules, not reference images: every build compiles and draws, no engine pixel under the dash, additive flames never write alpha; plus the Wallpaper Engine API (audio and media listeners, properties with junk values, pause, one animation loop), the key, pedal and odometer, and the browser settings panel.

GitHub Actions runs both on every push to `master` and on pull requests (`.github/workflows/ci.yml`).

Don't publish `node_modules/`, `test/`, `tools/`, `.github/` or `package*.json` to the Workshop: the wallpaper needs only `index.html`, `project.json`, `preview.jpg` and `js/`.

## Adding an engine

The core (sim, 3D scene, dash, settings) knows no engine by name. An engine is one file in `js/engines/`:

1. Register its type with `EngineTypes.register({ id, redline, glow, sim: { maxBoost, sources, … }, dash: red => ({ tach, left, right, lamps }) })` (skip this if it reuses a type, as the piston layouts do); see the header of `js/core/layout.js`.
2. Write a layout class extending `EngineLayouts.base` (BaseLayout: every build and effect hook with a do-nothing default) with the statics `id`, `kind`, `title`, `normCyl`, `label`, and register it with `EngineLayouts.register(cls)`.
3. Add a `<script>` line for it in `index.html` (after the other engines, before `induction.js`), then run `npm run sync:project` and the tests.

## Files

```
index.html               markup and script loading
project.json             wallpaper description and properties for WE
preview.jpg              preview
js/core/audio.js         audio analysis: BPM, beats, loudness, silence; demo and browser audio sources
js/core/sim.js           engine model: states, RPM, boost channel, temperature, flames, lamps, key, pedal
js/core/fx.js            shared effects: particles and their kinds, noise, flame-jet and plume shaders
js/core/engine3d.js      Three.js scene: build orchestration, crank timing, camera fit, shadows, sway, beat spring
js/core/layout.js        engine type and layout registries, the layout base class
js/core/dash.js          dashboard on a 2D canvas, key and pedal, odometer, radio
js/core/bg.js            backgrounds
js/core/media.js         now playing for the radio (WE media integration, or the picked audio file)
js/core/odometer.js      odometer and trip counter, kept in localStorage
js/engines/piston.js     the piston type and PistonLayout: cylinders, stacks, flame jets, backfires
js/engines/piston-layouts.js  inline, V, boxer, W, radial, rotary
js/engines/steam.js      steam engine: mill engine, boiler, chuffs, sparks, safety valve
js/engines/jet.js        turbojet: compressor, cans, turbine, afterburner plume, nozzle
js/engines/electric.js   DC motor: poles, armature, commutator, brushes, sparks, arcs, flashover
js/engines/marine.js     marine diesel: crossheads, open valve gear, turbocharger, funnel smoke
js/engines/rocket.js     rocket engines on a test stand: cluster, plumes, ignition, gimbals
js/engines/induction.js  forced induction options, boost sources and parts: air filter, turbos, Roots blower
js/main.js               glue: WE properties, audio, input, main loop, settings panel
js/three.min.js          Three.js r149 (MIT, license in js/three.LICENSE.txt)
tools/                   baseline and sync-project scripts (Node)
test/                    automated tests (node:test + Playwright), see Tests
.github/                 CI workflow
```
