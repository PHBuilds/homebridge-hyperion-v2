'use strict';
/* homebridge-hyperion-v2 — single-file bundle (no lib/ folder needed).
 * All modules are inlined below via a tiny CommonJS registry. */
const __mods = {};
function __def(name, factory){ const m = { exports: {} }; factory(m, m.exports); __mods[name] = m.exports; }
function __req(name){ if(!(name in __mods)) throw new Error('module not bundled: '+name); return __mods[name]; }

__def("util", (module, exports) => {
/**
 * Color + misc utilities. Pure functions, no dependencies.
 * HomeKit uses Hue (0-360), Saturation (0-100), Brightness (0-100).
 * Hyperion uses RGB arrays [0-255, 0-255, 0-255].
 */

/** Convert HSV (h:0-360, s:0-100, v:0-100) to an [r,g,b] array (0-255). */
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  v = clamp(v, 0, 100) / 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** Convert an [r,g,b] array (0-255) to { hue:0-360, saturation:0-100, value:0-100 }. */
function rgbToHsv(rgb) {
  const r = clamp(rgb[0], 0, 255) / 255;
  const g = clamp(rgb[1], 0, 255) / 255;
  const b = clamp(rgb[2], 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;
  return {
    hue: Math.round(h),
    saturation: Math.round(s * 100),
    value: Math.round(max * 100),
  };
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Coerce loose truthy config values ("true", 1, true) to boolean. */
function asBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return fallback;
}

/** Sleep helper. */
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

module.exports = { hsvToRgb, rgbToHsv, clamp, asBool, delay };
});

__def("effects", (module, exports) => {
/**
 * The default Hyperion.NG system effects (shipped with Hyperion). Users can
 * override the list via config ("effects": [...]). Custom effects created in
 * the Hyperion web UI can simply be added to that array by name.
 */
const DEFAULT_EFFECTS = [
  'Atomic swirl',
  'Blue mood blobs',
  'Breath',
  'Candle',
  'Cinema brighten lights',
  'Cinema dim lights',
  'Cold mood blobs',
  'Double swirl',
  'Full color mood blobs',
  'Green mood blobs',
  'Knight rider',
  'Notify blue',
  'Plasma',
  'Police Lights Single',
  'Police Lights Solid',
  'Rainbow swirl',
  'Rainbow swirl fast',
  'Red mood blobs',
  'Sea waves',
  'Sparks',
  'Strobe red',
  'Strobe white',
  'System Shutdown',
  'Warm mood blobs',
  'Waves with Color',
];

/**
 * Hyperion component identifiers usable with `componentstate`.
 * key   = component id sent to Hyperion
 * label = friendly name for HomeKit
 */
const COMPONENTS = {
  ALL: 'Hyperion',
  SMOOTHING: 'Smoothing',
  BLACKBORDER: 'Blackbar Detection',
  FORWARDER: 'Forwarder',
  BOBLIGHTSERVER: 'Boblight Server',
  GRABBER: 'Screen Capture',
  V4L: 'USB Capture',
  AUDIO: 'Audio Capture',
  LEDDEVICE: 'LED Device',
};

/** Components that make sense as user-facing on/off switches (besides ALL). */
const SWITCHABLE_COMPONENTS = [
  'SMOOTHING',
  'BLACKBORDER',
  'FORWARDER',
  'BOBLIGHTSERVER',
  'LEDDEVICE',
];

module.exports = { DEFAULT_EFFECTS, COMPONENTS, SWITCHABLE_COMPONENTS };
});

__def("settings", (module, exports) => {
/**
 * Plugin identifiers.
 *
 * ACCESSORY_NAME is intentionally "Hyperion" so that existing configs using
 *   { "accessory": "Hyperion", ... }
 * keep working with no changes (drop-in replacement for the classic plugin).
 *
 * PLATFORM_NAME enables the richer multi-instance / auto-discovery mode via
 *   { "platform": "HyperionV2", ... }
 */
const PLUGIN_NAME = 'homebridge-hyperion-v2';
const ACCESSORY_NAME = 'Hyperion';
const PLATFORM_NAME = 'HyperionV2';
const VERSION = '1.1.0';

module.exports = {
  PLUGIN_NAME, ACCESSORY_NAME, PLATFORM_NAME, VERSION,
};
});

__def("persist", (module, exports) => {
const fs = require('fs');
const path = require('path');

/**
 * Tiny grow-only cache of the discovered effect count, stored in the Homebridge
 * storage dir. Used to size the effects-wheel input pool so it matches the
 * server over time without ever shrinking (shrinking would churn HomeKit inputs).
 * All operations are best-effort and never throw.
 */
function cacheFile(storagePath, key) {
  return path.join(storagePath || '.', `.hyperion-v2-${key}.json`);
}

function readCount(storagePath, key) {
  try {
    const obj = JSON.parse(fs.readFileSync(cacheFile(storagePath, key), 'utf8'));
    return Number(obj.effectCount) || 0;
  } catch (_) {
    return 0;
  }
}

function writeCount(storagePath, key, count) {
  try {
    if (count > readCount(storagePath, key)) {
      fs.writeFileSync(cacheFile(storagePath, key), JSON.stringify({ effectCount: count }));
    }
  } catch (_) { /* best effort */ }
}

module.exports = { readCount, writeCount };
});

__def("client", (module, exports) => {
const net = require('net');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

/**
 * HyperionClient speaks Hyperion's JSON-RPC API over either:
 *   - a raw TCP JSON socket (default Hyperion port 19444), or
 *   - HTTP POST to /json-rpc (Hyperion.NG webserver, default 8090).
 *
 * Transport is chosen by `opts.transport`:
 *   'auto' (default) -> 'http' when port === 8090, otherwise 'tcp'
 *   'tcp' | 'http'   -> forced
 *
 * The TCP transport keeps a persistent connection, matches responses to
 * requests using Hyperion's `tan` field, auto-reconnects with backoff, and can
 * subscribe to live state-update pushes. The HTTP transport opens one request
 * per call (stateless).
 *
 * Events: 'connect', 'disconnect', 'error', 'update' (live serverinfo push).
 */
class HyperionClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.host = cleanHost(opts.host || '127.0.0.1');
    this.port = Number(opts.port) || 19444;
    // Strip CR/LF/control chars to prevent header or protocol injection via token.
    this.token = String(opts.token || '').replace(/[\r\n\x00-\x1f]/g, '');
    this.instance = opts.instance; // optional: switch to this instance after connect
    this.timeout = Number(opts.timeout) || 7000;
    this.log = opts.log || console;
    this.useTls = !!opts.tls;
    this.maxBuffer = Number(opts.maxBuffer) || 4 * 1024 * 1024; // 4 MB safety cap

    const t = (opts.transport || 'auto').toLowerCase();
    this.transport = t === 'auto' ? (this.port === 8090 ? 'http' : 'tcp') : t;

    // TCP state
    this._socket = null;
    this._connected = false;
    this._connecting = null;
    this._buffer = '';
    this._tan = 0;
    this._pending = new Map(); // tan -> {resolve, reject, timer}
    this._closedByUser = false;
    this._backoff = 1000;
    this._subscribed = false;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  /** Send a command and resolve with the parsed Hyperion response object. */
  async send(command) {
    if (this.transport === 'http') return this._sendHttp(command);
    return this._sendTcp(command);
  }

  /** Establish the persistent TCP connection (no-op for HTTP). */
  async connect() {
    if (this.transport === 'http') return true;
    return this._ensureConnected();
  }

  /** Subscribe to live update pushes (TCP only). Safe to call repeatedly. */
  async subscribe() {
    if (this.transport !== 'tcp' || this._subscribed) return;
    try {
      await this.send({
        command: 'serverinfo',
        subscribe: [
          'components-update',
          'adjustment-update',
          'priorities-update',
          'effects-update',
          'instance-update',
          'videomode-update',
        ],
      });
      this._subscribed = true;
    } catch (e) {
      this.log.debug && this.log.debug('Subscription failed (will poll instead):', e.message);
    }
  }

  /** Tear down the connection and reject all pending requests. */
  close() {
    this._closedByUser = true;
    if (this._socket) {
      try { this._socket.destroy(); } catch (_) { /* ignore */ }
    }
    this._failAllPending(new Error('client closed'));
  }

  /* ------------------------------------------------------------------ */
  /* HTTP transport                                                      */
  /* ------------------------------------------------------------------ */

  _sendHttp(command) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(command);
      const lib = this.useTls ? https : http;
      const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      };
      if (this.token) headers.Authorization = `token ${this.token}`;

      const req = lib.request(
        { host: this.host, port: this.port, path: '/json-rpc', method: 'POST', headers, timeout: this.timeout },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            body += c;
            if (body.length > this.maxBuffer) {
              req.destroy(new Error('HTTP response exceeded size limit'));
            }
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body || '{}'));
            } catch (e) {
              reject(new Error(`Invalid JSON from Hyperion: ${e.message}`));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('HTTP request timed out')));
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  /* ------------------------------------------------------------------ */
  /* TCP transport                                                       */
  /* ------------------------------------------------------------------ */

  _ensureConnected() {
    if (this._connected) return Promise.resolve(true);
    if (this._connecting) return this._connecting;

    this._connecting = new Promise((resolve, reject) => {
      this._closedByUser = false;
      const socket = new net.Socket();
      this._socket = socket;
      let settled = false;

      const onError = (err) => {
        if (!settled) { settled = true; this._connecting = null; reject(err); }
      };

      socket.setNoDelay(true);
      socket.connect(this.port, this.host, async () => {
        this._connected = true;
        this._backoff = 1000;
        settled = true;
        this._connecting = null;
        this.emit('connect');
        try {
          if (this.token) {
            await this._sendTcp({ command: 'authorize', subcommand: 'login', token: this.token }).catch(() => {});
          }
          if (this.instance !== undefined && this.instance !== null) {
            await this._sendTcp({ command: 'instance', subcommand: 'switchTo', instance: Number(this.instance) }).catch(() => {});
          }
        } finally {
          resolve(true);
        }
      });

      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('error', (err) => { this.emit('error', err); onError(err); });
      socket.on('close', () => this._onClose());
    });

    return this._connecting;
  }

  async _sendTcp(command) {
    await this._ensureConnected();
    return new Promise((resolve, reject) => {
      const tan = ++this._tan;
      const msg = JSON.stringify(Object.assign({}, command, { tan })) + '\n';

      const timer = setTimeout(() => {
        if (this._pending.has(tan)) {
          this._pending.delete(tan);
          reject(new Error(`Hyperion command timed out: ${command.command}`));
        }
      }, this.timeout);

      this._pending.set(tan, { resolve, reject, timer });

      try {
        this._socket.write(msg);
      } catch (e) {
        clearTimeout(timer);
        this._pending.delete(tan);
        reject(e);
      }
    });
  }

  _onData(chunk) {
    this._buffer += chunk.toString('utf8');

    // Safety: if a peer streams data with no newline delimiter, don't grow
    // memory without bound. Drop the connection and let reconnection recover.
    if (this._buffer.length > this.maxBuffer) {
      this.log.error && this.log.error('Hyperion response exceeded buffer limit; resetting connection');
      this._buffer = '';
      if (this._socket) { try { this._socket.destroy(); } catch (_) { /* ignore */ } }
      return;
    }

    let idx;
    while ((idx = this._buffer.indexOf('\n')) >= 0) {
      const line = this._buffer.slice(0, idx).trim();
      this._buffer = this._buffer.slice(idx + 1);
      if (!line) continue;

      let obj;
      try { obj = JSON.parse(line); } catch (_) { continue; }

      // Live update pushes carry a *-update command and no matching tan.
      if (typeof obj.command === 'string' && obj.command.endsWith('-update')) {
        this.emit('update', obj);
        continue;
      }

      const tan = obj.tan;
      if (tan !== undefined && this._pending.has(tan)) {
        const { resolve, timer } = this._pending.get(tan);
        clearTimeout(timer);
        this._pending.delete(tan);
        resolve(obj);
      } else {
        // Unsolicited but useful (e.g. serverinfo subscription seed).
        this.emit('update', obj);
      }
    }
  }

  _onClose() {
    const wasConnected = this._connected;
    this._connected = false;
    this._subscribed = false;
    this._connecting = null;
    this._failAllPending(new Error('connection closed'));
    if (wasConnected) this.emit('disconnect');

    if (this._closedByUser) return;
    // Reconnect with capped exponential backoff.
    const wait = this._backoff;
    this._backoff = Math.min(this._backoff * 2, 30000);
    const t = setTimeout(() => {
      if (this._closedByUser) return;
      this._ensureConnected()
        .then(() => this.subscribe())
        .catch(() => { /* will retry on next close */ });
    }, wait);
    if (t.unref) t.unref();
  }

  _failAllPending(err) {
    for (const [, p] of this._pending) {
      clearTimeout(p.timer);
      try { p.reject(err); } catch (_) { /* ignore */ }
    }
    this._pending.clear();
  }
}

