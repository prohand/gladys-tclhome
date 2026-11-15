// -----------------------------------------------------------------------------
// The TCL devices of the account, as Gladys sees them.
//
// `TclHome` keeps what the integration knows about each device (its entry in
// the TCL device list, its last shadow, its online state, its error codes)
// and turns it into what Gladys asks for: the discovery payload, the states of
// a poll, the transport badges. Commands go the other way: a Gladys value
// becomes `desired` properties sent to the device shadow.
//
// It owns no timer and does not talk to Gladys by itself, except to publish
// what a call produced: index.js decides when to call it.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_POLL_FREQUENCIES,
  DEVICE_TRANSPORTS,
} from '@gladysassistant/integration-sdk';
import { TclAuthError, TclCloud } from '../tcl/cloud.js';
import { hasCredentials, normalizeConfig } from '../config.js';
import { buildFeatureSpecs, detectFamily, errorCodes, FAMILIES } from './catalog.js';

const logger = createLogger({ name: 'devices' });

/** Namespace of the external ids: `ext:<selector>:tcl:<TCL device id>`. Never renamed. */
export const DEVICE_TYPE = 'tcl';

/** Scene trigger keys, as declared in the manifest. Never renamed: scenes store them. */
export const SCENE_TRIGGERS = {
  AVAILABILITY_CHANGED: 'availability_changed',
  ERROR_REPORTED: 'error_reported',
};

/** Values of the `status` field of the availability trigger. */
export const AVAILABILITY = { ONLINE: 'online', OFFLINE: 'offline' };

/** An unchanged state is re-sent this often, so Gladys keeps it recently dated. */
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

// Gladys' poll ticks drift by a few milliseconds: a read due within the next
// half-minute runs now, so a 120 s interval does not slip to 180 s.
const POLL_TOLERANCE_MS = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES / 2;

export class TclHome {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK instance
   * @param {(config: object) => TclCloud} [options.createCloud] cloud factory (tests)
   * @param {() => number} [options.now] clock, in milliseconds
   * @param {number} [options.confirmDelayMs] re-read a device this long after a
   *   command, to show the state it really took (0: never)
   */
  constructor({
    gladys,
    createCloud = (config) =>
      new TclCloud({ username: config.username, password: config.password, logger }),
    now = Date.now,
    confirmDelayMs = 4000,
  }) {
    this.gladys = gladys;
    this.createCloud = createCloud;
    this.now = now;
    this.confirmDelayMs = confirmDelayMs;
    this.cloud = null;
    this.credentials = null;
    this.config = null;
    /** @type {Map<string, object>} TCL device id -> entry */
    this.devices = new Map();
    /** Things the account has that this integration does not drive. */
    this.unsupported = [];
    this.thingsReadAt = 0;
    this.lastReads = new Map();
    this.lastError = null;
    this.confirmTimers = new Set();
    this.configure(normalizeConfig());
  }

  /** Apply a (new) configuration. Changed credentials start a new session. */
  configure(config) {
    this.config = config;
    const credentials = `${config.username}\u0000${config.password}`;
    if (credentials !== this.credentials) {
      this.credentials = credentials;
      this.cloud = hasCredentials(config) ? this.createCloud(config) : null;
      this.devices.clear();
      this.unsupported = [];
      this.thingsReadAt = 0;
      this.lastReads.clear();
      this.lastError = null;
    }
  }

  ids(deviceId) {
    return this.gladys.externalIds(DEVICE_TYPE, deviceId);
  }

  /** The entry of a Gladys device external_id, or undefined. */
  findByExternalId(externalId) {
    for (const entry of this.devices.values()) {
      if (entry.ids.device === externalId) return entry;
    }
    return undefined;
  }

  /** The driven devices, in the order of the TCL app. */
  list() {
    return [...this.devices.values()];
  }

  /** The air conditioners, the targets of the climate scene action and widget. */
  airConditioners() {
    return this.list().filter((entry) => entry.kind.family === FAMILIES.AIR_CONDITIONER);
  }

  requireCloud() {
    if (!this.cloud) {
      throw new Error('The TCL Home account is not configured');
    }
    return this.cloud;
  }

  // --- Reading -----------------------------------------------------------------

