// -----------------------------------------------------------------------------
// Dashboard widget (Gladys 5.1+, button forms 5.2+): the TCL devices at a glance.
//
// `tcl_overview` shows:
//   - a status list: the TCL Home account, then every device (off, offline, or
//     its mode and target temperature);
//   - live tiles bound to the indoor temperature of the first air conditioners
//     (they follow the published states, nothing to refresh);
//   - three buttons: "Set an air conditioner" (a form: unit, mode, temperature,
//     fan), "Turn everything off" and "Refresh".
//
// The content is declarative, the core renders it. Its budget: 8 components,
// 1 status list (10 rows), 6 tiles, 4 buttons, 4 fields per form.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { hasCredentials } from './config.js';
import { MODE_LABELS, TARGET_MAX, TARGET_MIN } from './devices/catalog.js';
import { localize, pick } from './i18n.js';
import { climateRequest, FAN_SPEED_OPTIONS, MODE_OPTIONS } from './scenes.js';
import { MISSING_CREDENTIALS } from './messages.js';
import { TclAuthError } from './tcl/cloud.js';

const logger = createLogger({ name: 'widgets' });

/** Widget key, as declared in the manifest. Never renamed: dashboards store it. */
export const OVERVIEW_WIDGET = 'tcl_overview';

/** Keys of the buttons of the content. Never renamed: they come back by key. */
export const WIDGET_ACTIONS = {
  SET_CLIMATE: 'set_climate',
  TURN_OFF_ALL: 'turn_off_all',
  REFRESH: 'refresh',
};

/** Rows of the status list: the account, then up to 9 devices. */
const MAX_DEVICE_ROWS = 9;
/** Live temperature tiles. */
const MAX_TILES = 3;
/** Options of a form select. */
const MAX_OPTIONS = 50;
/** Option labels hold 40 characters. */
const LABEL_LENGTH = 40;

