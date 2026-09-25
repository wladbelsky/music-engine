'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');

const KEY = 'music-engine.odometer';
const run = rpm => ({ state: 'running', rpm });

test('odometer: distance = rpm × 30 km/h per 1000 rpm, only while the crank turns on its own', () => {
  const g = load(), o = new g.Odometer();
  o.update(3600, run(1000), 0);                          // one hour at 1000 rpm
  assert.ok(Math.abs(o.km - 30) < 1e-9, `km ${o.km}`);
  assert.ok(Math.abs(o.trip - 30) < 1e-9);
  o.update(3600, { state: 'stalling', rpm: 1000 }, 0);
  assert.ok(Math.abs(o.km - 60) < 1e-9, 'stalling still rolls');
  for (const state of ['off', 'lamptest', 'cranking', 'stalled']) o.update(3600, { state, rpm: 5000 }, 0);
  assert.ok(Math.abs(o.km - 60) < 1e-9, 'not while cranking / off');
  for (const rpm of [NaN, -500, Infinity]) o.update(10, run(rpm), 0);
  assert.ok(Math.abs(o.km - 60) < 1e-9, 'junk rpm adds nothing');
  assert.ok(Math.abs(o.value('mi', false) - 60 / 1.609344) < 1e-9);
  assert.equal(o.value('km', true), o.trip);
});

test('odometer: ODO wraps at 1e6 km, TRIP at 1e4 km', () => {
  const g = load();
  g.localStorage.setItem(KEY, JSON.stringify({ km: 999999.9, trip: 9999.9 }));
  const o = new g.Odometer();
  o.update(3600, run(1000), 0);                          // +30 km
  assert.ok(Math.abs(o.km - 29.9) < 1e-6, `km ${o.km}`);
  assert.ok(Math.abs(o.trip - 29.9) < 1e-6, `trip ${o.trip}`);
});

test('odometer: saves every 10 s of wall time while moving, flush() saves the rest', () => {
  const g = load(), o = new g.Odometer();
  o.update(1, run(3000), 1000);
  assert.equal(g.localStorage.getItem(KEY), null, 'not yet');
  o.update(1, run(3000), 11000);
  const s1 = JSON.parse(g.localStorage.getItem(KEY));
  assert.ok(s1.km > 0);
  o.update(1, run(3000), 12000);
  o.flush();
  const s2 = JSON.parse(g.localStorage.getItem(KEY));
  assert.ok(Math.abs(s2.km - o.km) < 1e-12);
  assert.equal(o.dirty, false);
});

test('odometer: two writers on one store add up instead of overwriting each other', () => {
  const g = load();
  const a = new g.Odometer(), b = new g.Odometer();
  a.update(3600, run(1000), 0); a.save();               // +30
  b.update(3600, run(2000), 0); b.save();               // +60, b never saw a's 30
  const s = JSON.parse(g.localStorage.getItem(KEY));
  assert.ok(Math.abs(s.km - 90) < 1e-9, `stored ${s.km}`);
  assert.ok(Math.abs(b.km - 90) < 1e-9);
});

test('odometer: resetTrip keeps the total, reset zeroes both; junk in the store loads as 0', () => {
  const g = load(), o = new g.Odometer();
  o.update(3600, run(1000), 0);
  o.resetTrip();
  assert.equal(o.trip, 0);
  assert.ok(Math.abs(JSON.parse(g.localStorage.getItem(KEY)).km - 30) < 1e-9);
  o.reset();
  assert.deepEqual(JSON.parse(g.localStorage.getItem(KEY)), { km: 0, trip: 0 });
  for (const junk of ['{"km":-5,"trip":"x"}', 'not json', '{"km":null}', '[]', 'null', '{"km":1e400}']) {
    g.localStorage.setItem(KEY, junk);
    const x = new g.Odometer();
    assert.ok(x.km === 0 && x.trip === 0, `${junk} -> ${x.km}/${x.trip}`);
  }
});

