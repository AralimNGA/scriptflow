'use strict';
/*
 * Tests für js/parser.js — ausführbar mit:  node tests/test-parser.js
 * Exit-Code 0 bei Erfolg, sonst != 0 mit lesbarer Ausgabe.
 */
const assert = require('assert');
const path = require('path');
const { parse } = require(path.join(__dirname, '..', 'js', 'parser.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name);
    const msg = (e && e.message) ? e.message : String(e);
    console.log('      ' + msg.split('\n').join('\n      '));
  }
}

function ps(lines) {
  return Array.isArray(lines) ? lines.join('\n') : lines;
}

// ------------------------------------------------------------------

test('einfache Sequenz mit io-Klassifikation', () => {
  const r = parse(ps([
    '$name = "Welt"',
    'Write-Host "Hallo $name"',
    'Get-Date'
  ]));
  assert.strictEqual(r.warnings.length, 0, 'keine Warnungen erwartet: ' + JSON.stringify(r.warnings));
  const b = r.script.body;
  assert.strictEqual(b.length, 3);
  assert.strictEqual(b[0].type, 'process');
  assert.strictEqual(b[0].io, null);
  assert.strictEqual(b[0].line, 1);
  assert.strictEqual(b[1].io, 'output');
  assert.strictEqual(b[1].text, 'Write-Host "Hallo $name"');
  assert.strictEqual(b[1].line, 2);
  assert.strictEqual(b[2].io, null);
  assert.strictEqual(b[2].line, 3);
});

test('Read-Host wird als input klassifiziert (und gewinnt gegen output)', () => {
  const b1 = parse('$name = Read-Host "Wie heisst du?"').script.body;
  assert.strictEqual(b1.length, 1);
  assert.strictEqual(b1[0].io, 'input');

  const b2 = parse('Write-Host (Read-Host "Frage")').script.body;
  assert.strictEqual(b2[0].io, 'input', 'input muss gegen output gewinnen');

  const b3 = parse('Out-File -FilePath a.txt -InputObject $x').script.body;
  assert.strictEqual(b3[0].io, 'output');
});

test('# innerhalb eines Strings ist kein Kommentar, echte Kommentare werden entfernt', () => {
  const r = parse(ps([
    'Get-Date # jetzt',
    '# ganze Zeile Kommentar',
    '<# Block',
    'Kommentar #>',
    'Write-Host "Nummer #1"'
  ]));
  const b = r.script.body;
  assert.strictEqual(b.length, 2, JSON.stringify(b.map(x => x.text)));
  assert.strictEqual(b[0].text, 'Get-Date');
  assert.strictEqual(b[0].line, 1);
  assert.strictEqual(b[1].text, 'Write-Host "Nummer #1"');
  assert.strictEqual(b[1].io, 'output');
  assert.strictEqual(b[1].line, 5);
});

test('$( ... ) im doppelt zitierten String verwirrt die Klammer-Erkennung nicht', () => {
  const r1 = parse('Write-Host "Datei: $($d.FullName)"');
  assert.strictEqual(r1.warnings.length, 0);
  assert.strictEqual(r1.script.body.length, 1);
  assert.strictEqual(r1.script.body[0].text, 'Write-Host "Datei: $($d.FullName)"');
  assert.strictEqual(r1.script.body[0].io, 'output');

  // geschweifte Klammern INNERHALB der Subexpression duerfen keine Bloecke oeffnen
  const r2 = parse('Write-Host "Wert: $(if ($a) { 1 } else { 2 })"');
  assert.strictEqual(r2.warnings.length, 0, JSON.stringify(r2.warnings));
  assert.strictEqual(r2.script.body.length, 1);
  assert.strictEqual(r2.script.body[0].type, 'process');
});

