'use strict';

// Self-contained smoke test for the shipped single-file bundle (index.js).
// No external dependencies; mocks HAP and a Hyperion TCP server in-process.
// Run with: node test.js   (also used by .github/workflows/test.yml)

const net = require('net');
const crypto = require('crypto');
const assert = require('assert');

let passed = 0;
const ok = (m) => { passed += 1; console.log(`  \u2713 ${m}`); };

/* ---------------- minimal mock HAP ---------------- */
function mk(n, c) { const C = class {}; C.charName = n; Object.assign(C, c || {}); return C; }
const Characteristic = {
  On: mk('On'), Brightness: mk('Brightness'), Hue: mk('Hue'), Saturation: mk('Saturation'),
  Manufacturer: mk('Manufacturer'), Model: mk('Model'), SerialNumber: mk('SerialNumber'),
  FirmwareRevision: mk('FirmwareRevision'), Identify: mk('Identify'),
  ConfiguredName: mk('ConfiguredName'), Name: mk('Name'), Identifier: mk('Identifier'),
  ActiveIdentifier: mk('ActiveIdentifier'), RemoteKey: mk('RemoteKey'),
  Active: mk('Active', { ACTIVE: 1, INACTIVE: 0 }), IsConfigured: mk('IsConfigured', { CONFIGURED: 1 }),
  InputSourceType: mk('InputSourceType', { OTHER: 0 }),
  CurrentVisibilityState: mk('CurrentVisibilityState', { SHOWN: 0, HIDDEN: 1 }),
  SleepDiscoveryMode: mk('SleepDiscoveryMode', { ALWAYS_DISCOVERABLE: 1 }),
};
class CS { constructor(t) { this.type = t; this._onSet = null; this.value = null; }
  onGet() { return this; } onSet(f) { this._onSet = f; return this; }
  updateValue(v) { this.value = v; return this; } }
class SB { constructor(n, s) { this.displayName = n; this.subtype = s; this.c = new Map(); }
  getCharacteristic(t) { if (!this.c.has(t)) this.c.set(t, new CS(t)); return this.c.get(t); }
  setCharacteristic() { return this; }
  updateCharacteristic(t, v) { this.getCharacteristic(t).value = v; return this; }
  addCharacteristic(t) { return this.getCharacteristic(t); }
  addOptionalCharacteristic() { return this; } addLinkedService() { return this; } }
function sc(n) { const C = class extends SB {}; C.UUID = n; return C; }
const Service = {
  AccessoryInformation: sc('AccessoryInformation'), Lightbulb: sc('Lightbulb'),
  Switch: sc('Switch'), Television: sc('Television'), InputSource: sc('InputSource'),
};
const api = {
  hap: { Service, Characteristic, uuid: { generate: (s) => crypto.createHash('md5').update(s).digest('hex') } },
  on: () => {}, registerAccessory: (n, c) => { api._acc = c; }, registerPlatform: (n, c) => { api._plat = c; },
};
const warnings = [];
const log = { info() {}, warn(m) { warnings.push(m); }, error() {}, debug() {} };