test('odometer: a store that throws (private mode) never breaks counting', () => {
  const g = load();
  g.localStorage.broken = true;
  const o = new g.Odometer();
  o.update(3600, run(1000), 0);
  o.save(); o.flush(); o.resetTrip();
  o.update(3600, run(1000), 20000);
  assert.ok(Math.abs(o.km - 60) < 1e-9, `km ${o.km}`);
  o.reset();
  assert.equal(o.km, 0);
});

/* ---------------- media (radio) ---------------- */
test('media: a new track is a new title or a different artist; repeats and late artists are not', () => {
  const g = load(), m = new g.MediaInfo();
  assert.equal(m.active(0), false);
  m.onProps({ title: 'Song', artist: '' });
  assert.equal(m.trackNo, 1);
  m.onProps({ title: 'Song', artist: 'Band' });           // artist filled in later
  m.onProps({ title: 'Song', artist: 'Band' });           // resent with a thumbnail
  assert.equal(m.trackNo, 1);
  assert.equal(m.artist, 'Band');
  m.onProps({ title: 'Song', artist: 'Other band' });
  assert.equal(m.trackNo, 2);
  m.onProps({ title: 'Next', albumArtist: 'AA' });
  assert.equal(m.trackNo, 3);
  assert.equal(m.artist, 'AA');
  assert.equal(m.active(0), true, 'state null (no playback event yet) counts as playing');
  m.onProps({ title: '  ' });
  assert.equal(m.available, false);
  assert.equal(m.active(0), false, 'empty title -> AUX');
  m.onProps(null); m.onProps(undefined);
  assert.equal(m.available, false);
});

test('media: playback states, with and without the WE constants; stopped falls back to AUX after 10 s', () => {
  const g = load(), m = new g.MediaInfo();
  m.onProps({ title: 'T', artist: 'A' });
  m.onPlayback({ state: 2 }); assert.equal(m.state, 'paused');
  m.onPlayback({ state: 1 }); assert.equal(m.state, 'playing');
  m.onPlayback({ state: 0 }); assert.equal(m.state, 'stopped');
  m.onPlayback(null); assert.equal(m.state, 'stopped');
  g.wallpaperMediaIntegration = { PLAYBACK_PLAYING: 7, PLAYBACK_PAUSED: 8 };
  m.onPlayback({ state: 7 }); assert.equal(m.state, 'playing');
  m.onPlayback({ state: 8 }); assert.equal(m.state, 'paused');
  g.clock.ms = 100000;
  m.onPlayback({ state: 1 });                              // not a known state now -> stopped at t = 100 s
  assert.equal(m.state, 'stopped');
  assert.equal(m.active(105), true);
  assert.equal(m.active(111), false);
  m.onStatus({ enabled: false });
  assert.equal(m.available, false);
  assert.equal(m.state, null);
});

test('media: a picked file "Artist - Title.ext" feeds the radio; a replaced <audio> is ignored', () => {
  const g = load(), m = new g.MediaInfo();
  const el = () => { const h = {}; return { paused: false, addEventListener: (k, f) => { h[k] = f; }, fire: k => h[k](), h }; };
  const e1 = el();
  m.fromFile('Daft Punk - Around_the_World.mp3', e1);
  assert.equal(m.artist, 'Daft Punk');
  assert.equal(m.title, 'Around the World');
  assert.equal(m.state, 'playing');
  e1.fire('pause'); assert.equal(m.state, 'paused');
  const e2 = el();
  m.fromFile('just a title.ogg', e2);
  assert.equal(m.title, 'just a title');
  assert.equal(m.artist, '');
  e1.fire('pause');                                        // the old element's late event
  assert.equal(m.state, 'playing');
  m.clear();
  assert.equal(m.available, false);
  e2.fire('pause');
  assert.equal(m.state, null, 'after clear() even the current element is ignored');
});