test('Here-String: Klammern, Anführungszeichen und # darin sind reiner Text', () => {
  const r = parse(ps([
    '$text = @"',
    'Zeile 1 "mit" { Klammern }',
    '#kein Kommentar',
    '"@',
    'Write-Host $text'
  ]));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  const b = r.script.body;
  assert.strictEqual(b.length, 2, JSON.stringify(b.map(x => x.text)));
  assert.ok(b[0].text.indexOf('{ Klammern }') !== -1, 'Klammern muessen erhalten bleiben: ' + b[0].text);
  assert.ok(b[0].text.indexOf('#kein Kommentar') !== -1, '# im Here-String ist kein Kommentar');
  assert.strictEqual(b[0].line, 1);
  assert.strictEqual(b[1].line, 5);
  assert.strictEqual(b[1].io, 'output');
});

test('Backtick-Zeilenfortsetzung ergibt EINE Anweisung', () => {
  const r = parse(ps([
    'Get-ChildItem `',
    '  -Path C:\\ `',
    '  -Recurse'
  ]));
  const b = r.script.body;
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].text, 'Get-ChildItem -Path C:\\ -Recurse');
  assert.strictEqual(b[0].line, 1);
});

test('Pipe am Zeilenende setzt die Anweisung fort', () => {
  const r = parse(ps([
    'Get-Process |',
    '  Sort-Object CPU -Descending |',
    '  Select-Object -First 5'
  ]));
  const b = r.script.body;
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].text, 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 5');
});

test('Ein-Zeilen-Scriptblock (Where-Object) kollabiert zu einem Process-Schritt', () => {
  const r = parse('$stopped = Get-Service | Where-Object { $_.Status -eq "Stopped" }');
  assert.strictEqual(r.warnings.length, 0);
  const b = r.script.body;
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].type, 'process');
  assert.strictEqual(b[0].text, '$stopped = Get-Service | Where-Object { $_.Status -eq "Stopped" }');
  assert.strictEqual(b[0].io, null);
  assert.strictEqual(b[0].line, 1);
});

test('Scriptblock mit anschliessender Pipe-Fortsetzung bleibt eine Anweisung', () => {
  const r = parse(ps([
    '$namen = Get-Service | Where-Object { $_.Status -eq "Running" } |',
    '    Select-Object -First 3'
  ]));
  const b = r.script.body;
  assert.strictEqual(b.length, 1, JSON.stringify(b.map(x => x.text)));
  assert.strictEqual(b[0].text, '$namen = Get-Service | Where-Object { $_.Status -eq "Running" } | Select-Object -First 3');
});

test('if / elseif / else wird zu einem If-Knoten zusammengefügt', () => {
  const r = parse(ps([
    'if ($a -gt 1) {',
    '    Write-Host "gross"',
    '} elseif ($a -eq 1) {',
    '    Write-Host "eins"',
    '} else {',
    '    Write-Host "klein"',
    '}'
  ]));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  const b = r.script.body;
  assert.strictEqual(b.length, 1);
  const n = b[0];
  assert.strictEqual(n.type, 'if');
  assert.strictEqual(n.line, 1);
  assert.strictEqual(n.branches.length, 2);
  assert.strictEqual(n.branches[0].cond, '$a -gt 1');
  assert.strictEqual(n.branches[1].cond, '$a -eq 1');
  assert.strictEqual(n.branches[0].body.length, 1);
  assert.strictEqual(n.branches[0].body[0].io, 'output');
  assert.strictEqual(n.branches[1].body.length, 1);
  assert.ok(Array.isArray(n.elseBody));
  assert.strictEqual(n.elseBody.length, 1);
  assert.strictEqual(n.elseBody[0].text, 'Write-Host "klein"');
});

test('if ohne else: elseBody ist null', () => {
  const r = parse('if ($x) { $y = 1 }');
  const n = r.script.body[0];
  assert.strictEqual(n.type, 'if');
  assert.strictEqual(n.elseBody, null);
  assert.strictEqual(n.branches[0].cond, '$x');
  assert.strictEqual(n.branches[0].body[0].text, '$y = 1');
});

