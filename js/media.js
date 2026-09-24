/* Now-playing info from Wallpaper Engine media integration (Windows media session). */
(function () {
  'use strict';
  const STOP_HOLD = 10;                // s: a stopped track stays on the radio this long, then back to AUX

  class MediaInfo {
    constructor() {
      this.available = false;          // WE sent track info and integration is enabled
      this.title = ''; this.artist = '';
      this.state = null;               // 'playing' | 'paused' | 'stopped' | null (no playback event yet)
      this.trackNo = 0; this.changeT = -99; this.stopT = -99;
    }

    _now() { return performance.now() / 1000; }
    _clear() { this.available = false; this.title = this.artist = ''; }

    // should the radio show the track (vs AUX)?
    active(t) { return this.available && !(this.state === 'stopped' && t - this.stopT > STOP_HOLD); }

    onStatus(e) {
      if (e && e.enabled === false) { this._clear(); this.state = null; }
    }

    onProps(e) {
      const title = String((e && e.title) || '').trim(), artist = String((e && (e.artist || e.albumArtist)) || '').trim();
      if (!title) { this._clear(); return; }   // media session ended / nothing playing
      this.available = true;
      // WE resends the same track (e.g. with the thumbnail) and may fill the artist in later: not a new track
      if (title === this.title && (!artist || !this.artist || artist === this.artist)) { if (artist) this.artist = artist; return; }
      this.title = title; this.artist = artist;
      this.trackNo++; this.changeT = this._now();
    }

    onPlayback(e) {
      const M = window.wallpaperMediaIntegration || {};
      const P = M.PLAYBACK_PLAYING !== undefined ? M.PLAYBACK_PLAYING : 1;
      const Z = M.PLAYBACK_PAUSED !== undefined ? M.PLAYBACK_PAUSED : 2;
      const s = e ? e.state : undefined;
      const st = s === P ? 'playing' : s === Z ? 'paused' : 'stopped';
      if (st === 'stopped' && this.state !== 'stopped') this.stopT = this._now();
      this.state = st;
    }

    // dev panel / tests
    mock(artist, title) { this.onProps({ artist, title }); this.state = 'playing'; }
    mockState(s) { if (s === 'stopped' && this.state !== 'stopped') this.stopT = this._now(); this.state = s; }
  }

  window.MediaInfo = MediaInfo;
})();
