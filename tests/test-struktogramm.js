/*
 * ScriptFlow — tests/test-struktogramm.js
 * Ausfuehrung: node tests/test-struktogramm.js   (aus dem Projektstamm)
 * AST-Fixtures werden GEMAESS CONTRACT.md von Hand gebaut (kein parser.js-Import).
 */
'use strict';

const assert = require('assert');

// Vorbelegen, um das nicht-klobbernde Object.assign-Registrierungsmuster zu pruefen.
globalThis.PSViz = { fromShell: true };

const api = require('../js/struktogramm.js');
const renderStruktogramm = api.renderStruktogramm;
const estWidth = api.estWidth;

// ------------------------------------------------------------ Test-Infrastruktur

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (e) {
    failures++;
    console.error('FAIL ' + name);
    console.error('     ' + (e && e.message ? e.message : e));
  }
}

function assertClean(svg, ctx) {
  const where = ctx ? ' (' + ctx + ')' : '';
  assert.ok(typeof svg === 'string' && svg.length > 0, 'svg ist ein String' + where);
  assert.ok(!/NaN/.test(svg), 'kein NaN im SVG' + where);
  assert.ok(!/Infinity/.test(svg), 'kein Infinity im SVG' + where);
  assert.ok(!/\b(?:x|y|x1|y1|x2|y2|width|height)="-/.test(svg),
    'keine negativen Koordinaten' + where);
}

// AST-Fixture-Helfer (von Hand, gemaess Contract)
const P = (text, line, io, calls) =>
  ({ type: 'process', text, io: io || null, calls: calls || [], line });
const J = (kind, text, line) => ({ type: 'jump', kind, text, line });

// Nachbildung der Modul-Truncation fuer die Breiten-Behauptung.
const truncLike = (s) => (s.length > 46 ? s.slice(0, 45) + '…' : s);

// ------------------------------------------------------------------- Tests

check('Registrierung: PSViz.renderStruktogramm ohne Klobbern', () => {
  assert.strictEqual(typeof renderStruktogramm, 'function');
  assert.strictEqual(typeof estWidth, 'function');
  assert.strictEqual(typeof globalThis.PSViz.renderStruktogramm, 'function');
  assert.strictEqual(globalThis.PSViz.fromShell, true,
    'bestehende PSViz-Member bleiben erhalten');
});