  /**
   * Read the device list again, keep the entries of the known devices, and
   * fire the availability trigger for every device whose online state changed.
   */
  async refreshThings() {
    const things = await this.requireCloud().getThings();
    const previous = this.devices;
    const next = new Map();
    const unsupported = [];
    const transitions = [];
    for (const thing of things) {
      const kind = detectFamily(thing.deviceName);
      if (!kind) {
        unsupported.push(thing);
        continue;
      }
      const known = previous.get(thing.deviceId);
      const entry = known ?? {
        thing,
        kind,
        ids: this.ids(thing.deviceId),
        reported: null,
        specs: [],
        errors: null,
      };
      if (known && known.thing.online !== thing.online) {
        transitions.push(entry);
      }
      entry.thing = thing;
      next.set(thing.deviceId, entry);
    }
    this.devices = next;
    this.unsupported = unsupported;
    this.thingsReadAt = this.now();
    this.lastError = null;

    for (const entry of transitions) {
      const status = entry.thing.online ? AVAILABILITY.ONLINE : AVAILABILITY.OFFLINE;
      logger.info(`${entry.thing.name} is now ${status}`);
      await this.gladys
        .publishSceneEvent(SCENE_TRIGGERS.AVAILABILITY_CHANGED, {
          device: entry.ids.device,
          status,
        })
        .catch((err) => logger.warn(`availability_changed not published: ${err.message}`));
    }
    if (transitions.length > 0) {
      await this.publishTransports();
    }
    return this.list();
  }

  /** Read the shadow of one device and remember it. */
  async readShadow(entry) {
    const shadow = await this.requireCloud().getShadow(entry.thing.deviceId);
    if (!shadow) {
      return entry;
    }
    // A command still on its way shows in `desired` until the device takes it;
    // the device's own report is the truth Gladys must show.
    entry.reported = shadow.reported;
    entry.specs = buildFeatureSpecs(entry.kind, entry.reported);
    await this.checkErrors(entry);
    return entry;
  }

  /** Fire `error_reported` when a device starts reporting a new error code. */
  async checkErrors(entry) {
    const codes = errorCodes(entry.reported).join(',');
    const before = entry.errors;
    entry.errors = codes;
    // The first read is the baseline: a restart must not re-fire an old error.
    if (before === null || codes === before || codes === '') return;
    logger.warn(`${entry.thing.name} reports error ${codes}`);
    await this.gladys
      .publishSceneEvent(SCENE_TRIGGERS.ERROR_REPORTED, { device: entry.ids.device, code: codes })
      .catch((err) => logger.warn(`error_reported not published: ${err.message}`));
  }

  /**
   * Everything, from scratch: the device list and every shadow. A shadow that
   * cannot be read leaves its device out of this discovery, not the others.
   */
  async refreshAll() {
    await this.refreshThings();
    for (const entry of this.list()) {
      try {
        await this.readShadow(entry);
      } catch (err) {
        logger.warn(`Shadow of ${entry.thing.name} not read: ${err.message}`);
      }
    }
    return this.list();
  }

  // --- Gladys payloads ---------------------------------------------------------

  /** The discovery payload: one Gladys device per TCL device whose shadow is known. */
  buildDiscoveredDevices() {
    return this.list()
      .filter((entry) => entry.reported)
      .map((entry) => ({
        name: entry.thing.name,
        external_id: entry.ids.device,
        // Read once at creation: Gladys calls onPoll every minute, and
        // createPoller applies the slower interval of the configuration.
        // `should_poll` stays explicit for the cores older than SDK 0.16.
        should_poll: true,
        poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
        params: [
          { name: 'model', value: entry.thing.deviceName },
          ...(entry.thing.firmwareVersion
            ? [{ name: 'firmware', value: entry.thing.firmwareVersion }]
            : []),
        ],
        features: entry.specs.map((spec) => ({
          ...spec.feature,
          external_id: entry.ids.feature(spec.key),
        })),
      }));
  }

  /** The states of one device, from its last shadow. */
  statesOf(entry) {
    const states = [];
    for (const spec of entry.specs) {
      const value = spec.read(entry.reported);
      if (value !== null) {
        states.push({ device_feature_external_id: entry.ids.feature(spec.key), state: value });
      }
    }
    return states;
  }

  async publishStates(entry) {
    const states = this.statesOf(entry);
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
  }

  /** Transport badge: everything goes through the TCL cloud. */
  transportEntries() {
    return this.list().map((entry) => ({
      external_id: entry.ids.device,
      transport: entry.thing.online ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE,
    }));
  }