test('switch mit zitierten Labels und default', () => {
  const r = parse(ps([
    'switch ($wahl) {',
    '    "1" { Write-Host "eins" }',
    "    'zwei' { Write-Host \"zwei\" }",
    '    3 { Write-Host "drei" }',
    '    default { Write-Host "anders" }',
    '}'
  ]));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  const n = r.script.body[0];
  assert.strictEqual(n.type, 'switch');
  assert.strictEqual(n.subject, '$wahl');
  assert.strictEqual(n.cases.length, 3);
  assert.deepStrictEqual(n.cases.map(c => c.label), ['1', 'zwei', '3']);
  assert.strictEqual(n.cases[0].body.length, 1);
  assert.strictEqual(n.cases[0].body[0].type, 'process');
  assert.ok(Array.isArray(n.defaultBody));
  assert.strictEqual(n.defaultBody.length, 1);
  assert.strictEqual(n.defaultBody[0].text, 'Write-Host "anders"');
});

test('while-Schleife', () => {
  const r = parse(ps([
    'while ($i -lt 10) {',
    '    $i++',
    '}'
  ]));
  const n = r.script.body[0];
  assert.strictEqual(n.type, 'while');
  assert.strictEqual(n.cond, '$i -lt 10');
  assert.strictEqual(n.body.length, 1);
  assert.strictEqual(n.body[0].text, '$i++');
  assert.strictEqual(n.line, 1);
});

test('while mit Klammer auf der Folgezeile (Allman-Stil)', () => {
  const r = parse(ps([
    '$i = 0',
    'while ($i -lt 3)',
    '{',
    '    $i++',
    '}'
  ]));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  const b = r.script.body;
  assert.strictEqual(b.length, 2);
  assert.strictEqual(b[1].type, 'while');
  assert.strictEqual(b[1].cond, '$i -lt 3');
  assert.strictEqual(b[1].body.length, 1);
});

test('do..while', () => {
  const r = parse(ps([
    'do {',
    '    $i++',
    '} while ($i -lt 5)'
  ]));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  const b = r.script.body;
  assert.strictEqual(b.length, 1, JSON.stringify(b.map(x => x.type)));
  const n = b[0];
  assert.strictEqual(n.type, 'doloop');
  assert.strictEqual(n.kind, 'while');
  assert.strictEqual(n.cond, '$i -lt 5');
  assert.strictEqual(n.body.length, 1);
  assert.strictEqual(n.line, 1);
});

test('do..until', () => {
  const r = parse(ps([
    'do {',
    '    $eingabe = Read-Host "Zahl"',
    '} until ($eingabe -eq "42")'
  ]));
  const n = r.script.body[0];
  assert.strictEqual(n.type, 'doloop');
  assert.strictEqual(n.kind, 'until');
  assert.strictEqual(n.cond, '$eingabe -eq "42"');
  assert.strictEqual(n.body[0].io, 'input');
});

test('for: Header bleibt roh erhalten (inkl. Semikolons)', () => {
  const r = parse(ps([
    'for ($i = 0; $i -lt 3; $i++) {',
    '    Write-Host $i',
    '}'
  ]));
  const n = r.script.body[0];
  assert.strictEqual(n.type, 'for');
  assert.strictEqual(n.header, '$i = 0; $i -lt 3; $i++');
  assert.strictEqual(n.body.length, 1);
});

test('foreach: Header roh ("$x in $y")', () => {
  const r = parse(ps([
    'foreach ($datei in $dateien) {',
    '    Write-Host $datei.Name',
    '}'
  ]));
  const n = r.script.body[0];
  assert.strictEqual(n.type, 'foreach');
  assert.strictEqual(n.header, '$datei in $dateien');
  assert.strictEqual(n.body[0].io, 'output');
});