check('SVG-Form und Attribut-Konsistenz', () => {
  const r = renderStruktogramm([P('$a = 1', 1)], { title: 'Testlauf' });
  assert.strictEqual(typeof r.svg, 'string');
  assert.ok(r.svg.startsWith('<svg '), 'beginnt mit <svg ');
  assert.ok(r.svg.endsWith('</svg>'), 'endet mit </svg>');
  assert.ok(r.svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'xmlns vorhanden');
  const m = r.svg.match(/width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(m, 'width/height/viewBox vorhanden');
  assert.strictEqual(Number(m[1]), r.width, 'width-Attribut == width');
  assert.strictEqual(Number(m[2]), r.height, 'height-Attribut == height');
  assert.strictEqual(Number(m[3]), r.width, 'viewBox-W == width');
  assert.strictEqual(Number(m[4]), r.height, 'viewBox-H == height');
  assert.ok(Number.isFinite(r.width) && r.width > 0, 'width > 0');
  assert.ok(Number.isFinite(r.height) && r.height > 0, 'height > 0');
  assert.ok(r.svg.includes('fill="#ffffff"'), 'weisser Hintergrund');
  assert.ok(r.svg.includes('Testlauf'), 'eigener Titel erscheint');
  assertClean(r.svg, 'einfacher Prozess');
});

check('Standardtitel "Ablauf"', () => {
  const r = renderStruktogramm([P('$a = 1', 1)]);
  assert.ok(r.svg.includes('Ablauf'));
});

check('data-line-Wrapper fuer App-Shell-Klicks', () => {
  const r = renderStruktogramm([P('$x = 5', 7)]);
  assert.ok(/class="nd"/.test(r.svg), 'class="nd" vorhanden');
  assert.ok(/data-line="7"/.test(r.svg), 'data-line="7" vorhanden');
  assert.ok(r.svg.includes('cursor:pointer'), 'cursor:pointer vorhanden');
});

check('deutsche Labels: Ja/Nein beim if', () => {
  const s = {
    type: 'if',
    branches: [{ cond: '$a -gt 0', body: [P('$b = 1', 2)] }],
    elseBody: [P('$b = 2', 4)],
    line: 1
  };
  const r = renderStruktogramm([s]);
  assert.ok(/>Ja</.test(r.svg), 'Ja vorhanden');
  assert.ok(/>Nein</.test(r.svg), 'Nein vorhanden');
  assertClean(r.svg, 'if/else');
});

check('if ohne else zeigt leere Zelle "—"', () => {
  const s = { type: 'if', branches: [{ cond: '$a', body: [P('x', 2)] }], elseBody: null, line: 1 };
  const r = renderStruktogramm([s]);
  assert.ok(r.svg.includes('—'), 'Leerzelle vorhanden');
});

check('elseif-Kaskade: drei Koepfe, drei Ja-Labels', () => {
  const s = {
    type: 'if',
    branches: [
      { cond: '$n -ge 5.5', body: [P('a', 2)] },
      { cond: '$n -ge 4.0', body: [P('b', 4)] },
      { cond: '$n -ge 3.5', body: [P('c', 6)] }
    ],
    elseBody: [P('d', 8)],
    line: 1
  };
  const r = renderStruktogramm([s]);
  const ja = r.svg.match(/>Ja</g) || [];
  const nein = r.svg.match(/>Nein</g) || [];
  assert.strictEqual(ja.length, 3, 'drei Ja-Labels (Kaskade rechts verschachtelt)');
  assert.strictEqual(nein.length, 3, 'drei Nein-Labels');
  assertClean(r.svg, 'elseif-Kaskade');
});

check('deutsche Labels: Sonst beim switch', () => {
  const s = {
    type: 'switch', subject: '$wahl',
    cases: [
      { label: '1', body: [P('eins', 2)] },
      { label: '2', body: [P('zwei', 3)] }
    ],
    defaultBody: [P('anderes', 5)],
    line: 1
  };
  const r = renderStruktogramm([s]);
  assert.ok(r.svg.includes('Sonst'), 'Sonst vorhanden');
  assert.ok(r.svg.includes('$wahl'), 'Subjekt vorhanden');
  assertClean(r.svg, 'switch');
});

check('switch ohne defaultBody: Sonst-Spalte mit "—"', () => {
  const s = {
    type: 'switch', subject: '$x',
    cases: [{ label: 'a', body: [P('a', 2)] }],
    defaultBody: null, line: 1
  };
  const r = renderStruktogramm([s]);
  assert.ok(r.svg.includes('Sonst'), 'Sonst auch ohne defaultBody');
  assert.ok(r.svg.includes('—'), 'Leerzelle in der Sonst-Spalte');
});

check('deutsche Labels: solange / für / für jedes', () => {
  const w = renderStruktogramm([{ type: 'while', cond: '$i -lt 10', body: [P('$i++', 2)], line: 1 }]);
  assert.ok(w.svg.includes('solange $i -lt 10'), 'while-Präfix');
  const f = renderStruktogramm([{ type: 'for', header: '$i = 0; $i -lt 5; $i++', body: [P('x', 2)], line: 1 }]);
  assert.ok(f.svg.includes('für $i = 0'), 'for-Präfix');
  const fe = renderStruktogramm([{ type: 'foreach', header: '$x in $liste', body: [P('x', 2)], line: 1 }]);
  assert.ok(fe.svg.includes('für jedes $x in $liste'), 'foreach-Präfix');
});

check('deutsche Labels: wiederhole bis / wiederhole solange (doloop)', () => {
  const u = renderStruktogramm([{ type: 'doloop', kind: 'until', cond: '$ok', body: [P('x', 2)], line: 1 }]);
  assert.ok(u.svg.includes('wiederhole bis $ok'), 'until-Fuss');
  const w = renderStruktogramm([{ type: 'doloop', kind: 'while', cond: '$weiter', body: [P('x', 2)], line: 1 }]);
  assert.ok(w.svg.includes('wiederhole solange $weiter'), 'while-Fuss');
});

check('deutsche Labels: Versuche / Bei Fehler / Danach (finally)', () => {
  const s = {
    type: 'try', line: 1,
    body: [P('$d = Get-Content log.txt', 2)],
    catches: [{ label: 'System.IO.IOException', body: [P('melden', 4)] }],
    finallyBody: [P('aufräumen', 6)]
  };
  const r = renderStruktogramm([s]);
  assert.ok(r.svg.includes('Versuche'), 'Versuche vorhanden');
  assert.ok(r.svg.includes('Bei Fehler (System.IO.IOException)'), 'Bei Fehler (<label>) vorhanden');
  assert.ok(r.svg.includes('Danach (finally)'), 'finally-Streifen vorhanden');
  assert.ok(r.svg.includes('#ff9f0a'), 'gestrichelter Container-Rahmen');
  assert.ok(r.svg.includes('stroke-dasharray'), 'dasharray vorhanden');
  assertClean(r.svg, 'try/catch/finally');
});

check('E:/A:-Praefixe und I/O-Fuellung', () => {
  const r = renderStruktogramm([
    P('$n = Read-Host "Name"', 3, 'input'),
    P('Write-Host $n', 4, 'output')
  ]);
  assert.ok(r.svg.includes('E: $n = Read-Host'), 'E:-Praefix');
  assert.ok(r.svg.includes('A: Write-Host $n'), 'A:-Praefix');
  assert.ok(r.svg.includes('fill="#eaf2ff"'), 'I/O-Fuellfarbe');
});

check('calls: Doppelbalken (predefined process)', () => {
  const r = renderStruktogramm([P('Hole-Daten -Pfad $p', 2, null, ['Hole-Daten'])]);
  const lines = r.svg.match(/<line /g) || [];
  assert.ok(lines.length >= 2, 'mindestens zwei vertikale Balkenlinien');
});

check('Truncation bei 46 Zeichen mit … und volle <title>', () => {
  const long = 'Set-Content -Pfad C:\\temp\\ausgabe.txt -Wert $ergebnis -Encoding UTF8';
  const r = renderStruktogramm([P(long, 5)]);
  assert.ok(r.svg.includes('…'), 'Ellipse vorhanden');
  assert.ok(r.svg.includes('<title>' + long + '</title>'), 'Volltext im <title>');
});

check('XML-Escaping von & < > "', () => {
  const r = renderStruktogramm([P('Write-Host "A & B <C>"', 1, 'output')]);
  assert.ok(r.svg.includes('&amp;'), '& escaped');
  assert.ok(r.svg.includes('&lt;C&gt;'), '< und > escaped');
  assert.ok(r.svg.includes('&quot;'), '" escaped');
});

check('Jump als einfache Zelle', () => {
  const r = renderStruktogramm([J('return', 'return $wahl', 9), J('break', 'break', 10)]);
  assert.ok(r.svg.includes('return $wahl'));
  assert.ok(r.svg.includes('break'));
  assert.ok(/data-line="9"/.test(r.svg) && /data-line="10"/.test(r.svg));
});

check('verschachtelt: foreach > if/else > while — Hoehe streng steigend', () => {
  const whileStmt = { type: 'while', cond: '$i -lt 3', body: [P('$i++', 5)], line: 4 };
  const ifStmt = {
    type: 'if',
    branches: [{ cond: '$a -gt 0', body: [whileStmt] }],
    elseBody: [P('Write-Host "neg"', 8, 'output')],
    line: 3
  };
  const feStmt = { type: 'foreach', header: '$x in $liste', body: [ifStmt], line: 2 };

  const r1 = renderStruktogramm([whileStmt]);
  const r2 = renderStruktogramm([ifStmt]);
  const r3 = renderStruktogramm([feStmt]);
  assert.ok(r1.height < r2.height, 'if(while) hoeher als while: ' + r1.height + ' < ' + r2.height);
  assert.ok(r2.height < r3.height, 'foreach(if) hoeher als if: ' + r2.height + ' < ' + r3.height);
  assertClean(r1.svg, 'nested 1');
  assertClean(r2.svg, 'nested 2');
  assertClean(r3.svg, 'nested 3');
});

check('Breite >= Summe der Spalten-Mindestbreiten (if mit zwei breiten Zweigen)', () => {
  const longL = 'Write-Host "linker Zweig mit ziemlich viel erklaerendem Text"';
  const longR = 'Write-Host "rechter Zweig mit ebenfalls sehr viel Text darin"';
  const s = {
    type: 'if',
    branches: [{ cond: '$a', body: [P(longL, 2)] }],
    elseBody: [P(longR, 4)],
    line: 1
  };
  const r = renderStruktogramm([s]);
  const need = estWidth(truncLike(longL)) + estWidth(truncLike(longR));
  assert.ok(r.width >= need,
    'Gesamtbreite ' + r.width + ' >= Spaltenminima ' + need);
  assertClean(r.svg, 'breites if');
});

check('leerer Body rendert eine "—"-Zelle', () => {
  const r = renderStruktogramm([]);
  assert.ok(r.svg.includes('—'), 'Leerzelle vorhanden');
  assert.ok(r.width > 0 && r.height > 0, 'positive Masse');
  const m = r.svg.match(/width="(\d+)" height="(\d+)"/);
  assert.strictEqual(Number(m[1]), r.width);
  assert.strictEqual(Number(m[2]), r.height);
  assertClean(r.svg, 'leer');
});

check('Muell-AST wirft nie', () => {
  assert.doesNotThrow(() => renderStruktogramm(null));
  assert.doesNotThrow(() => renderStruktogramm(undefined, null));
  assert.doesNotThrow(() => renderStruktogramm('kein array'));
  assert.doesNotThrow(() => renderStruktogramm(42, 'keine opts'));
  const garbage = [
    {}, { type: 'voellig-unbekannt', text: 'huch' }, 42, 'nur ein string', null, undefined,
    { type: 'if' },                       // ohne branches
    { type: 'if', branches: 'kaputt' },   // branches kein Array
    { type: 'switch' },                   // ohne cases/subject
    { type: 'switch', cases: [null, {}] },
    { type: 'while' },                    // ohne cond/body
    { type: 'doloop' },
    { type: 'for' },
    { type: 'foreach', body: 'kaputt' },
    { type: 'try' },
    { type: 'try', catches: 'kaputt', finallyBody: 'auch kaputt' },
    { type: 'process' },
    { type: 'process', calls: 'kaputt' },
    { type: 'jump' }
  ];
  let r;
  assert.doesNotThrow(() => { r = renderStruktogramm(garbage); });
  assert.ok(r.svg.startsWith('<svg '), 'liefert trotzdem ein SVG');
  assert.ok(r.width > 0 && r.height > 0, 'positive Masse trotz Muell');
  assertClean(r.svg, 'garbage');
});

check('estWidth: plausibel und ueberschaetzend', () => {
  assert.ok(estWidth('') >= 0);
  assert.ok(estWidth('iii') < estWidth('WWW'), 'schmal < breit');
  assert.ok(estWidth('Hallo Welt') > 50, 'realistische Groessenordnung');
  assert.ok(Number.isFinite(estWidth(null)), 'null tolerieren');
});

// ---------------------------------------------- Regression: Surrogates/Titles

// Scan auf einsame Surrogates (Code-Unit-Ebene): jedes High-Surrogate muss von
// einem Low-Surrogate gefolgt sein, jedes Low-Surrogate von einem High vorangegangen.
function assertNoLoneSurrogates(svg, ctx) {
  const where = ctx ? ' (' + ctx + ')' : '';
  for (let i = 0; i < svg.length; i++) {
    const c = svg.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const nxt = i + 1 < svg.length ? svg.charCodeAt(i + 1) : 0;
      assert.ok(nxt >= 0xDC00 && nxt <= 0xDFFF,
        'einsames High-Surrogate bei Code-Unit ' + i + where);
      i++; // gueltiges Paar konsumiert
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      assert.fail('einsames Low-Surrogate bei Code-Unit ' + i + where);
    }
  }
}

