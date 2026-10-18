/*
 * ScriptFlow — Mermaid-Exporter (js/mermaid.js)
 *
 * toMermaid(body, opts) => string
 *   body: Stmt[] gemäss CONTRACT.md, opts = { title?: string }
 *
 * Erzeugt gültigen `flowchart TD`-Code, der die Flowchart-Semantik spiegelt:
 * Terminatoren (["…"]), Prozess ["…"], Entscheidung {"…"} mit |Ja|/|Nein|,
 * I/O [/"…"/], Unterprogramm-Aufruf [["…"]], for/foreach als Hexagon {{"…"}}
 * mit Exit-Label `fertig`, Switch-Fan-out mit Case-Labels und `Sonst`,
 * try/catch als Subgraphen mit gestrichelter `bei Fehler`-Kante.
 *
 * Alle Label-Texte werden entity-escaped (#35; #quot; #91; #93; …), damit
 * PowerShell-Syntax wie [int]$x oder Case-Labels mit ()/{}/| die
 * Mermaid-Syntax nicht brechen und der Anzeigetext unverfälscht bleibt.
 * break/throw terminieren ihre Kette (keine Abwärtskante) wie return/exit;
 * continue behält die Abwärtskante (fliesst zur Schleifenbedingung zurück).
 *
 * Wirft nie — unbekannte/kaputte Knoten degradieren zu Prozessknoten.
 */
