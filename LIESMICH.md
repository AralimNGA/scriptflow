# ScriptFlow — PowerShell → Diagramm

English: [README.md](README.md) · Live-Demo: <https://aralimnga.github.io/scriptflow/>

Lokales, komplett offline funktionierendes Tool, das PowerShell-Scripts automatisch
grafisch darstellt — für das Scripting-Modul der Berufsschule (Lernziele «Darstellung»).

![Skript links, Flussdiagramm rechts](docs/screenshots/flowchart.png)

## Was es kann

- **Flussdiagramm** (DIN-66001-Stil): Start/Ende, Prozess, Entscheidung (Raute),
  Ein-/Ausgabe (Parallelogramm), Schleifen mit Rücksprung-Pfeilen, Funktionsaufrufe,
  try/catch-Container. Erkennt `if/elseif/else`, `switch`, `while`, `do…while/until`,
  `for`, `foreach`, `function`, `try/catch/finally`, `return/break/continue`.
- **Struktogramm** (Nassi-Shneiderman): die kompakte Darstellung ohne Pfeile.
- **Mermaid-Code**: die *bearbeitbare* Variante — in draw.io importierbar
  (Extras → Einfügen → Erweitert → Mermaid), auf mermaid.live oder als
  ```` ```mermaid ````-Block in Markdown/Obsidian/GitLab.
- **Export**: PNG (2×-Auflösung, für Word/OneNote) und SVG, optional mit Beschriftung
  («Abbildung 1: …») direkt im Bild.
- **Live**: Script links ändern → Diagramm aktualisiert sich sofort.
  Klick auf eine Form markiert die zugehörige Code-Zeile.
- Jede Funktion bekommt ihr eigenes Teildiagramm.
- **Detailgrad umschaltbar** (Detailliert / Einfach): «Einfach» übersetzt Befehle in
  verständliches Deutsch («Eingabe: …», «Dateien auflisten», `-gt` → `>`), fasst
  aufeinanderfolgende Ausgaben zusammen und zeigt Funktionsaufrufe als «Funktion: Name» —
  gut für die Doku-Zielgruppe ohne PowerShell-Kenntnisse; «Detailliert» zeigt den echten Code.
- **Kommentare werden genutzt:** Ein `#`-Kommentar direkt über einer Zeile wird im
  Einfach-Modus zur Beschriftung der Form (auch bei if-Rauten). Der Kopfkommentar des
  Scripts wird zum «Zweck».
- **Auto-Beschreibung:** Über dem Diagramm fasst ein Panel «Was macht dieses Script?»
  Zweck, Parameter, Ablauf und Funktionen in Sätzen zusammen — mit Kopier-Knopf als
  fertige Einleitung für die Dokumentation.

## Starten

- **Mac:** Doppelklick auf `serve.command` (startet einen Mini-Server auf Port 8666), oder
- **überall (auch Schul-PC):** einfach `index.html` doppelklicken — läuft direkt im
  Browser, keine Installation, kein Internet nötig. Zum Mitnehmen den ganzen Ordner
  kopieren.
- **Eine Datei zum Mitnehmen:** `node build.js` erzeugt `dist/ScriptFlow.html` mit allen
  Modulen eingebettet. `dist/` wird nicht eingecheckt (die Datei gehört als Anhang in ein
  Release).

## Aufbau

- `index.html` — App-Oberfläche (Editor, Tabs, Export)
- `js/parser.js` — PowerShell-Parser → AST
- `js/flowchart.js` — Flussdiagramm-Renderer (SVG)
- `js/struktogramm.js` — Struktogramm-Renderer (SVG)
- `js/mermaid.js` — Mermaid-Export
- `build.js` — baut die Einzeldatei `dist/ScriptFlow.html`
- `serve.js` / `serve.command` — Mini-Server ohne Abhängigkeiten (Port 8666)
- `tests/` — `node tests/test-<modul>.js`, plus `fixtures-*.html` zur visuellen Kontrolle;
  `mermaid-live-check.html` prüft den Mermaid-Export gegen echtes Mermaid 11 (lädt es von
  jsDelivr, braucht also Internet — nur diese Testseite)
- `CONTRACT.md` — verbindlicher Vertrag für AST & Modul-APIs

Ohne Abhängigkeiten: reines HTML/CSS/JS, keine Bibliotheken, kein Build nötig.

## Entstehung

Gebaut mit KI-Coding-Agenten (Claude Code): Parser, Renderer und Oberfläche entstanden
parallel gegen den Vertrag in `CONTRACT.md`, ein Review-Durchgang mit mehreren Agenten fand
11 Fehler, die alle behoben sind (die meisten mit Regressionstest). Details im englischen
[README](README.md#how-it-was-built).

## Lizenz

MIT, siehe [LICENSE](LICENSE).
