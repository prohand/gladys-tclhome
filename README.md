# Gladys TCL Home

External integration for [Gladys Assistant](https://gladysassistant.com) that controls the
**TCL** appliances of a **TCL Home** account: air conditioners, dehumidifiers and Breeva air
purifiers. Built on the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js) and the
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

- **Cloud** integration (`transports: ["cloud"]`): it talks to the TCL Home cloud and AWS IoT
  exactly like the TCL Home mobile app. TCL appliances have no local API.
- Requires **Gladys 5.3** or newer.
- User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
  [Español](docs/es.md).

> TCL publishes no official API. This integration reproduces the calls of the TCL Home app, as
> documented by the community
> ([Home Assistant `tcl_home_unofficial`](https://github.com/nemesa/ha-tcl-home-unofficial-integration)).
> TCL may change them at any time. Not affiliated with TCL.

## What it does

| Device family                                                            | Features in Gladys                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Air conditioners (split, window, portable, duct, cylindrical, fresh air) | Power, mode, target temperature, fan speed (quiet / turbo), vertical and horizontal swing, indoor temperature, outdoor unit temperature, eco, sleep, health, anti-mold, display, beep |
| Dehumidifiers (DEM, DF)                                                  | Power, humidity                                                                                                                                                                       |
| Breeva air purifiers (A2, A3, A5)                                        | Power, PM2.5, display, child lock                                                                                                                                                     |

A feature only appears when the unit reports it. Other TCL devices (TVs…) are listed by the
"Test the connection" button as not supported.

On top of the devices (Gladys 5.1+ capabilities):

| Capability       | Key                    | What it does                                                         |
| ---------------- | ---------------------- | -------------------------------------------------------------------- |
| Scene trigger    | `availability_changed` | A TCL device goes online or offline (`{{triggerEvent.data.status}}`) |
| Scene trigger    | `error_reported`       | A TCL device reports a new error code (`{{triggerEvent.data.code}}`) |
| Scene action     | `set_climate`          | Turn an air conditioner on with mode, temperature and fan speed      |
| Scene action     | `turn_off_all`         | Turn off every TCL device that is on (output: `count`)               |
| Scene action     | `self_clean`           | Start the self-cleaning cycle of an air conditioner                  |
| Dashboard widget | `tcl_overview`         | Account and device states, live temperatures, quick buttons          |

## How it works

```
Gladys  <-- WebSocket / HTTP -->  this container  -- HTTPS -->  TCL Home cloud (login, device list)
                                                  -- HTTPS -->  Amazon Cognito (temporary AWS keys)
                                                  -- HTTPS -->  AWS IoT device shadows (state, orders)
```

1. Sign in with the TCL Home e-mail and password (the password is sent as an MD5 hash, like the
   app), then get the cloud region, the app tokens and temporary AWS credentials. Each step is
   kept in memory until it expires.
2. Read the device list (online state) and each device's AWS IoT shadow (its state).
3. Send orders by publishing the wanted state on the device shadow, then read it back a few
   seconds later to show what the device really did.

Gladys polls each device every minute; the integration reads the cloud at the interval chosen
in the configuration (60 s by default).

## Project structure

```
.
├─ index.js                          # SDK wiring (no TCL logic)
├─ src/
│  ├─ tcl/cloud.js                   # TCL Home + Cognito + AWS IoT client
│  ├─ tcl/sigv4.js                   # AWS Signature V4 (node:crypto, no AWS SDK)
│  ├─ devices/catalog.js             # TCL shadow <-> Gladys features
│  ├─ devices/index.js               # devices: discovery, polling, commands, triggers
│  ├─ scenes.js                      # scene actions
│  ├─ widgets.js                     # dashboard widget
│  ├─ messages.js, i18n.js           # texts in en, fr, de, es
│  └─ config.js                      # config defaults + normalization
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md · SECURITY.md · CLAUDE.md
└─ .github/                          # CI, Release, build, GitHub releases, Dependabot
```

## Development

```bash
npm install
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test, against the SDK's fake Gladys and a fake TCL cloud
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="tcl-home" \
LOG_LEVEL=debug \
npm start
```

The CI runs the three checks on Node 22 and 24 for every push and pull request; pull requests
also run the store admission checks and a Docker build.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major` (the very first
   release: `major`, for 1.0.0).
3. The workflow bumps `package.json` and the manifest (`version` + `docker_image`), moves the
   changelog section, tags `vX.Y.Z`, builds the `linux/amd64` + `linux/arm64` image to
   `ghcr.io/prohand/gladys-tclhome`, publishes the GitHub Release and runs the store checks.

For the Gladys store: add the GitHub topic `gladys-assistant-integration` to the repository,
make the package `ghcr.io/prohand/gladys-tclhome` public, and turn on **Private vulnerability
reporting** ([`SECURITY.md`](SECURITY.md) sends reporters there).

## License

Apache-2.0
