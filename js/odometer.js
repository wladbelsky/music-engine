/* Odometer: total + trip mileage from engine rpm, kept in localStorage (browser and WE, best effort). */
(function () {
  'use strict';
  // file:// pages share one origin, so the key carries the wallpaper's name. In WE the storage is per monitor,
  // wiped in screensaver mode and lost when WE resets its Chromium cache: every access is in try/catch.
  const KEY = 'music-engine.odometer';
  const KMH_PER_KRPM = 30;             // "one long gear": idle 850 rpm ≈ 25 km/h, 7000 rpm ≈ 210 km/h
  const KM_PER_MI = 1.609344;
  const SAVE_EVERY = 10;               // s of wall time between saves while the counter moves
  const ODO_WRAP = 1e6, TRIP_WRAP = 1e4;
  const num = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);

  class Odometer {
    constructor() { this.km = 0; this.trip = 0; this.dirty = false; this.savedAt = 0; this.load(); }

    load() {
      try {
        const d = JSON.parse(localStorage.getItem(KEY)) || {};
        this.km = num(d.km) % ODO_WRAP; this.trip = num(d.trip) % TRIP_WRAP;
      } catch (e) { /* no storage / junk: start from zero */ }
    }
    save() {
      this.dirty = false; this.savedAt = performance.now() / 1000;
      try { localStorage.setItem(KEY, JSON.stringify({ km: this.km, trip: this.trip })); } catch (e) { /* private mode, quota */ }
    }
    flush() { if (this.dirty) this.save(); }
    resetTrip() { this.trip = 0; this.save(); }
    reset() { this.km = this.trip = 0; this.save(); }

    // distance only while the crank turns on its own (not cranking); dt is the sim's (clamped) step
    update(dt, sim, now) {
      if (sim.state === 'running' || sim.state === 'stalling') {
        const d = sim.rpm * KMH_PER_KRPM / 1000 * dt / 3600;
        if (isFinite(d) && d > 0) {
          this.km = (this.km + d) % ODO_WRAP; this.trip = (this.trip + d) % TRIP_WRAP; this.dirty = true;
        }
      }
      if (this.dirty && now / 1000 - this.savedAt > SAVE_EVERY) this.save();
    }

    // shown value in the chosen units
    value(units, trip) { const km = trip ? this.trip : this.km; return units === 'mi' ? km / KM_PER_MI : km; }
  }
  Odometer.KMH_PER_KRPM = KMH_PER_KRPM;
  Odometer.KM_PER_MI = KM_PER_MI;

  window.Odometer = Odometer;
})();
