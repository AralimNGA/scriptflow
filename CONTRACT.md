# ScriptFlow — Module Contract (BINDING)

ScriptFlow is a dependency-free local web app that parses PowerShell scripts and renders
them as (1) a DIN-66001-style flowchart, (2) a Nassi-Shneiderman diagram (Struktogramm),
and (3) Mermaid `flowchart TD` code. Target user: a Swiss vocational-school student.
UI language is German; diagram labels are German (see below).

This file is the single source of truth for the AST shape and module APIs.
All modules MUST follow it exactly — the app shell and the other modules are built
against it in parallel.

## General rules for every module

- Plain browser JavaScript, ES2020, **no external libraries**, no TypeScript syntax.
- Pure string-in/string-out. **Never touch the DOM**, never use `document`/`window` APIs
  beyond the registration pattern below.
- Never throw on any input — degrade gracefully.
- Registration pattern (mandatory, exactly this shape):

```js
(function (root) {
  'use strict';
  // ... implementation ...
  const api = { /* exported functions, see per-module sections */ };
  root.PSViz = root.PSViz || {};
  Object.assign(root.PSViz, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

## AST

All statement nodes carry `line` (1-based line number of the statement start in the source).

```
Script   = { type:'script', paramText: string|null, functions: Func[], body: Stmt[] }
Func     = { type:'function', name: string, paramText: string|null, body: Stmt[], line: number }

Stmt is one of:
Process  = { type:'process', text: string, io: null|'input'|'output', calls: string[], line }
           // one node per plain statement; text = raw statement, whitespace collapsed to single spaces
           // io: 'input' if the statement contains Read-Host (input wins over output);
           //     'output' if it starts with or contains Write-Host, Write-Output, Out-File,
           //     Out-GridView, Export-Csv, Export-Clixml, Add-Content, Set-Content
           // calls: names of user-defined functions (defined in the same script) that this
           //        statement invokes (word-boundary, case-insensitive match; post-pass)
If       = { type:'if', branches: [{ cond: string, body: Stmt[] }], elseBody: Stmt[]|null, line }
           // branches[0] = if, branches[1..] = elseif, in source order; length >= 1
Switch   = { type:'switch', subject: string, cases: [{ label: string, body: Stmt[] }],
             defaultBody: Stmt[]|null, line }
While    = { type:'while', cond: string, body: Stmt[], line }
DoLoop   = { type:'doloop', kind:'while'|'until', cond: string, body: Stmt[], line }
For      = { type:'for', header: string, body: Stmt[], line }      // header = raw "init; cond; update"
Foreach  = { type:'foreach', header: string, body: Stmt[], line }  // header = raw "$x in $collection"
Try      = { type:'try', body: Stmt[], catches: [{ label: string, body: Stmt[] }],
             finallyBody: Stmt[]|null, line }
           // label = exception type text if given, else "Fehler"
Jump     = { type:'jump', kind:'return'|'break'|'continue'|'exit'|'throw', text: string, line }
           // text = full statement, e.g. "return $wahl" or "break"
```

`cond`, `subject`, `header`, `label`, `paramText` are raw source text with surrounding
parentheses stripped and whitespace collapsed.

## Module: js/parser.js

```
parse(source: string) => { script: Script, warnings: [{ message: string, line: number }] }
```

- Handles: line comments (`#` to EOL, but NOT inside strings), block comments `<# ... #>`,
  single-quoted strings (`''` escapes a quote), double-quoted strings (backtick escapes,
  `""` escapes a quote, `$( ... )` subexpressions inside them must not confuse brace
  tracking), here-strings `@' ... '@` and `@" ... "@` (closer at line start), backtick
  line continuation, nested `()`, `{}`, `[]`.
- Statement splitting inside a block: newline or `;` ends a statement, EXCEPT while inside
  any open bracket, inside a string, after a trailing pipe `|`, or after a trailing backtick.
- Keywords are case-insensitive: if/elseif/else, switch (incl. `default` case and quoted
  case labels), while, do…while, do…until, for, foreach ($x in $y), function Name { },
  try/catch/finally (multiple catch blocks allowed), return/break/continue/exit/throw.
- `param( ... )` as the first statement of the script or of a function body becomes
  `paramText` (raw content inside the parens), not a Process node.
- Function definitions can appear anywhere at top level; they go into `script.functions`
  in source order and are NOT part of `script.body`. Nested function definitions inside
  functions may be treated as Process nodes with a warning.
- Anything unrecognized becomes a Process node; recovery from malformed input (e.g.
  unclosed brace) must not throw — emit a warning `{message, line}` instead.

## Modules: js/flowchart.js and js/struktogramm.js

