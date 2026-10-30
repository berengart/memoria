# Memoria

Persönliche Wissens- und Tagebuch-App im Docker-Container. Alle Inhalte liegen als **Markdown-Dateien** im Ordner `data/` neben der `docker-compose.yml` – lesbar und editierbar mit jedem Editor, auch mit Obsidian. Die Dateien bleiben die Quelle der Wahrheit; alles andere (Suchindex, Verlauf) ist ableitbar.

## Starten

```bash
docker compose up -d --build
```

App: **http://localhost:4444**. Beim ersten Aufruf legst du das erste Konto an (wird Administrator, Passwort mind. 10 Zeichen). Alternativ `ADMIN_USER`/`ADMIN_PASSWORD` in der `docker-compose.yml` setzen. Voraussetzung ohne Docker: Node.js ≥ 22.5 (wegen `node:sqlite`).

## Funktionen

### Inhalte
- **Personen** (wie Monica): mehrere Telefonnummern, E-Mails und Adressen, Beziehungen (mit automatischer Gegenrichtung, z. B. Eltern ↔ Kind), Aktivitäten/Treffen, Geschenkideen, Schulden (offen/beglichen), Geburtstage, Kontakt-Rhythmus, Foto. Übersicht mit offenen Schulden und Geschenkideen.
- **Familie und Stammbaum**: Im Bearbeiten-Modus einer Person fragt „Verwandt?“ nach Mutter, Vater, Partner:in, Kindern und Geschwistern; unbekannte Namen werden als neue Personen angelegt. Gespeichert werden nur diese direkten Beziehungen im Frontmatter (`type: Elternteil|Kind|Partner|Geschwister`, optional `role: Mutter|Vater`, `ex: true`). Großeltern, Urgroßeltern, Onkel/Tante, Cousins, Nichten/Neffen, Schwager, Schwiegereltern, Stiefeltern und Halbgeschwister werden daraus abgeleitet und als Stammbaum (SVG) mit „＋ Mutter/Vater“-Platzhaltern auf der Personenseite gezeigt. Der Menüpunkt **Stammbaum** zeigt immer den **kompletten Stammbaum aller Personen**, nach Familien gruppiert (Zoom, Personensuche mit Hervorhebung); Personen ohne Verbindung stehen darunter. Auf der Personenseite gibt es zusätzlich den Ausschnitt um diese Person. Jede Person zeigt Lebensdaten und **Alter** (`* 1950 † 2020 (70)`, lebende: `* 1980 (46)`) sowie **Geburts- und Sterbeort** (Felder „Geburtsort“/„Sterbeort“). **Export** als PNG (alle Familien), PDF (eine Seite je Familie) und **GEDCOM** (für Gramps, Ancestry u. a.). Namensvorschläge erscheinen beim Tippen; vor dem Anlegen warnt eine **Dubletten-Erkennung** bei ähnlichen Namen (auch „Mueller/Müller“, vertauschte Namen). Geschlecht und Sterbedatum sind optional. Kreise (jemand als eigener Vorfahre) werden beim Speichern abgelehnt.
- **Zeitleiste pro Person**: Treffen, Tagebucheinträge und Notizen, die die Person erwähnen, chronologisch, filterbar. Aktivitäten lassen sich direkt dort eintragen.
- **Tagebuch** mit `[[Verlinkung]]` wie in Obsidian, Rückverweise, nicht verlinkte Erwähnungen, `#tags`, Graph, Notizen, Vorlagen.
- **Stimmung/Energie**, **Lied des Tages**, Formatierungs-Werkzeugleiste, Bilder und Dateien per Upload/Einfügen/Drag & Drop (`![[datei.png|300]]`).
- **Anhänge nach Typ**: `data/attachments/<typ>/` – z. B. `jpeg`, `png`, `pdf`, `mp3`.
- **Wetter und Ort automatisch eintragen** (Einstellungen → Wetter, standardmäßig aus): Open-Meteo und Nominatim, nur mit deiner Zustimmung; Ort per Browser-Standort oder Stadtname, Wetter auch für vergangene Tage.