check('Emoji an der Truncation-Grenze: keine einsamen Surrogates, Export-safe', () => {
  // Emoji beginnt bei Code-Unit-Index 44 -> der alte Schnitt bei Unit 45
  // trennte das Surrogate-Paar. Alle drei Kuerzungspfade abdecken:
  const procText = 'A'.repeat(44) + '🚀🚀🚀';   // Zellentext (trunc/fitText)
  const caseLabel = 'B'.repeat(44) + '😀😀';    // switch-Fallbeschriftung
  const headTitle = 'T'.repeat(44) + '🎯🎯';    // opts.title-Kopfstreifen
  const ifCond = 'C'.repeat(44) + '🔥🔥';       // if-Kopf (trunc + fitText)
  const body = [
    P(procText, 1),
    {
      type: 'switch', subject: '$emoji',
      cases: [{ label: caseLabel, body: [P('x', 3)] }],
      defaultBody: null, line: 2
    },
    {
      type: 'if',
      branches: [{ cond: ifCond, body: [P('y', 6)] }],
      elseBody: null, line: 5
    }
  ];
  const r = renderStruktogramm(body, { title: headTitle });
  assert.ok(r.svg.includes('…'), 'Truncation hat stattgefunden (Ellipse vorhanden)');
  assertNoLoneSurrogates(r.svg, 'Emoji-Grenzfall');
  assert.doesNotThrow(() => encodeURIComponent(r.svg),
    'encodeURIComponent(svg) darf nicht werfen (PNG-Export)');
});

