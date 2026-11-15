# TCL Home

Diese Integration verbindet Gladys mit deinem **TCL-Home**-Konto und steuert die dort
hinzugefügten TCL-Geräte: **Klimageräte**, **Luftentfeuchter** und **Breeva-Luftreiniger**.

## Bevor du beginnst

- **Gladys 5.3 oder neuer** ist erforderlich.
- Deine Geräte müssen zuerst in der mobilen **TCL-Home**-App funktionieren: Füge sie dort
  hinzu, Gladys koppelt sie nicht.
- Dies ist eine **Cloud**-Integration: Gladys geht über die TCL-Home-Cloud, wie die App. Gladys
  braucht Internet, und nichts funktioniert, solange die TCL-Cloud ausgefallen ist. TCL-Geräte
  bieten keine lokale Steuerung.

TCL veröffentlicht keine offizielle API: Diese Integration macht, was die TCL-Home-App macht.
TCL kann das jederzeit ändern. Sie ist nicht mit TCL verbunden.

## Konfiguration

Öffne in Gladys **Integrationen → TCL Home → Konfiguration**:

| Feld                         | Was eintragen                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------- |
| TCL-Home-E-Mail              | Die E-Mail-Adresse, mit der du dich in der TCL-Home-App anmeldest             |
| TCL-Home-Passwort            | Das Passwort dieses Kontos                                                    |
| Aktualisierungsintervall (s) | Wie oft jedes Gerät gelesen wird, in Sekunden (60 bis 3600, standardmäßig 60) |

Speichere und drücke dann **Verbindung testen**: Es listet die gefundenen Geräte auf, wie viele
online sind, und die TCL-Geräte, die diese Integration nicht steuert (zum Beispiel einen
Fernseher).

Öffne dann den Reiter **Entdecken** der Integration und füge deine Geräte hinzu.

> Tipp: Lege ein zweites TCL-Home-Konto an, teile dein Zuhause in der App mit ihm und gib
> dieses Konto an Gladys. So bleibt dein eigenes Passwort bei dir.

## Geräte und Funktionen

Eine Funktion erscheint nur, wenn dein Gerät sie meldet: Ein Modell ohne horizontale
Lamellenbewegung bekommt keine Steuerung dafür.

### Klimageräte

Split-, Fenster-, mobile, Kanal-, Säulen- und Frischluftgeräte.

| Funktion                                                              | In Gladys                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Ein/Aus                                                               | Ein / aus                                                                   |
| Modus                                                                 | Automatik, Kühlen, Entfeuchten, Lüften, Heizen (je nach Gerät)              |
| Solltemperatur                                                        | 16 bis 31 °C, in ganzen Grad                                                |
| Lüfterstufe                                                           | Automatik, leise, niedrig, mittel-niedrig, mittel, mittel-hoch, hoch, Turbo |
| Vertikale / horizontale Lamellen                                      | Aus, schwenken oder eine von 5 festen Positionen                            |
| Innentemperatur                                                       | Vom Gerät gemessen                                                          |
| Temperatur des Außengeräts                                            | Wenn das Gerät sie meldet                                                   |
| Eco, Schlaf, Gesundheit, Schimmelschutz-Trocknung, Anzeige, Signalton | Ein-/Aus-Schalter                                                           |

Bei einem mobilen Gerät gibt es den Automatikmodus und die Lüfterstufe nur bei Modellen mit
Schwenklamelle.

### Luftentfeuchter

Ein/Aus und Raumfeuchtigkeit.

### Breeva-Luftreiniger

Ein/Aus, PM2.5, Anzeige und Kindersicherung.

### Aktualisierung

Gladys liest jedes Gerät im gewählten Intervall. Nach einem Befehl liest die Integration das
Gerät wenige Sekunden später erneut, damit Gladys zeigt, was es wirklich getan hat.

Ein Gerät, das offline ist, zeigt ein Abzeichen **nicht erreichbar**; online ein Abzeichen
**Cloud**.

## Szenen

### Auslöser

