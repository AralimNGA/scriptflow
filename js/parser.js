/*
 * ScriptFlow — js/parser.js
 * Parst PowerShell-Quelltext in den AST gemäss CONTRACT.md.
 * API: parse(source) => { script, warnings }
 * Wirft niemals — Fehler werden als warnings {message, line} gemeldet.
 */
(function (root) {
  'use strict';

  // ===================== Text-Helfer =====================

  function collapse(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Index des schliessenden einfachen Anführungszeichens ('' ist Escape)
  function skipSingleQ(s, k) {
    for (let j = k + 1; j < s.length; j++) {
      if (s[j] === "'") {
        if (s[j + 1] === "'") { j++; continue; }
        return j;
      }
    }
    return s.length - 1;
  }

  // Index des schliessenden doppelten Anführungszeichens (Backtick und "" sind Escapes)
  function skipDoubleQ(s, k) {
    for (let j = k + 1; j < s.length; j++) {
      const c = s[j];
      if (c === '`') { j++; continue; }
      if (c === '"') {
        if (s[j + 1] === '"') { j++; continue; }
        return j;
      }
    }
    return s.length - 1;
  }

  // Findet zur '(' an Position start die passende ')' — String-bewusst. -1 wenn keine.
  function matchParen(s, start) {
    let d = 0;
    for (let k = start; k < s.length; k++) {
      const c = s[k];
      if (c === "'") { k = skipSingleQ(s, k); continue; }
      if (c === '"') { k = skipDoubleQ(s, k); continue; }
      if (c === '`') { k++; continue; }
      if (c === '(') d++;
      else if (c === ')') { d--; if (d === 0) return k; }
    }
    return -1;
  }

  // Erste '(' ausserhalb von Strings. -1 wenn keine.
  function findParen(s) {
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === "'") { k = skipSingleQ(s, k); continue; }
      if (c === '"') { k = skipDoubleQ(s, k); continue; }
      if (c === '(') return k;
    }
    return -1;
  }

  // Entfernt EIN umschliessendes Klammerpaar, kollabiert Whitespace.
  function stripParens(text) {
    const t = collapse(text);
    if (t.charAt(0) === '(') {
      const close = matchParen(t, 0);
      if (close === t.length - 1) return collapse(t.slice(1, close));
    }
    return t;
  }

  const KEYWORDS = { if: 1, elseif: 1, else: 1, while: 1, do: 1, for: 1, foreach: 1, switch: 1, function: 1, try: 1, catch: 1, finally: 1 };

  // Schlüsselwort am Kopfanfang (case-insensitiv), sonst null.
  // (?![\w-]) verhindert Treffer wie "ForEach-Object" oder "Try-Something".
  function keywordOf(head) {
    const m = /^([A-Za-z]+)(?![\w-])/.exec(head || '');
    if (!m) return null;
    const k = m[1].toLowerCase();
    return KEYWORDS[k] === 1 ? k : null;
  }

  function restAfter(head) {
    const m = /^[A-Za-z]+/.exec(head || '');
    return m ? head.slice(m[0].length) : (head || '');
  }

  // ===================== Phase A: Lexer -> Blockbaum =====================
  // Knoten: { kind:'stmt', text, line }  |  { kind:'block', head, line, endLine, children }

  function lex(src, warnings) {
    const rootB = { kind: 'block', head: null, line: 1, endLine: null, children: [] };
    const stack = [rootB];
    const n = src.length;
    let i = 0;
    let line = 1;
    let pending = '';
    let pendingLine = 0;   // 0 = noch nicht gesetzt
    let held = false;      // Anweisung über Zeilenende gehalten (wartet auf '{')
    let depth = 0;         // () und [] kombiniert; Klammern > 0 => { } ; sind Text
    let depthLine = 0;

    function top() { return stack[stack.length - 1]; }

    function put(s) {
      if (pendingLine === 0 && /\S/.test(s)) pendingLine = line;
      pending += s;
    }

    function flushStmt() {
      const text = pending.trim();
      if (text !== '') top().children.push({ kind: 'stmt', text, line: pendingLine || line });
      pending = '';
      pendingLine = 0;
      held = false;
    }

    function openBlock() {
      const head = pending.trim();
      const ln = head !== '' ? (pendingLine || line) : line;
      const blk = { kind: 'block', head, line: ln, endLine: null, children: [] };
      top().children.push(blk);
      stack.push(blk);
      pending = '';
      pendingLine = 0;
      held = false;
    }

    function closeBlock() {
      flushStmt();
      if (stack.length > 1) stack.pop().endLine = line;
      else warnings.push({ message: "Zusätzliche schliessende Klammer '}' wurde ignoriert.", line: line });
    }

    function scanSingle() {
      const start = line;
      put("'");
      i++;
      while (i < n) {
        const c = src[i];
        if (c === "'") {
          if (src[i + 1] === "'") { pending += "''"; i += 2; continue; }
          pending += "'"; i++;
          return;
        }
        if (c === '\n') line++;
        pending += c; i++;
      }
      warnings.push({ message: 'Nicht geschlossene Zeichenkette (beginnt in Zeile ' + start + ').', line: start });
    }

    function scanDouble() {
      const start = line;
      put('"');
      i++;
      while (i < n) {
        const c = src[i];
        if (c === '`') {
          pending += c;
          const nx = src[i + 1];
          if (nx !== undefined) { pending += nx; if (nx === '\n') line++; i += 2; } else i++;
          continue;
        }
        if (c === '"') {
          if (src[i + 1] === '"') { pending += '""'; i += 2; continue; }
          pending += '"'; i++;
          return;
        }
        if (c === '$' && src[i + 1] === '(') { pending += '$('; i += 2; scanSubexpr(); continue; }
        if (c === '\n') line++;
        pending += c; i++;
      }
      warnings.push({ message: 'Nicht geschlossene Zeichenkette (beginnt in Zeile ' + start + ').', line: start });
    }

    // $( ... ) innerhalb eines doppelt zitierten Strings: Klammern zählen,
    // Strings beachten — { } sind hier reiner Text.
    function scanSubexpr() {
      let d = 1;
      while (i < n && d > 0) {
        const c = src[i];
        if (c === "'") { scanSingle(); continue; }
        if (c === '"') { scanDouble(); continue; }
        if (c === '`') {
          pending += c;
          const nx = src[i + 1];
          if (nx !== undefined) { pending += nx; if (nx === '\n') line++; i += 2; } else i++;
          continue;
        }
        if (c === '(') d++;
        else if (c === ')') d--;
        else if (c === '\n') line++;
        pending += c; i++;
      }
    }

    // Here-String @" ... "@ / @' ... '@ — Abschluss muss am Zeilenanfang stehen.
    // Gibt false zurück, wenn an dieser Stelle gar kein Here-String beginnt.
    function scanHere() {
      const q = src[i + 1];
      let j = i + 2;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) j++;
      if (src[j] !== '\n') return false;
      const start = line;
      put('@' + q + '\n');
      line++;
      i = j + 1;
      let atStart = true;
      while (i < n) {
        if (atStart && src[i] === q && src[i + 1] === '@') { pending += q + '@'; i += 2; return true; }
        const c = src[i];
        if (c === '\n') { line++; atStart = true; } else atStart = false;
        pending += c; i++;
      }
      warnings.push({ message: 'Nicht geschlossener Here-String (beginnt in Zeile ' + start + ').', line: start });
      return true;
    }

    // ${variablen name} — die geschweiften Klammern gehören zur Variable, kein Block.
    function scanVarBrace() {
      put('${');
      i += 2;
      while (i < n) {
        const c = src[i];
        pending += c; i++;
        if (c === '}') return;
        if (c === '\n') line++;
      }
    }

    function lineComment() {
      while (i < n && src[i] !== '\n') i++;
      pending += ' ';
    }

    function blockComment() {
      i += 2;
      while (i < n) {
        if (src[i] === '#' && src[i + 1] === '>') { i += 2; break; }
        if (src[i] === '\n') line++;
        i++;
      }
      pending += ' ';
    }

    // Soll die Anweisung über das Zeilenende gehalten werden (Allman-Stil:
    // '{' erst auf der Folgezeile)? Ein 'while'/'until' direkt nach einem
    // do-Block ist dessen Abschlussbedingung und wird sofort abgeschlossen.
    function shouldHold(t) {
      if (/^(while|until)(?![\w-])/i.test(t)) {
        const kids = top().children;
        const last = kids[kids.length - 1];
        if (last && last.kind === 'block' && /^do(?![\w-])/i.test(last.head || '')) return false;
        return /^while(?![\w-])/i.test(t);
      }
      if (/^(elseif|else|if|foreach|for|switch|do|try|catch|finally|function)(?![\w-])/i.test(t)) return true;
      const th = top().head;
      if (th && /^switch(?![\w-])/i.test(th)) return true; // Fall-Label wartet auf seinen Block
      return false;
    }

    while (i < n) {
      const c = src[i];

      // Gehaltene Anweisung: kam doch kein '{', wird sie rückwirkend abgeschlossen.
      if (held && c !== ' ' && c !== '\t' && c !== '\n' && c !== '{' && c !== '#' && !(c === '<' && src[i + 1] === '#')) {
        flushStmt();
      }

      if (c === '\n') {
        line++;
        i++;
        if (depth > 0 || held) { pending += ' '; continue; }
        const t = pending.trim();
        if (t === '') { pending = ''; pendingLine = 0; continue; }
        if (t.charAt(t.length - 1) === '|') { pending += ' '; continue; } // Pipe am Zeilenende
        if (shouldHold(t)) { held = true; pending += ' '; continue; }
        flushStmt();
        continue;
      }

      if (c === '`') {
        if (src[i + 1] === '\n') { line++; pending += ' '; i += 2; continue; } // Zeilenfortsetzung
        put('`');
        if (i + 1 < n) { pending += src[i + 1]; i += 2; } else i++;
        continue;
      }

      if (c === "'") { scanSingle(); continue; }
      if (c === '"') { scanDouble(); continue; }
      if (c === '@' && (src[i + 1] === '"' || src[i + 1] === "'")) {
        if (scanHere()) continue;
        put('@'); i++; continue;
      }
      if (c === '$' && src[i + 1] === '{') { scanVarBrace(); continue; }
      if (c === '<' && src[i + 1] === '#') { blockComment(); continue; }
      if (c === '#') { lineComment(); continue; }

      if (c === '(' || c === '[') {
        if (depth === 0) depthLine = line;
        depth++;
        put(c); i++;
        continue;
      }
      if (c === ')' || c === ']') {
        if (depth > 0) depth--;
        put(c); i++;
        continue;
      }

      if (depth === 0) {
        if (c === '{') { openBlock(); i++; continue; }
        if (c === '}') { closeBlock(); i++; continue; }
        if (c === ';') { flushStmt(); i++; continue; }
      } else if (c === '{' || c === '}' || c === ';') {
        put(c); i++;
        continue;
      }

      put(c);
      i++;
    }

    flushStmt();
    while (stack.length > 1) {
      const b = stack.pop();
      b.endLine = line;
      warnings.push({
        message: "Nicht geschlossene geschweifte Klammer '{' — der Block ab Zeile " + b.line + ' wurde automatisch geschlossen.',
        line: b.line
      });
    }
    if (depth > 0) {
      warnings.push({ message: 'Nicht geschlossene runde oder eckige Klammer (geöffnet in Zeile ' + depthLine + ').', line: depthLine });
    }
    return rootB;
  }

  // ===================== Phase B: Blockbaum -> AST =====================

  const RE_JUMP = /^(return|break|continue|exit|throw)(?![\w-])/i;
  const RE_INPUT = /(^|[^\w-])Read-Host($|[^\w-])/i;
  const RE_OUTPUT = /(^|[^\w-])(Write-Host|Write-Output|Out-File|Out-GridView|Export-Csv|Export-Clixml|Add-Content|Set-Content)($|[^\w-])/i;

  function makeProcess(text, line) {
    let io = null;
    if (RE_INPUT.test(text)) io = 'input';           // input gewinnt gegen output
    else if (RE_OUTPUT.test(text)) io = 'output';
    return { type: 'process', text: text, io: io, calls: [], line: line };
  }

  function stmtToNode(it) {
    const text = collapse(it.text);
    if (text === '') return null;
    const m = RE_JUMP.exec(text);
    if (m) return { type: 'jump', kind: m[1].toLowerCase(), text: text, line: it.line };
    return makeProcess(text, it.line);
  }

  // Blockbaum als Fliesstext (für Ein-Zeilen-Scriptblöcke, Hashtables, verschachtelte Funktionen).
  function flattenItems(items) {
    const parts = [];
    for (let k = 0; k < items.length; k++) {
      const x = items[k];
      const s = x.kind === 'stmt' ? x.text : flattenBlock(x);
      if (collapse(s) !== '') parts.push(s);
    }
    return parts.join('; ');
  }

  function flattenBlock(b) {
    const inner = collapse(flattenItems(b.children));
    const head = collapse(b.head || '');
    const sep = head === '' ? '' : (head.charAt(head.length - 1) === '@' ? '' : ' ');
    return head + sep + (inner !== '' ? '{ ' + inner + ' }' : '{ }');
  }

  function unquote(h) {
    let m = /^'([\s\S]*)'$/.exec(h);
    if (m) return m[1].replace(/''/g, "'");
    m = /^"([\s\S]*)"$/.exec(h);
    if (m) return m[1].replace(/""/g, '"');
    return h;
  }

  function subjectOf(head) {
    const t = collapse(restAfter(head));
    const p = findParen(t);
    if (p !== -1) {
      const close = matchParen(t, p);
      if (close !== -1) return collapse(t.slice(p + 1, close));
    }
    return t;
  }

  // param( ... ) — gibt den Inhalt zurück oder null, wenn die Anweisung kein param ist.
  function tryParam(text) {
    const t = collapse(text);
    const m = /^param(?![\w-])\s*/i.exec(t);
    if (!m) return null;
    const rest = t.slice(m[0].length);
    if (rest.charAt(0) !== '(') return null;
    const close = matchParen(rest, 0);
    if (close !== rest.length - 1) return null;
    return collapse(rest.slice(1, close));
  }

  function isAttributeStmt(text) {
    return /^\[[\s\S]*\]$/.test(collapse(text));
  }

  // Fortsetzung eines zu Text kollabierten Scriptblock-Aufrufs?
  // (z. B. "| Select-Object ..." oder "-Process { ... }" nach ForEach-Object)
  function isContinuation(s) {
    return s.charAt(0) === '|' || /^-[A-Za-z]/.test(s);
  }

  function buildStmts(items, ctx) {
    const out = [];
    const sub = { warnings: ctx.warnings, script: ctx.script, allowFunctions: false };
    let i = 0;

    while (i < items.length) {
      const it = items[i];

      if (it.kind === 'stmt') {
        const node = stmtToNode(it);
        if (node) out.push(node);
        i++;
        continue;
      }

      const head = it.head || '';
      const kw = keywordOf(head);

      // --- Kein Schlüsselwort: Ein-Zeilen-/Argument-Scriptblock -> ein Process-Schritt
      if (kw === null) {
        let text = flattenBlock(it);
        // Endet der Kopf auf "if ( ... )", ist dies ein if-AUSDRUCK (z. B.
        // "$x = if (...)") — direkt folgende elseif/else-Blöcke gehören dazu
        // und werden in denselben Process-Schritt aufgenommen (keine Warnung).
        const isIfExpr = /(^|[^\w-])if\s*\([\s\S]*\)$/i.test(collapse(head));
        let sawElse = false;
        while (i + 1 < items.length) {
          const nx = items[i + 1];
          if (nx.kind === 'stmt' && isContinuation(nx.text)) { text += ' ' + nx.text; i++; continue; }
          if (nx.kind === 'block') {
            const nk = keywordOf(nx.head);
            if (nk === null && isContinuation(collapse(nx.head || ''))) {
              text += ' ' + flattenBlock(nx); i++; continue;
            }
            if (isIfExpr && !sawElse && (nk === 'elseif' || nk === 'else')) {
              if (nk === 'else' && !/^if(?![\w-])/i.test(collapse(restAfter(nx.head || '')))) sawElse = true;
              text += ' ' + flattenBlock(nx);
              i++;
              continue;
            }
          }
          break;
        }
        out.push(makeProcess(collapse(text), it.line));
        i++;
        continue;
      }

      if (kw === 'if') {
        const node = {
          type: 'if',
          branches: [{ cond: stripParens(restAfter(head)), body: buildStmts(it.children, sub) }],
          elseBody: null,
          line: it.line
        };
        i++;
        while (i < items.length && items[i].kind === 'block') {
          const h2 = items[i].head || '';
          const k2 = keywordOf(h2);
          if (k2 === 'elseif') {
            node.branches.push({ cond: stripParens(restAfter(h2)), body: buildStmts(items[i].children, sub) });
            i++;
            continue;
          }
          if (k2 === 'else') {
            const rest2 = collapse(restAfter(h2));
            if (/^if(?![\w-])/i.test(rest2)) { // Toleranz für "else if (...)"
              node.branches.push({ cond: stripParens(rest2.replace(/^if(?![\w-])\s*/i, '')), body: buildStmts(items[i].children, sub) });
              i++;
              continue;
            }
            node.elseBody = buildStmts(items[i].children, sub);
            i++;
          }
          break;
        }
        out.push(node);
        continue;
      }

      if (kw === 'while') {
        out.push({ type: 'while', cond: stripParens(restAfter(head)), body: buildStmts(it.children, sub), line: it.line });
        i++;
        continue;
      }

      if (kw === 'do') {
        const node = { type: 'doloop', kind: 'while', cond: '', body: buildStmts(it.children, sub), line: it.line };
        i++;
        let matched = false;
        if (i < items.length && items[i].kind === 'stmt') {
          const m = /^(while|until)(?![\w-])\s*([\s\S]*)$/i.exec(items[i].text);
          if (m) {
            node.kind = m[1].toLowerCase();
            node.cond = stripParens(m[2]);
            i++;
            matched = true;
          }
        }
        if (!matched) {
          ctx.warnings.push({ message: "'do'-Schleife ohne abschliessendes 'while (...)' oder 'until (...)'.", line: it.line });
        }
        out.push(node);
        continue;
      }

      if (kw === 'for' || kw === 'foreach') {
        out.push({ type: kw, header: stripParens(restAfter(head)), body: buildStmts(it.children, sub), line: it.line });
        i++;
        continue;
      }

      if (kw === 'switch') {
        const node = { type: 'switch', subject: subjectOf(head), cases: [], defaultBody: null, line: it.line };
        const kids = it.children;
        for (let j = 0; j < kids.length; j++) {
          const k = kids[j];
          if (k.kind === 'block') {
            const h = collapse(k.head || '');
            if (h === '' && kids[j + 1] && kids[j + 1].kind === 'block' && collapse(kids[j + 1].head || '') === '') {
              // Scriptblock-Label: { Bedingung } { Body }
              node.cases.push({ label: collapse(flattenItems(k.children)), body: buildStmts(kids[j + 1].children, sub) });
              j++;
              continue;
            }
            if (/^default$/i.test(h)) { node.defaultBody = buildStmts(k.children, sub); continue; }
            node.cases.push({ label: unquote(h), body: buildStmts(k.children, sub) });
          } else {
            ctx.warnings.push({ message: 'Unerwarteter Ausdruck im switch-Block: "' + collapse(k.text) + '"', line: k.line });
          }
        }
        out.push(node);
        i++;
        continue;
      }

      if (kw === 'try') {
        const node = { type: 'try', body: buildStmts(it.children, sub), catches: [], finallyBody: null, line: it.line };
        i++;
        while (i < items.length && items[i].kind === 'block' && keywordOf(items[i].head) === 'catch') {
          const rest = collapse(restAfter(items[i].head || ''));
          let label;
          if (rest === '') label = 'Fehler';
          else {
            const m = /^\[([^\]]*)\]$/.exec(rest);
            label = m ? collapse(m[1]) : rest;
          }
          node.catches.push({ label: label, body: buildStmts(items[i].children, sub) });
          i++;
        }
        if (i < items.length && items[i].kind === 'block' && keywordOf(items[i].head) === 'finally') {
          node.finallyBody = buildStmts(items[i].children, sub);
          i++;
        }
        if (node.catches.length === 0 && node.finallyBody === null) {
          ctx.warnings.push({ message: "'try' ohne 'catch' oder 'finally'.", line: it.line });
        }
        out.push(node);
        continue;
      }

      if (kw === 'function') {
        if (ctx.allowFunctions) {
          ctx.script.functions.push(buildFunc(it, ctx));
          i++;
          continue;
        }
        const nm = /^function\s+([^\s({]+)/i.exec(collapse(head));
        ctx.warnings.push({
          message: "Verschachtelte Funktionsdefinition '" + (nm ? nm[1] : '?') + "' wird als einfacher Schritt behandelt.",
          line: it.line
        });
        out.push(makeProcess(collapse(flattenBlock(it)), it.line));
        i++;
        continue;
      }

      if (kw === 'elseif' || kw === 'else') {
        ctx.warnings.push({ message: "'" + kw + "' ohne zugehöriges 'if' — der Inhalt wird direkt übernommen.", line: it.line });
        out.push.apply(out, buildStmts(it.children, sub));
        i++;
        continue;
      }

      if (kw === 'catch' || kw === 'finally') {
        ctx.warnings.push({ message: "'" + kw + "' ohne zugehöriges 'try' — der Inhalt wird direkt übernommen.", line: it.line });
        out.push.apply(out, buildStmts(it.children, sub));
        i++;
        continue;
      }

      // Sollte nie erreicht werden — sicherheitshalber als Process.
      out.push(makeProcess(collapse(flattenBlock(it)), it.line));
      i++;
    }

    return out;
  }

  function buildFunc(it, ctx) {
    const head = collapse(it.head || '');
    const nm = /^function\s+([^\s({]+)/i.exec(head);
    let name;
    if (nm) name = nm[1];
    else {
      name = '';
      ctx.warnings.push({ message: 'Funktionsdefinition ohne Namen.', line: it.line });
    }

    let paramText = null;
    const p = head.indexOf('(');
    if (p !== -1) {
      const close = matchParen(head, p);
      if (close !== -1) paramText = collapse(head.slice(p + 1, close));
    }

    const kids = it.children.slice();
    let idx = 0;
    while (idx < kids.length && kids[idx].kind === 'stmt' && isAttributeStmt(kids[idx].text)) idx++;
    if (idx < kids.length && kids[idx].kind === 'stmt') {
      const pt = tryParam(kids[idx].text);
      if (pt !== null) {
        if (paramText === null) paramText = pt;
        kids.splice(idx, 1);
      }
    }

    const body = buildStmts(kids, { warnings: ctx.warnings, script: ctx.script, allowFunctions: false });
    return { type: 'function', name: name, paramText: paramText, body: body, line: it.line };
  }

  // Nachlauf: Process.calls mit Namen der aufgerufenen benutzerdefinierten Funktionen füllen.
  function fillCalls(script) {
    if (script.functions.length === 0) return;
    const matchers = script.functions.map(function (f) {
      return { name: f.name, re: new RegExp('(^|[^\\w-])' + escapeRe(f.name) + '($|[^\\w-])', 'i') };
    });

    function visitList(list) {
      if (!list) return;
      for (let k = 0; k < list.length; k++) visit(list[k]);
    }

    function visit(node) {
      if (!node) return;
      switch (node.type) {
        case 'process':
          node.calls = [];
          for (let k = 0; k < matchers.length; k++) {
            if (matchers[k].name !== '' && matchers[k].re.test(node.text)) node.calls.push(matchers[k].name);
          }
          break;
        case 'if':
          for (let k = 0; k < node.branches.length; k++) visitList(node.branches[k].body);
          visitList(node.elseBody);
          break;
        case 'switch':
          for (let k = 0; k < node.cases.length; k++) visitList(node.cases[k].body);
          visitList(node.defaultBody);
          break;
        case 'while':
        case 'doloop':
        case 'for':
        case 'foreach':
          visitList(node.body);
          break;
        case 'try':
          visitList(node.body);
          for (let k = 0; k < node.catches.length; k++) visitList(node.catches[k].body);
          visitList(node.finallyBody);
          break;
      }
    }

    visitList(script.body);
    for (let k = 0; k < script.functions.length; k++) visitList(script.functions[k].body);
  }

  function buildScript(rootItems, warnings) {
    const script = { type: 'script', paramText: null, functions: [], body: [] };
    const ctx = { warnings: warnings, script: script, allowFunctions: true };
    const items = rootItems.slice();

    // param( ... ) als erste Anweisung (Attribut-Zeilen wie [CmdletBinding()] davor sind erlaubt)
    let idx = 0;
    while (idx < items.length && items[idx].kind === 'stmt' && isAttributeStmt(items[idx].text)) idx++;
    if (idx < items.length && items[idx].kind === 'stmt') {
      const p = tryParam(items[idx].text);
      if (p !== null) {
        script.paramText = p;
        items.splice(idx, 1);
      }
    }

    script.body = buildStmts(items, ctx);
    fillCalls(script);
    return script;
  }

  // ===================== Öffentliche API =====================

  function parse(source) {
    const warnings = [];
    let script = { type: 'script', paramText: null, functions: [], body: [] };
    try {
      let src = typeof source === 'string' ? source : (source == null ? '' : String(source));
      src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const rootBlock = lex(src, warnings);
      script = buildScript(rootBlock.children, warnings);
    } catch (e) {
      warnings.push({ message: 'Interner Parserfehler: ' + (e && e.message ? e.message : String(e)), line: 1 });
    }
    return { script: script, warnings: warnings };
  }

  const api = { parse: parse };
  root.PSViz = root.PSViz || {};
  Object.assign(root.PSViz, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
