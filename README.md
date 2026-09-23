# Engine Revs: audio-reactive wallpaper for Wallpaper Engine

A web wallpaper with a 3D engine. The engine revs up to the music, and on the most powerful moments flames shoot out of the exhaust. On the right is a dashboard: tachometer, temperature, boost, warning lamps, an ignition key and a throttle pedal.

![preview](preview.jpg)

## Installation

1. Wallpaper Engine → **Create Wallpaper** → select `index.html` from this folder. WE will copy the project into its `myprojects` folder.
   - Alternatively, copy the `EngineRevs` folder into `…\steamapps\common\wallpaper_engine\projects\myprojects\` and restart WE.
2. If the engine settings don't show up in the WE properties panel, replace `project.json` in the WE project folder with this file and restart WE.
3. For the wallpaper to react to sound, audio capture from the output device must be enabled in the WE settings.
4. The key and pedal respond to the mouse only if WE passes mouse input to the wallpaper: mouse input must be allowed in the WE settings. Clicks on desktop icons are not passed to the wallpaper.

> After changing files in this folder, import `index.html` again: WE works with its own copy of the project.

## Controls

| Element | Action |
|---|---|
| **Ignition key** (left, above the tachometer) | Click to toggle OFF/ON. When switched on, all lamps light up for ~1 s as a bulb check, then the starter cranks the engine and it starts. When switched off, the engine stalls, the gauges go dark, and it ignores the music. |
| **Throttle pedal** (right, above the tachometer) | While the mouse button is held, RPM climbs all the way to the rev limiter: you get flames, backfire "pops" when you lift off, and the hiss of the blow-off valve. The pedal works without music too and can restart a stalled engine on its own. |
| Keyboard (browser only) | `Space` or `↑` act as the pedal, `I` turns the key. |

## Settings (wallpaper properties panel in WE)

- **Ignition on**: key position at startup.
- **Show key and throttle pedal**.
- **Number of cylinders** (2–12) and **Layout**: inline, V, boxer. For V and boxer an odd number is rounded up.
- **Turbochargers**: none, 1, 2 (twin) or 4 (quad). Turbo size follows how many cylinders each one feeds, so a single turbo on a V12 is big and a quad setup uses small ones. Without turbos the engine gets an air filter, the boost gauge shows manifold vacuum and there is no blow-off valve.
- **Cutaway block**: a semi-transparent block that shows the pistons, connecting rods and crankshaft.
- **Valve cover color**, **gauge backlight color**.
- **Background**: Garage, Carbon, Gradient (custom color), Custom image. Plus background dimming.
- **Audio sensitivity**, **rev limiter**, **flame threshold** (lower means more frequent flames).
- **Stall after silence, s**.
- **Crankshaft animation speed**, **engine sway strength**.
- **Graphics quality**: low, medium, high. If the wallpaper loads your system too much, also cap the FPS in the WE settings.
- **Show BPM and load**, **debug info** (BPM, confidence, loudness, engine state).

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

## How it works

- About 30 times per second WE passes the audio spectrum (64 bands per channel). BPM is computed by the wallpaper itself: it looks for the repetition period of the beats from energy jumps in the bass (autocorrelation over a ~10 s window).
- RPM is made up of loudness, BPM, beat density, kicks on strong beats and the throttle pedal.
- Flames appear when the "power" (loudness relative to the track + BPM + beat density) is above the threshold. They are drawn as shader jets with procedural turbulence, plus fireballs on backfires and sparks.

## Testing without Wallpaper Engine

Open `index.html` in Chrome. A dev panel will appear: demo beat, microphone, audio file, engine and background selection.
The microphone requires a local server:

```
python -m http.server 8000
# http://localhost:8000/?debug=true
```

Parameters can be passed in the URL: `?demo=1&layout=inline&cylinders=6&background=carbon&ignition=false`.

## Files

```
index.html        markup and script loading
project.json      wallpaper description and properties for WE
preview.jpg       preview
js/audio.js       audio analysis: BPM, beats, loudness, silence; demo and browser audio sources
js/sim.js         engine model: states, RPM, boost, temperature, flames, lamps, key, pedal
js/engine3d.js    Three.js 3D scene: engine generation, camera, shadows, sway, flames, smoke
js/dash.js        dashboard on a 2D canvas, key and pedal
js/bg.js          backgrounds
js/main.js        glue: WE properties, audio, input, main loop
js/three.min.js   Three.js r149 (MIT, license in js/three.LICENSE.txt)
```