### Wohnort, Orte und Karte
- **Adressen** einer Person können **Koordinaten** haben (📍 Adress-Suche oder von Hand „Breite, Länge“). Genau eine Adresse lässt sich als **aktueller Wohnort** ankreuzen; ohne Markierung gilt die erste Adresse mit Koordinaten.
- **Wohnort:** Pro Person gibt es genau **eine Adresse** für den aktuellen Wohnort. **Frühere Wohnorte** trägst du ohne Adresse nur als Ortsnamen ein. Das Feld nimmt eine Kommaliste auf, optional mit Zeitraum: `Muggendorf, Forchheim (1990–2004), Hundsboden (ab 2010), Köln (bis 1985), Bonn (1999)`. Gespeichert als `places:` im Frontmatter (`name`, `lat`, `lon`, `from`, `to`). Auf der **Karte** erscheint das Foto der Person am aktuellen Wohnort in voller Deckkraft, an allen übrigen Orten und Adressen **blass**. Fehlende Koordinaten werden beim Speichern gesucht (nur mit aktivierter Online-Karte, erster Treffer) oder über „Fehlende Orte jetzt suchen“ nachgeholt.
- **Karte** (Menüpunkt): Ziehen/Zoomen, Gruppierung naher Pins, Popup mit Link zur Person, Filter nach Name/Tag/Ort. Dazu:
  - **⏳ Zeitverlauf**: Regler (mit Abspielen) zeigt, wer im gewählten Jahr wo war – anhand der Orte mit Zeitraum; der aktuelle Wohnort gilt nur für das laufende Jahr.
  - **👪 Familie**: nur eine Familie oder die „Verwandten von …“ einer Person zeigen, Eltern-Kind- und Partner-Beziehungen als Linien zwischen den Wohnorten.
  - **📓 Tagebuch-Orte**: das Ortsfeld der Tagebucheinträge als Pins (mit Links zu den Einträgen; Koordinaten werden einmal gesucht und lokal zwischengespeichert).
  - **📏 Umkreissuche**: „Wer wohnt im Umkreis von X km?“ um eine Person, den eigenen Standort oder eine Adresse, sortiert nach Entfernung, mit Hinweis auf überfällige Kontaktwünsche.
- Die Karte ist eigenständig geschrieben, ohne Fremdbibliothek. **Ohne Aktivierung der Online-Karte** (Einstellungen → Wetter & Ort) wird nichts übertragen: kein Kartenhintergrund, keine Adress-Suche; Orte mit selbst eingetragenen Koordinaten erscheinen trotzdem als Pins.
- **Mit Aktivierung** gehen Adressen (nur beim Suchen) an OpenStreetMap/Nominatim, und der Browser lädt Kacheln von `TILE_URL` (Standard `tile.openstreetmap.org`; dabei sind IP-Adresse, Kartenausschnitt und App-Adresse sichtbar). Für intensive Nutzung die OSM-Nutzungsbedingungen beachten oder einen eigenen Tile-Server eintragen. Die CSP erlaubt nur diese eine Kachel-Adresse.

### Erfassen und Bedienen
- **⚡ Schnell erfassen** (＋-Knopf unten rechts oder Taste `N`): Personen (Komma, mit Vorschlägen), Text, Ort, Datum, **Foto** und **Sprachnotiz** (Mikrofon, braucht HTTPS oder localhost) landen als verlinkte Zeile im Tagebuch des Tages; optional zusätzlich als Treffen bei den Personen. Unbekannte Namen werden angelegt.
- **Befehlspalette** `Strg/Cmd + K`: Seiten, Personen, Notizen und Befehle schnell finden. **Tastenkürzel**: `G` dann `U/H/P/S/K/T/N/M/L/G/R/C/E` springt zu Übersicht, Heute, Personen, Stammbaum, Karte, Tagebuch, Notizen, Stimmung, Lieder, Graph, Rückblick, Prüfung, Einstellungen; `/` sucht, `?` zeigt die Hilfe. Im Editor bleibt `Strg+K` = Link einfügen.
- **🎞️ Jahresrückblick** (`#/review`): Einträge, Wörter, Ø Stimmung, Stimmungsverlauf je Monat, beste/schwerste Tage, längste Serie, wichtigste Menschen, Orte, Lieder, Themen, Treffen – druckbar.
- **📅 Kalender-Abo** (Einstellungen → Daten): geheimer `.ics`-Link mit Geburtstagen, Todestagen, fälligen Kontaktwünschen und geplanten Treffen für Google/Apple/Thunderbird/Nextcloud; jederzeit ersetz- oder widerrufbar. Memoria muss dafür vom Kalenderdienst erreichbar sein.
- **🧹 Datenprüfung** (`#/check`): findet Links ins Leere, Beziehungen auf fehlende Personen, fehlende Fotos und eingebettete Dateien, Stammbaum-Kreise, ungenutzte Anhänge und mögliche Dubletten und bietet – nur auf Klick – Reparaturen an (Notiz/Person anlegen, Beziehung entfernen, Anhang in den Papierkorb).

