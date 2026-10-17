# Grafikdateien

[README](../README.md) · [Entwicklung und Architektur](ENTWICKLUNG.md)

## Extension-Icon

| Datei | Verwendung |
| --- | --- |
| `assets/icon.svg` | Bearbeitbare Vektorquelle. |
| `assets/ezy-icon.png` | Gerenderte PNG-Datei mit 256 × 256 Pixeln, über `package.json.icon` eingebunden. |

Das Icon zeigt den Schriftzug EZY in Creme (`#F5EFE6`), einen Apricot-Punkt und zwei eingerückte YAML-Zeilen (`#E8A25A`) auf Graphit (`#1A1712`). Die SVG-Quelle verwendet Arial mit einer generischen Sans-Serif-Ersatzschrift. Das gerenderte PNG hält die Darstellung für die Extension unabhängig von lokal installierten Schriften fest.

Das Icon wird in der Extension-Liste und der Extension-Detailansicht angezeigt. Es erzeugt keinen eigenen Eintrag in der Activity Bar. Die VS-Code-Spezifikation verlangt mindestens 128 × 128 Pixel und nennt 256 × 256 Pixel für Retina-Displays; siehe [Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest).

Für Änderungen wird die SVG-Quelle bearbeitet und anschließend die PNG-Datei neu erzeugt. Maßgeblich ist die Erkennbarkeit bei kleinen Darstellungen; Schriftzug, Punkt und Zeilen bleiben deshalb auf wenige klare Elemente reduziert.

## README-Screenshot

`docs/images/ezy-editor.png` zeigt die tatsächliche Webview mit einer generischen Beispielvorlage, ausgewählten Feldern und erzeugter YAML. Der Screenshot enthält weder lokale Projektpfade noch Inhalte einer produktiven Konfiguration. Die VS-Code-Fensterumgebung ist nicht Bestandteil der Aufnahme.

Die Aufnahmesequenz ist in `test/ui.cjs` definiert. Sie setzt den Arbeitsstand zurück, lädt die Beispielkonfiguration und erstellt einen Screenshot mit 1440 × 1040 Pixeln. Vorher durchläuft dieselbe Oberfläche die UI-Prüfungen. Dateidialoge und Host-Antworten werden über die bestehende Testbrücke simuliert.

## Erzeugung

Voraussetzungen: installierte npm-Abhängigkeiten und Chrome im Windows-Standardpfad oder über `EZY_CHROME`.

```sh
npm run assets
```

Der npm-Hook baut zunächst die Webview. `scripts/assets.cjs` startet anschließend die UI-Prüfungen mit Ausgabezielen für Screenshot und Icon. Chrome rendert beide Dateien; zusätzliche Grafikpakete sind nicht erforderlich.

Die SVG-Quelle und die beiden erzeugten PNG-Dateien werden versioniert. Damit stehen das Icon bereits beim Paketieren und der Screenshot unmittelbar auf GitHub zur Verfügung. Die CI baut die PNG-Dateien nicht erneut.

Nach Änderungen an Texten, Darstellung oder SVG-Quelle:

1. `npm run assets` ausführen.
2. Screenshot und Icon visuell prüfen, einschließlich Lesbarkeit auf schmalen Ansichten und kleiner Icon-Darstellung.
3. Quellen und aktualisierte PNG-Dateien gemeinsam committen.

Das VSIX enthält das PNG-Icon und die README-Grafik. Das Icon ist keine Webview-Ressource und benötigt daher keine Anpassung der Webview-Sicherheitsrichtlinie.
