/* Engine behaviour model driven by AudioAnalyzer output. Generic: the state machine, revs from the music and the
 * pedal, flames, pops, warnings. What depends on the engine type (the boost channel's sources, extra events)
 * comes from EngineTypes (js/core/layout.js), looked up by settings.kind. */
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const IDLE = 850;
  const FIRE_RPM = 2500;              // no flames or pops below this, whatever the redline is

  /* The right-hand small gauge reads sim.boost: turbo/blower boost for a piston engine, boiler pressure, EGT...
     Its sources come from the engine type (js/core/layout.js): each has a target and its own rise/fall time,
     the value is the max of all of them. */

  /* starting and stalling, overridable per engine type (type.sim.crank / type.sim.stall) */
  const CRANK = { time: 0.9, rpm: 230, wobble: 70, rise: 20, fire: 1500 };   // starter speed, its lumpiness, rpm when it fires
  const STALL = { rpm: 380, stumble: 500, pops: true };                    // dying revs, random stumbles, backfire pops

  class EngineSim {
    constructor() {
      this.state = 'off';            // off | lamptest | cranking | running | stalling | stalled
      this.ignition = true; this.pedal = 0; this.pedalIn = false; this.lastPedalT = -99;
      this.stateT = 0;
      this.rpm = 0; this.target = 0;
      this.kick = 0;
      this.throttle = 0; this._thrHist = [];
      this.boost = -0.1; this.maxBoost = 1.6;
      this.temp = 72;
      this.flame = 0; this._flameOn = false;
      this.events = [];               // {type:'backfire'|'bov'|'smoke'|'start', k}
      this.limiter = false; this._limT = 0;
      this.lowT = 0; this.ceT = 0; this.obT = 0;
      this.warn = {};
      this.settings = { redline: 7000, stallDelay: 3, flameThr: 0.62, turbos: 1, blower: false, kind: 'piston' };
      this.pw = 0;
      this._srcKey = '';
    }

    type() { return window.EngineTypes.get(this.settings.kind); }
    _sources() {
      const s = this.settings, type = this.type(), key = type.id + '|' + (s.turbos | 0) + '|' + !!s.blower;
      if (key !== this._srcKey) {
        this._srcKey = key;
        this.maxBoost = type.sim.maxBoost;
        const src = type.sim.sources(s, this.maxBoost);
        src.forEach(b => b.v = this.boost);
        this._src = src;
      }
      return this._src;
    }

    emit(type, k = 1) { this.events.push({ type, k }); }
    takeEvents() { const e = this.events; this.events = []; return e; }

    update(dt, a, t) {
      const s = this.settings, red = Math.max(250, s.redline || 7000);
      const ts = this.type().sim, crank = Object.assign({}, CRANK, ts.crank), stall = Object.assign({}, STALL, ts.stall);
      const beats = a.takeBeats();
      // one NaN (junk input) would otherwise stick in these accumulators for good
      for (const k of ['rpm', 'kick', 'throttle', 'pedal', 'temp', 'flame', 'stateT']) if (!isFinite(this[k])) this[k] = k === 'temp' ? 72 : 0;
      this.stateT += dt;
      const soundOn = a.silentTime < 0.12 && a.level > 0.006;
      // throttle pedal (manual)
      const pin = this.pedalIn && this.ignition ? 1 : 0;
      this.pedal += (pin - this.pedal) * (1 - Math.exp(-dt / (pin > this.pedal ? 0.12 : 0.06)));
      if (this.pedal < 0.002) this.pedal = 0;
      if (this.pedal > 0.05) this.lastPedalT = t;
      const wake = soundOn || this.pedal > 0.3;
      // ignition key
      if (!this.ignition) { if (this.state !== 'off') { this.state = 'off'; this.stateT = 0; } }
      else if (this.state === 'off') { this.state = 'lamptest'; this.stateT = 0; }

      // ---------- state machine ----------
      switch (this.state) {
        case 'lamptest':
          if (this.stateT > 1.1) { this.state = 'cranking'; this.stateT = 0; }
          break;
        case 'running':
          if (a.silentTime > s.stallDelay && t - this.lastPedalT > s.stallDelay) { this.state = 'stalling'; this.stateT = 0; }
          break;
        case 'stalling':
          if (wake) { this.state = 'running'; this.stateT = 0; break; }
          if (this.stateT > 1.3 || this.rpm < 120) { this.state = 'stalled'; this.stateT = 0; this.emit('smoke', 0.6); }
          break;
        case 'stalled':
          if (wake && this.stateT > 0.4) { this.state = 'cranking'; this.stateT = 0; }
          break;
        case 'cranking':
          if (this.stateT > crank.time) { this.state = 'running'; this.stateT = 0; this.emit('start'); this.emit('smoke', 1); this.rpm = crank.fire; }
          break;
      }

      // ---------- target rpm ----------
      let target = 0, rise = 6, fall = 2.6;
      if (this.state === 'running') {
        const bpmN = clamp((a.bpm - 80) / 90, 0, 1) * clamp(a.conf * 1.8, 0.35, 1);
        const music = 0.08 + 0.32 * bpmN * clamp(a.intensity * 2, 0, 1) + 0.62 * a.intensity;
        for (const k of beats) this.kick += k * (350 + 1500 * a.intensity);
        this.kick *= Math.exp(-dt / 0.16);
        target = IDLE + (red - IDLE) * music + this.kick;
        target = Math.max(target, IDLE + (red * 1.05 - IDLE) * Math.pow(this.pedal, 1.3));
        target += Math.sin(t * 7.3) * 18 + Math.sin(t * 13.1) * 10; // idle wobble
      } else if (this.state === 'stalling') {
        target = stall.rpm + (Math.random() < 0.15 ? stall.stumble : 0); rise = 10; fall = 3;
        if (Math.random() < dt * 1.2 && stall.pops) this.emit('backfire', 0.3);
      } else if (this.state === 'cranking') {
        target = crank.rpm + Math.sin(this.stateT * 38) * crank.wobble; rise = crank.rise; fall = 20;
      } else {
        target = 0; fall = this.state === 'stalled' ? 4 : 3;
      }

      // rev limiter
      const lim = red * 1.03;
      this.limiter = false;
      if (target > lim) target = lim;
      if (this.rpm >= lim * 0.995 && this.state === 'running') {
        this.limiter = true;
        if (t - this._limT > 0.09) { this._limT = t; this.rpm -= Math.min(280, red * 0.04); if (this.rpm > FIRE_RPM && Math.random() < 0.5) this.emit('backfire', 0.55); }
      }
      this.target = target;
      const k = target > this.rpm ? rise : fall;
      this.rpm += (target - this.rpm) * (1 - Math.exp(-dt * k));
      if (this.rpm < 1) this.rpm = 0;

      const pw = this.pw = Math.max(a.power, this.pedal * 0.95);
      // throttle & decel detection
      const thr = this.state === 'running' ? clamp((target - IDLE) / Math.max(250, red - IDLE), 0, 1) : 0;
      this.throttle += (thr - this.throttle) * (1 - Math.exp(-dt / 0.08));
      this._thrHist.push([t, this.throttle]);
      while (this._thrHist.length && t - this._thrHist[0][0] > 0.25) this._thrHist.shift();
      const maxRecent = Math.max(...this._thrHist.map(x => x[1]));
      if (maxRecent - this.throttle > 0.28 && this.rpm > Math.max(red * 0.45, FIRE_RPM) && !this._decel) {
        this._decel = true;
        this.emit('backfire', 0.5 + 0.5 * pw);
        if (s.turbos > 0 && this.boost > 0.6) this.emit('bov', this.boost / this.maxBoost);
      }
      if (maxRecent - this.throttle < 0.08) this._decel = false;

      // boost: max over the sources (twincharged = blower down low, turbos take over higher up)
      let boost = -Infinity;
      for (const b of this._sources()) {
        const bt = this.state !== 'running' ? (b.rest ? b.rest(this) : 0) : b.target(this, red);
        b.v += (bt - b.v) * (1 - Math.exp(-dt / (bt > b.v ? b.rise : b.fall)));
        if (!isFinite(b.v)) b.v = 0;
        boost = Math.max(boost, b.v);
      }
      this.boost = boost;
      // the type's own extras (steam: the safety valve lifts near the top of the gauge)
      const after = this.type().sim.after;
      if (after) after(this, dt, t);

      // temperature
      const run = this.rpm > 300;
      const eq = run ? 88 + 34 * clamp((pw - 0.45) / 0.55, 0, 1) * clamp(this.rpm / red + 0.2, 0, 1) : 70;
      const tk = eq > this.temp ? 1 / 22 : 1 / 30;
      this.temp += (eq - this.temp) * (1 - Math.exp(-dt * tk));

      // flames (hysteresis)
      const ft = s.flameThr;
      if (this.state === 'running') {
        if (!this._flameOn && pw > ft && this.rpm > Math.max(red * 0.5, FIRE_RPM)) this._flameOn = true;
        if (this._flameOn && (pw < ft - 0.08 || this.rpm < Math.max(red * 0.4, FIRE_RPM * 0.8))) this._flameOn = false;
      } else this._flameOn = false;
      const fTarget = this._flameOn ? 0.35 + 0.65 * clamp((pw - ft) / Math.max(0.05, 1 - ft), 0, 1) : 0;
      this.flame += (fTarget - this.flame) * (1 - Math.exp(-dt / (fTarget > this.flame ? 0.1 : 0.35)));
      if (this._flameOn) for (const k of beats) if (k > 0.5) this.emit('backfire', 0.4 + 0.6 * k);

      // ---------- warnings ----------
      const w = this.warn;
      w.stall = this.state === 'stalled' || this.state === 'stalling';
      this.lowT = (this.state === 'running' && this.rpm < IDLE * 1.45) ? this.lowT + dt : 0;
      w.lowrpm = this.lowT > 1.2;
      w.redline = this.rpm > red * 0.93;
      w.overheat = this.temp > 110;
      w.oil = this.rpm < 500;
      w.battery = this.state === 'stalled' || this.state === 'cranking';
      const lost = this.state === 'running' && a.conf < 0.12 && a.intensity > 0.25;
      this.ceT = lost ? this.ceT + dt : Math.max(0, this.ceT - dt * 2);
      w.check = this.ceT > 4;
      this.obT = this.boost > this.maxBoost * 0.93 ? this.obT + dt : 0;
      w.overboost = this.obT > 1.0;
      w.limiter = this.limiter;
      if (this.state === 'off') for (const k in w) w[k] = false;
      else if (this.state === 'lamptest') for (const k in w) w[k] = k !== 'limiter';
    }
  }

  window.EngineSim = EngineSim;
  window.ENGINE_IDLE = IDLE;
})();
