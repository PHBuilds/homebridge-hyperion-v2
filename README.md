# homebridge-hyperion-v2

A full-featured [Homebridge](https://homebridge.io) plugin for **Hyperion** and
**Hyperion.NG**. It exposes essentially everything HomeKit can usefully control:
power, brightness, full color (hue/saturation), ambilight / screen capture, the
complete effects list, individual Hyperion components, multi-instance setups,
and more.

It is a **drop-in replacement** for the classic `homebridge-hyperion` accessory:
your existing `"accessory": "Hyperion"` config keeps working unchanged.

- **Configurable entirely in the Homebridge UI** (no manual JSON required)
- **Single file** — ships as one `index.js`, nothing else to install
- **Zero runtime dependencies** — uses only Node's built-in `net`/`http`

---

## Installation

### Homebridge UI (recommended)
1. In the Homebridge UI go to **Plugins** and search for **Hyperion v2**, or
   install from your GitHub repo:
   **Plugins -> (menu) -> Install from GitHub URL**.
2. Open the plugin's **Settings** to configure it (see below).

### Command line
```bash
npm install --prefix /var/lib/homebridge https://github.com/phbuilds/homebridge-hyperion-v2
sudo hb-service restart
```

---

## Configuration via the UI

After installing, click **Settings** on the plugin tile. Every option is exposed
as a form field: host, port, transport, priority, ambilight, the effects list,
and toggles for each exposed service. Nothing needs to be hand-edited.

The settings form edits a classic accessory block, so it stays compatible with
the original plugin.

## Drop-in migration (keep your current config)

If you already run the classic plugin, you don't need to change anything:

```json
{
  "accessory": "Hyperion",
  "name": "Hyperion TV Backlight",
  "ambilightName": "Hyperion TV Ambilight",
  "priority": 100,
  "host": "192.168.50.151",
  "port": "19444"
}
```

Because `port` is `19444`, the plugin automatically uses the TCP JSON socket
transport. You immediately gain color control, the effects selector, live state
sync and auto-reconnect on top of what you had.

See `sample-config.json` for a complete annotated example (accessory and
platform).

---

## Options

| Key | Default | Notes |
|---|---|---|
| `host` (or `url`) | - | **Required.** IP/hostname of Hyperion. |
| `port` | `19444` | `19444` = TCP JSON socket, `8090` = NG HTTP server. |
| `transport` | `auto` | `auto` picks HTTP for 8090, TCP otherwise. Force with `tcp`/`http`. |
| `token` | `""` | Only if Hyperion API auth is enabled. |
| `priority` | `100` | Hyperion priority for color/effect/clear. Lower = higher priority. |
| `name` | `Hyperion` | Main light name. |
| `ambilightName` | `Ambilight` | Ambilight switch name. |
| `ambilightTarget` | `auto` | `auto` / `usb` (V4L) / `screen` (GRABBER) / `both`. |
| `pollInterval` | `10` | Seconds between state refreshes. `0` disables polling. |
| `effects` | auto | Leave empty to auto-discover from the server (recommended). Set a list to override. |
| `ambilightMode` | `ambient` | `ambient` = switch ON disables the capture device for ambient lighting (default); `capture` = toggle the capture device; `feed` = show/blank the picture. |
| `maxEffects` | `64` | Upper cap for the auto-sized effects wheel. |
| `hideMusicEffects` | `true` | Hide HyperHDR audio visualizers ("Music: ...") for a cleaner wheel. |
| `expose.color` | `true` | Hue/Saturation on the main light. |
| `expose.ambilight` | `true` | Ambilight switch. |
| `expose.effects` | `true` | Effects selector (Television tile). |
| `expose.usbCapture` | `false` | Optional extra dedicated USB capture (V4L) switch. |
| `expose.screenCapture` | `false` | Screen capture (GRABBER) switch. |
| `expose.audioCapture` | `false` | Audio capture switch. |
| `expose.captureSwitches` | `false` | All three capture switches at once. |
| `expose.componentSwitches` | `false` | Smoothing, Blackbar, Forwarder, Boblight, LED device. |
| `expose.clearAllSwitch` | `false` | Momentary clear-all button. |
| `origin` | `Homebridge` | Label shown in Hyperion's priority list. |
| `mainMode` | `power` | Main light: `power` (master, 0%=off) or `ambient` (disable capture). |
| `ambilightMode` | `leddevice` | Ambilight switch: `leddevice` / `ambient` / `capture` / `feed`. |
| `effectsPowerCapture` | `true` | Effects-tile power button toggles the USB capture device (V4L). |
| `verboseLog` | `false` | Log every command + result to the main log (troubleshooting). |
| `ambilightClearsEffect` | `true` | Enabling ambilight/capture clears the running effect so the live feed shows. |
| `autoPowerOnAction` | `true` | Picking an effect/color or enabling capture powers the LEDs on. |
| `tls` | `false` | Use HTTPS for the HTTP transport. |

### What the services do

- **Lightbulb** - On/Off maps to Hyperion's `ALL` component. Brightness maps to
  `adjustment.brightness`. Hue/Saturation send a solid `color` at your priority.
- **Ambilight switch** - enables/disables the **LED device** (`leddevice` mode).
  (Other modes: `ambient`, `capture`, `feed`.)
- **USB capture switch** - off by default; a dedicated V4L switch you can
  re-enable with `expose.usbCapture: true`.
- **Effects** - a Television tile; its **power button toggles the USB capture
  device (V4L)**, and its wheel is **auto-populated from your server's effects**. HyperHDR's "Music: ..." audio visualizers are hidden
  by default for a cleaner Hyperion.NG-style list. The first entry is Off.
- **Component / capture switches** *(optional)* - direct on/off for individual
  Hyperion components.
- **Clear-all button** *(optional)* - runs `clearall`.

---

## Multi-instance mode (platform)

To get one HomeKit accessory per running Hyperion.NG instance, use the platform
block from `sample-config.json` (alias `HyperionV2`). Each instance gets its own
connection. Multi-instance works best over TCP.

---

## Transports

- **TCP JSON socket (19444)** - persistent connection, live push updates so
  HomeKit reflects changes from the web UI/remotes instantly, auto-reconnect.
- **HTTP (8090)** - stateless POSTs to `/json-rpc`; relies on `pollInterval` for
  sync; supports token auth and optional HTTPS.

---


## HyperHDR & WLED

HyperHDR is supported (it shares Hyperion's JSON API). With network LED devices
like **WLED** that hold their last frame, turning the light **off** also disables
the `LEDDEVICE` component so the strip actually goes dark. If your setup prefers
a different behaviour, set `powerComponent` to `LEDDEVICE`.

## Troubleshooting

- **A switch flips back after tapping:** fixed by built-in write-pinning. If it
  persists, enable `verboseLog` and check the log for a rejected command.
- **Return to USB capture from an effect:** turn on the Ambilight/USB Capture
  switch (it clears the effect so the live feed shows), or pick **Off** on the wheel.
- **Wrong effects in the wheel:** leave `effects` empty so the plugin discovers
  your server's real effects automatically. The wheel is kept Active so the Home
  app sends selections; the first entry is **Off**.
- **USB Capture mirrors Ambilight:** with `ambilightMode: feed` (default) the
  Ambilight switch shows/blanks the picture and the USB switch toggles the
  capture device, so they no longer mirror.
- **Nothing responds:** confirm `host`/`port` and `transport`. Port 19444 = TCP,
  8090 = HTTP. Enable `verboseLog` to see exactly what is sent and returned.


## Reliability & polish

- **No Response in Home** - if Hyperion becomes unreachable, the accessory shows
  "No Response" instead of silently going stale, and recovers automatically.
- **Identify** - tapping Identify in the Home app briefly flashes the LEDs white.
- **Friendly config validation** - bad host/port/priority/mode values are caught
  at startup with a clear log message and a safe fallback, instead of failing later.
- **Dimming** - in `power` main mode the brightness slider behaves like a normal
  dimmable light (0% off, >0% on).
- **Adaptive effects wheel** - the wheel sizes itself to your server's effect
  count and remembers it across restarts (grow-only, so HomeKit inputs never churn).

## License

MIT
