// -----------------------------------------------------------------------------
// The texts the integration shows the user: the connection status of the
// Configuration screen and the answer of the "Test the connection" button.
// Every one of them is a `{ en, fr, de, es }` object (see src/i18n.js).
// -----------------------------------------------------------------------------

import { TclAuthError } from './tcl/cloud.js';
import { localize, pick } from './i18n.js';

export const MISSING_CREDENTIALS = {
  en: 'Enter the e-mail and password of your TCL Home account.',
  fr: 'Renseignez l’e-mail et le mot de passe de votre compte TCL Home.',
  de: 'Gib die E-Mail-Adresse und das Passwort deines TCL-Home-Kontos ein.',
  es: 'Introduzca el correo y la contraseña de su cuenta TCL Home.',
};

export const AUTH_REFUSED = {
  en: 'TCL Home refused the e-mail or the password. Check them in the TCL Home app.',
  fr: 'TCL Home refuse l’e-mail ou le mot de passe. Vérifiez-les dans l’application TCL Home.',
  de: 'TCL Home lehnt die E-Mail-Adresse oder das Passwort ab. Prüfe sie in der TCL-Home-App.',
  es: 'TCL Home rechaza el correo o la contraseña. Compruébelos en la app TCL Home.',
};

/** Why the cloud cannot be used, for the connection status. */
export function describeFailure(err) {
  if (err instanceof TclAuthError) return AUTH_REFUSED;
  // The message names the step and the HTTP status, never a secret.
  const reason = String(err?.message ?? err).slice(0, 120);
  return {
    en: `TCL Home cannot be reached (${reason}). The integration retries by itself.`,
    fr: `TCL Home est injoignable (${reason}). L’intégration réessaie d’elle-même.`,
    de: `TCL Home ist nicht erreichbar (${reason}). Die Integration versucht es selbst erneut.`,
    es: `No se puede contactar con TCL Home (${reason}). La integración lo reintenta sola.`,
  };
}

/** List names in a sentence, at most `max` of them. */
function names(list, max = 6) {
  const shown = list.slice(0, max).map((item) => item.name);
  return list.length > max ? `${shown.join(', ')}…` : shown.join(', ');
}

/**
 * Answer of the "Test the connection" button: what the account holds.
 * @param {{ list: () => object[], unsupported: object[] }} home
 */
export function describeAccount(home) {
  const devices = home.list().map((entry) => entry.thing);
  const online = devices.filter((thing) => thing.online).length;
  return localize((language) => {
    const parts = [];
    if (devices.length === 0) {
      parts.push(
        pick(language, {
          en: 'Connected, but the account has no air conditioner, dehumidifier or purifier.',
          fr: 'Connecté, mais le compte n’a ni climatiseur, ni déshumidificateur, ni purificateur.',
          de: 'Verbunden, aber das Konto hat kein Klimagerät, keinen Entfeuchter und keinen Luftreiniger.',
          es: 'Conectado, pero la cuenta no tiene aire acondicionado, deshumidificador ni purificador.',
        }),
      );
    } else {
      parts.push(
        pick(language, {
          en: `Connected: ${devices.length} device(s), ${online} online (${names(devices)}).`,
          fr: `Connecté : ${devices.length} appareil(s), ${online} en ligne (${names(devices)}).`,
          de: `Verbunden: ${devices.length} Gerät(e), ${online} online (${names(devices)}).`,
          es: `Conectado: ${devices.length} dispositivo(s), ${online} en línea (${names(devices)}).`,
        }),
      );
    }
    if (home.unsupported.length > 0) {
      parts.push(
        pick(language, {
          en: `Not supported: ${names(home.unsupported, 3)}.`,
          fr: `Non pris en charge : ${names(home.unsupported, 3)}.`,
          de: `Nicht unterstützt: ${names(home.unsupported, 3)}.`,
          es: `No compatible: ${names(home.unsupported, 3)}.`,
        }),
      );
    }
    return parts.join(' ');
  });
}