(function (root) {
  'use strict';

  const MAX_NODE_LABEL = 60;
  const MAX_EDGE_LABEL = 30;

  // Papier-taugliche helle Palette (fix, unabhängig vom App-Theme)
  const CLASS_DEFS = {
    decision: 'fill:#fff6e5,stroke:#3a3a3c,color:#1d1d1f',
    io: 'fill:#eaf2ff,stroke:#3a3a3c,color:#1d1d1f',
    terminal: 'fill:#e9f7ef,stroke:#3a3a3c,color:#1d1d1f',
    loop: 'fill:#f4edfb,stroke:#3a3a3c,color:#1d1d1f'
  };

  function collapse(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  }

  // Kürzt auf `max` Codepunkte (surrogat-sicher via Array.from) mit ….
  // Wird VOR dem Entity-Escaping angewendet, damit nie eine Entity
  // in der Mitte zerschnitten wird.
  function truncate(text, max) {
    const cps = Array.from(text);
    if (cps.length <= max) return text;
    return cps.slice(0, max - 1).join('') + '…';
  }

  // Gemeinsamer Sanitizer für ALLE Label-Texte (Knoten UND Kanten).
  // Reihenfolge ist entscheidend: `#` ZUERST zu #35;, damit ein vom Nutzer
  // getipptes literales `#quot;` oder `#35;` zu `#35;quot;` / `#35;35;`
  // wird und Mermaid es nie zu `"` / `#` zurückdecodiert (kein
  // Doppel-Decoding möglich). Danach " -> #quot; sowie [ -> #91; und
  // ] -> #93; — Mermaid rendert die Entities wieder als Originalzeichen,
  // ohne dass sie die Knoten-Syntax brechen (z. B. bleibt [int]$x sichtbar
  // statt zu (int)$x verfälscht zu werden).
  function sanitize(text) {
    return text
      .replace(/#/g, '#35;')
      .replace(/"/g, '#quot;')
      .replace(/\[/g, '#91;')
      .replace(/\]/g, '#93;');
  }

  // Knoten-Label: Whitespace kollabieren, auf 60 Codepunkte kürzen, dann
  // sanitizen. Bleibt wie bisher im Aufrufer in doppelte Anführungszeichen
  // gewrappt.
  function nodeLabel(value) {
    let t = collapse(value);
    t = truncate(t, MAX_NODE_LABEL);
    t = sanitize(t);
    if (t === '') t = '…';
    return t;
  }

  // Kanten-Label (|...|): bleiben unquoted, daher müssen zusätzlich ALLE
  // Zeichen mit Mermaid-Syntaxbedeutung als Entities codiert werden —
  // rohe ( ) { } | in einem |...|-Label machen das ganze Diagramm
  // unparsbar (z. B. Case-Label `(sonstiges)` oder Catch-Labels mit
  // Klammern). Kürzung auf 30 Codepunkte, ebenfalls vor dem Escaping.
  function edgeLabel(value) {
    let t = collapse(value);
    t = truncate(t, MAX_EDGE_LABEL);
    t = sanitize(t)
      .replace(/\(/g, '#40;')
      .replace(/\)/g, '#41;')
      .replace(/\{/g, '#123;')
      .replace(/\}/g, '#125;')
      .replace(/\|/g, '#124;');
    return t;
  }

  function toMermaid(body, opts) {
    try {
      return build(body, opts);
    } catch (err) {
      // Vertrag: nie werfen — minimal gültiges Diagramm als Fallback.
      return 'flowchart TD\n  n0(["Fehler beim Mermaid-Export"])\n';
    }
  }

  function build(body, opts) {
    const options = (opts && typeof opts === 'object') ? opts : {};
    // Sanfte Degradation: auch ein versehentlich übergebenes Script-Objekt
    // ({ body: [...] }) wird akzeptiert; alles andere => leerer Ablauf.
    let stmts = [];
    if (Array.isArray(body)) stmts = body;
    else if (body && Array.isArray(body.body)) stmts = body.body;

    const state = {
      lines: [],
      nextNode: 0,
      nextSub: 0,
      indent: 1,
      classes: { decision: [], io: [], terminal: [], loop: [] }
    };

    function emit(text) {
      state.lines.push('  '.repeat(state.indent) + text);
    }

    // Deklariert einen Knoten (Deklaration steht immer VOR jeder Kante,
    // die den Knoten referenziert) und gibt seine Id zurück.
    function newNode(open, close, text, cls) {
      const id = 'n' + (state.nextNode++);
      emit(id + open + '"' + nodeLabel(text) + '"' + close);
      if (cls && state.classes[cls]) state.classes[cls].push(id);
      return id;
    }

    function edge(from, to, label, dashed) {
      const arrow = dashed ? ' -.->' : ' -->';
      const l = (label === null || label === undefined) ? '' : edgeLabel(label);
      if (l !== '') emit(from + arrow + '|' + l + '| ' + to);
      else emit(from + arrow + ' ' + to);
    }

    // exits: Array von [id, label|null]
    function connectExits(exits, target) {
      if (!Array.isArray(exits)) return;
      for (const ex of exits) edge(ex[0], target, ex[1], false);
    }

    // ---- rekursive Generierung ------------------------------------------
    // gen(node)   => { entry: id, exits: [[id, label|null], ...] }
    // genSeq(arr) => dito oder null (leerer Block)
    // exits === [] bedeutet: alle Pfade terminieren (return/exit).

    function genSeq(list) {
      if (!Array.isArray(list) || list.length === 0) return null;
      let entry = null;
      let exits = null;
      for (const stmt of list) {
        const r = gen(stmt);
        if (!r) continue;
        if (entry === null) entry = r.entry;
        else connectExits(exits, r.entry);
        exits = r.exits;
      }
      if (entry === null) return null;
      return { entry: entry, exits: exits || [] };
    }

    function genProcess(node) {
      const text = (node && node.text !== undefined && node.text !== null && String(node.text) !== '')
        ? node.text
        : ((node && node.type) ? String(node.type) : '?');
      const io = node ? node.io : null;
      const calls = (node && Array.isArray(node.calls)) ? node.calls : [];
      let id;
      if (io === 'input' || io === 'output') id = newNode('[/', '/]', text, 'io');
      else if (calls.length > 0) id = newNode('[[', ']]', text, null);
      else id = newNode('[', ']', text, null);
      return { entry: id, exits: [[id, null]] };
    }

    function genJump(node) {
      const kind = node.kind;
      const text = (node.text && collapse(node.text) !== '') ? node.text : (kind || 'return');
      if (kind === 'return' || kind === 'exit') {
        // Terminator ohne ausgehende Kante
        const id = newNode('([', '])', text, 'terminal');
        return { entry: id, exits: [] };
      }
      if (kind === 'break' || kind === 'throw') {
        // break/throw verlassen den normalen Ablauf: Knoten OHNE
        // Abwärtskante, sonst flösse z. B. ein break zurück in die
        // Schleifenbedingung (semantisch falsch). Kette terminiert wie
        // bei return/exit; Folge-Statements im selben Block verhalten
        // sich exakt wie nach einem return (deklariert, ohne Eingang).
        const id = newNode('[', ']', text, null);
        return { entry: id, exits: [] };
      }
      // continue: behält die Abwärtskante — sie fliesst natürlich zur
      // Schleifenbedingung zurück.
      const id = newNode('[', ']', text, null);
      return { entry: id, exits: [[id, null]] };
    }

    function genIf(node) {
      const branches = (Array.isArray(node.branches) && node.branches.length > 0)
        ? node.branches
        : [{ cond: '?', body: [] }];
      const exits = [];
      let entry = null;
      let prevDecision = null;
      for (const br of branches) {
        const b = br || {};
        const d = newNode('{', '}', b.cond || '?', 'decision');
        if (entry === null) entry = d;
        if (prevDecision) edge(prevDecision, d, 'Nein', false);
        const res = genSeq(b.body);
        if (res) {
          edge(d, res.entry, 'Ja', false);
          exits.push.apply(exits, res.exits);
        } else {
          exits.push([d, 'Ja']);
        }
        prevDecision = d;
      }
      const elseRes = genSeq(node.elseBody);
      if (elseRes) {
        edge(prevDecision, elseRes.entry, 'Nein', false);
        exits.push.apply(exits, elseRes.exits);
      } else {
        exits.push([prevDecision, 'Nein']);
      }
      return { entry: entry, exits: exits };
    }

    function genWhile(node) {
      const d = newNode('{', '}', node.cond || '?', 'decision');
      const res = genSeq(node.body);
      if (res) {
        edge(d, res.entry, 'Ja', false);
        connectExits(res.exits, d); // Rücksprung zur Bedingung
      } else {
        edge(d, d, 'Ja', false); // leerer Rumpf: Selbstschleife
      }
      return { entry: d, exits: [[d, 'Nein']] };
    }

    // for / foreach: Hexagon-Kopf, Rumpf, Rücksprung, Ausgang `fertig`
    function genCountedLoop(node) {
      const h = newNode('{{', '}}', node.header || node.type || '?', 'loop');
      const res = genSeq(node.body);
      if (res) {
        edge(h, res.entry, null, false);
        connectExits(res.exits, h);
      }
      return { entry: h, exits: [[h, 'fertig']] };
    }

    function genDoLoop(node) {
      const res = genSeq(node.body);
      const d = newNode('{', '}', node.cond || '?', 'decision');
      // do-while: Ja zurück, Nein raus — do-until: invers
      const backLabel = node.kind === 'until' ? 'Nein' : 'Ja';
      const exitLabel = node.kind === 'until' ? 'Ja' : 'Nein';
      if (res) {
        connectExits(res.exits, d);
        edge(d, res.entry, backLabel, false);
        return { entry: res.entry, exits: [[d, exitLabel]] };
      }
      edge(d, d, backLabel, false);
      return { entry: d, exits: [[d, exitLabel]] };
    }

    function genSwitch(node) {
      const d = newNode('{', '}', node.subject || 'switch', 'decision');
      const exits = [];
      const cases = Array.isArray(node.cases) ? node.cases : [];
      for (const c of cases) {
        const cc = c || {};
        const label = (cc.label !== undefined && cc.label !== null && collapse(cc.label) !== '')
          ? cc.label
          : 'Fall';
        const res = genSeq(cc.body);
        if (res) {
          edge(d, res.entry, label, false);
          exits.push.apply(exits, res.exits);
        } else {
          exits.push([d, label]);
        }
      }
      const defRes = genSeq(node.defaultBody);
      if (defRes) {
        edge(d, defRes.entry, 'Sonst', false);
        exits.push.apply(exits, defRes.exits);
      } else {
        exits.push([d, 'Sonst']);
      }
      return { entry: d, exits: exits };
    }

    function genTry(node) {
      const sgTry = 'sg' + (state.nextSub++);
      emit('subgraph ' + sgTry + '["Try"]');
      state.indent++;
      let tryRes = genSeq(node.body);
      if (!tryRes) {
        const ph = newNode('[', ']', '(leer)', null);
        tryRes = { entry: ph, exits: [[ph, null]] };
      }
      state.indent--;
      emit('end');

      let exits = tryRes.exits.slice();
      const catches = Array.isArray(node.catches) ? node.catches : [];
      for (const c of catches) {
        const cc = c || {};
        const label = (cc.label && collapse(cc.label) !== '') ? cc.label : 'Fehler';
        const sgCatch = 'sg' + (state.nextSub++);
        emit('subgraph ' + sgCatch + '["' + nodeLabel('Catch: ' + collapse(label)) + '"]');
        state.indent++;
        let cRes = genSeq(cc.body);
        if (!cRes) {
          const ph = newNode('[', ']', '(leer)', null);
          cRes = { entry: ph, exits: [[ph, null]] };
        }
        state.indent--;
        emit('end');
        edge(sgTry, cRes.entry, 'bei Fehler ' + collapse(label), true);
        exits = exits.concat(cRes.exits);
      }

      const finRes = genSeq(node.finallyBody);
      if (finRes) {
        connectExits(exits, finRes.entry);
        exits = finRes.exits;
      }
      return { entry: tryRes.entry, exits: exits };
    }

    function gen(node) {
      if (!node || typeof node !== 'object') {
        return genProcess({ text: (node === null || node === undefined) ? '?' : String(node) });
      }
      switch (node.type) {
        case 'process': return genProcess(node);
        case 'if': return genIf(node);
        case 'switch': return genSwitch(node);
        case 'while': return genWhile(node);
        case 'doloop': return genDoLoop(node);
        case 'for':
        case 'foreach': return genCountedLoop(node);
        case 'try': return genTry(node);
        case 'jump': return genJump(node);
        default:
          // Unbekannter Knotentyp: als Prozess degradieren, nie werfen.
          return genProcess({ text: node.text || String(node.type || '?') });
      }
    }

    // ---- Hauptablauf ----------------------------------------------------
    const title = (typeof options.title === 'string' && collapse(options.title) !== '')
      ? options.title
      : 'Start';
    const startId = newNode('([', '])', title, 'terminal');

    const bodyRes = genSeq(stmts);
    if (bodyRes) {
      edge(startId, bodyRes.entry, null, false);
      if (bodyRes.exits.length > 0) {
        const endeId = newNode('([', '])', 'Ende', 'terminal');
        connectExits(bodyRes.exits, endeId);
      }
      // exits leer => letzter Pfad endet in return/exit: kein Ende-Knoten
    } else {
      const endeId = newNode('([', '])', 'Ende', 'terminal');
      edge(startId, endeId, null, false);
    }

    // Styling (optional laut Design, aber gültiges Mermaid)
    for (const cls of Object.keys(CLASS_DEFS)) {
      if (state.classes[cls].length > 0) {
        state.lines.push('  classDef ' + cls + ' ' + CLASS_DEFS[cls]);
        state.lines.push('  class ' + state.classes[cls].join(',') + ' ' + cls);
      }
    }

    return 'flowchart TD\n' + state.lines.join('\n') + '\n';
  }

  const api = { toMermaid: toMermaid };
  root.PSViz = root.PSViz || {};
  Object.assign(root.PSViz, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