test('try mit typisiertem catch, catch ohne Typ und finally', () => {
  const r = parse(ps([
    'try {',
    '    Get-Content "fehlt.txt"',
    '} catch [System.IO.IOException] {',
    '    Write-Host "IO-Fehler"',
    '} catch {',
    '    Write-Host "Anderer Fehler"',
    '} finally {',
    '    Write-Host "fertig"',
    '}'
  ]));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  const n = r.script.body[0];
  assert.strictEqual(n.type, 'try');
  assert.strictEqual(n.body.length, 1);
  assert.strictEqual(n.catches.length, 2);
  assert.strictEqual(n.catches[0].label, 'System.IO.IOException');
  assert.strictEqual(n.catches[1].label, 'Fehler');
  assert.ok(Array.isArray(n.finallyBody));
  assert.strictEqual(n.finallyBody.length, 1);
  assert.strictEqual(n.line, 1);
});

test('return/break/continue/exit/throw werden Jump-Knoten mit korrektem kind', () => {
  const r = parse(ps([
    'return $wahl',
    'break',
    'continue',
    'exit 1',
    'throw "Schlimm"'
  ]));
  const b = r.script.body;
  assert.strictEqual(b.length, 5);
  const kinds = b.map(x => x.kind);
  assert.deepStrictEqual(kinds, ['return', 'break', 'continue', 'exit', 'throw']);
  b.forEach(x => assert.strictEqual(x.type, 'jump'));
  assert.strictEqual(b[0].text, 'return $wahl');
  assert.strictEqual(b[3].text, 'exit 1');
  assert.strictEqual(b[4].text, 'throw "Schlimm"');
  assert.strictEqual(b[4].line, 5);
});

test('Kommandos, die nur wie Jumps beginnen, bleiben Process (z. B. "exitcode")', () => {
  const b = parse('$exitcode = 5\nexitcode-pruefen').script.body;
  assert.strictEqual(b[0].type, 'process');
  assert.strictEqual(b[1].type, 'process', '"exitcode-pruefen" ist kein Jump');
});

test('param( ... ) am Skriptanfang wird zu paramText (auch mehrzeilig)', () => {
  const r = parse(ps([
    'param(',
    '    [string]$Name = "Welt",',
    '    [int]$Anzahl = 3',
    ')',
    'Write-Host $Name'
  ]));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  assert.strictEqual(r.script.paramText, '[string]$Name = "Welt", [int]$Anzahl = 3');
  const b = r.script.body;
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].text, 'Write-Host $Name');
  assert.strictEqual(b[0].line, 5);
});

test('param mitten im Skript bleibt eine normale Anweisung', () => {
  const r = parse('Get-Date\nparam($x)');
  assert.strictEqual(r.script.paramText, null);
  assert.strictEqual(r.script.body.length, 2);
  assert.strictEqual(r.script.body[1].type, 'process');
});

test('Funktion: Name, param(...) im Body, calls[] wird gefüllt (case-insensitiv)', () => {
  const r = parse(ps([
    'function Sag-Hallo {',
    '    param($wer)',
    '    Write-Host "Hallo $wer"',
    '}',
    'Sag-Hallo "Welt"',
    '$x = 5',
    'SAG-HALLO $x'
  ]));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  assert.strictEqual(r.script.functions.length, 1);
  const f = r.script.functions[0];
  assert.strictEqual(f.type, 'function');
  assert.strictEqual(f.name, 'Sag-Hallo');
  assert.strictEqual(f.paramText, '$wer');
  assert.strictEqual(f.line, 1);
  assert.strictEqual(f.body.length, 1, 'param(...) darf nicht im Body bleiben');
  assert.strictEqual(f.body[0].io, 'output');

  const b = r.script.body;
  assert.strictEqual(b.length, 3, 'Funktionsdefinition gehört nicht in body');
  assert.deepStrictEqual(b[0].calls, ['Sag-Hallo']);
  assert.strictEqual(b[0].line, 5);
  assert.deepStrictEqual(b[1].calls, []);
  assert.deepStrictEqual(b[2].calls, ['Sag-Hallo'], 'Aufruf muss case-insensitiv erkannt werden');
});

