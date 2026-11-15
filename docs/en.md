# TCL Home

This integration connects Gladys to your **TCL Home** account and drives the TCL appliances
added to it: **air conditioners**, **dehumidifiers** and **Breeva air purifiers**.

## Before you begin

- **Gladys 5.3 or newer** is required.
- Your appliances must work in the **TCL Home** mobile app first: add them there, Gladys does
  not pair them.
- This is a **cloud** integration: Gladys goes through the TCL Home cloud, like the app. Gladys
  needs Internet access, and nothing works while the TCL cloud is down. TCL appliances offer no
  local control.

TCL publishes no official API: this integration does what the TCL Home app does. TCL may
change it at any time. It is not affiliated with TCL.

## Configuration

In Gladys, open **Integrations → TCL Home → Configuration**:

| Field                | What to enter                                                         |
| -------------------- | --------------------------------------------------------------------- |
| TCL Home e-mail      | The e-mail you sign in to the TCL Home app with                       |
| TCL Home password    | The password of that account                                          |
| Refresh interval (s) | How often each device is read, in seconds (60 to 3600, 60 by default) |

Save, then press **Test the connection**: it lists the devices found, how many are online, and
the TCL devices this integration does not drive (a TV, for example).

Then open the **Discover** tab of the integration and add your devices.

> Tip: create a second TCL Home account, share your home with it from the app, and give that
> one to Gladys. Your own password then stays yours.

## Devices and features

A feature only appears when your unit reports it: a model without horizontal swing gets no
horizontal swing control.

### Air conditioners

Split, window, portable, duct, cylindrical and fresh air units.

| Feature                                             | In Gladys                                                      |
| --------------------------------------------------- | -------------------------------------------------------------- |
| Power                                               | On / off                                                       |
| Mode                                                | Auto, cool, dry, fan, heat (only the modes your unit has)      |
| Target temperature                                  | 16 to 31 °C, whole degrees                                     |
| Fan speed                                           | Auto, quiet, low, medium-low, medium, medium-high, high, turbo |
| Vertical / horizontal swing                         | Off, swing, or one of 5 fixed positions                        |
| Indoor temperature                                  | Measured by the unit                                           |
| Outdoor unit temperature                            | When the unit reports it                                       |
| Eco, sleep, health, anti-mold drying, display, beep | On / off switches                                              |

On a portable unit, the auto mode and the fan speed only exist on the models with a swing flap.

### Dehumidifiers

Power and room humidity.

### Breeva air purifiers

Power, PM2.5, display and child lock.

### Refresh

Gladys reads each device at the interval you chose. After an order, the integration reads the
device again a few seconds later, so Gladys shows what the device really did.

A device that is offline shows an **unreachable** badge; online, a **cloud** badge.

## Scenes

### Triggers

| Trigger                     | When                                    | Variable                             |
| --------------------------- | --------------------------------------- | ------------------------------------ |
| TCL device online / offline | A device loses or finds its connection  | `status`: `online` or `offline`      |
| TCL device error            | A device starts reporting an error code | `code`: the code(s), comma-separated |

Both can be limited to one device. They fire on a change: a device already offline, or an error
already present when Gladys starts, does not fire them.

### Actions

| Action                    | What it does                                                                             | Output                 |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| Set a TCL air conditioner | Turns the unit on, with the mode, temperature and fan speed you chose (empty: unchanged) | `applied` (true/false) |
| Turn off all TCL devices  | Turns off every TCL device that is on                                                    | `count`                |
| Start TCL self-cleaning   | Starts the self-cleaning cycle of the unit (it stops the unit), when the model has one   | `started` (true/false) |

An offline unit does not stop the scene: the output is `false`, use it in a condition if needed.

Example: "When I leave home, turn off all TCL devices", or "At 6 pm in summer, set the living
room unit to cool at 24 °C".

## Dashboard widget

Add the **TCL Home** widget to a dashboard. It shows:

- the state of the TCL Home account, then each device: off, offline, or its mode and target
  temperature;
- the live indoor temperature of the first air conditioners;
- the buttons **Set an air conditioner** (unit, mode, temperature, fan), **Turn everything off**
  and **Refresh**.

## Troubleshooting

| Message or symptom                            | What to do                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "TCL Home refused the e-mail or the password" | Check them by signing in to the TCL Home app. An account created with Google or Apple has no password: set one in the app, or use a second account. |
| "TCL Home cannot be reached"                  | Check Gladys' Internet access. The integration retries by itself every 5 minutes.                                                                   |
| A device is missing                           | Is it in the TCL Home app, on the same account? "Test the connection" lists the unsupported ones.                                                   |
| An order fails with "is offline"              | The device is not connected to the TCL cloud: check its Wi-Fi in the TCL Home app.                                                                  |
| The state changes late                        | The cloud is read at the refresh interval: lower it (60 s minimum).                                                                                 |

Set the log level to `debug` (`LOG_LEVEL` environment variable) to see every call. Passwords and
tokens are never written to the logs.

## Privacy

- The password is stored by Gladys in a secret field and sent to TCL only, as an MD5 hash, like
  the app does.
- The TCL tokens and the temporary AWS credentials stay in memory, nothing is written to disk.
- The integration talks only to TCL (`*.tcl.com`, `*.tcljd.com`) and Amazon Web Services
  (`*.amazonaws.com`), over HTTPS.
