// -----------------------------------------------------------------------------
// Entry point of the TCL Home integration for Gladys Assistant.
//
// This file only wires the SDK to the code of src/: it registers the handlers
// BEFORE connect(), then (re)initializes on every connection. No TCL logic
// here: the cloud client lives in src/tcl/, the devices in src/devices/.
//
// Environment variables injected by the Gladys supervisor (read by the SDK):
//   GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { hasCredentials, normalizeConfig } from './src/config.js';
import { TclAuthError } from './src/tcl/cloud.js';
import { TclHome } from './src/devices/index.js';
import { MISSING_CREDENTIALS, describeAccount, describeFailure } from './src/messages.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { OVERVIEW_WIDGET, buildOverview, handleOverviewAction } from './src/widgets.js';

const gladys = new GladysIntegration();
const home = new TclHome({ gladys });

/** When an initialization failed (TCL down...), try again after this delay. */
const RETRY_DELAY_MS = 5 * 60 * 1000;
let retryTimer = null;

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> reading the TCL Home account');
  await synchronize();
});

// --- Command: the user acts on a feature -------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  // Throwing acks the command as failed: Gladys shows the message.
  await home.setValue(device, feature, value);
  gladys.requestWidgetRefresh(OVERVIEW_WIDGET);
});

// --- Polling: Gladys calls it every minute for each created device -----------
gladys.onPoll(async (device) => {
  const failing = home.lastError !== null;
  try {
    if (await home.poll(device)) {
      gladys.requestWidgetRefresh(OVERVIEW_WIDGET);
      if (failing && home.lastError === null) {
        // The cloud answers again: clear the error of the Configuration screen.
        await gladys.setConnectionStatus(true);
      }
    }
  } catch (err) {
    await reportFailure(err);
    throw err;
  }
});

// --- Configuration screen buttons --------------------------------------------
gladys.onAction('test_connection', async () => {
  if (!hasCredentials(home.config)) return MISSING_CREDENTIALS;
  try {
    await home.refreshAll();
    await gladys.setConnectionStatus(true);
    return describeAccount(home);
  } catch (err) {
    await reportFailure(err);
    return describeFailure(err);
  }
});

// --- Scene actions -----------------------------------------------------------
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(home, fields));
}

// --- Dashboard widget --------------------------------------------------------
gladys.onWidgetGet(OVERVIEW_WIDGET, () => buildOverview(home));
gladys.onWidgetAction(OVERVIEW_WIDGET, (actionKey, _params, { values } = {}) =>
  handleOverviewAction(home, { actionKey, values, refresh: synchronize }),
);

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  home.configure(normalizeConfig(newConfig));
  await synchronize();
});

/**
 * Read the whole account and give Gladys everything: the devices to
 * discover, their states, their transport badges, the connection status.
 * Never throws: a failure is reported in the Configuration screen and
 * retried later.
 */
async function synchronize() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (!hasCredentials(home.config)) {
    await gladys.publishDiscoveredDevices([]);
    await gladys.setConnectionStatus(false, MISSING_CREDENTIALS);
    gladys.requestWidgetRefresh(OVERVIEW_WIDGET);
    return;
  }
  try {
    await home.refreshAll();
    await gladys.publishDiscoveredDevices(home.buildDiscoveredDevices());
    for (const entry of home.list()) {
      if (entry.reported) await home.publishStates(entry);
    }
    await home.publishTransports();
    await gladys.setConnectionStatus(true);
  } catch (err) {
    await reportFailure(err);
    // A refused password waits for the user: retrying would only lock the account.
    if (!(err instanceof TclAuthError)) {
      retryTimer = setTimeout(() => {
        synchronize().catch((e) => logger.error('Retry failed', e));
      }, RETRY_DELAY_MS);
    }
  }
  gladys.requestWidgetRefresh(OVERVIEW_WIDGET);
}

/** Show why the cloud cannot be used in the Configuration screen. */
async function reportFailure(err) {
  home.lastError = err;
  logger.error(`TCL Home: ${err.message}`);
  await gladys.setConnectionStatus(false, describeFailure(err)).catch(() => {});
}

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself; these handlers only run the
// integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    home.configure(normalizeConfig(await gladys.getConfig()));
    await synchronize();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
  }
});

gladys.on('disconnected', () => {
  home.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  clearTimeout(retryTimer);
  home.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the TCL Home integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
