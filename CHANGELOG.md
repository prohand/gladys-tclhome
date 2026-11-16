# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [0.0.3] - 2026-11-16

- Update `@gladysassistant/integration-sdk` to 0.16.1 (security update).

## [0.0.2] - 2026-11-16

- Maintenance release, no functional change.

## [0.0.1] - 2026-11-15

### Added

- TCL Home account connection (e-mail and password of the mobile app), through the TCL Home
  cloud and AWS IoT, like the app. Cloud only: TCL devices have no local API.
- Air conditioners (split, window, portable, duct, cylindrical, fresh air): power, mode, target
  temperature, fan speed (quiet and turbo included), vertical and horizontal swing, indoor and
  outdoor unit temperature, eco, sleep, health, anti-mold, display and beep switches — each one
  only when the unit reports it.
- Dehumidifiers (power, humidity) and Breeva air purifiers (power, PM2.5, display, child lock).
- Transport badge: `cloud` when the device is online, `unreachable` otherwise.
- Scene triggers: a device goes online or offline, a device reports an error code.
- Scene actions: set an air conditioner (mode, temperature, fan) in one command, turn off every
  TCL device, start the self-cleaning cycle.
- "TCL Home" dashboard widget: account and device states, live indoor temperatures, "Set an air
  conditioner", "Turn everything off" and "Refresh" buttons.
- "Test the connection" button in the configuration screen.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/prohand/gladys-tclhome/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/prohand/gladys-tclhome/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/prohand/gladys-tclhome/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/prohand/gladys-tclhome/releases/tag/v0.0.1