### Suche, Index, Live-Aktualisierung
- **Volltextsuche** (SQLite FTS5) mit Filtern (Typ, Person, Tag, Zeitraum), Treffer-Markierung, Umlaute werden toleriert.
- **Datenbank-Index statt Scan**: `.system/index/<konto>.sqlite` ist nur ein Cache. Beim Start werden nur Dateien neu gelesen, deren Größe oder Änderungszeit abweicht. Löschen ist jederzeit gefahrlos.
- **Filewatcher**: Änderungen an den Markdown-Dateien von außen (Obsidian, Editor, Sync) werden erkannt und im offenen Browser live aktualisiert.

### Verlauf, Konflikte, Sicherung
- **Versionsverlauf** je Datei (bis 60 Stände, höchstens alle 3 Minuten) mit Diff-Ansicht und Wiederherstellung; liegt in `.history/`.
- **Konfliktbehandlung beim WebDAV-Sync**: Richtlinie *neuere gewinnt*, *lokal* oder *entfernt*. Die unterlegene Fassung wird aufgehoben und kann unter Einstellungen → WebDAV-Sync verglichen und übernommen werden.
- **Backup-Download** als ZIP (optional mit Verlauf) unter Einstellungen → Daten.
- **Import**: Obsidian-/Markdown-ZIP oder einzelne `.md`, Day One (JSON-ZIP), vCard (`.vcf`), Memoria-Backup. vCard-Export für Personen.

### Verschlüsselung (optional, je Eintrag)
- Der **Text** wird im Browser mit AES-256-GCM verschlüsselt (Schlüssel per PBKDF2, 600 000 Runden aus deiner Passphrase). Der Server sieht nur den Chiffretext.
- **Nicht** verschlüsselt: Titel, Datum, Stimmung, Tags, Anhänge, Dateinamen. Verschlüsselte Texte sind nicht durchsuchbar und werden nicht indiziert.
- **Vergisst du die Passphrase, sind die Texte unwiederbringlich verloren.** Frühere Klartext-Stände im Verlauf werden beim Verschlüsseln gelöscht; Kopien im Papierkorb oder auf einem WebDAV-Ziel bleiben aber bestehen.

### Erinnerungen
- Tägliche Zusammenfassung (Geburtstage, „Mal wieder melden“, „An diesem Tag“) und Tagebuch-Erinnerung per **E-Mail (SMTP)**, **ntfy** (Push aufs Handy) oder **Webhook**. SMTP wird über die `SMTP_*`-Variablen in der `docker-compose.yml` eingerichtet; ntfy/Webhook in den Einstellungen.
- Kein klassisches Web-Push (VAPID) – dafür ntfy.

### Deutsche Formate
- Datumsfelder erwarten **TT.MM.JJJJ** (auch „1.3.20“ oder „TT.MM.“ für Geburtstage ohne Jahr) und haben einen Kalender-Knopf; Uhrzeiten sind 24-Stunden-Zeiten (HH:MM). Gespeichert wird weiterhin ISO (JJJJ-MM-TT), damit die Markdown-Dateien kompatibel bleiben.