/* ---------------- fake Hyperion TCP server ---------------- */
const recv = [];
const server = net.createServer((s) => {
  let b = '';
  s.on('data', (d) => {
    b += d;
    let i;
    while ((i = b.indexOf('\n')) >= 0) {
      const l = b.slice(0, i); b = b.slice(i + 1);
      if (!l.trim()) continue;
      const cmd = JSON.parse(l); recv.push(cmd);
      const r = { command: cmd.command, success: true, tan: cmd.tan };
      if (cmd.command === 'serverinfo') {
        r.info = {
          components: [{ name: 'ALL', enabled: true }, { name: 'V4L', enabled: true }, { name: 'LEDDEVICE', enabled: true }],
          adjustment: [{ brightness: 75 }],
          effects: [{ name: 'Rainbow swirl' }, { name: 'Candle' }, { name: 'Music: pulse' }],
          activeEffects: [], priorities: [], instance: [{ instance: 0, running: true, friendly_name: 'X' }],
        };
      }
      s.write(JSON.stringify(r) + '\n');
    }
  });
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const plugin = require('./index.js');
  assert.strictEqual(typeof plugin, 'function', 'exports a function');
  plugin(api);
  assert.ok(api._acc && api._plat, 'registered accessory + platform');
  ok('bundle loads & registers accessory + platform');

  const Acc = api._acc;
  const acc = new Acc(log, { accessory: 'Hyperion', name: 'TV', ambilightName: 'Ambi', priority: 100, host: '127.0.0.1', port });
  const svcs = acc.getServices();
  const names = svcs.map((s) => s.constructor.UUID);
  assert.ok(names.includes('Lightbulb') && names.includes('Television'), 'has core services');
  ok(`builds ${svcs.length} services from bundle`);

  await new Promise((r) => setTimeout(r, 80)); // let it connect & refresh

  const light = svcs.find((s) => s.constructor.UUID === 'Lightbulb');
  await light.getCharacteristic(Characteristic.Brightness)._onSet(33);
  await new Promise((r) => setTimeout(r, 60));
  const adj = [...recv].reverse().find((c) => c.command === 'adjustment');
  assert.ok(adj && adj.adjustment.brightness === 33, 'brightness reached Hyperion');
  ok('control commands reach Hyperion (brightness=33)');

  // main light (power mode) ON = master power; brightness 0% turns it off
  recv.length = 0;
  await light.getCharacteristic(Characteristic.On)._onSet(true);
  await new Promise((r) => setTimeout(r, 60));
  const allOn = [...recv].reverse().find((c) => c.command === 'componentstate' && c.componentstate.component === 'ALL');
  assert.ok(allOn && allOn.componentstate.state === true, 'main light ON = master power');
  recv.length = 0;
  await light.getCharacteristic(Characteristic.Brightness)._onSet(0);
  await new Promise((r) => setTimeout(r, 60));
  const allOff = [...recv].reverse().find((c) => c.command === 'componentstate' && c.componentstate.component === 'ALL');
  assert.ok(allOff && allOff.componentstate.state === false, 'brightness 0% powers off');
  ok('brightness slider at 0% turns the light off');

  // Television power button toggles USB capture (V4L)
  const tv = svcs.find((s) => s.constructor.UUID === 'Television');
  recv.length = 0;
  await tv.getCharacteristic(Characteristic.Active)._onSet(Characteristic.Active.ACTIVE);
  await new Promise((r) => setTimeout(r, 60));
  const v4lOn = [...recv].reverse().find((c) => c.command === 'componentstate' && c.componentstate.component === 'V4L');
  assert.ok(v4lOn && v4lOn.componentstate.state === true, 'TV power enables V4L');
  ok('effects-tile power button controls USB capture (V4L)');

  // ambilight switch toggles the LED device
  const ambi = svcs.find((s) => s.subtype === 'ambilight');
  recv.length = 0;
  await ambi.getCharacteristic(Characteristic.On)._onSet(true);
  await new Promise((r) => setTimeout(r, 60));
  const led = [...recv].reverse().find((c) => c.command === 'componentstate' && c.componentstate.component === 'LEDDEVICE');
  assert.ok(led && led.componentstate.state === true, 'ambilight toggles LED device');
  ok('ambilight switch controls the LED device');

  // effects auto-discovered (music hidden)
  const eff = acc.controller.effectiveEffects();
  assert.ok(eff.includes('Rainbow swirl') && !eff.some((n) => /music/i.test(n)), 'music effects hidden');
  ok('effects auto-discovered from server (music hidden)');

  // identify flashes
  recv.length = 0;
  await acc.controller.identify();
  assert.ok(recv.some((c) => c.command === 'color' && c.color && c.color[0] === 255), 'identify flashed');
  ok('identify flashes the LEDs');

  // reachability event
  let reach = null;
  acc.controller.on('reachability', (v) => { reach = v; });
  acc.controller._setConnected(false);
  assert.strictEqual(reach, false, 'reachability false emitted');
  ok('reachability drives No Response');

  // config validation fallbacks
  const bad = new Acc(log, { accessory: 'Hyperion', name: 'B', host: '127.0.0.1', port, priority: 999, transport: 'nope', maxEffects: 0 });
  assert.strictEqual(bad.cfg.priority, 100, 'bad priority -> 100');
  assert.strictEqual(bad.cfg.transport, 'auto', 'bad transport -> auto');
  assert.strictEqual(bad.cfg.maxEffects, 64, 'bad maxEffects -> 64');
  assert.ok(warnings.length >= 2, "friendly warnings logged");
  ok('config validation falls back with friendly warnings');
  bad.controller.stop();

  acc.controller.stop(); server.close();
  console.log(`\nAll ${passed} bundle checks passed.`);
  process.exit(0);
});

setTimeout(() => { console.error('timeout'); process.exit(1); }, 8000);
