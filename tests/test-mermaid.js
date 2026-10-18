/*
 * ScriptFlow — Tests für js/mermaid.js
 * Ausführen aus dem Projektwurzelverzeichnis:  node tests/test-mermaid.js
 * Exit-Code 0 bei Erfolg. Fixtures VON HAND gemäss CONTRACT.md gebaut —
 * parser.js wird bewusst NICHT importiert.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { toMermaid } = require(path.join(__dirname, '..', 'js', 'mermaid.js'));

// ---------------------------------------------------------------------------
// Fixture-Helfer (AST-Formen exakt nach CONTRACT.md)
// ---------------------------------------------------------------------------
let lineNo = 0;
const P = (text, io = null, calls = []) =>
  ({ type: 'process', text, io, calls, line: ++lineNo });
const IF = (branches, elseBody = null) =>
  ({ type: 'if', branches, elseBody, line: ++lineNo });
const BR = (cond, body) => ({ cond, body });
const WHILE = (cond, body) => ({ type: 'while', cond, body, line: ++lineNo });
const DO = (kind, cond, body) => ({ type: 'doloop', kind, cond, body, line: ++lineNo });
const FOREACH = (header, body) => ({ type: 'foreach', header, body, line: ++lineNo });
const SWITCH = (subject, cases, defaultBody = null) =>
  ({ type: 'switch', subject, cases, defaultBody, line: ++lineNo });
const TRY = (body, catches, finallyBody = null) =>
  ({ type: 'try', body, catches, finallyBody, line: ++lineNo });
const JUMP = (kind, text) => ({ type: 'jump', kind, text, line: ++lineNo });

// ---------------------------------------------------------------------------
// Generische Struktur-Checks für jede Ausgabe
// ---------------------------------------------------------------------------
const EDGE_RE = /^(n\d+|sg\d+) (?:-->|-\.->)(?:\|[^|]*\|)? (n\d+|sg\d+)$/;

function checkBasics(out, name) {
  assert.strictEqual(typeof out, 'string', name + ': Ausgabe ist ein String');
  assert.ok(out.startsWith('flowchart TD'), name + ": beginnt mit 'flowchart TD'");

  const lines = out.split('\n');
  const declared = new Set();
  let subgraphOpen = 0;
  let subgraphClose = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;

    // Ausgewogene doppelte Anführungszeichen auf jeder Zeile
    const quotes = (line.match(/"/g) || []).length;
    assert.strictEqual(quotes % 2, 0,
      name + ': unausgeglichene Anführungszeichen in Zeile: ' + line);

    // Kein Label darf über das Zeilenende hinaus offen bleiben
    assert.ok(!/[\[({]"[^"]*$/.test(line),
      name + ': offenes Label am Zeilenende: ' + line);

    // Deklarationen sammeln
    const decl = line.match(/^(n\d+)[\[({]/);
    if (decl) declared.add(decl[1]);
    const sub = line.match(/^subgraph (sg\d+)/);
    if (sub) { declared.add(sub[1]); subgraphOpen++; }
    if (line === 'end') subgraphClose++;

    // Jede Kante darf nur bereits deklarierte Ids referenzieren
    const edge = line.match(EDGE_RE);
    if (edge) {
      assert.ok(declared.has(edge[1]),
        name + ': Kante nutzt undeklarierte Id ' + edge[1] + ': ' + line);
      assert.ok(declared.has(edge[2]),
        name + ': Kante nutzt undeklarierte Id ' + edge[2] + ': ' + line);
    } else {
      // Zeilen mit Pfeil, die nicht dem Kantenformat entsprechen, sind Fehler
      assert.ok(!/-->|-\.->/.test(line),
        name + ': Kantenzeile mit unerwartetem Format: ' + line);
    }
  }

  assert.strictEqual(subgraphOpen, subgraphClose,
    name + ': subgraph/end nicht ausgeglichen (' + subgraphOpen + '/' + subgraphClose + ')');
}

// Deklarationszeile finden, deren Label `needle` enthält; gibt die Id zurück.
function findNodeId(out, needle) {
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(n\d+)[\[({]/);
    if (m && line.includes(needle)) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test-Runner
// ---------------------------------------------------------------------------
let failures = 0;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok - ' + name);
  } catch (e) {
    failures++;
    console.error('FAIL - ' + name);
    console.error('  ' + (e && e.message ? e.message : e));
  }
}

// ---------------------------------------------------------------------------
// 1) if/elseif/else — |Ja|/|Nein|, Titel-Terminator, Ende, Escaping
// ---------------------------------------------------------------------------
const ifBody = [
  P('$name = Read-Host "Wie heisst du?"', 'input'),
  IF(
    [
      BR('$name -eq "Alex"', [P('Write-Host "Hallo Alex"', 'output')]),
      BR('$name.Length -gt 10', [P('Write-Host "Langer Name"', 'output')])
    ],
    [P('Write-Host "Unbekannt"', 'output')]
  ),
  P('$fertig = $true')
];
const outIf = toMermaid(ifBody, { title: 'Begruessung' });

test('if/elseif/else: Grundstruktur', () => checkBasics(outIf, 'if'));
test('if/elseif/else: |Ja| und |Nein| vorhanden', () => {
  assert.ok(outIf.includes('|Ja|'), 'enthaelt |Ja|');
  assert.ok(outIf.includes('|Nein|'), 'enthaelt |Nein|');
});
test('if/elseif/else: Start-Titel und Ende-Terminator', () => {
  assert.ok(outIf.includes('(["Begruessung"])'), 'Titel-Terminator');
  assert.ok(outIf.includes('(["Ende"])'), 'Ende-Terminator');
});
test('if/elseif/else: I/O-Knoten als Parallelogramm', () => {
  assert.ok(/n\d+\[\/"/.test(outIf), 'enthaelt [/"..."/]-Knoten');
});

// ---------------------------------------------------------------------------
// 2) foreach — Hexagon, Rücksprung, Exit `fertig`
// ---------------------------------------------------------------------------
const outFe = toMermaid([
  FOREACH('$f in Get-ChildItem *.txt', [
    P('Add-Content log.txt $f.Name', 'output')
  ])
]);
test('foreach: Grundstruktur', () => checkBasics(outFe, 'foreach'));
test('foreach: Hexagon-Kopf und fertig-Exit', () => {
  assert.ok(/n\d+\{\{"/.test(outFe), 'Hexagon {{"..."}} vorhanden');
  assert.ok(outFe.includes('|fertig|'), 'Exit-Kante |fertig| vorhanden');
});
test('foreach: Rumpf springt zum Hexagon zurueck', () => {
  const hexId = findNodeId(outFe, '{{"');
  const bodyId = findNodeId(outFe, 'Add-Content');
  assert.ok(hexId && bodyId, 'Ids gefunden');
  assert.ok(outFe.split('\n').some(l => l.trim() === bodyId + ' --> ' + hexId),
    'Rueckkante ' + bodyId + ' --> ' + hexId);
});

// ---------------------------------------------------------------------------
// 3) do-until / do-while — Rückkante und Exit invers beschriftet
// ---------------------------------------------------------------------------
const outDu = toMermaid([DO('until', '$i -ge 5', [P('$i++')])]);
test('do-until: Grundstruktur', () => checkBasics(outDu, 'do-until'));
test('do-until: Rueckkante |Nein|, Exit |Ja|', () => {
  const dId = findNodeId(outDu, '{"$i -ge 5"}');
  const bId = findNodeId(outDu, '$i++');
  assert.ok(dId && bId, 'Ids gefunden');
  const lines = outDu.split('\n').map(l => l.trim());
  assert.ok(lines.includes(dId + ' -->|Nein| ' + bId), 'Rueckkante |Nein| zum Rumpf');
  assert.ok(lines.some(l => l.startsWith(dId + ' -->|Ja| ')), 'Exit-Kante |Ja|');
});

const outDw = toMermaid([DO('while', '$ok', [P('$i++')])]);
test('do-while: Rueckkante |Ja|, Exit |Nein|', () => {
  checkBasics(outDw, 'do-while');
  const dId = findNodeId(outDw, '{"$ok"}');
  const bId = findNodeId(outDw, '$i++');
  assert.ok(dId && bId, 'Ids gefunden');
  const lines = outDw.split('\n').map(l => l.trim());
  assert.ok(lines.includes(dId + ' -->|Ja| ' + bId), 'Rueckkante |Ja| zum Rumpf');
  assert.ok(lines.some(l => l.startsWith(dId + ' -->|Nein| ')), 'Exit-Kante |Nein|');
});

// ---------------------------------------------------------------------------
// 4) while — Ja in den Rumpf, Rücksprung, Nein-Exit
// ---------------------------------------------------------------------------
const outWh = toMermaid([WHILE('$i -lt 3', [P('$i++')])]);
test('while: Struktur, Rueckkante und Exits', () => {
  checkBasics(outWh, 'while');
  const dId = findNodeId(outWh, '{"$i -lt 3"}');
  const bId = findNodeId(outWh, '$i++');
  assert.ok(dId && bId, 'Ids gefunden');
  const lines = outWh.split('\n').map(l => l.trim());
  assert.ok(lines.includes(dId + ' -->|Ja| ' + bId), '|Ja| in den Rumpf');
  assert.ok(lines.includes(bId + ' --> ' + dId), 'Rueckkante zum Diamanten');
  assert.ok(lines.some(l => l.startsWith(dId + ' -->|Nein| ')), '|Nein|-Exit');
});

// ---------------------------------------------------------------------------
// 5) return/exit — Terminator OHNE ausgehende Kante, Ende wird übersprungen
// ---------------------------------------------------------------------------
const outRet = toMermaid([
  P('$x = 1'),
  IF([BR('$x -gt 0', [JUMP('return', 'return $x')])], null),
  P('Write-Host "weiter"', 'output')
]);
test('return: Grundstruktur', () => checkBasics(outRet, 'return'));
test('return: Terminator-Form ohne ausgehende Kante', () => {
  assert.ok(outRet.includes('(["return $x"])'), 'Terminator (["return $x"])');
  const retId = findNodeId(outRet, '(["return $x"])');
  assert.ok(retId, 'Id gefunden');
  const outgoing = new RegExp('^' + retId + '\\s*(-->|-\\.->)');
  for (const raw of outRet.split('\n')) {
    assert.ok(!outgoing.test(raw.trim()),
      'return-Knoten hat ausgehende Kante: ' + raw.trim());
  }
});
test('exit am Skriptende: kein Ende-Terminator', () => {
  const outExit = toMermaid([P('Aufraeumen'), JUMP('exit', 'exit 1')]);
  checkBasics(outExit, 'exit');
  assert.ok(outExit.includes('(["exit 1"])'), 'exit-Terminator vorhanden');
  assert.ok(!outExit.includes('(["Ende"])'), 'Ende wird uebersprungen');
});

// ---------------------------------------------------------------------------
// 6) switch — Fan-out inkl. Sonst, Aufruf-Knoten [[...]]
// ---------------------------------------------------------------------------
const outSw = toMermaid([
  P('$wahl = Read-Host "Auswahl"', 'input'),
  SWITCH('$wahl', [
    { label: '1', body: [P('Show-Menu', null, ['Show-Menu'])] },
    { label: '2', body: [P('Write-Host "Zwei"', 'output')] },
    { label: 'beenden', body: [JUMP('return', 'return')] }
  ], [P('Write-Host "Ungueltig"', 'output')])
]);
test('switch: Grundstruktur', () => checkBasics(outSw, 'switch'));
test('switch: Fan-out-Labels inkl. Sonst', () => {
  for (const lbl of ['|1|', '|2|', '|beenden|', '|Sonst|']) {
    assert.ok(outSw.includes(lbl), 'enthaelt ' + lbl);
  }
});
test('switch: Funktionsaufruf als [["..."]]', () => {
  assert.ok(/n\d+\[\["Show-Menu"\]\]/.test(outSw), 'Subroutine-Knoten fuer calls');
});
test('switch: Sonst als direkter Exit bei defaultBody null', () => {
  const noDef = toMermaid([SWITCH('$x', [{ label: 'a', body: [P('tu-was')] }], null)]);
  checkBasics(noDef, 'switch-ohne-default');
  assert.ok(/\|Sonst\| n\d+/.test(noDef), 'Sonst-Kante fuehrt direkt weiter');
});

// ---------------------------------------------------------------------------
// 7) try/catch/finally — Subgraphen, gestrichelte bei-Fehler-Kante
// ---------------------------------------------------------------------------
const outTry = toMermaid([
  TRY(
    [P('Get-Content geheim.txt')],
    [
      { label: 'System.IO.IOException', body: [P('Write-Host "IO-Fehler"', 'output')] },
      { label: 'Fehler', body: [] }
    ],
    [P('Write-Host "Aufraeumen"', 'output')]
  )
]);
test('try: Grundstruktur (inkl. subgraph/end-Balance)', () => checkBasics(outTry, 'try'));
test('try: Subgraphen und bei-Fehler-Kanten', () => {
  const lines = outTry.split('\n').map(l => l.trim());
  const opens = lines.filter(l => l.startsWith('subgraph ')).length;
  const closes = lines.filter(l => l === 'end').length;
  assert.strictEqual(opens, 3, 'drei Subgraphen (Try + 2 Catch)');
  assert.strictEqual(opens, closes, 'subgraph/end ausgeglichen');
  const dashed = lines.filter(l => l.includes('-.->') && l.includes('bei Fehler'));
  assert.strictEqual(dashed.length, 2, 'zwei gestrichelte bei-Fehler-Kanten');
  assert.ok(outTry.includes('Catch: System.IO.IOException'), 'Catch-Label mit Typ');
});

// ---------------------------------------------------------------------------
// 8) Escaping — #quot;, Klammern, Zeilenumbrueche, Kuerzung
// ---------------------------------------------------------------------------
test('Escaping: " wird zu #quot;', () => {
  const out = toMermaid([P('Write-Host "Servus"', 'output')]);
  checkBasics(out, 'quot');
  assert.ok(out.includes('Write-Host #quot;Servus#quot;'), '#quot;-Escaping');
});
test('Escaping: Zeilenumbrueche im Label werden kollabiert', () => {
  const out = toMermaid([P('$a = 1\n\t$b = 2')]);
  checkBasics(out, 'newline');
  assert.ok(out.includes('"$a = 1 $b = 2"'), 'Umbruch zu Leerzeichen kollabiert');
});
test('Escaping: [ und ] im Label werden zu #91;/#93;-Entities', () => {
  const out = toMermaid([P('$arr[0] = 5')]);
  checkBasics(out, 'brackets');
  const m = out.match(/n1\["([^"]*)"\]/);
  assert.ok(m, 'Deklaration gefunden');
  assert.strictEqual(m[1], '$arr#91;0#93; = 5', 'Klammern als Entities');
});
test('Escaping: Labels werden bei 60 Zeichen gekuerzt', () => {
  const out = toMermaid([P('x'.repeat(100))]);
  checkBasics(out, 'truncate');
  const m = out.match(/n1\["([^"]*)"\]/);
  assert.ok(m, 'Deklaration gefunden');
  assert.ok(m[1].length <= 60, 'Label max. 60 Zeichen, ist ' + m[1].length);
  assert.ok(m[1].endsWith('…'), 'endet mit …');
});

// ---------------------------------------------------------------------------
// 9) Robustheit — nie werfen, leerer Body, Titel-Option
// ---------------------------------------------------------------------------
test('Leerer Body: Start --> Ende', () => {
  const out = toMermaid([]);
  checkBasics(out, 'leer');
  assert.ok(out.includes('(["Start"])'), 'Start-Terminator');
  assert.ok(out.includes('(["Ende"])'), 'Ende-Terminator');
  assert.ok(out.split('\n').some(l => /^n0 --> n1$/.test(l.trim())), 'Kante Start->Ende');
});
test('Robustheit: Muell-Eingaben werfen nicht', () => {
  for (const garbage of [null, undefined, 'quatsch', 42,
    [{ type: 'alien', zeug: true }, null, 42, {}],
    [{ type: 'if' }, { type: 'switch' }, { type: 'try' }, { type: 'jump', kind: 'return' }]]) {
    const out = toMermaid(garbage);
    assert.ok(typeof out === 'string' && out.startsWith('flowchart TD'),
      'gueltige Ausgabe fuer ' + JSON.stringify(garbage));
    checkBasics(out, 'garbage');
  }
});
test('Titel mit Anfuehrungszeichen wird escaped', () => {
  const out = toMermaid([], { title: 'Skript "Test"' });
  checkBasics(out, 'titel');
  assert.ok(out.includes('(["Skript #quot;Test#quot;"])'), 'Titel escaped');
});

// ---------------------------------------------------------------------------
// 10) Bugfixes — Kanten-Label-Entities, Knoten-Entities, #-Literale,
//     break/throw ohne Abwaertskante, continue mit Rueckkante
// ---------------------------------------------------------------------------
const outNasty = toMermaid([
  SWITCH('$wahl', [
    { label: '(a|b) {x}', body: [P('tu-a')] },
    { label: '(sonstiges)', body: [P('tu-b')] }
  ], null)
]);
test('Kanten-Labels: keine rohen ( ) { } | in |...|', () => {
  checkBasics(outNasty, 'nasty-switch');
  let found = 0;
  for (const raw of outNasty.split('\n')) {
    const m = raw.trim().match(/(?:-->|-\.->)\|([^|]*)\|/);
    if (!m) continue;
    found++;
    assert.ok(!/[(){}]/.test(m[1]),
      'rohes Sonderzeichen im Kantenlabel: ' + raw.trim());
  }
  assert.ok(found >= 3, 'Kantenlabels vorhanden (2 Cases + Sonst), ' + found);
  assert.ok(outNasty.includes('#40;a#124;b#41; #123;x#125;'),
    'Case-Label vollstaendig als Entities codiert');
});

test('Knoten-Label: [int]$x bleibt als Entities erhalten', () => {
  const out = toMermaid([P('[int]$x = 7')]);
  checkBasics(out, 'int-cast');
  assert.ok(out.includes('#91;int#93;$x = 7'), 'Entities #91;int#93;$x');
  assert.ok(!out.includes('(int)$x'), 'keine Klammer-Umschreibung mehr');
});

test('Literales #quot; im Quelltext wird zu #35;quot;', () => {
  const out = toMermaid([P('Write-Host #quot;')]);
  checkBasics(out, 'hash-literal');
  assert.ok(out.includes('Write-Host #35;quot;'), '# wird ZUERST zu #35;');
  assert.ok(!out.includes('Write-Host #quot;'),
    'nicht zurueck zu einem Anfuehrungszeichen decodierbar');
});

test('break in while: kein ausgehender Pfeil, keine Rueckkante vom break', () => {
  const out = toMermaid([WHILE('$true', [P('verarbeite'), JUMP('break', 'break')])]);
  checkBasics(out, 'while-break');
  const dId = findNodeId(out, '{"$true"}');
  const pId = findNodeId(out, 'verarbeite');
  const bId = findNodeId(out, '"break"');
  assert.ok(dId && pId && bId, 'Ids gefunden');
  const lines = out.split('\n').map(l => l.trim());
  assert.ok(lines.includes(dId + ' -->|Ja| ' + pId), '|Ja| in den Rumpf');
  assert.ok(lines.includes(pId + ' --> ' + bId), 'Prozess fliesst in den break');
  const outgoing = new RegExp('^' + bId + ' (?:-->|-\\.->)');
  for (const line of lines) {
    assert.ok(!outgoing.test(line),
      'break-Knoten hat ausgehende Kante: ' + line);
  }
});

test('break hinter if: Rueckkante kommt vom Prozess, nicht vom break', () => {
  const out = toMermaid([WHILE('$true', [
    IF([BR('$fehler', [JUMP('break', 'break')])], null),
    P('verarbeite weiter')
  ])]);
  checkBasics(out, 'while-if-break');
  const loopId = findNodeId(out, '{"$true"}');
  const pId = findNodeId(out, 'verarbeite weiter');
  const bId = findNodeId(out, '"break"');
  assert.ok(loopId && pId && bId, 'Ids gefunden');
  const lines = out.split('\n').map(l => l.trim());
  assert.ok(lines.includes(pId + ' --> ' + loopId),
    'Rueckkante ' + pId + ' --> ' + loopId + ' vom Prozess');
  assert.ok(!lines.includes(bId + ' --> ' + loopId),
    'keine Rueckkante vom break zur Bedingung');
  const outgoing = new RegExp('^' + bId + ' (?:-->|-\\.->)');
  for (const line of lines) {
    assert.ok(!outgoing.test(line),
      'break-Knoten hat ausgehende Kante: ' + line);
  }
});

test('throw terminiert die Kette wie return', () => {
  const out = toMermaid([P('$a = 1'), JUMP('throw', 'throw $err'), P('$b = 2')]);
  checkBasics(out, 'throw');
  const tId = findNodeId(out, 'throw $err');
  assert.ok(tId, 'throw-Knoten gefunden');
  const outgoing = new RegExp('^' + tId + ' (?:-->|-\\.->)');
  for (const raw of out.split('\n')) {
    assert.ok(!outgoing.test(raw.trim()),
      'throw-Knoten hat ausgehende Kante: ' + raw.trim());
  }
});

test('continue behaelt die Abwaertskante zur Schleifenbedingung', () => {
  const out = toMermaid([WHILE('$weiter', [JUMP('continue', 'continue')])]);
  checkBasics(out, 'while-continue');
  const dId = findNodeId(out, '{"$weiter"}');
  const cId = findNodeId(out, '"continue"');
  assert.ok(dId && cId, 'Ids gefunden');
  const lines = out.split('\n').map(l => l.trim());
  assert.ok(lines.includes(cId + ' --> ' + dId),
    'continue fliesst zurueck zur Bedingung');
});

// ---------------------------------------------------------------------------
// Ergebnis + Sichtpruefung
// ---------------------------------------------------------------------------
console.log('\n--- Sichtpruefung: if/elseif/else-Fixture ---');
console.log(outIf);

console.log('--- Sichtpruefung: switch mit fiesen Case-Labels ---');
console.log(outNasty);

console.log(passed + ' Tests bestanden, ' + failures + ' fehlgeschlagen.');
process.exit(failures > 0 ? 1 : 0);
