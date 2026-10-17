# Bedienungsanleitung

[README](../README.md) · [Entwicklung und Architektur](ENTWICKLUNG.md)

## Vorlagen und Konfigurationen

Eine Vorlage definiert die verfügbaren Felder, ihre Struktur und Beispielwerte. Nach dem Laden sind zunächst keine Felder ausgewählt. Eine Beispielvorlage liegt unter [examples/template.yml](../examples/template.yml).

**Konfiguration importieren** übernimmt eine YAML-Datei als Arbeitsstand. Vorhandene Felder werden ausgewählt und ihre Werte geladen. Zusätzliche Felder bleiben erhalten; weitere Vorlagenfelder bleiben ergänzbar. Listen werden vollständig aus der importierten Konfiguration übernommen.

Dateien werden über die Dateidialoge oder den VS-Code-Befehl **Mit EZY als Vorlage öffnen** geladen. Drag-and-drop wird nicht unterstützt.

## Felder und Auswahl

- Checkboxen steuern die Aufnahme in die Ausgabe. Auswahl und Wert eines Boolean-Felds sind unabhängig; auch `false` kann ausdrücklich ausgewählt werden.
- Gruppencheckboxen wählen sämtliche Unterfelder aus oder ab. Teilweise ausgewählte Gruppen zeigen einen Zwischenzustand.
- Die Typauswahl unterstützt Text, Zahl, Boolean und `null`. Mehrzeilige Texte sind bearbeitbar.
- Abwählen entfernt ein Feld aus der Ausgabe, erhält jedoch seinen bearbeiteten Wert im Arbeitsstand.
- Ungültige Werte blockieren den Export, wenn das betreffende Feld ausgewählt ist.

## Listen

Listeneinträge können bearbeitet, ergänzt und entfernt werden. **Wie Vorlage** übernimmt beim Hinzufügen den Beispielwert beziehungsweise die Struktur des ersten Listenelements.

Für leere Listen kann der Typ neuer Einträge gewählt werden. Neu angelegte Objekte können zusätzliche Felder erhalten.

## Suche und Filter

Die Suche berücksichtigt Namen, Pfade und Hilfetexte. Die Filter **Alle**, **Ausgewählt** und **Nicht ausgewählt** können mit der Suche kombiniert werden. Suche und Filter verändern die Auswahl nicht.

## Kommentare als Hilfetext

Nur aktive YAML-Einträge erzeugen bearbeitbare Felder. Kommentare erscheinen beim zugehörigen Feld oder Abschnitt als Hilfetext. Zeilenumbrüche, Leerzeilen und Einrückungen innerhalb der Kommentare bleiben erhalten; das Kommentarzeichen und ein folgendes Leerzeichen werden entfernt.

Auskommentierte Optionen, Beispiele und alternative Werte bleiben Hilfetext. Für eine Bearbeitung als Feld muss die Option in der Vorlagendatei aktiviert und die Vorlage erneut geladen werden. Rautezeichen innerhalb von Textwerten bleiben Bestandteil des Werts.

## Vorschau und Ausgabe

Die Vorschau enthält ausschließlich ausgewählte Felder und deren erforderliche Elternobjekte. Kommentare und ursprüngliche Formatierung werden nicht exportiert.

**Speichern unter …** öffnet den VS-Code-Speicherdialog. Die Vorlage wird nicht automatisch überschrieben. **Kopieren** übernimmt den Vorschautext in die Zwischenablage.

Die Anwendung prüft YAML-Struktur und Werttypen. Fachliche Vollständigkeit, Pflichtfelder, zulässige Werte und Abhängigkeiten der Zielanwendung werden nicht validiert.

## Sitzung und Zurücksetzen

| Aktion | Verhalten |
| --- | --- |
| Tabwechsel | Der aktuelle Arbeitsstand bleibt erhalten. |
| **Änderungen zurücksetzen** | Stellt die importierte Konfiguration wieder her; ohne Import wird die leere Vorlagenauswahl hergestellt. |
| **Zur Startseite** | Entfernt Vorlage, Importbasis, Werte und Auswahl aus der Sitzung. |
| EZY-Tab schließen | Beendet die Sitzung ohne automatische Wiederherstellung. |
| Neue Vorlage laden | Erfordert bei bereits geladener Vorlage eine Bestätigung zum Verwerfen des Arbeitsstands. |
| Dialog abbrechen oder ungültige Datei laden | Erhält den bisherigen Arbeitsstand. |

Autosave und Synchronisierung mit Texteditoren sind nicht implementiert. Externe Dateiänderungen werden erst nach erneutem Laden übernommen.

## Unterstützte Vorlagen

- Ein YAML-Dokument mit Objektwurzel, einfachen Textschlüsseln, verschachtelten Objekten und Listen.
- YAML-Core-Typen: Text, endliche und sicher darstellbare Zahlen, Boolean und `null`.
- Schlüssel mit Punkten, Platzhalter wie `${app.configDir}`, URLs und Hashes.
- Vorlagengröße bis 5 MB; zusätzliche Begrenzungen für Verschachtelung und Knotenzahl.

Nicht unterstützt werden komplexe Schlüssel, unzitierte numerische oder Boolean-Schlüssel, Anker, Aliase, benutzerdefinierte Tags und mehrere Dokumente pro Datei.
