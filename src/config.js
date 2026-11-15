// -----------------------------------------------------------------------------
// Integration configuration.
//
// The user fills it in Gladys, from the `config_schema` declared in
// `gladys-assistant-integration.json`. The SDK fetches it (`gladys.getConfig()`)
// and notifies every change (`gladys.onConfigUpdated()`).
//
// This module only provides the defaults and normalizes the received object,
// so the rest of the code never deals with `undefined` or with numbers typed
// as strings in a form.
// -----------------------------------------------------------------------------

/** Slowest and fastest refresh the configuration accepts, in seconds. */
export const POLL_FREQUENCY_MIN = 60;
export const POLL_FREQUENCY_MAX = 3600;

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // TCL Home account (the one of the mobile app).
  username: '',
  password: '',
  // Seconds between two reads of a device. Gladys polls at most once a minute:
  // slower intervals are applied by skipping polls (see createPoller in
  // src/devices/index.js).
  poll_frequency: 60,
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const pollFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    username: String(raw.username ?? '').trim(),
    // Never trimmed: a password may legitimately start or end with a space.
    password: String(raw.password ?? ''),
    poll_frequency: Number.isFinite(pollFrequency)
      ? Math.min(POLL_FREQUENCY_MAX, Math.max(POLL_FREQUENCY_MIN, Math.round(pollFrequency)))
      : DEFAULT_CONFIG.poll_frequency,
  };
}

/** Whether the account fields are filled in: nothing can work without them. */
export function hasCredentials(config) {
  return config.username.length > 0 && config.password.length > 0;
}