### Aufbau der Oberfläche
- **Menü:** Übersicht · Menschen (mit Reitern Personen / Stammbaum / Karte) · Tagebuch · Notizen · „Mehr“ (Stimmung, Lieder, Graph, Rückblick, Datenprüfung, Tastenkürzel). Am Handy sitzt in der unteren Leiste ein ＋ zum schnellen Erfassen, am Computer der Knopf „⚡ Erfassen“.
- **Übersicht:** zuerst „Heute“ (schreiben, kurz festhalten, Stimmung), dann Dringendes (Geburtstage, „Mal melden“, „An diesem Tag“), dann Verlauf und zuletzt der Bestand.
- **Personenseite** mit Reitern: Überblick · Zeitleiste · Familie & Orte · Geschenke & Schulden (der zuletzt benutzte Reiter bleibt in der Sitzung gewählt, direkt öffnen mit `?tab=fam`).
- **Karte:** Filter in einer einklappbaren Seitenleiste (am Handy ein Fenster von unten). Pins: Wohnort mit farbigem Rand, weitere Orte blass mit gestricheltem Rand.
- **Stammbaum:** Foto am Kästchen, leichter Farbton nach Geschlecht, „Vorfahren hervorheben“ (nach Personensuche), Minikarte bei großen Familien.
- **Barrierefreiheit:** sichtbarer Fokus, „Zum Inhalt springen“, ARIA für Menüs/Reiter, Tastatur für Karte und Reiter, reduzierte Bewegung, Kontrast aller Themes mindestens 4,5 : 1 für Text und Links.

### Familien, Geburtsname und Orte (Auswahl)
- **Stammbaum nach Familien:** Familien werden nach dem Geburtsnamen gebildet (Mädchenname, sonst Nachname). Eine Familie zeigt ihre Mitglieder plus Partner, Eltern und Kinder (gestrichelt = angeheiratet/andere Familie). Die gleiche Person kann so in zwei Familien erscheinen, z. B. Anna Müller (geb. Schmidt) bei Müller und bei Schmidt.
- **Mädchenname / Geburtsname:** eigenes Feld bei der Person; im Stammbaum „geb. …“, im GEDCOM-Export als Geburtsname.
- **Automatische Verbindungen:** Gegenrichtungen (Mutter ↔ Kind, Partner, Geschwister über gemeinsame Eltern, Großeltern …) werden abgeleitet; geben Sie Mutter und Vater an, werden diese automatisch als Paar eingetragen.
- **Mehrdeutige Orte:** Gibt es mehrere Orte mit demselben Namen (z. B. Muggendorf in Bayern und in Österreich), erscheint eine Auswahl. Die Wahl wird mit Region gespeichert; „🔄 Orte neu auswählen“ im Editor wiederholt die Auswahl. Gilt auch für Adressen und Tagebuch-Orte.

### Look & Bedienung (Modern-Pass)
- **Schrift Inter** (lokal ausgeliefert, SIL OFL), größere Rundungen, weichere Flächen, glasige Kopfzeile, kräftigeres Indigo als Standard-Akzent; alle Themes bleiben, Kontrast ≥ 4,5 : 1.
- **Linien-Icons** (Lucide, eingebettet) ersetzen die Emojis in Menüs, Knöpfen und Überschriften; Inhalte (Texte, Stimmungs-Emojis) bleiben unverändert.
- **Seitenleiste** am Computer (einklappbar, Wahl wird gemerkt); am Handy bleibt die untere Leiste mit ＋.
- **Übersicht** mit Wochenstreifen (Stimmungspunkte, Klick öffnet den Tag), **Personen** als Kacheln mit Kontakt-Ampel oder als Liste, **ruhiger Editor** (Werkzeugleiste blass, bis man schreibt).
- Weiche Übergänge und Lade-Platzhalter (bei „reduzierte Bewegung“ abgeschaltet), Stammbaum mit runden Kästchen und größeren Fotos, runde Karten-Pins und ruhigerer Kartenstil.

### Mobil
- Installierbare **PWA** (Manifest, Service Worker, Offline-Lesen bereits geladener Seiten), Navigation unten, große Tippflächen, Teilen-Ziel und Schnellzugriff „Heute“. Entwürfe werden lokal zwischengespeichert.