test('calls: kein Treffer auf Teilwörter (Get-Foo ruft nicht Foo)', () => {
  const r = parse(ps([
    'function Foo { Write-Host "x" }',
    'Get-Foo',
    'Foo'
  ]));
  const b = r.script.body;
  assert.deepStrictEqual(b[0].calls, [], '"Get-Foo" darf nicht als Aufruf von "Foo" zählen');
  assert.deepStrictEqual(b[1].calls, ['Foo']);
});

test('Funktionsparameter im Kopf: function Add($a, $b)', () => {
  const r = parse('function Add($a, $b) { return $a + $b }');
  const f = r.script.functions[0];
  assert.strictEqual(f.name, 'Add');
  assert.strictEqual(f.paramText, '$a, $b');
  assert.strictEqual(f.body.length, 1);
  assert.strictEqual(f.body[0].type, 'jump');
  assert.strictEqual(f.body[0].kind, 'return');
  assert.strictEqual(f.body[0].text, 'return $a + $b');
});

test('verschachtelte Funktion wird Process-Knoten mit Warnung', () => {
  const r = parse(ps([
    'function Aussen {',
    '    function Innen { Write-Host "hi" }',
    '    Write-Host "aussen"',
    '}'
  ]));
  assert.strictEqual(r.script.functions.length, 1);
  const f = r.script.functions[0];
  assert.strictEqual(f.name, 'Aussen');
  assert.strictEqual(f.body.length, 2);
  assert.strictEqual(f.body[0].type, 'process');
  assert.ok(f.body[0].text.indexOf('function Innen') !== -1, f.body[0].text);
  assert.strictEqual(r.warnings.length, 1, JSON.stringify(r.warnings));
  assert.strictEqual(r.warnings[0].line, 2);
});

test('nicht geschlossene Klammer: Warnung, kein Absturz, Block bleibt nutzbar', () => {
  const r = parse(ps([
    'if ($a) {',
    '    Write-Host "x"'
  ]));
  assert.ok(r.warnings.length >= 1, 'Warnung erwartet');
  assert.strictEqual(typeof r.warnings[0].message, 'string');
  assert.strictEqual(typeof r.warnings[0].line, 'number');
  assert.strictEqual(r.script.body.length, 1);
  assert.strictEqual(r.script.body[0].type, 'if');
  assert.strictEqual(r.script.body[0].branches[0].body.length, 1);
});

test('zusätzliche schliessende Klammer: Warnung, Rest wird weiter geparst', () => {
  const r = parse('$a = 1\n}\n$b = 2');
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.warnings[0].line, 2);
  assert.strictEqual(r.script.body.length, 2);
  assert.strictEqual(r.script.body[1].text, '$b = 2');
});

test('leere Eingabe und Nicht-Strings werfen nicht', () => {
  const r = parse('');
  assert.deepStrictEqual(r.script.body, []);
  assert.deepStrictEqual(r.script.functions, []);
  assert.strictEqual(r.script.paramText, null);
  assert.strictEqual(r.warnings.length, 0);

  assert.doesNotThrow(() => parse(null));
  assert.doesNotThrow(() => parse(undefined));
  assert.doesNotThrow(() => parse(42));
  assert.strictEqual(parse(null).script.body.length, 0);
});

test('Semikolons trennen Anweisungen auf einer Zeile', () => {
  const b = parse('$a = 1; $b = 2; Write-Host $a').script.body;
  assert.strictEqual(b.length, 3);
  assert.deepStrictEqual(b.map(x => x.line), [1, 1, 1]);
  assert.strictEqual(b[2].io, 'output');
});