```
renderFlowchart(body: Stmt[], opts)     => { svg: string, width: number, height: number }
renderStruktogramm(body: Stmt[], opts)  => { svg: string, width: number, height: number }
opts = { title?: string }   // flowchart: text of the Start terminator (default "Start");
                            // struktogramm: header strip text (default "Ablauf")
```

SVG requirements (both renderers):
- A single standalone `<svg>` string with `xmlns="http://www.w3.org/2000/svg"`,
  `width`, `height` AND `viewBox="0 0 W H"` attributes, and a white background
  `<rect>` covering everything. Returned width/height must match the attributes.
- Paper-ready light palette (fixed, independent of app theme):
  text `#1d1d1f`, lines/strokes `#3a3a3c`, process fill `#ffffff`,
  decision fill `#fff6e5`, I/O fill `#eaf2ff`, terminator fill `#e9f7ef`,
  loop-header fill `#f4edfb`, try/catch container stroke `#ff9f0a` (dashed).
- `font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif"`, font-size ~13.
- Node labels truncated at 46 chars with `…`; full text in a child `<title>` element.
- Empty `body` must still render (flowchart: Start→Ende; struktogramm: single empty box).
- German labels: `Ja`/`Nein` on decisions, `Start`/`Ende` terminators, `Sonst` for
  switch default, `fertig` when a loop is exhausted.

Flowchart specifics (DIN-66001-inspired):
- Start/Ende: stadium (rounded terminator). Process: rectangle. Decision (if/while/do
  condition, switch): diamond. I/O (`io` != null): parallelogram. for/foreach loop header:
  hexagon. Process whose `calls` is non-empty: rectangle with double vertical side bars
  (predefined process).
- while: diamond on top, `Ja` into body, back edge to diamond, `Nein` exits.
  doloop kind 'while': body first, diamond after, `Ja` loops back, `Nein` exits.
  doloop kind 'until': body first, diamond after, `Nein` loops back, `Ja` exits.
  for/foreach: hexagon header, body below, back edge to hexagon, exit edge labeled `fertig`.
- if/elseif/else: diamonds with `Ja`/`Nein`, branch bodies laid out side by side, merged
  below. switch: one diamond, fan-out edges labeled with case labels, `Sonst` for default.
- try: dashed rounded container around the try body, catch blocks connected with a dashed
  edge labeled `bei Fehler` (plus catch label), finally below the merge.
- Jump 'return'/'exit': terminator-shaped node, NO outgoing edge. 'break'/'continue'/'throw':
  rounded node with a short dashed outgoing stub labeled `Schleife verlassen` /
  `nächste Iteration` / `Fehler werfen` (no long edges required).
- Layout: recursive composition — every construct produces a sub-layout with
  {width, height, entry point, exit point}; vertical center spine; orthogonal edges with
  arrowheads (marker or polygon); nothing may overlap.

Struktogramm specifics (Nassi-Shneiderman):
- Sequence: stacked full-width boxes. If: header box with two diagonals meeting at the
  bottom center, `Ja` left / `Nein` right, two columns below (Nein column shows `—` if
  elseBody is null). elseif chains: nest in the Nein column (or an n-column split).
- switch: header with fan-out, one column per case + `Sonst`.
- while/for/foreach: top strip with the condition/header + L-shaped left bar around the
  indented body. doloop: body first, bottom strip (`wiederhole solange <cond>` for 'while',
  `wiederhole bis <cond>` for 'until').
- try: container with sections `Versuche`, `Bei Fehler (<label>)`, `Danach (finally)`.
- Jump: plain box with the statement text.
- Column widths computed recursively (min-width per subtree) so nested content stays readable.

## Module: js/mermaid.js

```
toMermaid(body: Stmt[], opts) => string          // opts = { title?: string }
```

- Emits a valid `flowchart TD` mirroring the flowchart semantics:
  `id(["Start"])` / `id(["Ende"])` terminators, `id["..."]` process, `id{"..."}` decision
  with `|Ja|`/`|Nein|` edge labels, `id[/"..."/]` for io nodes, `id[["..."]]` for
  statements that call user functions, loop back edges, switch fan-out with case labels,
  try/catch via an edge labeled `bei Fehler`.
- Every label wrapped in double quotes; `"` inside labels replaced with `#quot;`;
  no raw newlines inside labels (collapse to spaces). Node ids unique (`n0`, `n1`, …).
- do-until loops: back edge labeled `Nein`, exit labeled `Ja` (inverse for do-while).
- return/exit map to `(["..."])` terminators with no outgoing edge.

## Tests

Each module author writes `tests/test-<module>.js`, runnable as
`node tests/test-<module>.js` from the project root (plain `assert`/manual checks,
process exit code 0 on success, non-zero with readable output on failure).
Renderer/mermaid tests build AST fixtures BY HAND per this contract — they must not
import parser.js. Parser tests cover the tricky lexing cases listed in its section.
