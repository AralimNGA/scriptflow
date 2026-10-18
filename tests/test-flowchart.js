/*
 * ScriptFlow — tests/test-flowchart.js
 * Run from project root:  node tests/test-flowchart.js
 * AST fixtures are built BY HAND per CONTRACT.md (parser.js is NOT imported).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const api = require(path.join(__dirname, '..', 'js', 'flowchart.js'));

let passed = 0, failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.error('FAIL ' + name);
    console.error('     ' + String(e && e.message ? e.message : e).split('\n').join('\n     '));
  }
}

// ---- fixture helpers (hand-built AST per contract) --------------------------

function P(text, line, io, calls) {
  return { type: 'process', text: text, io: io || null, calls: calls || [], line: line };
}
function J(kind, text, line) {
  return { type: 'jump', kind: kind, text: text, line: line };
}

function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// Structural sanity checks applied to every rendered result.
function sane(res, label) {
  const tag = ' [' + label + ']';
  assert.ok(res && typeof res === 'object', 'result object' + tag);
  assert.strictEqual(typeof res.svg, 'string', 'svg is a string' + tag);
  assert.ok(res.svg.startsWith('<svg'), 'svg starts with <svg' + tag);
  assert.ok(res.svg.endsWith('</svg>'), 'svg ends with </svg>' + tag);
  assert.ok(res.svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'xmlns present' + tag);
  assert.ok(Number.isFinite(res.width) && res.width > 0, 'width positive number' + tag);
  assert.ok(Number.isFinite(res.height) && res.height > 0, 'height positive number' + tag);
  const open = res.svg.slice(0, res.svg.indexOf('>') + 1);
  const wm = open.match(/\bwidth="(\d+(?:\.\d+)?)"/);
  const hm = open.match(/\bheight="(\d+(?:\.\d+)?)"/);
  const vb = open.match(/\bviewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  assert.ok(wm && hm && vb, 'width/height/viewBox attributes present' + tag);
  assert.strictEqual(+wm[1], res.width, 'width attr matches returned width' + tag);
  assert.strictEqual(+hm[1], res.height, 'height attr matches returned height' + tag);
  assert.strictEqual(+vb[1], res.width, 'viewBox W matches' + tag);
  assert.strictEqual(+vb[2], res.height, 'viewBox H matches' + tag);
  assert.ok(res.svg.includes('fill="#ffffff"'), 'white background rect' + tag);
  assert.ok(!/NaN/.test(res.svg), 'no NaN in svg' + tag);
  assert.ok(!/-\d/.test(res.svg), 'no negative coordinates in svg' + tag);
  // every node group carries data-line + pointer cursor
  const nds = count(res.svg, 'class="nd"');
  assert.strictEqual(count(res.svg, 'data-line="'), nds, 'every nd group has data-line' + tag);
  assert.strictEqual(count(res.svg, 'cursor:pointer'), nds, 'every nd group has pointer cursor' + tag);
  return res.svg;
}

const R = api.renderFlowchart;

// ---- tests ------------------------------------------------------------------

check('module API exports', () => {
  assert.strictEqual(typeof api.renderFlowchart, 'function');
  assert.strictEqual(typeof api.estWidth, 'function');
});

check('estWidth basics', () => {
  assert.strictEqual(api.estWidth(''), 0);
  assert.ok(api.estWidth('iiii') < api.estWidth('MMMM'), 'narrow < wide');
  assert.ok(api.estWidth('Hallo Welt') > 0);
  assert.ok(Number.isFinite(api.estWidth(null)), 'null tolerated');
});

check('empty body renders Start -> Ende', () => {
  const res = R([], {});
  const svg = sane(res, 'empty');
  assert.ok(svg.includes('>Start</tspan>'), 'Start terminator');
  assert.ok(svg.includes('>Ende</tspan>'), 'Ende terminator');
  assert.strictEqual(count(svg, 'class="nd"'), 2, 'exactly 2 nodes');
  assert.ok(svg.includes('fill="#e9f7ef"'), 'terminator fill');
});

check('opts.title used as Start text', () => {
  const svg = sane(R([], { title: 'Mein Skript' }), 'title');
  assert.ok(svg.includes('>Mein Skript</tspan>'));
  assert.ok(!svg.includes('>Start</tspan>'));
});

check('process, io and calls shapes', () => {
  const body = [
    P('$name = Read-Host "Wie ist dein Name?"', 1, 'input'),
    P('$gruss = "Hallo " + $name', 2),
    P('Zeige-Gruss $gruss', 3, null, ['Zeige-Gruss']),
    P('Write-Host $gruss', 4, 'output')
  ];
  const svg = sane(R(body, {}), 'shapes');
  assert.strictEqual(count(svg, 'fill="#eaf2ff"'), 2, 'two io parallelograms');
  assert.strictEqual(count(svg, 'class="pp"'), 2, 'double side bars on calls-process');
  assert.ok(svg.includes('data-line="1"') && svg.includes('data-line="2"')
    && svg.includes('data-line="3"') && svg.includes('data-line="4"'), 'data-line per stmt');
  assert.strictEqual(count(svg, 'class="nd"'), 6, 'Start + 4 stmts + Ende');
});

check('if/else: Ja/Nein labels and decision diamond', () => {
  const body = [{
    type: 'if', line: 2,
    branches: [{ cond: '$x -gt 10', body: [P('Write-Host "gross"', 3, 'output')] }],
    elseBody: [P('Write-Host "klein"', 5, 'output')]
  }];
  const svg = sane(R(body, {}), 'if/else');
  assert.ok(svg.includes('>Ja</text>'), 'Ja label');
  assert.ok(svg.includes('>Nein</text>'), 'Nein label');
  assert.ok(svg.includes('fill="#fff6e5"'), 'decision fill');
  assert.strictEqual(count(svg, 'class="nd"'), 5, 'Start, diamond, 2 bodies, Ende');
});

check('if without else: Nein channel to merge', () => {
  const body = [{
    type: 'if', line: 1,
    branches: [{ cond: '$ok', body: [P('Tu-Was', 2)] }],
    elseBody: null
  }];
  const svg = sane(R(body, {}), 'if-no-else');
  assert.ok(svg.includes('>Nein</text>'));
  assert.strictEqual(count(svg, 'class="nd"'), 4);
});

check('elseif cascade: one Ja/Nein per diamond', () => {
  const body = [{
    type: 'if', line: 1,
    branches: [
      { cond: '$n -eq 1', body: [P('Eins', 2)] },
      { cond: '$n -eq 2', body: [P('Zwei', 4)] },
      { cond: '$n -eq 3', body: [P('Drei', 6)] }
    ],
    elseBody: [P('Viele', 8)]
  }];
  const svg = sane(R(body, {}), 'elseif');
  assert.strictEqual(count(svg, '>Ja</text>'), 3, 'three Ja labels');
  assert.strictEqual(count(svg, '>Nein</text>'), 3, 'three Nein labels');
  assert.strictEqual(count(svg, 'fill="#fff6e5"'), 3, 'three diamonds');
  assert.strictEqual(count(svg, 'class="nd"'), 9, 'Start + 3 diamonds + 4 bodies + Ende');
});

check('nested if inside while: node count sanity', () => {
  const body = [
    P('$i = 0', 2),
    {
      type: 'while', cond: '$i -lt 10', line: 3,
      body: [
        {
          type: 'if', line: 4,
          branches: [{ cond: '$i % 2 -eq 0', body: [P('Write-Host "gerade"', 5, 'output')] }],
          elseBody: [P('Write-Host "ungerade"', 7, 'output')]
        },
        P('$i = $i + 1', 9)
      ]
    },
    P('Write-Host "geschafft"', 11, 'output')
  ];
  const svg = sane(R(body, {}), 'if-in-while');
  // Start, $i=0, while-diamond, if-diamond, gerade, ungerade, $i+1, geschafft, Ende
  assert.strictEqual(count(svg, 'class="nd"'), 9, 'nine node groups');
  assert.ok(svg.includes('>Ja</text>') && svg.includes('>Nein</text>'));
  assert.strictEqual(count(svg, 'fill="#fff6e5"'), 2, 'two diamonds');
  assert.ok(svg.includes('data-line="3"') && svg.includes('data-line="4"'));
});

check('while with break: jump stub label', () => {
  const body = [{
    type: 'while', cond: '$true', line: 1,
    body: [
      P('Warte kurz', 2),
      {
        type: 'if', line: 3,
        branches: [{ cond: '$fertig', body: [J('break', 'break', 4)] }],
        elseBody: null
      }
    ]
  }];
  const svg = sane(R(body, {}), 'while-break');
  assert.ok(svg.includes('Schleife verlassen'), 'break stub label');
  assert.ok(svg.includes('fill="#fdecea"'), 'jump node fill');
  assert.ok(svg.includes('stroke-dasharray'), 'dashed stub');
});

check('continue and throw stub labels', () => {
  const svg = sane(R([J('continue', 'continue', 1), J('throw', 'throw "kaputt"', 2)], {}), 'cont-throw');
  assert.ok(svg.includes('nächste Iteration'), 'continue label');
  assert.ok(svg.includes('Fehler werfen'), 'throw label');
});

check('switch with 3 cases + default', () => {
  const body = [{
    type: 'switch', subject: '$farbe', line: 1,
    cases: [
      { label: 'rot', body: [P('Male rot', 2)] },
      { label: 'blau', body: [P('Male blau', 3)] },
      { label: 'gruen', body: [P('Male gruen', 4)] }
    ],
    defaultBody: [P('Male grau', 5)],
    line: 1
  }];
  const svg = sane(R(body, {}), 'switch');
  assert.ok(svg.includes('>rot</text>') && svg.includes('>blau</text>') && svg.includes('>gruen</text>'), 'case labels');
  assert.ok(svg.includes('>Sonst</text>'), 'Sonst label for default');
  assert.strictEqual(count(svg, 'class="nd"'), 7, 'Start + diamond + 4 case bodies + Ende');
});

check('switch without default: direct Sonst edge', () => {
  const body = [{
    type: 'switch', subject: '$n', line: 1,
    cases: [{ label: 'eins', body: [P('Eins', 2)] }],
    defaultBody: null
  }];
  const svg = sane(R(body, {}), 'switch-no-default');
  assert.ok(svg.includes('>Sonst</text>'), 'direct Sonst edge label');
});

check('do-until: Nein loops back, Ja exits (order in paint)', () => {
  const body = [{ type: 'doloop', kind: 'until', cond: '$eingabe -eq "q"', line: 1, body: [P('Frage stellen', 2)] }];
  const svg = sane(R(body, {}), 'do-until');
  const iN = svg.indexOf('>Nein</text>'), iJ = svg.indexOf('>Ja</text>');
  assert.ok(iN !== -1 && iJ !== -1, 'both labels present');
  assert.ok(iN < iJ, 'until: back edge (Nein) painted before exit (Ja)');
});

check('do-while: Ja loops back, Nein exits (order in paint)', () => {
  const body = [{ type: 'doloop', kind: 'while', cond: '$weiter', line: 1, body: [P('Noch einmal', 2)] }];
  const svg = sane(R(body, {}), 'do-while');
  const iN = svg.indexOf('>Nein</text>'), iJ = svg.indexOf('>Ja</text>');
  assert.ok(iN !== -1 && iJ !== -1, 'both labels present');
  assert.ok(iJ < iN, 'while: back edge (Ja) painted before exit (Nein)');
});

check('do-until with switch inside', () => {
  const body = [{
    type: 'doloop', kind: 'until', cond: '$wahl -eq 4', line: 1,
    body: [{
      type: 'switch', subject: '$wahl', line: 2,
      cases: [
        { label: '1', body: [P('Aktion eins', 3)] },
        { label: '2', body: [P('Aktion zwei', 4)] },
        { label: '3', body: [P('Aktion drei', 5)] }
      ],
      defaultBody: [P('Hinweis zeigen', 6)]
    }]
  }];
  const svg = sane(R(body, {}), 'do-until-switch');
  assert.ok(svg.includes('>Sonst</text>'));
  assert.strictEqual(count(svg, 'class="nd"'), 8, 'Start + do-diamond + switch-diamond + 4 bodies + Ende');
});

check('foreach: hexagon and fertig label', () => {
  const body = [{
    type: 'foreach', header: '$datei in $dateien', line: 1,
    body: [P('Copy-Item $datei $ziel', 2)]
  }];
  const svg = sane(R(body, {}), 'foreach');
  assert.ok(svg.includes('fill="#f4edfb"'), 'loop header fill (hexagon)');
  assert.ok(svg.includes('>fertig</text>'), 'fertig exit label');
  assert.ok(svg.includes('$datei in $dateien'), 'raw header text');
});

check('for: hexagon and fertig label', () => {
  const body = [{ type: 'for', header: '$i = 0; $i -lt 5; $i++', line: 1, body: [P('Write-Host $i', 2, 'output')] }];
  const svg = sane(R(body, {}), 'for');
  assert.ok(svg.includes('fill="#f4edfb"') && svg.includes('>fertig</text>'));
});

check('try/catch/finally', () => {
  const body = [{
    type: 'try', line: 1,
    body: [P('Get-Content daten.txt', 2)],
    catches: [{ label: 'IOException', body: [P('Write-Host "Lesefehler"', 4, 'output')] }],
    finallyBody: [P('Aufraeumen', 6)]
  }];
  const svg = sane(R(body, {}), 'try');
  assert.ok(svg.includes('bei Fehler'), 'bei Fehler edge label');
  assert.ok(svg.includes('IOException'), 'catch label shown');
  assert.ok(svg.includes('#ff9f0a'), 'orange dashed container stroke');
  assert.ok(svg.includes('>Try</text>') && svg.includes('>Catch</text>') && svg.includes('>Finally</text>'), 'container labels');
  assert.ok(svg.includes('stroke-dasharray'), 'dashed strokes');
  // Try/Catch/Finally containers are clickable nd groups too (click-to-source)
  assert.strictEqual(count(svg, 'class="nd"'), 8, 'Start + 3 containers + 3 bodies + Ende');
});

check('try with two catches, no finally', () => {
  const body = [{
    type: 'try', line: 1,
    body: [P('Riskante Sache', 2)],
    catches: [
      { label: 'IOException', body: [P('Melde IO', 3)] },
      { label: 'Fehler', body: [P('Melde Rest', 5)] }
    ],
    finallyBody: null
  }];
  const svg = sane(R(body, {}), 'try-2-catches');
  assert.strictEqual(count(svg, 'bei Fehler'), 2, 'two bei Fehler labels');
  assert.strictEqual(count(svg, '>Catch</text>'), 2, 'two catch containers');
  assert.ok(!svg.includes('>Finally</text>'), 'no finally container');
});

check('return mid-flow: dead code stays disconnected, Ende still present', () => {
  const body = [P('$a = 1', 1), J('return', 'return $a', 2), P('$b = 2', 3)];
  const svg = sane(R(body, {}), 'return-mid');
  assert.ok(svg.includes('>Ende</tspan>'), 'Ende present (last stmt is a process)');
  assert.strictEqual(count(svg, 'class="nd"'), 5, 'Start, p, return, p, Ende');
  assert.ok(svg.includes('return $a'), 'return text shown');
});

check('return as last statement: no Ende terminator', () => {
  const body = [P('$a = 1', 1), J('return', 'return $a', 2)];
  const svg = sane(R(body, {}), 'return-last');
  assert.ok(!svg.includes('>Ende</tspan>'), 'no Ende after terminating return');
  assert.strictEqual(count(svg, 'class="nd"'), 3, 'Start, p, return');
});

check('if with both branches returning: flow terminates', () => {
  const body = [{
    type: 'if', line: 1,
    branches: [{ cond: '$x', body: [J('return', 'return 1', 2)] }],
    elseBody: [J('return', 'return 2', 4)]
  }];
  const svg = sane(R(body, {}), 'if-all-return');
  assert.ok(!svg.includes('>Ende</tspan>'), 'no Ende when every branch returns');
});

check('label truncation at 46 chars with title fallback', () => {
  const long = 'Set-Content pfad wert und noch viel mehr Text der wirklich sehr lang ist am Ende';
  const svg = sane(R([P(long, 1)], {}), 'trunc');
  assert.ok(long.length > 46, 'fixture text is long enough');
  assert.ok(svg.includes('…'), 'ellipsis in label');
  assert.ok(svg.includes('<title>' + long + '</title>'), 'full text in <title>');
});

check('garbage AST never throws', () => {
  const garbage = [
    undefined, null, 'hallo', 42, {}, { foo: 1 },
    [{ type: 'unbekannt', text: 'Mystery Statement', line: 7 }],
    [{ type: 'if' }], [{ type: 'if', branches: [] }],
    [{ type: 'switch' }], [{ type: 'while' }], [{ type: 'doloop' }],
    [{ type: 'for' }], [{ type: 'foreach' }], [{ type: 'try' }],
    [{ type: 'jump' }], [{ type: 'jump', kind: 'seltsam' }],
    [null, { type: 'process' }, 'wat', 5]
  ];
  garbage.forEach((g, i) => {
    let res;
    assert.doesNotThrow(() => { res = api.renderFlowchart(g, null); }, 'input #' + i + ' must not throw');
    sane(res, 'garbage#' + i);
  });
  // unknown type is rendered as a process node with its text
  const svg = R([{ type: 'unbekannt', text: 'Mystery Statement', line: 7 }], {}).svg;
  assert.ok(svg.includes('Mystery Statement'), 'unknown type rendered as process');
  assert.ok(svg.includes('data-line="7"'), 'unknown type keeps its line');
});

check('deeply nested combination stays sane', () => {
  const body = [{
    type: 'foreach', header: '$s in $server', line: 1,
    body: [{
      type: 'try', line: 2,
      body: [{
        type: 'if', line: 3,
        branches: [{ cond: 'Test-Connection $s', body: [P('Sichere $s', 4, null, ['Sichere'])] }],
        elseBody: [J('continue', 'continue', 6)]
      }],
      catches: [{ label: 'Fehler', body: [P('Write-Host "Problem mit $s"', 8, 'output')] }],
      finallyBody: [P('Protokoll schreiben', 10, 'output')]
    }]
  }];
  sane(R(body, { title: 'Backup' }), 'deep-nest');
});

// ---- regression: try emits a clickable node (click-to-source) ---------------

check('regression: try container is a clickable nd group with the try line', () => {
  const body = [{
    type: 'try', line: 7,
    body: [P('Get-Content daten.txt', 8)],
    catches: [{ label: 'Fehler', body: [P('Melde Fehler', 9)] }],
    finallyBody: [P('Aufraeumen', 10)]
  }];
  const svg = sane(R(body, {}), 'try-clickable');
  // the Try container itself must be wrapped in a clickable nd group carrying
  // the try statement's line
  const gi = svg.indexOf('<g class="nd" data-line="7"');
  assert.ok(gi !== -1, 'nd group with the try statement line exists');
  assert.ok(svg.slice(gi, gi + 60).includes('cursor:pointer'), 'try group has pointer cursor');
  const seg = svg.slice(gi, svg.indexOf('</g>', gi));
  assert.ok(seg.includes('stroke-dasharray'), 'group wraps the dashed container rect');
  assert.ok(seg.includes('>Try</text>'), 'group wraps the "Try" label');
  // Catch and Finally containers carry the same try line
  assert.strictEqual(count(svg, 'data-line="7"'), 3, 'Try + Catch + Finally groups share the try line');
});

// ---- regression: truncation must never split a UTF-16 surrogate pair --------

// Every high surrogate must be followed by a low one and every low surrogate
// preceded by a high one, else the SVG is invalid XML and PNG export
// (encodeURIComponent-based) throws URIError.
function assertNoLoneSurrogates(svg, tag) {
  for (let i = 0; i < svg.length; i++) {
    const c = svg.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const n = i + 1 < svg.length ? svg.charCodeAt(i + 1) : 0;
      assert.ok(n >= 0xDC00 && n <= 0xDFFF, 'lone HIGH surrogate at index ' + i + ' [' + tag + ']');
      i++; // skip the low half of the valid pair
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      assert.fail('lone LOW surrogate at index ' + i + ' [' + tag + ']');
    }
  }
  assert.doesNotThrow(() => encodeURIComponent(svg), 'encodeURIComponent must not throw [' + tag + ']');
}

check('regression: emoji straddling the 46-char truncation cut', () => {
  // high surrogate at code unit 44, low at 45 — the old slice(0, 45) cut
  // exactly between them
  const procText = 'A'.repeat(44) + '\u{1F600}' + 'XYZ';
  assert.ok(procText.length > 46, 'fixture longer than 46 code units');
  const hi = procText.charCodeAt(44);
  assert.ok(hi >= 0xD800 && hi <= 0xDBFF, 'surrogate pair straddles index 45');
  const svg = sane(R([P(procText, 1)], {}), 'emoji-46');
  assert.ok(svg.includes('…'), 'label was truncated');
  assertNoLoneSurrogates(svg, 'emoji-46');
});

check('regression: emoji straddling the 18-char edge-label truncation cut', () => {
  // switch case labels go through trunc18(); high surrogate at unit 16,
  // low at 17 — the old slice(0, 17) cut between them
  const caseLabel = 'B'.repeat(16) + '\u{1F600}' + 'CC';
  assert.ok(caseLabel.length > 18, 'label longer than 18 code units');
  const hi = caseLabel.charCodeAt(16);
  assert.ok(hi >= 0xD800 && hi <= 0xDBFF, 'surrogate pair straddles index 17');
  const body = [{
    type: 'switch', subject: '$x', line: 1,
    cases: [{ label: caseLabel, body: [P('Tu was', 2)] }],
    defaultBody: null
  }];
  const svg = sane(R(body, {}), 'emoji-18');
  assertNoLoneSurrogates(svg, 'emoji-18');
});

check('regression: emoji at the 3-line wrap clamp', () => {
  // Four one-word lines force the 3-line clamp, whose old code sliced one
  // CODE UNIT off the third line — the trailing emoji lost its low half.
  const t = 'M'.repeat(9) + ' ' + 'M'.repeat(9) + ' ' + 'M'.repeat(8) + '\u{1F600} ' + 'M'.repeat(9);
  const svg = sane(R([P(t, 1)], {}), 'emoji-clamp');
  assert.ok(svg.includes('…'), 'clamped label carries ellipsis');
  assertNoLoneSurrogates(svg, 'emoji-clamp');
});

// ---- summary ----------------------------------------------------------------

console.log('');
if (failed) {
  console.error(failed + ' test(s) FAILED, ' + passed + ' passed.');
  process.exit(1);
} else {
  console.log('All ' + passed + ' tests passed.');
  process.exit(0);
}