| Auslöser                   | Wann                                            | Variable                                      |
| -------------------------- | ----------------------------------------------- | --------------------------------------------- |
| TCL-Gerät online / offline | Ein Gerät verliert oder findet seine Verbindung | `status`: `online` oder `offline`             |
| Fehler eines TCL-Geräts    | Ein Gerät meldet einen neuen Fehlercode         | `code`: der/die Code(s), durch Komma getrennt |

Beide lassen sich auf ein Gerät beschränken. Sie lösen bei einer Änderung aus: Ein Gerät, das
beim Start von Gladys schon offline ist, oder ein schon vorhandener Fehler löst sie nicht aus.

### Aktionen

| Aktion                      | Was sie tut                                                                                 | Ausgabe                 |
| --------------------------- | ------------------------------------------------------------------------------------------- | ----------------------- |
| TCL-Klimagerät einstellen   | Schaltet das Gerät ein, mit gewähltem Modus, Temperatur und Lüfterstufe (leer: unverändert) | `applied` (wahr/falsch) |
| Alle TCL-Geräte ausschalten | Schaltet alle eingeschalteten TCL-Geräte aus                                                | `count`                 |
| TCL-Selbstreinigung starten | Startet den Selbstreinigungszyklus des Geräts (es schaltet ab), wenn das Modell einen hat   | `started` (wahr/falsch) |

Ein Gerät, das offline ist, hält die Szene nicht an: Die Ausgabe ist `false`, nutze sie bei
Bedarf in einer Bedingung.

Beispiel: „Wenn ich das Haus verlasse, alle TCL-Geräte ausschalten“ oder „Im Sommer um 18 Uhr
das Wohnzimmergerät auf Kühlen mit 24 °C stellen“.

## Dashboard-Widget

Füge das Widget **TCL Home** zu einem Dashboard hinzu. Es zeigt:

- den Zustand des TCL-Home-Kontos und dann jedes Gerät: aus, offline oder Modus und
  Solltemperatur;
- die Live-Innentemperatur der ersten Klimageräte;
- die Schaltflächen **Klimagerät einstellen** (Gerät, Modus, Temperatur, Lüfter), **Alles
  ausschalten** und **Aktualisieren**.

## Fehlerbehebung

| Meldung oder Symptom                                     | Was tun                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| „TCL Home lehnt die E-Mail-Adresse oder das Passwort ab“ | Prüfe sie, indem du dich in der TCL-Home-App anmeldest. Ein mit Google oder Apple angelegtes Konto hat kein Passwort: Lege in der App eines fest oder nutze ein zweites Konto. |
| „TCL Home ist nicht erreichbar“                          | Prüfe den Internetzugang von Gladys. Die Integration versucht es alle 5 Minuten selbst erneut.                                                                                 |
| Ein Gerät fehlt                                          | Ist es in der TCL-Home-App, im selben Konto? „Verbindung testen“ listet die nicht unterstützten auf.                                                                           |
| Ein Befehl scheitert mit „is offline“                    | Das Gerät ist nicht mit der TCL-Cloud verbunden: Prüfe sein WLAN in der TCL-Home-App.                                                                                          |
| Der Zustand ändert sich verspätet                        | Die Cloud wird im Aktualisierungsintervall gelesen: Verringere es (mindestens 60 s).                                                                                           |

Setze die Protokollstufe auf `debug` (Umgebungsvariable `LOG_LEVEL`), um jeden Aufruf zu sehen.
Passwörter und Tokens werden nie in die Protokolle geschrieben.

## Datenschutz

- Das Passwort wird von Gladys in einem geheimen Feld gespeichert und nur an TCL gesendet, als
  MD5-Hash, wie es die App tut.
- Die TCL-Tokens und die temporären AWS-Zugangsdaten bleiben im Speicher, nichts wird auf die
  Festplatte geschrieben.
- Die Integration spricht nur mit TCL (`*.tcl.com`, `*.tcljd.com`) und Amazon Web Services
  (`*.amazonaws.com`), über HTTPS.
