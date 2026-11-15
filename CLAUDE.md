# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human contributors.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **TCL Home** appliances: air conditioners
(split, window, portable, duct, cylindrical, fresh air), dehumidifiers and Breeva air purifiers.
Requires Gladys 5.3+. Started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

**Cloud only.** TCL publishes no API and the appliances have no local one: the integration
speaks to the TCL Home cloud exactly like the mobile app (as documented by the Home Assistant
`tcl_home_unofficial` integration). Manifest `transports: ["cloud"]`.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/catalog.test.js            # one file
node --test --test-name-pattern "swing"     # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24, and on
pull requests the store checks and a Docker build: run the three commands before pushing.

## Architecture

```
index.js                SDK wiring only: handlers registered before connect(), synchronize()
src/config.js           DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js             LANGUAGES (en, fr, de, es), pick, localize
src/messages.js         connection status and "Test the connection" texts
src/tcl/cloud.js        TclCloud: login -> cloud URLs -> app tokens -> Cognito -> AWS IoT shadow
src/tcl/sigv4.js        AWS Signature V4 with node:crypto (no AWS SDK)
src/devices/catalog.js  TCL family + shadow properties <-> Gladys features (read / write)
src/devices/index.js    TclHome: device registry, discovery, polling, commands, scene triggers
src/scenes.js           scene actions (set_climate, turn_off_all, self_clean)
src/widgets.js          dashboard widget tcl_overview
test/helpers/fakeTcl.js FakeCloud, fake fetch of the TCL/AWS endpoints, JWT builder
```

### Invariants worth knowing

- **The session.** Five steps, each cached until 5 minutes before it expires
  (`TclCloud.ensureSession`): TCL login (password sent as MD5), `cloud_url_get` (region and
  URLs), `refresh_tokens` (saas token + Cognito token), Cognito `GetCredentialsForIdentity`
  (temporary AWS keys), then the AWS IoT data plane. A 401/403 renews the last step once.
- **The device list** (`get_things`, signed with timestamp + nonce + MD5) gives the online
  state; the **shadow** (`GET /things/<id>/shadow`) gives the state: `reported` is the truth.
- **Commands** are published on `$aws/things/<id>/shadow/update` (`state.desired`), like the
  app. The topic is URL-encoded once in the URL and twice in the signature: `test/sigv4.test.js`
  pins a botocore-signed request.
- **Features follow the shadow**: a feature is published only when its property is in
  `reported` (`buildFeatureSpecs`). Work modes are numbered per unit in the order
  auto, cool, dry, fan, heat, skipping the modes the family lacks (portable: no auto without
  `swingWind`, no heat; window: no heat).
- **Values are the Gladys core constants** (`AC_MODE`, `AC_FAN_SPEED`, `AC_SWING_*`), copied in
  `catalog.js` because the SDK does not export them.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys).
- **Polling**: devices are published with `poll_frequency: EVERY_MINUTES` (an enum in ms, any
  other value rejects the whole discovery); `TclHome.poll` skips ticks to honour the
  configured `poll_frequency` (seconds, 60–3600) and reads the device list once per interval.
- **Several orders at once go in ONE `desired`** (`applyClimate`): separate publishes can
  arrive out of order.
- **Scene triggers fire on changes only**: the first read is the baseline, so a restart never
  re-fires an old error or availability.
- Secrets (password, tokens, AWS keys) are never logged and never put in an error message.

## Rules

- **External ids are forever**: `gladys.externalIds('tcl', <TCL device id>)` and the feature keys
  of `catalog.js` (`power`, `mode`, `target-temperature`…). Renaming one creates a new device
  and orphans the history, scenes and dashboards. Same for config, action, trigger, scene
  action, widget and widget button keys.
- **The container rootfs is read-only.** Write only under `/data` (nothing is written today).
- **Versions belong to the Release workflow** (Actions → Release). Never edit `version` in
  `package.json` or in the manifest, nor the `docker_image` tag, by hand.
  `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version
  heading: the Release workflow moves the section, and it becomes the GitHub Release notes.
- **Manifest.** Texts are `{ en, fr, de, es }` objects (labels, descriptions, placeholders), the
  catalog description holds 10 to 100 characters per language, `gladys_version` stays
  `>=5.3.0` (keywords; widget button forms need 5.2). `test/manifest.test.js` ties the manifest
  to the code: change both sides together.
- **User-facing text** exists in English, French, German and Spanish: messages, widget, manifest
  and `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English. Tests
  never touch the network (`test/helpers/fakeTcl.js`).
