# EZY – Easy YAML für VS Code

EZY macht YAML-Vorlagen als Formular bearbeitbar: Felder auswählen, Werte anpassen und das Ergebnis direkt in der Live-Vorschau prüfen. Bestehende Konfigurationen lassen sich als Arbeitsstand übernehmen und ergänzen.

Alles läuft lokal in VS Code – ohne Server, externe Ressourcen oder Telemetrie. Unterstützt wird Desktop-VS-Code ab Version 1.85.

## Funktionen

- Verschachtelte Felder und Listen bearbeiten.
- Nur ausgewählte Optionen exportieren.
- Optionen nach Namen, Pfaden, Hilfetexten und Auswahl filtern.
- Kommentare aus der Vorlage als Hilfetext anzeigen.
- YAML speichern oder in die Zwischenablage kopieren.

Zum Beispiel: Aus dieser Vorlage nur `enabled` auswählen und auf `false` setzen:

```yaml
app:
  enabled: true
  port: 8080
```

Die Ausgabe enthält nur das ausgewählte Feld und sein Elternobjekt:

```yaml
app:
  enabled: false
```

## Installation und Schnellstart

Aktuell wird EZY als lokales VSIX installiert; eine Marketplace-Version gibt es noch nicht. Zum Bauen werden Node.js ab 22 und npm benötigt:

```sh
npm ci
npm run package
```

1. In VS Code **Extensions: Install from VSIX…** aufrufen und das erzeugte `ezy-easy-yaml-<Version>.vsix` auswählen. Nach einem Update **Developer: Reload Window** ausführen.
2. **EZY: Konfigurator öffnen** ausführen oder eine YAML-Datei rechts anklicken und **Mit EZY als Vorlage öffnen** wählen.
3. Eine Vorlage laden, zum Beispiel [examples/template.yml](examples/template.yml). Optional **Bestehende Konfiguration laden** wählen.
4. Felder auswählen, Werte bearbeiten und über **Speichern unter …** oder **Kopieren** exportieren.

Mehr zur Bedienung: [Felder, Listen, Kommentare und Arbeitsstand](docs/BEDIENUNG.md).

## Grenzen

- Kommentare und ursprüngliche Formatierung werden nicht exportiert. Auskommentierte Optionen bleiben Hilfetext.
- Kein Autosave und keine Sitzungswiederherstellung nach dem Schließen des EZY-Tabs. Externe Dateiänderungen müssen erneut geladen werden.
- Ein YAML-Dokument mit Objektwurzel, höchstens 5 MB. Anker, Aliase und benutzerdefinierte Tags werden nicht unterstützt.

Weitere Details: [Unterstützte Vorlagen](docs/BEDIENUNG.md#unterstützte-vorlagen).

## Entwicklung

Nach `npm ci` das Repository in VS Code öffnen und F5 drücken. Der Development Host baut die Webview automatisch. `npm test` prüft Kern und Host; `npm run test:ui` prüft die Oberfläche in Chrome.

[Entwicklungsumgebung, Architektur, Kern-API und Tests](docs/ENTWICKLUNG.md)

## Lizenz

[MIT](LICENSE). Die Lizenzhinweise mitgelieferter Abhängigkeiten bleiben erhalten.