const short = (text) => (text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH - 1)}…` : text);
const same = (text) => ({ en: text, fr: text, de: text, es: text });

const KEEP = {
  en: 'Unchanged',
  fr: 'Inchangé',
  de: 'Unverändert',
  es: 'Sin cambios',
};

const FAN_LABELS = {
  auto: { en: 'Auto', fr: 'Auto', de: 'Automatik', es: 'Automático' },
  quiet: { en: 'Quiet', fr: 'Silencieux', de: 'Leise', es: 'Silencioso' },
  low: { en: 'Low', fr: 'Faible', de: 'Niedrig', es: 'Baja' },
  medium: { en: 'Medium', fr: 'Moyen', de: 'Mittel', es: 'Media' },
  high: { en: 'High', fr: 'Fort', de: 'Hoch', es: 'Alta' },
  turbo: { en: 'Turbo', fr: 'Turbo', de: 'Turbo', es: 'Turbo' },
};

/** One status row per device. */
function deviceItem(entry) {
  const label = same(short(entry.thing.name));
  if (!entry.thing.online) {
    return {
      label,
      icon: 'wifi-off',
      value: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (!entry.reported) {
    return {
      label,
      icon: 'help-circle',
      value: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  if (Number(entry.reported.powerSwitch) !== 1) {
    return {
      label,
      icon: 'power',
      value: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  const spec = (key) => entry.specs.find((item) => item.key === key);
  const mode = spec('mode')?.read(entry.reported);
  const target = spec('target-temperature')?.read(entry.reported);
  const on = { en: 'On', fr: 'Allumé', de: 'An', es: 'Encendido' };
  return {
    label,
    icon: 'wind',
    value: localize((language) => {
      const parts = [pick(language, MODE_LABELS[mode] ?? on)];
      if (target !== null && target !== undefined) parts.push(`${target} °C`);
      return parts.join(' · ');
    }),
    color: WIDGET_COLORS.SUCCESS,
  };
}

function accountItem(home) {
  const label = {
    en: 'TCL Home account',
    fr: 'Compte TCL Home',
    de: 'TCL-Home-Konto',
    es: 'Cuenta TCL Home',
  };
  if (!hasCredentials(home.config)) {
    return {
      label,
      icon: 'user-x',
      value: { en: 'Not set', fr: 'À renseigner', de: 'Nicht gesetzt', es: 'Sin configurar' },
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (home.lastError) {
    return {
      label,
      icon: 'cloud-off',
      value: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
      color: WIDGET_COLORS.DANGER,
    };
  }
  return {
    label,
    icon: 'cloud',
    value: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
    color: WIDGET_COLORS.SUCCESS,
  };
}

/** "Set an air conditioner": the set_climate scene action, behind a form. */
function climateButton(home) {
  const units = home
    .airConditioners()
    .filter((entry) => entry.reported)
    .slice(0, MAX_OPTIONS);
  if (units.length === 0) return null;
  return {
    type: 'button',
    label: {
      en: 'Set an air conditioner',
      fr: 'Régler un climatiseur',
      de: 'Klimagerät einstellen',
      es: 'Ajustar un aire',
    },
    icon: 'sliders',
    style: 'primary',
    action: {
      key: WIDGET_ACTIONS.SET_CLIMATE,
      fields: [
        {
          key: 'device',
          type: 'select',
          label: { en: 'Unit', fr: 'Appareil', de: 'Gerät', es: 'Equipo' },
          required: true,
          default: units[0].ids.device,
          options: units.map((entry) => ({
            value: entry.ids.device,
            label: same(short(entry.thing.name)),
          })),
        },
        {
          key: 'mode',
          type: 'select',
          label: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
          required: true,
          default: 'keep',
          options: [
            { value: 'keep', label: KEEP },
            ...Object.entries(MODE_OPTIONS).map(([value, mode]) => ({
              value,
              label: MODE_LABELS[mode],
            })),
          ],
        },
        {
          key: 'target_temperature',
          type: 'number',
          label: {
            en: 'Temperature (°C)',
            fr: 'Température (°C)',
            de: 'Temperatur (°C)',
            es: 'Temperatura (°C)',
          },
          required: false,
          min: TARGET_MIN,
          max: TARGET_MAX,
        },
        {
          key: 'fan_speed',
          type: 'select',
          label: { en: 'Fan', fr: 'Ventilation', de: 'Lüfter', es: 'Ventilador' },
          required: true,
          default: 'keep',
          options: [
            { value: 'keep', label: KEEP },
            ...Object.keys(FAN_SPEED_OPTIONS).map((value) => ({
              value,
              label: FAN_LABELS[value],
            })),
          ],
        },
      ],
    },
  };
}

/** Captions hold 80 characters: the short version of src/messages.js. */
function failureNotice(err) {
  if (err instanceof TclAuthError) {
    return {
      en: 'TCL Home refused the e-mail or the password.',
      fr: 'TCL Home refuse l’e-mail ou le mot de passe.',
      de: 'TCL Home lehnt die E-Mail-Adresse oder das Passwort ab.',
      es: 'TCL Home rechaza el correo o la contraseña.',
    };
  }
  return {
    en: 'TCL Home cannot be reached. The integration retries by itself.',
    fr: 'TCL Home est injoignable. L’intégration réessaie d’elle-même.',
    de: 'TCL Home ist nicht erreichbar. Neuer Versuch folgt automatisch.',
    es: 'No se puede contactar con TCL Home. Se reintentará solo.',
  };
}

/** The content of the widget. */
export function buildOverview(home) {
  const components = [];

  if (!hasCredentials(home.config)) {
    components.push({ type: 'text', variant: 'caption', text: MISSING_CREDENTIALS });
  } else if (home.lastError) {
    components.push({ type: 'text', variant: 'caption', text: failureNotice(home.lastError) });
  }

  const devices = home.list();
  components.push({
    type: 'status',
    items: [accountItem(home), ...devices.slice(0, MAX_DEVICE_ROWS).map(deviceItem)],
  });

  // Live tiles, bound to the published indoor temperatures.
  const tiles = home
    .airConditioners()
    .filter((entry) => entry.specs.some((spec) => spec.key === 'indoor-temperature'))
    .slice(0, MAX_TILES);
  for (const entry of tiles) {
    components.push({
      type: 'value',
      label: same(short(entry.thing.name)),
      icon: 'thermometer',
      device_feature: entry.ids.feature('indoor-temperature'),
    });
  }

  const climate = climateButton(home);
  if (climate) components.push(climate);
  if (devices.length > 0) {
    components.push({
      type: 'button',
      label: {
        en: 'Turn everything off',
        fr: 'Tout éteindre',
        de: 'Alles ausschalten',
        es: 'Apagar todo',
      },
      icon: 'power',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.TURN_OFF_ALL, confirm: true },
    });
  }
  components.push({
    type: 'button',
    label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });

  // The device rows only change at a poll or a command, and index.js nudges
  // the widget then: the TTL is a safety net.
  return { ttl_seconds: 300, components };
}

/**
 * A tapped button. Resolves the toast shown to the user (≤ 200 characters).
 * @param {object} home the TclHome instance
 * @param {object} request
 * @param {string} request.actionKey the button
 * @param {object} [request.values] the form, for set_climate
 * @param {() => Promise<void>} request.refresh full refresh, provided by index.js
 */
export async function handleOverviewAction(home, { actionKey, values = {}, refresh }) {
  logger.info(`onWidgetAction <- ${OVERVIEW_WIDGET}.${actionKey}`);
  if (actionKey === WIDGET_ACTIONS.SET_CLIMATE) {
    const applied = await home.applyClimate(values.device, climateRequest(values));
    return applied
      ? { en: 'Sent.', fr: 'Envoyé.', de: 'Gesendet.', es: 'Enviado.' }
      : {
          en: 'This unit is offline or unknown.',
          fr: 'Cet appareil est hors ligne ou inconnu.',
          de: 'Dieses Gerät ist offline oder unbekannt.',
          es: 'Este equipo está sin conexión o es desconocido.',
        };
  }
  if (actionKey === WIDGET_ACTIONS.TURN_OFF_ALL) {
    const count = await home.turnOffAll();
    return localize((language) =>
      pick(language, {
        en: `${count} device(s) turned off.`,
        fr: `${count} appareil(s) éteint(s).`,
        de: `${count} Gerät(e) ausgeschaltet.`,
        es: `${count} dispositivo(s) apagado(s).`,
      }),
    );
  }
  if (actionKey === WIDGET_ACTIONS.REFRESH) {
    await refresh();
    return { en: 'Refreshed.', fr: 'Actualisé.', de: 'Aktualisiert.', es: 'Actualizado.' };
  }
  // Throwing acks the action as failed: the message reaches the user.
  throw new Error(`Unknown widget action: ${actionKey}`);
}