function cleanHost(host) {
  let s = String(host).replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const v6 = s.match(/^\[(.+)\](?::\d+)?$/); // [::1] or [::1]:port
  if (v6) return v6[1];
  const m = s.match(/^([^:]+):\d+$/); // host:port
  if (m) return m[1];
  return s;
}

module.exports = { HyperionClient };
});

__def("controller", (module, exports) => {
const { EventEmitter } = require('events');
const { HyperionClient } = __req('client');
const { hsvToRgb, rgbToHsv, clamp, delay } = __req('util');

/**
 * HyperionController wraps a HyperionClient with a cached state model and a
 * clean, HAP-agnostic feature API. The accessory / platform layers call these
 * methods and listen for 'changed' to refresh HomeKit characteristics.
 */
class HyperionController extends EventEmitter {
  constructor(opts) {
    super();
    this.log = opts.log;
    this.priority = Number(opts.priority) || 50;
    this.origin = opts.origin || 'Homebridge';
    this.pollInterval = Math.max(0, Number(opts.pollInterval) || 10) * 1000;
    this.powerComponent = String(opts.powerComponent || 'ALL').toUpperCase();
    this.verbose = !!opts.verboseLog;
    // Behaviour toggles (default on):
    //  - enabling ambilight/capture clears our effect/color so the live feed
    //    (lower-priority capture) becomes visible again;
    //  - picking an effect/color or enabling capture powers the LEDs on so the
    //    result is never invisible.
    this.ambilightClearsEffect = opts.ambilightClearsEffect !== false;
    this.autoPowerOnAction = opts.autoPowerOnAction !== false;
    this.hideMusicEffects = opts.hideMusicEffects !== false; // hide HyperHDR "Music: ..." effects
    this.serverEffects = []; // effect names reported by the server

    // Write-pinning: after the user changes something, trust the value we just
    // wrote for a short window so a racing serverinfo refresh can't bounce the
    // HomeKit control back to its old state.
    this._pins = new Map(); // key -> { value, until }
    this._pinMs = 3500;
    this.connected = true; // reachability for HomeKit "No Response"

    this.client = new HyperionClient(opts);

    // Cached HomeKit-facing state.
    this.state = {
      power: false,         // component ALL enabled
      brightness: 100,      // adjustment.brightness 0-100
      hue: 0,               // 0-360
      saturation: 0,        // 0-100
      effectIndex: 0,       // index into effect list
      effectActive: false,  // an effect is currently running
      override: false,      // plugin is showing its own color/effect (feed hidden)
      feedShown: true,      // the live capture feed is visible
      components: {},       // { ALL:true, V4L:false, ... }
    };

    this.client.on('update', () => this.refresh().catch(() => {}));
    this.client.on('connect', () => {
      this.log.debug && this.log.debug('Connected to Hyperion');
      this._setConnected(true);
      this.refresh().catch(() => {});
    });
    this.client.on('disconnect', () => {
      this.log.warn && this.log.warn('Lost connection to Hyperion, retrying...');
      this._setConnected(false);
    });
    this.client.on('disconnect', () => this.log.warn && this.log.warn('Lost connection to Hyperion, retrying...'));
    this.client.on('error', (e) => this.log.debug && this.log.debug('Hyperion socket error:', e.message));

    this._poller = null;
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  async start() {
    try {
      await this.client.connect();
      await this.client.subscribe();
    } catch (e) {
      this.log.warn && this.log.warn(`Initial connect to Hyperion failed: ${e.message} (will keep retrying)`);
    }
    await this.refresh().catch(() => {});
    // Warn about configured effects the server doesn't actually have, so the
    // wheel never silently fails on a typo'd or missing effect name.
    if (this._configuredEffects && this._configuredEffects.length && this.serverEffects.length) {
      const missing = this._configuredEffects.filter(
        (n) => n && !['off', 'none'].includes(String(n).toLowerCase()) && !this.serverEffects.includes(n),
      );
      if (missing.length) {
        this.log.warn && this.log.warn(
          `Hyperion: these effects are not on the server and will not work: ${missing.join(', ')}. ` +
          `Available effects: ${this.serverEffects.join(', ')}`,
        );
      }
    }
    if (this.pollInterval > 0) {
      this._poller = setInterval(() => this.refresh().catch(() => {}), this.pollInterval);
      if (this._poller.unref) this._poller.unref();
    }
  }

  stop() {
    if (this._poller) clearInterval(this._poller);
    this.client.close();
  }

  /* ------------------------------------------------------------------ */
  /* State refresh                                                       */
  /* ------------------------------------------------------------------ */

  async refresh() {
    let res;
    try {
      res = await this.client.send({ command: 'serverinfo' });
    } catch (e) {
      this._setConnected(false);
      throw e;
    }
    this._setConnected(true);
    const info = res && res.info;
    if (!info) return this.state;

    const prev = JSON.stringify(this.state);

    // Components.
    const comps = {};
    for (const c of info.components || []) comps[c.name] = !!c.enabled;
    this.state.components = comps;

    // Power: prefer the configured power component, fall back to ALL / LEDDEVICE.
    if (this.powerComponent in comps) this.state.power = comps[this.powerComponent];
    else if ('ALL' in comps) this.state.power = comps.ALL;
    else if ('LEDDEVICE' in comps) this.state.power = comps.LEDDEVICE;

    // Brightness from the first adjustment block.
    if (Array.isArray(info.adjustment) && info.adjustment.length) {
      const b = info.adjustment[0].brightness;
      if (typeof b === 'number') this.state.brightness = clamp(b, 0, 100);
      if (info.adjustment[0].id) this._adjustmentId = info.adjustment[0].id;
    }

    // Remember the effects the server actually has (for validation / discovery).
    if (Array.isArray(info.effects)) {
      this.serverEffects = info.effects.map((e) => (e && e.name) || e).filter(Boolean);
    }

    // Active effect / active color from the priorities list.
    const active = (info.priorities || []).find((p) => p.visible) ||
                   (info.priorities || []).find((p) => p.active);
    this.state.effectActive = (info.activeEffects || []).length > 0;

    // Is the plugin currently overriding the live feed with our own color/effect?
    let manualColor = false;
    if (active) {
      if (active.componentId === 'COLOR' && active.value && Array.isArray(active.value.RGB)) {
        const hsv = rgbToHsv(active.value.RGB);
        this.state.hue = hsv.hue;
        this.state.saturation = hsv.saturation;
        manualColor = active.owner === this.origin || active.origin === this.origin || true;
      }
      if (active.componentId === 'EFFECT' && active.owner) {
        const idx = this.effectiveEffects().indexOf(active.owner);
        if (idx >= 0) this.state.effectIndex = idx;
      }
    }
    // override = we are showing our own color/effect (feed hidden); else feed shows.
    this.state.override = this.state.effectActive || manualColor;
    this.state.feedShown = !this.state.override;

    // Apply any recent user writes on top of the freshly-read state so HomeKit
    // controls don't visually bounce back before Hyperion has caught up.
    this._applyPins();

    if (JSON.stringify(this.state) !== prev) this.emit('changed', this.state);
    return this.state;
  }

  /* ---- write-pin helpers ---- */
  _pin(key, value) { this._pins.set(key, { value, until: Date.now() + this._pinMs }); }
  _applyPins() {
    const now = Date.now();
    for (const [key, p] of this._pins) {
      if (p.until < now) { this._pins.delete(key); continue; }
      if (key === 'power') this.state.power = p.value;
      else if (key === 'brightness') this.state.brightness = p.value;
      else if (key === 'hue') this.state.hue = p.value;
      else if (key === 'saturation') this.state.saturation = p.value;
      else if (key === 'effectActive') this.state.effectActive = p.value;
      else if (key === 'feedShown') { this.state.feedShown = p.value; this.state.override = !p.value; }
      else if (key === 'effectIndex') this.state.effectIndex = p.value;
      else if (key.startsWith('comp:')) this.state.components[key.slice(5)] = p.value;
    }
  }

  /** Provide the configured effect list (empty/undefined => auto from server). */
  setEffectList(effects) {
    this._configuredEffects = Array.isArray(effects) ? effects.filter(Boolean) : [];
  }

  _setConnected(v) {
    if (this.connected === v) return;
    this.connected = v;
    this.emit('reachability', v);
  }

  /** Briefly flash the LEDs white so the user can locate this accessory. */
  async identify() {
    try {
      await this._ensurePowered();
      for (let i = 0; i < 3; i++) {
        await this._cmd({ command: 'color', color: [255, 255, 255], priority: 1, origin: this.origin, duration: 0 });
        await delay(300);
        await this._cmd({ command: 'clear', priority: 1 });
        await delay(300);
      }
    } catch (_) { /* identify is best-effort */ }
  }

  /** Effects actually used: the user's configured list, else the server's list. */
  effectiveEffects() {
    if (this._configuredEffects && this._configuredEffects.length) return this._configuredEffects;
    let list = this.serverEffects || [];
    if (this.hideMusicEffects) {
      // Drop HyperHDR audio visualizers ("Music: ...") for a cleaner wheel.
      list = list.filter((n) => !/^\s*music\b/i.test(n) && !/music:/i.test(n));
    }
    return list;
  }

  /** Ambilight "feed" mode: show the live capture feed, or blank the strip. */
  async setFeed(on) {
    if (on) {
      await this._ensurePowered();
      await this.clearEffect(); // remove our color/effect so capture shows
      this.state.feedShown = true;
      this.state.override = false;
      this._pin('feedShown', true);
    } else {
      // Blank the LEDs without disabling the capture hardware.
      await this._cmd({
        command: 'color', color: [0, 0, 0], priority: this.priority, origin: this.origin, duration: 0,
      });
      this.state.feedShown = false;
      this.state.override = true;
      this.state.effectActive = false;
      this._pin('feedShown', false);
    }
    this.emit('changed', this.state);
  }

  getFeed() { return this.state.feedShown !== false && !this.state.override; }

  /* ------------------------------------------------------------------ */
  /* Feature handlers                                                    */
  /* ------------------------------------------------------------------ */

  async setPower(on) {
    if (on) {
      await this._componentState('LEDDEVICE', true).catch(() => {});
      await this._componentState(this.powerComponent, true).catch(() => {});
      if (this.powerComponent !== 'ALL') await this._componentState('ALL', true).catch(() => {});
    } else {
      await this._componentState(this.powerComponent, false).catch(() => {});
      if (this.powerComponent !== 'ALL') await this._componentState('ALL', false).catch(() => {});
      await this._componentState('LEDDEVICE', false).catch(() => {});
    }
    this.state.power = !!on;
    this._pin('power', !!on);
    this.emit('changed', this.state);
  }

  getPower() { return this.state.power; }

  async setBrightness(value) {
    const v = clamp(value, 0, 100);
    const adjustment = { brightness: v };
    // Target the active adjustment profile explicitly; some Hyperion/HyperHDR
    // setups ignore an untargeted adjustment, so brightness appeared to do nothing.
    if (this._adjustmentId) adjustment.id = this._adjustmentId;
    await this._cmd({ command: 'adjustment', adjustment });
    this.state.brightness = v;
    this._pin('brightness', v);
    this.emit('changed', this.state);
  }

  getBrightness() { return this.state.brightness; }

  async setHue(value) {
    this.state.hue = clamp(value, 0, 360);
    this._pin('hue', this.state.hue);
    await this._applyColor();
  }

  getHue() { return this.state.hue; }

  async setSaturation(value) {
    this.state.saturation = clamp(value, 0, 100);
    this._pin('saturation', this.state.saturation);
    await this._applyColor();
  }

  getSaturation() { return this.state.saturation; }

  /** Ensure the LEDs are actually outputting so an action is visible. */
  async _ensurePowered() {
    if (!this.autoPowerOnAction || this.state.power) return;
    await this._componentState('LEDDEVICE', true).catch(() => {});
    await this._componentState(this.powerComponent, true).catch(() => {});
    if (this.powerComponent !== 'ALL') await this._componentState('ALL', true).catch(() => {});
    this.state.power = true;
    this._pin('power', true);
  }

  /** Push the current hue/saturation to Hyperion as a solid color at our priority. */
  async _applyColor() {
    await this._ensurePowered();
    const rgb = hsvToRgb(this.state.hue, this.state.saturation, 100);
    await this._cmd({
      command: 'color',
      color: rgb,
      priority: this.priority,
      origin: this.origin,
      duration: 0,
    });
    this.state.effectActive = false;
    this.state.override = true;
    this.state.feedShown = false;
    this._pin('effectActive', false);
    this._pin('feedShown', false);
    this.emit('changed', this.state);
  }

  /** Ambilight / capture control mapped to one or more capture components. */
  async setCapture(components, on) {
    if (on) await this._ensurePowered();
    for (const comp of components) {
      await this._componentState(comp, !!on);
    }
    // Enabling capture: clear our effect/color so the (lower-priority) live feed
    // becomes visible again instead of being hidden behind a higher-priority effect.
    if (on && this.ambilightClearsEffect) {
      await this._cmd({ command: 'clear', priority: this.priority }).catch(() => {});
      this.state.effectActive = false;
      this._pin('effectActive', false);
    }
    this.emit('changed', this.state);
  }

  getCapture(components) {
    return components.some((c) => this.state.components[c]);
  }

  /**
   * Ambient mode: the switch ON disables the capture device (so the LEDs show
   * ambient lighting instead of following the TV); OFF re-enables capture.
   */
  async setAmbient(on, components) {
    const comps = components && components.length ? components : ['V4L'];
    for (const comp of comps) {
      await this._componentState(comp, !on); // on => capture OFF
    }
    this.emit('changed', this.state);
  }

  getAmbient(components) {
    const comps = components && components.length ? components : ['V4L'];
    // Ambient is active when the capture device(s) are disabled.
    return comps.every((c) => !this.state.components[c]);
  }

  async setEffectActive(on, effectList) {
    if (on) {
      await this.applyEffectByIndex(this.state.effectIndex, effectList);
    } else {
      await this.clearEffect();
    }
  }

  getEffectActive() { return this.state.effectActive; }

  /**
   * Television input identifiers: 0 = Off (clear), 1..N = effects[0..N-1].
   * This lets the Home app's input wheel both pick an effect and switch it off.
   */
  getEffectIdentifier() {
    return this.state.effectActive ? this.state.effectIndex + 1 : 0;
  }

  async setEffectIdentifier(identifier, effectList) {
    const id = Number(identifier) || 0;
    if (id <= 0) {
      await this.clearEffect();
    } else {
      await this.applyEffectByIndex(id - 1, effectList);
    }
  }

  async setEffectIndex(index, effectList) {
    await this.applyEffectByIndex(Math.max(0, Number(index) || 0), effectList);
  }

  getEffectIndex() { return this.state.effectIndex; }

  async clearEffect() {
    await this._cmd({ command: 'clear', priority: this.priority });
    this.state.effectActive = false;
    this.state.override = false;
    this.state.feedShown = true;
    this._pin('effectActive', false);
    this._pin('feedShown', true);
    this.emit('changed', this.state);
  }

  async applyEffectByIndex(index, effectList) {
    const list = effectList || this.effectiveEffects();
    const name = list[index];
    if (!name || String(name).toLowerCase() === 'none' || String(name).toLowerCase() === 'off') {
      await this.clearEffect();
      return;
    }
    await this._ensurePowered();
    await this._cmd({
      command: 'effect',
      effect: { name },
      priority: this.priority,
      origin: this.origin,
      duration: 0,
    });
    this.state.effectIndex = index;
    this.state.effectActive = true;
    this.state.override = true;
    this.state.feedShown = false;
    this._pin('effectIndex', index);
    this._pin('effectActive', true);
    this._pin('feedShown', false);
    this.emit('changed', this.state);
  }

  /** Generic component switch (SMOOTHING, BLACKBORDER, FORWARDER, ...). */
  async setComponent(name, on) {
    await this._componentState(name, !!on);
    this.emit('changed', this.state);
  }

  getComponent(name) { return !!this.state.components[name]; }

  /** Clear all priorities (lets the auto-selected source take over / blanks manual control). */
  async clearAll() {
    await this._cmd({ command: 'clearall' });
    this.state.effectActive = false;
    this.emit('changed', this.state);
  }

  /** Set Hyperion video mode: '2D' | '3DSBS' | '3DTAB'. */
  async setVideoMode(mode) {
    await this._cmd({ command: 'videomode', videoMode: mode });
  }

  /* ------------------------------------------------------------------ */
  /* Low-level helpers                                                   */
  /* ------------------------------------------------------------------ */

  async _componentState(component, state) {
    const res = await this._cmd({
      command: 'componentstate',
      componentstate: { component, state: !!state },
    });
    this.state.components[component] = !!state;
    this._pin(`comp:${component}`, !!state);
    return res;
  }

  async _cmd(command) {
    if (this.verbose) this.log.info && this.log.info(`Hyperion -> ${JSON.stringify(command)}`);
    const res = await this.client.send(command);
    if (this.verbose) {
      const ok = res && res.success !== false;
      this.log.info && this.log.info(`Hyperion <- ${command.command}: ${ok ? 'ok' : 'FAILED ' + (res && res.error || '')}`);
    }
    if (res && res.success === false) {
      const reason = res.error || 'unknown error';
      this.log.error && this.log.error(`Hyperion rejected ${command.command}: ${reason}`);
      throw new Error(reason);
    }
    return res;
  }
}

module.exports = { HyperionController };
});

__def("services", (module, exports) => {
const { DEFAULT_EFFECTS, COMPONENTS, SWITCHABLE_COMPONENTS } = __req('effects');
const { asBool } = __req('util');

/**
 * Parse a raw host string (which may be a bare IP, a hostname, or a full URL
 * with scheme/port/path) into a clean { host, port } pair. Handles IPv6 in
 * brackets. Returns port=undefined when none is embedded.
 */
function parseHostPort(raw) {
  let s = String(raw || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const v6 = s.match(/^\[(.+)\](?::(\d+))?$/); // [::1]:8090
  if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : undefined };
  const m = s.match(/^([^:]+):(\d+)$/); // host:port (IPv4 / hostname)
  if (m) return { host: m[1], port: Number(m[2]) };
  return { host: s || '127.0.0.1', port: undefined };
}


/**
 * Normalise a user config block, accepting BOTH the classic keys
 * (host/port/ambilightName/priority/autoupdate) and Hyperion.NG-style keys
 * (url/token), so existing installs keep working unchanged.
 */
function resolveConfig(config, log) {
  const expose = config.expose || {};
  const parsed = parseHostPort(config.host || config.url || '127.0.0.1');
  const host = parsed.host;
  const explicitPort = config.port !== undefined && config.port !== null && config.port !== ''
    ? Number(config.port) : undefined;
  let port = explicitPort !== undefined && !Number.isNaN(explicitPort)
    ? explicitPort : parsed.port;
  if (port === undefined || Number.isNaN(port)) port = 19444;

  // Effects: use the user's list if given, otherwise auto-discover from the
  // server at runtime (empty here means "auto").
  const effectsConfigured = Array.isArray(config.effects) && config.effects.length > 0;
  let effects = effectsConfigured ? config.effects.slice() : [];
  if (config.effect && effectsConfigured && effects.includes(config.effect)) {
    effects = [config.effect, ...effects.filter((e) => e !== config.effect)];
  }

  const resolved = {
    name: config.name || 'Hyperion',
    ambilightName: config.ambilightName || 'Ambilight',
    host,
    port,
    token: config.token || '',
    priority: config.priority !== undefined ? Number(config.priority) : 50,
    transport: (config.transport || 'auto').toLowerCase(),
    tls: asBool(config.tls, false),
    origin: config.origin || 'Homebridge',
    powerComponent: String(config.powerComponent || 'ALL').toUpperCase(),
    verboseLog: asBool(config.verboseLog, false),
    ambilightClearsEffect: asBool(config.ambilightClearsEffect, true),
    autoPowerOnAction: asBool(config.autoPowerOnAction, true),
    hideMusicEffects: asBool(config.hideMusicEffects, true),
    pollInterval: config.pollInterval !== undefined ? Number(config.pollInterval) : 10,
    effects,
    effectsConfigured,
    maxEffects: Number(config.maxEffects) || 64,
    ambilightTarget: (config.ambilightTarget || 'auto').toLowerCase(), // usb|screen|both|auto
    // Main light On/Off behaviour: 'ambient' (toggle ambient mode by disabling
    // the capture device) or 'power' (master ALL/LEDDEVICE power).
    // 'power'  = main light On/Off is master power (brightness 0% = off);
    // 'ambient' = main light toggles ambient mode (disables capture).
    mainMode: (config.mainMode || 'power').toLowerCase(),
    // 'leddevice' = Ambilight switch toggles the LED device on/off;
    // 'ambient' = disables the capture device; 'capture'/'feed' as named.
    ambilightMode: (config.ambilightMode || 'leddevice').toLowerCase(),
    // The effects-tile power button toggles the USB capture device (V4L).
    effectsPowerCapture: asBool(config.effectsPowerCapture, false),
    expose: {
      color: asBool(expose.color, true),
      ambilight: asBool(expose.ambilight, true),
      effects: asBool(expose.effects, true),
      componentSwitches: asBool(expose.componentSwitches, false),
      captureSwitches: asBool(expose.captureSwitches, false),
      usbCapture: asBool(expose.usbCapture, true),
      screenCapture: asBool(expose.screenCapture, false),
      audioCapture: asBool(expose.audioCapture, false),
      clearAllSwitch: asBool(expose.clearAllSwitch, false),
    },
  };
  return validateConfig(resolved, log);
}

/** Resolve which capture components the ambilight switch should toggle. */
function ambilightTargets(cfg, controller) {
  switch (cfg.ambilightTarget) {
    case 'usb': return ['V4L'];
    case 'screen': return ['GRABBER'];
    case 'both': return ['V4L', 'GRABBER'];
    case 'auto':
    default: {
      const present = Object.keys(controller.state.components || {})
        .filter((c) => c === 'V4L' || c === 'GRABBER');
      return present.length ? present : ['V4L'];
    }
  }
}

/**
 * Build and wire every HomeKit service onto an accessory.
 *
 * @param {object} ctx
 * @param {object} ctx.api          Homebridge API (for hap.Service / hap.Characteristic)
 * @param {object} ctx.controller   HyperionController
 * @param {object} ctx.cfg          resolved config (from resolveConfig)
 * @param {object} ctx.log          logger
 * @param {function} ctx.makeService (ServiceClass, displayName, subtype) => Service
 *                                  Creates/returns a service registered on the accessory.
 * @returns {object} handles to key services for live updates
 */
function wireServices(ctx) {
  const { api, controller, cfg, log, makeService } = ctx;
  const { Service, Characteristic } = api.hap;
  controller.setEffectList(cfg.effects);

  const handles = {};

  /* -------------------- Main lightbulb -------------------- */
  const light = makeService(Service.Lightbulb, cfg.name, 'main');
  handles.light = light;

  light.getCharacteristic(Characteristic.On)
    .onGet(async () => (cfg.mainMode === 'ambient'
      ? controller.getAmbient(ambilightTargets(cfg, controller))
      : controller.getPower()))
    .onSet(async (v) => (cfg.mainMode === 'ambient'
      ? controller.setAmbient(v, ambilightTargets(cfg, controller))
      : controller.setPower(v)));

  light.getCharacteristic(Characteristic.Brightness)
    .onGet(async () => controller.getBrightness())
    .onSet(async (v) => {
      await controller.setBrightness(v);
      // In power mode, behave like a normal dimmable light: 0% turns off, >0 turns on.
      if (cfg.mainMode === 'power') {
        if (v === 0 && controller.getPower()) await controller.setPower(false);
        else if (v > 0 && !controller.getPower()) await controller.setPower(true);
      }
    });

  if (cfg.expose.color) {
    light.getCharacteristic(Characteristic.Hue)
      .onGet(async () => controller.getHue())
      .onSet(async (v) => controller.setHue(v));
    light.getCharacteristic(Characteristic.Saturation)
      .onGet(async () => controller.getSaturation())
      .onSet(async (v) => controller.setSaturation(v));
  }

  /* -------------------- Ambilight switch -------------------- */
  if (cfg.expose.ambilight) {
    const ambi = makeService(Service.Switch, cfg.ambilightName, 'ambilight');
    handles.ambilight = ambi;
    setConfiguredName(Characteristic, ambi, cfg.ambilightName);
    if (cfg.ambilightMode === 'leddevice') {
      // Ambilight switch toggles only the LED device on/off.
      ambi.getCharacteristic(Characteristic.On)
        .onGet(async () => controller.getComponent('LEDDEVICE'))
        .onSet(async (v) => controller.setComponent('LEDDEVICE', v));
    } else if (cfg.ambilightMode === 'feed') {
      ambi.getCharacteristic(Characteristic.On)
        .onGet(async () => controller.getFeed())
        .onSet(async (v) => controller.setFeed(v));
    } else if (cfg.ambilightMode === 'ambient') {
      // ON = ambient mode (capture device disabled); OFF = follow the TV.
      ambi.getCharacteristic(Characteristic.On)
        .onGet(async () => controller.getAmbient(ambilightTargets(cfg, controller)))
        .onSet(async (v) => controller.setAmbient(v, ambilightTargets(cfg, controller)));
    } else {
      ambi.getCharacteristic(Characteristic.On)
        .onGet(async () => controller.getCapture(ambilightTargets(cfg, controller)))
        .onSet(async (v) => controller.setCapture(ambilightTargets(cfg, controller), v));
    }
  }

  /* -------------------- Capture switches (USB / Screen / Audio) -------------------- */
  // Build a de-duplicated set from the bundled flag and the granular flags so a
  // component is never exposed twice (which would create duplicate services).
  const captureSet = new Set();
  if (cfg.expose.captureSwitches) ['GRABBER', 'V4L', 'AUDIO'].forEach((c) => captureSet.add(c));
  if (cfg.expose.usbCapture) captureSet.add('V4L');
  if (cfg.expose.screenCapture) captureSet.add('GRABBER');
  if (cfg.expose.audioCapture) captureSet.add('AUDIO');

  if (captureSet.size) {
    handles.capture = {};
    for (const comp of captureSet) {
      const sw = makeService(Service.Switch, COMPONENTS[comp], `cap-${comp}`);
      setConfiguredName(Characteristic, sw, COMPONENTS[comp]);
      sw.getCharacteristic(Characteristic.On)
        .onGet(async () => controller.getComponent(comp))
        .onSet(async (v) => controller.setCapture([comp], v));
      handles.capture[comp] = sw;
    }
  }

  /* -------------------- Component switches -------------------- */
  if (cfg.expose.componentSwitches) {
    handles.components = {};
    for (const comp of SWITCHABLE_COMPONENTS) {
      const sw = makeService(Service.Switch, COMPONENTS[comp], `comp-${comp}`);
      setConfiguredName(Characteristic, sw, COMPONENTS[comp]);
      sw.getCharacteristic(Characteristic.On)
        .onGet(async () => controller.getComponent(comp))
        .onSet(async (v) => controller.setComponent(comp, v));
      handles.components[comp] = sw;
    }
  }

  /* -------------------- Clear-all switch (stateless momentary) -------------------- */
  if (cfg.expose.clearAllSwitch) {
    const clr = makeService(Service.Switch, `${cfg.name} Clear`, 'clearall');
    setConfiguredName(Characteristic, clr, `${cfg.name} Clear`);
    clr.getCharacteristic(Characteristic.On)
      .onGet(async () => false)
      .onSet(async (v) => {
        if (v) {
          await controller.clearAll();
          setTimeout(() => clr.updateCharacteristic(Characteristic.On, false), 400);
        }
      });
  }

  /* -------------------- Effects (Television input selector) -------------------- */
  if (cfg.expose.effects) {
    const tv = makeService(Service.Television, `${cfg.name} Effects`, 'effects');
    handles.effects = tv;
    tv.setCharacteristic(Characteristic.ConfiguredName, `${cfg.name} Effects`);
    tv.setCharacteristic(
      Characteristic.SleepDiscoveryMode,
      Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );

    // The effects-tile power button enables/disables the USB capture device (V4L).
    if (cfg.effectsPowerCapture) {
      tv.getCharacteristic(Characteristic.Active)
        .onGet(async () => (controller.getCapture(['V4L'])
          ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE))
        .onSet(async (v) => controller.setCapture(['V4L'], v === Characteristic.Active.ACTIVE));
    } else {
      // Keep the tile Active so the Home app always sends input-wheel changes.
      tv.getCharacteristic(Characteristic.Active)
        .onGet(async () => Characteristic.Active.ACTIVE)
        .onSet(async (v) => {
          if (v === Characteristic.Active.INACTIVE) {
            await controller.clearEffect();
            setTimeout(() => tv.updateCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE), 200);
          }
        });
    }

    tv.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(async () => controller.getEffectIdentifier())
      .onSet(async (v) => controller.setEffectIdentifier(v, controller.effectiveEffects()));

    tv.getCharacteristic(Characteristic.RemoteKey).onSet(async () => {});

    // Pool of input slots. Configured effects size it exactly; for auto-discovery
    // we size from the persisted discovered count (grow-only) so it converges to
    // the server without churning HomeKit inputs.
    const poolSize = cfg.effectsConfigured
      ? cfg.effects.length
      : Math.max(40, Math.min(cfg.maxEffects, (cfg.effectPoolSize || 0) + 6));
    handles.effectInputs = [];

    const makeInput = (identifier, label, subtype, shown) => {
      const input = makeService(Service.InputSource, `effect_${identifier}`, subtype);
      input
        .setCharacteristic(Characteristic.Identifier, identifier)
        .setCharacteristic(Characteristic.Name, label)
        .setCharacteristic(Characteristic.ConfiguredName, label)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER)
        .setCharacteristic(
          Characteristic.CurrentVisibilityState,
          shown ? Characteristic.CurrentVisibilityState.SHOWN
                : Characteristic.CurrentVisibilityState.HIDDEN,
        );
      tv.addLinkedService(input);
      return input;
    };

    makeInput(0, 'Off', 'effect-off', true);
    for (let i = 1; i <= poolSize; i++) {
      const initial = cfg.effects[i - 1] || `Effect ${i}`;
      handles.effectInputs.push(makeInput(i, initial, `effect-${i - 1}`, !!cfg.effects[i - 1]));
    }

    // Populate / refresh the visible effect names from the controller.
    handles.syncEffects = () => {
      const names = controller.effectiveEffects();
      for (let i = 0; i < handles.effectInputs.length; i++) {
        const input = handles.effectInputs[i];
        const name = names[i];
        if (name) {
          input.updateCharacteristic(Characteristic.ConfiguredName, name);
          input.updateCharacteristic(
            Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN,
          );
        } else {
          input.updateCharacteristic(
            Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.HIDDEN,
          );
        }
      }
    };
    handles.syncEffects();
  }

  /* -------------------- Live updates -> HomeKit -------------------- */
  controller.on('changed', (state) => {
    try {
      const mainOn = cfg.mainMode === 'ambient'
        ? controller.getAmbient(ambilightTargets(cfg, controller))
        : controller.getPower();
      light.updateCharacteristic(Characteristic.On, mainOn);
      light.updateCharacteristic(Characteristic.Brightness, state.brightness);
      if (cfg.expose.color) {
        light.updateCharacteristic(Characteristic.Hue, state.hue);
        light.updateCharacteristic(Characteristic.Saturation, state.saturation);
      }
      if (handles.ambilight) {
        let ambiOn;
        if (cfg.ambilightMode === 'leddevice') ambiOn = controller.getComponent('LEDDEVICE');
        else if (cfg.ambilightMode === 'feed') ambiOn = controller.getFeed();
        else if (cfg.ambilightMode === 'ambient') ambiOn = controller.getAmbient(ambilightTargets(cfg, controller));
        else ambiOn = controller.getCapture(ambilightTargets(cfg, controller));
        handles.ambilight.updateCharacteristic(Characteristic.On, ambiOn);
      }
      if (handles.effects) {
        if (handles.syncEffects) handles.syncEffects();
        const tvActive = cfg.effectsPowerCapture
          ? (controller.getCapture(['V4L']) ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
          : Characteristic.Active.ACTIVE;
        handles.effects.updateCharacteristic(Characteristic.Active, tvActive);
        handles.effects.updateCharacteristic(
          Characteristic.ActiveIdentifier, controller.getEffectIdentifier(),
        );
      }
      if (handles.components) {
        for (const [comp, sw] of Object.entries(handles.components)) {
          sw.updateCharacteristic(Characteristic.On, controller.getComponent(comp));
        }
      }
      if (handles.capture) {
        for (const [comp, sw] of Object.entries(handles.capture)) {
          sw.updateCharacteristic(Characteristic.On, controller.getComponent(comp));
        }
      }
    } catch (e) {
      log.debug && log.debug('characteristic update skipped:', e.message);
    }
  });

  /* -------------------- Reachability ("No Response") -------------------- */
  controller.on('reachability', (connected) => {
    try {
      if (!connected) {
        const err = new Error('Hyperion not reachable');
        light.updateCharacteristic(Characteristic.On, err);
        light.updateCharacteristic(Characteristic.Brightness, err);
        if (handles.ambilight) handles.ambilight.updateCharacteristic(Characteristic.On, err);
        if (handles.effects) handles.effects.updateCharacteristic(Characteristic.Active, err);
      } else {
        controller.refresh().catch(() => {});
      }
    } catch (_) { /* ignore */ }
  });

  return handles;
}

function setConfiguredName(Characteristic, service, name) {
  try {
    service.addOptionalCharacteristic(Characteristic.ConfiguredName);
    service.setCharacteristic(Characteristic.ConfiguredName, name);
  } catch (_) { /* some HAP versions add it automatically */ }
}

/**
 * Validate a resolved config and apply safe corrections, logging clear messages
 * so misconfiguration is obvious at startup instead of failing later at connect.
 * Mutates and returns cfg. `log` is the Homebridge logger.
 */
function validateConfig(cfg, log) {
  const warn = (m) => { try { (log && log.warn ? log.warn : console.warn)(`[hyperion-v2] ${m}`); } catch (_) { /* noop */ } };
  const err = (m) => { try { (log && log.error ? log.error : console.error)(`[hyperion-v2] ${m}`); } catch (_) { /* noop */ } };

  if (!cfg.host) {
    err('No "host" configured — set it to your Hyperion/HyperHDR IP or hostname (e.g. 192.168.1.50). The accessory cannot connect until this is fixed.');
  }
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    const fallback = cfg.transport === 'http' ? 8090 : 19444;
    warn(`Invalid port "${cfg.port}"; using ${fallback}. Use 19444 for the JSON/TCP API or 8090 for HTTP.`);
    cfg.port = fallback;
  }
  if (!['auto', 'tcp', 'http'].includes(cfg.transport)) {
    warn(`Unknown transport "${cfg.transport}"; using "auto".`);
    cfg.transport = 'auto';
  }
  if (!Number.isFinite(cfg.priority) || cfg.priority < 2 || cfg.priority > 253) {
    warn(`Priority "${cfg.priority}" is out of range (2–253); using 100. Lower numbers win; capture usually sits at 240.`);
    cfg.priority = 100;
  }
  if (!Number.isFinite(cfg.pollInterval) || cfg.pollInterval < 0) {
    warn(`Invalid pollInterval "${cfg.pollInterval}"; using 10 seconds.`);
    cfg.pollInterval = 10;
  }
  if (!['ambient', 'power'].includes(cfg.mainMode)) {
    warn(`Unknown mainMode "${cfg.mainMode}"; using "power".`);
    cfg.mainMode = 'power';
  }
  if (!['leddevice', 'ambient', 'capture', 'feed'].includes(cfg.ambilightMode)) {
    warn(`Unknown ambilightMode "${cfg.ambilightMode}"; using "leddevice".`);
    cfg.ambilightMode = 'leddevice';
  }
  if (!Number.isInteger(cfg.maxEffects) || cfg.maxEffects < 1) {
    warn(`Invalid maxEffects "${cfg.maxEffects}"; using 64.`);
    cfg.maxEffects = 64;
  }
  return cfg;
}

module.exports = {
  resolveConfig, validateConfig, wireServices, ambilightTargets,
};
});