check('switch-Fallbeschriftung 60 Zeichen: volle <title> trotz Kuerzung', () => {
  const label60 = 'Sehr-Langer-Fallname-' + 'x'.repeat(39); // exakt 60 Zeichen
  assert.strictEqual(label60.length, 60, 'Fixture hat 60 Zeichen');
  const s = {
    type: 'switch', subject: '$wahl',
    cases: [{ label: label60, body: [P('a', 2)] }],
    defaultBody: null, line: 1
  };
  const r = renderStruktogramm([s]);
  assert.ok(r.svg.includes('…'), 'Beschriftung wurde gekuerzt');
  assert.ok(r.svg.includes('<title>' + label60 + '</title>'),
    'volle 60-Zeichen-Beschriftung im <title>');
  assertClean(r.svg, 'langes Case-Label');
});

check('opts.title 80 Zeichen: Kopfstreifen traegt <title> mit Volltext', () => {
  const title80 = 'Ablaufplan-' + 'y'.repeat(69); // exakt 80 Zeichen
  assert.strictEqual(title80.length, 80, 'Fixture hat 80 Zeichen');
  const r = renderStruktogramm([P('$a = 1', 1)], { title: title80 });
  assert.ok(r.svg.includes('…'), 'Titel wurde gekuerzt');
  assert.ok(r.svg.includes('<title>' + title80 + '</title>'),
    'voller 80-Zeichen-Titel im <title> des Kopfstreifens');
  assertClean(r.svg, 'langer Titel');
});

// ------------------------------------------------------------------ Abschluss

if (failures > 0) {
  console.error('\n' + failures + ' Test(s) fehlgeschlagen.');
  process.exit(1);
}
console.log('\nAlle Struktogramm-Tests bestanden.');
process.exit(0);