### Sicherheit
- Passwörter mit scrypt, mind. 10 Zeichen plus Liste schwacher Passwörter; Sperre pro Konto nach 5 Fehlversuchen (30 s, verdoppelt sich bis 15 min) und Begrenzung pro IP.
- **Zwei-Faktor (TOTP)** mit 8 Wiederherstellungscodes (ohne QR-Code: Geheimnis und `otpauth://`-Link werden angezeigt), Sitzungsübersicht mit Abmelden, Audit-Log.
- CSP, X-Frame-Options, Referrer-/Permissions-Policy, HSTS hinter HTTPS, Origin-/Fetch-Metadata-Prüfung gegen CSRF, SSRF-Schutz für ausgehende URLs (kein Zugriff auf Link-Local-/Metadaten-Adressen).
- Hinter einem Reverse-Proxy `TRUST_PROXY=1` setzen und **HTTPS** davor betreiben.

### Weiteres
- **WebDAV-Sync**: beidseitig, nur hoch oder nur runter; manuell oder automatisch; Sicherheitsstopp bei Massenlöschung.
- **Themes** (Nord, Dracula, Solarized, Gruvbox, Catppuccin, …), Akzentfarbe, Dichte, Schriften; **Funktionsumfang** *Minimal, Standard, Tagebuch, Kontakte, Pro* oder individuell.

### Editor (formatiert, wie in Obsidian)
Der Text wird immer formatiert angezeigt und direkt so bearbeitet – Markdown-Zeichen sieht man nicht. Wer Markdown tippt, bekommt sofort das Ergebnis: `# ` Überschrift, `- ` Liste, `1. ` nummerierte Liste, `> ` Zitat, `[ ] ` Aufgabe, `**fett**`, `*kursiv*`, `~~durch~~`, `` `code` ``, ``` ``` ``` + Enter Codeblock, `---` + Enter Trennlinie, `[[Name]]` Verknüpfung (mit Vorschlägen). Die Werkzeugleiste und Strg+B/I/K/E arbeiten auf dem formatierten Text. Der Knopf **Markdown** zeigt den ganzen Text roh und lässt ihn dort bearbeiten (wird gemerkt) – das ist auch der Weg für Tabellen und Sonderfälle. Gespeichert wird weiterhin reines Markdown; unveränderte Absätze werden unverändert zurückgeschrieben.

### Datum ändern und Art umwandeln
Im Bearbeiten-Formular gibt es für Tagebucheinträge und Notizen ein Feld **Datum** (bei Notizen optional). Ändert man das Datum eines Tagebucheintrags, wird die Datei auf den neuen Tag umbenannt (Verlauf und Verknüpfungen `[[2026-03-05]]` wandern mit; gibt es am Zieltag schon einen Eintrag, entsteht ein zusätzlicher mit Titel im Namen). Über **Art des Eintrags** wird eine Notiz in einen Tagebucheintrag umgewandelt und umgekehrt (beim Umwandeln in ein Tagebuch zählt das Datumsfeld, sonst das Notizdatum bzw. der Tag der letzten Änderung).

## Daten

```
data/
  people/  journal/  notes/  templates/
  attachments/jpeg/  attachments/pdf/ …
  users/<name>/…        (weitere Konten)
  .system/              (Konten, Sitzungen, Schlüssel, Index, Audit-Log – nicht weitergeben)
  .history/  .conflicts/  .trash/
```

## Architektur

`server.js` (schlank) · `lib/` (Vault, Index, Sync, Auth, Mail, Benachrichtigungen, Wetter, Import, ZIP …) · `routes/` (auth, account, settings, data, tools) · `public/` (Frontend als kleine Module, ohne Build-Schritt).

## Hinweise

- WebDAV: Self-signed-TLS-Zertifikate werden nicht akzeptiert; bei Nextcloud ein App-Passwort nutzen.
- `node:sqlite` ist in Node 22 noch als experimentell markiert; die Warnung wird unterdrückt. Der Index ist reiner Cache und kann gelöscht werden.
- Beim Löschen eines Kontos bleiben dessen Dateien erhalten.
- Sicherung: `data/` kopieren oder das Backup-ZIP herunterladen.