__def("accessory", (module, exports) => {
const { HyperionController } = __req('controller');
const { resolveConfig, wireServices } = __req('services');
const persist = __req('persist');

/**
 * Classic Homebridge AccessoryPlugin registered as "Hyperion".
 * This is the drop-in path: an existing { "accessory": "Hyperion", ... } block
 * continues to work, now with the full feature set.
 */
function makeHyperionAccessory(api) {
  const { Service, Characteristic } = api.hap;
  const storagePath = api.user && api.user.storagePath ? api.user.storagePath() : null;

  return class HyperionAccessory {
    constructor(log, config) {
      this.log = log;
      this.cfg = resolveConfig(config || {}, log);
      this.services = [];

      // Size the effects wheel from the last discovered count (grow-only).
      this._persistKey = `${this.cfg.host}_${this.cfg.port}`.replace(/[^\w.-]/g, '_');
      this.cfg.effectPoolSize = persist.readCount(storagePath, this._persistKey);

      this.controller = new HyperionController({
        host: this.cfg.host,
        port: this.cfg.port,
        token: this.cfg.token,
        transport: this.cfg.transport,
        tls: this.cfg.tls,
        priority: this.cfg.priority,
        origin: this.cfg.origin,
        powerComponent: this.cfg.powerComponent,
        verboseLog: this.cfg.verboseLog,
        ambilightClearsEffect: this.cfg.ambilightClearsEffect,
        autoPowerOnAction: this.cfg.autoPowerOnAction,
        hideMusicEffects: this.cfg.hideMusicEffects,
        pollInterval: this.cfg.pollInterval,
        log,
      });

      // Persist the discovered effect count so the wheel converges next launch.
      this.controller.on('changed', () => {
        persist.writeCount(storagePath, this._persistKey, this.controller.effectiveEffects().length);
      });

      // Accessory information.
      const info = new Service.AccessoryInformation();
      info
        .setCharacteristic(Characteristic.Manufacturer, 'Hyperion')
        .setCharacteristic(Characteristic.Model, 'Hyperion v2')
        .setCharacteristic(Characteristic.SerialNumber, `${this.cfg.host}:${this.cfg.port}`)
        .setCharacteristic(Characteristic.FirmwareRevision, '1.1.0');
      info.getCharacteristic(Characteristic.Identify).onSet(() => this.controller.identify());
      this.services.push(info);

      const makeService = (ServiceClass, displayName, subtype) => {
        const svc = new ServiceClass(displayName, subtype);
        this.services.push(svc);
        return svc;
      };

      wireServices({ api, controller: this.controller, cfg: this.cfg, log, makeService });

      this.controller.start().catch((e) => log.error(`Hyperion start failed: ${e.message}`));

      // Graceful shutdown.
      api.on('shutdown', () => this.controller.stop());

      log.info(`Hyperion accessory "${this.cfg.name}" -> ${this.cfg.host}:${this.cfg.port} ` +
               `(${this.controller.client.transport.toUpperCase()}, priority ${this.cfg.priority})`);
    }

    identify() {
      this.controller.identify();
    }

    getServices() {
      return this.services;
    }
  };
}

module.exports = { makeHyperionAccessory };
});