test('Zeilennummern in einem mehrzeiligen Beispiel', () => {
  const r = parse(ps([
    '$a = 1',            // 1
    '',                  // 2
    'if ($a -eq 1) {',   // 3
    '    $b = 2',        // 4
    '    $c = 3',        // 5
    '}',                 // 6
    '',                  // 7
    'Write-Host "Ende"'  // 8
  ]));
  const b = r.script.body;
  assert.strictEqual(b.length, 3);
  assert.strictEqual(b[0].line, 1);
  assert.strictEqual(b[1].line, 3);
  assert.strictEqual(b[1].branches[0].body[0].line, 4);
  assert.strictEqual(b[1].branches[0].body[1].line, 5);
  assert.strictEqual(b[2].line, 8);
});

test('Sanity: einzeiliges if/else ergibt einen sinnvollen AST', () => {
  const r = parse('if ($a) { $b = 1 } else { $b = 2 }');
  assert.strictEqual(r.warnings.length, 0);
  const n = r.script.body[0];
  assert.strictEqual(n.type, 'if');
  assert.strictEqual(n.branches.length, 1);
  assert.strictEqual(n.branches[0].cond, '$a');
  assert.strictEqual(n.branches[0].body[0].text, '$b = 1');
  assert.strictEqual(n.elseBody[0].text, '$b = 2');
});

test('Zuweisung aus if/elseif/else-AUSDRUCK wird EIN Process-Knoten ohne Warnungen', () => {
  const r = parse('$note = if ($p -ge 90) { 6 } elseif ($p -ge 75) { 5 } else { 4 }');
  assert.strictEqual(r.warnings.length, 0, 'keine Warnungen erwartet: ' + JSON.stringify(r.warnings));
  const b = r.script.body;
  assert.strictEqual(b.length, 1, JSON.stringify(b.map(x => x.text)));
  assert.strictEqual(b[0].type, 'process');
  assert.ok(b[0].text.indexOf('elseif') !== -1, 'elseif-Zweig muss enthalten sein: ' + b[0].text);
  assert.ok(b[0].text.indexOf('else') !== -1, 'else-Zweig muss enthalten sein: ' + b[0].text);
  assert.strictEqual(b[0].line, 1);
});

test('Zuweisung aus if/else-AUSDRUCK (ohne elseif) wird EIN Process-Knoten', () => {
  const r = parse('$status = if ($a -ge 18) { "erwachsen" } else { "jugendlich" }');
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  const b = r.script.body;
  assert.strictEqual(b.length, 1, JSON.stringify(b.map(x => x.text)));
  assert.strictEqual(b[0].type, 'process');
  assert.strictEqual(b[0].text, '$status = if ($a -ge 18) { "erwachsen" } else { "jugendlich" }');
});

test('verwaistes else ohne if warnt weiterhin', () => {
  const r = parse('else { $x = 1 }');
  assert.ok(r.warnings.length >= 1, 'Warnung für verwaistes else erwartet');
  assert.ok(r.warnings.some(w => w.message.indexOf('else') !== -1), JSON.stringify(r.warnings));
});

test('normales if/elseif/else-STATEMENT bleibt ein If-Knoten mit Zweigen', () => {
  const r = parse(ps([
    'if ($p -ge 90) {',
    '    $note = 6',
    '} elseif ($p -ge 75) {',
    '    $note = 5',
    '} else {',
    '    $note = 4',
    '}'
  ]));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  const n = r.script.body[0];
  assert.strictEqual(r.script.body.length, 1);
  assert.strictEqual(n.type, 'if');
  assert.strictEqual(n.branches.length, 2);
  assert.strictEqual(n.branches[0].cond, '$p -ge 90');
  assert.strictEqual(n.branches[1].cond, '$p -ge 75');
  assert.ok(Array.isArray(n.elseBody));
  assert.strictEqual(n.elseBody[0].text, '$note = 4');
});

// ------------------------------------------------------------------

console.log('');
console.log(passed + ' Tests bestanden, ' + failed + ' fehlgeschlagen.');
if (failed > 0) process.exit(1);
process.exit(0);