  async publishTransports() {
    const entries = this.transportEntries();
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  // --- Polling -----------------------------------------------------------------

  /**
   * Gladys polls every created device once a minute: read it at the interval
   * the user chose. The device list (online states) is read once per interval
   * for all devices, the shadow once per interval per device.
   * @returns {Promise<boolean>} true when the device was read
   */
  async poll(device) {
    // Refused credentials stay refused: signing in again every minute would
    // only get the TCL account locked. A new configuration (or the "Test the
    // connection" button) tries again.
    if (!this.cloud || this.lastError instanceof TclAuthError) return false;
    const intervalMs = this.config.poll_frequency * 1000 - POLL_TOLERANCE_MS;
    const now = this.now();
    const lastRead = this.lastReads.get(device.external_id);
    if (lastRead !== undefined && now - lastRead < intervalMs) return false;

    if (this.devices.size === 0 || now - this.thingsReadAt >= intervalMs) {
      await this.refreshThings();
    }
    const entry = this.findByExternalId(device.external_id);
    if (!entry) {
      // Removed from the TCL account (or moved to another one).
      this.lastReads.set(device.external_id, now);
      return false;
    }
    await this.readShadow(entry);
    await this.publishStates(entry);
    this.lastReads.set(device.external_id, now);
    return true;
  }

  // --- Commands ----------------------------------------------------------------

  /** Send `desired` properties, and mirror them until the device reports. */
  async send(entry, desired) {
    if (!entry.thing.online) {
      throw new Error(`${entry.thing.name} is offline`);
    }
    logger.info(`${entry.thing.name} <- ${JSON.stringify(desired)}`);
    await this.requireCloud().setDesired(entry.thing.deviceId, desired);
    entry.reported = { ...entry.reported, ...desired };
    await this.publishStates(entry);
    this.scheduleConfirm(entry);
  }

  /** Read the device again shortly, so Gladys shows what it really did. */
  scheduleConfirm(entry) {
    if (this.confirmDelayMs <= 0) return;
    const timer = setTimeout(() => {
      this.confirmTimers.delete(timer);
      this.readShadow(entry)
        .then(() => this.publishStates(entry))
        .catch((err) => logger.debug(`Confirmation read failed: ${err.message}`));
    }, this.confirmDelayMs);
    timer.unref?.();
    this.confirmTimers.add(timer);
  }

  /** Gladys `onSetValue`: one feature of one device. */
  async setValue(device, feature, value) {
    const entry = this.findByExternalId(device.external_id);
    if (!entry) throw new Error(`Unknown TCL device ${device.external_id}`);
    const spec = entry.specs.find((item) => entry.ids.feature(item.key) === feature.external_id);
    if (!spec?.write) throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    await this.send(entry, spec.write(Number(value), entry.reported));
  }

  /**
   * Turn an air conditioner on with a mode, a target temperature and a fan
   * speed, in ONE command (several commands in a row can arrive out of order).
   * Every argument but the device is optional.
   * @returns {Promise<boolean>} false when the device is unknown or offline
   */
  async applyClimate(externalId, { mode, temperature, fanSpeed } = {}) {
    const entry = this.findByExternalId(externalId);
    if (!entry || entry.kind.family !== FAMILIES.AIR_CONDITIONER || !entry.thing.online) {
      return false;
    }
    const spec = (key) => entry.specs.find((item) => item.key === key);
    const desired = { powerSwitch: 1 };
    if (mode !== undefined && mode !== null && spec('mode')) {
      Object.assign(desired, spec('mode').write(Number(mode)));
    }
    if (Number.isFinite(temperature) && spec('target-temperature')) {
      Object.assign(desired, spec('target-temperature').write(temperature));
    }
    if (fanSpeed !== undefined && fanSpeed !== null && spec('fan-speed')) {
      Object.assign(desired, spec('fan-speed').write(Number(fanSpeed)));
    }
    await this.send(entry, desired);
    return true;
  }

  /**
   * Turn off every device that is on and online.
   * @returns {Promise<number>} how many devices were turned off
   */
  async turnOffAll() {
    let count = 0;
    for (const entry of this.list()) {
      if (!entry.thing.online || Number(entry.reported?.powerSwitch) !== 1) continue;
      try {
        await this.send(entry, { powerSwitch: 0 });
        count += 1;
      } catch (err) {
        logger.warn(`${entry.thing.name} not turned off: ${err.message}`);
      }
    }
    return count;
  }

  /**
   * Start the self-cleaning cycle of an air conditioner (it stops the unit,
   * the app does the same).
   * @returns {Promise<boolean>} false when the unit has no such cycle or is offline
   */
  async selfClean(externalId) {
    const entry = this.findByExternalId(externalId);
    if (!entry || !entry.thing.online || entry.reported?.selfClean === undefined) {
      return false;
    }
    await this.send(entry, { powerSwitch: 0, selfClean: 1 });
    return true;
  }

  /** Stop the pending confirmation reads (shutdown, disconnection). */
  stop() {
    for (const timer of this.confirmTimers) clearTimeout(timer);
    this.confirmTimers.clear();
  }
}