__def("platform", (module, exports) => {
const { HyperionController } = __req('controller');
const { HyperionClient } = __req('client');
const { resolveConfig, wireServices } = __req('services');
const { PLUGIN_NAME, PLATFORM_NAME } = __req('settings');
const { asBool } = __req('util');
const persist = __req('persist');

/**
 * Dynamic platform registered as "HyperionV2".
 * Connects to Hyperion, enumerates instances, and exposes one fully-featured
 * accessory per running instance (or a single accessory if multiInstance=false).
 */
function makePlatform(api) {
  return class HyperionPlatform {
    constructor(log, config) {
      this.log = log;
      this.api = api;
      this.config = config || {};
      this.cfg = resolveConfig(this.config, log);
      this.multiInstance = asBool(this.config.multiInstance, true);
      this.cachedAccessories = new Map(); // uuid -> PlatformAccessory
      this.controllers = [];

      if (!this.config.host && !this.config.url) {
        this.log.error('HyperionV2: missing required "host" (or "url"). Platform disabled.');
        return;
      }

      this.api.on('didFinishLaunching', () => this.discover().catch((e) =>
        this.log.error(`Discovery failed: ${e.message}`)));
      this.api.on('shutdown', () => this.controllers.forEach((c) => c.stop()));
    }

    configureAccessory(accessory) {
      this.log.debug(`Restoring cached accessory: ${accessory.displayName}`);
      this.cachedAccessories.set(accessory.UUID, accessory);
    }

    async discover() {
      let instances = [{ instance: undefined, friendly_name: this.cfg.name }];

      if (this.multiInstance) {
        try {
          const probe = new HyperionClient({
            host: this.cfg.host, port: this.cfg.port, token: this.cfg.token,
            transport: this.cfg.transport, tls: this.cfg.tls, log: this.log,
          });
          const res = await probe.send({ command: 'serverinfo' });
          probe.close();
          const list = (res && res.info && res.info.instance) || [];
          const running = list.filter((i) => i.running);
          if (running.length) {
            instances = running.map((i) => ({
              instance: i.instance,
              friendly_name: i.friendly_name || `${this.cfg.name} ${i.instance}`,
            }));
          }
        } catch (e) {
          this.log.warn(`Could not enumerate instances (${e.message}); using single accessory.`);
        }
      }

      const seen = new Set();
      for (const inst of instances) {
        const uuid = this.api.hap.uuid.generate(
          `hyperion:${this.cfg.host}:${this.cfg.port}:${inst.instance ?? 'single'}`,
        );
        seen.add(uuid);
        this.setupAccessory(uuid, inst);
      }

      // Remove accessories for instances that no longer exist.
      for (const [uuid, acc] of this.cachedAccessories) {
        if (!seen.has(uuid)) {
          this.log.info(`Removing stale accessory: ${acc.displayName}`);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
          this.cachedAccessories.delete(uuid);
        }
      }
    }

    setupAccessory(uuid, inst) {
      const { Service, Characteristic } = this.api.hap;
      const displayName = inst.friendly_name;

      let accessory = this.cachedAccessories.get(uuid);
      let isNew = false;
      if (!accessory) {
        accessory = new this.api.platformAccessory(displayName, uuid);
        isNew = true;
      }
      accessory.displayName = displayName;

      const info = accessory.getService(Service.AccessoryInformation)
        || accessory.addService(Service.AccessoryInformation);
      info
        .setCharacteristic(Characteristic.Manufacturer, 'Hyperion')
        .setCharacteristic(Characteristic.Model, 'Hyperion v2')
        .setCharacteristic(Characteristic.SerialNumber, `${this.cfg.host}:${this.cfg.port}:${inst.instance ?? 0}`)
        .setCharacteristic(Characteristic.FirmwareRevision, '1.1.0');

      const storagePath = this.api.user && this.api.user.storagePath ? this.api.user.storagePath() : null;
      const persistKey = `${this.cfg.host}_${this.cfg.port}_${inst.instance ?? 0}`.replace(/[^\w.-]/g, '_');

      const controller = new HyperionController({
        host: this.cfg.host, port: this.cfg.port, token: this.cfg.token,
        transport: this.cfg.transport, tls: this.cfg.tls, instance: inst.instance,
        priority: this.cfg.priority, origin: this.cfg.origin, pollInterval: this.cfg.pollInterval,
        powerComponent: this.cfg.powerComponent,
        verboseLog: this.cfg.verboseLog,
        ambilightClearsEffect: this.cfg.ambilightClearsEffect, autoPowerOnAction: this.cfg.autoPowerOnAction,
        hideMusicEffects: this.cfg.hideMusicEffects,
        log: this.log,
      });
      this.controllers.push(controller);
      controller.on('changed', () => persist.writeCount(storagePath, persistKey, controller.effectiveEffects().length));
      accessory.on('identify', () => controller.identify());

      const instCfg = Object.assign({}, this.cfg, {
        name: displayName,
        effectPoolSize: persist.readCount(storagePath, persistKey),
      });
      const makeService = (ServiceClass, name, subtype) => {
        let svc = subtype
          ? accessory.getServiceById(ServiceClass.UUID, subtype)
          : accessory.getService(ServiceClass);
        if (!svc) svc = accessory.addService(ServiceClass, name, subtype);
        return svc;
      };

      wireServices({ api: this.api, controller, cfg: instCfg, log: this.log, makeService });
      controller.start().catch((e) => this.log.error(`Start failed for ${displayName}: ${e.message}`));

      if (isNew) {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.set(uuid, accessory);
      }

      this.log.info(`Hyperion instance "${displayName}" -> ${this.cfg.host}:${this.cfg.port}` +
        (inst.instance !== undefined ? ` [instance ${inst.instance}]` : ''));
    }
  };
}

module.exports = { makePlatform };
});

const { ACCESSORY_NAME, PLATFORM_NAME } = __req('settings');
const { makeHyperionAccessory } = __req('accessory');
const { makePlatform } = __req('platform');

module.exports = (api) => {
  api.registerAccessory(ACCESSORY_NAME, makeHyperionAccessory(api));
  api.registerPlatform(PLATFORM_NAME, makePlatform(api));
};
