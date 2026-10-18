/*
 * ScriptFlow — js/struktogramm.js
 * Nassi-Shneiderman-Renderer (Struktogramm) gemaess CONTRACT.md.
 *
 * renderStruktogramm(body: Stmt[], opts) => { svg: string, width: number, height: number }
 *
 * Reines String-in/String-out-Modul: beruehrt NIE das DOM. Textbreiten werden
 * ueber eine Zeichenbreiten-Tabelle geschaetzt (13px -apple-system/Helvetica/Arial),
 * bewusst leicht ueberschaetzt statt abzuschneiden.
 *
 * Layout: klassisches Struktogramm, rekursive Mindestbreiten in zwei Passen:
 *   measure(stmt) -> minW      (Breiten-Pass)
 *   paint(stmt, x, y, W) -> h  (Zeichen-Pass, Hoehe ist strukturbestimmt)
 * Jede Zelle zeichnet ihr eigenes Rechteck; identisch ueberlappende 1px-Raender
 * benachbarter Zellen sind gewollt (keine Doppelstrich-Naehte).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- Konstanten

  var COL = {
    text: '#1d1d1f',
    stroke: '#3a3a3c',
    process: '#ffffff',
    decision: '#fff6e5',
    io: '#eaf2ff',
    terminator: '#e9f7ef',
    loop: '#f4edfb',
    tryStroke: '#ff9f0a'
  };
  var FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
  var FONT_SIZE = 13;

  var ROW_H = 30;      // Hoehe einer einfachen Textzelle
  var HEAD_H = 44;     // Hoehe des if-/switch-Kopfes
  var CASE_H = 24;     // Hoehe der switch-Fallbeschriftungszeile
  var BAR_W = 18;      // Breite des L-Balkens bei Schleifen
  var PAD = 8;         // horizontales Text-Padding in Zellen
  var CALL_INSET = 6;  // Einzug der Doppelbalken bei Unterprogramm-Aufrufen
  var MARGIN = 16;     // Aussenrand des SVG
  var MAX_CHARS = 46;  // Zeichenlimit vor Ellipse
  var MIN_COL = 40;    // minimale Spalten-/Zellbreite
  var MIN_ROOT = 120;  // minimale Inhaltsbreite des Diagramms
  var TRI = 0.7;       // nutzbarer Breitenanteil fuer den if-Bedingungstext

  // ------------------------------------------------- Textbreiten ohne DOM

  // Zeichenbreiten fuer 13px -apple-system / 'Helvetica Neue' / Arial.
  var CHAR_W = (function () {
    var m = Object.create(null);
    function set(chars, w) {
      for (var i = 0; i < chars.length; i++) m[chars[i]] = w;
    }
    set("ilj.,:;'|!I", 4);
    set('ft', 4.6);
    set(' ', 4);
    set('r', 5);
    set('"()[]{}\\/`', 5.5);
    set('-*^', 6);
    set('_?', 7);
    set('0123456789$', 7.5);
    set('=+<>~#&', 8);
    set('ABCDEFGHJKLNOPQRSTUVXYZ', 9);
    set('m', 11);
    set('w', 11);
    set('M', 12.5);
    set('W@%', 13);
    return m;
  })();

  // Geschaetzte Pixelbreite eines Strings bei 13px; lieber etwas zu breit.
  function estWidth(str) {
    var s = String(str == null ? '' : str);
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      var cw = CHAR_W[ch];
      if (cw === undefined) cw = (s.charCodeAt(i) > 127 ? 9 : 7.2);
      w += cw;
    }
    return Math.ceil(w * 1.04 + 2); // 4% + 2px Sicherheitsmarge
  }

  // -------------------------------------------------------------- Helfer

  function arr(v) { return Array.isArray(v) ? v : []; }

  function collapse(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  function str(v, fallback) {
    var s = collapse(v);
    if (s !== '') return s;
    return fallback == null ? '?' : fallback;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Kuerzen IMMER auf Codepunkt-Basis (Array.from), nie auf UTF-16-Einheiten:
  // ein Schnitt mitten durch ein Surrogate-Paar (Emoji) erzeugt ungueltiges
  // XML und laesst encodeURIComponent beim PNG-Export werfen.
  function trunc(v) {
    var s = collapse(v);
    var cps = Array.from(s);
    return cps.length > MAX_CHARS ? cps.slice(0, MAX_CHARS - 1).join('') + '…' : s;
  }

  // Kuerzt s (mit Ellipse), bis es in maxPx passt — codepunktweise.
  function fitText(s, maxPx) {
    s = String(s == null ? '' : s);
    if (estWidth(s) <= maxPx) return s;
    var cps = Array.from(s);
    while (cps.length > 1 && estWidth(cps.join('') + '…') > maxPx) cps.pop();
    return cps.join('').replace(/\s+$/, '') + '…';
  }

  function n(v) {
    v = Number(v);
    if (!isFinite(v)) v = 0;
    if (v < 0) v = 0;
    return String(Math.round(v * 100) / 100);
  }

  function rectEl(x, y, w, h, fill) {
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(Math.max(0, w)) +
      '" height="' + n(Math.max(0, h)) + '" fill="' + fill +
      '" stroke="' + COL.stroke + '" stroke-width="1"/>';
  }

  function lineEl(x1, y1, x2, y2) {
    return '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) +
      '" y2="' + n(y2) + '" stroke="' + COL.stroke + '" stroke-width="1"/>';
  }

  function textEl(x, y, s, anchor, bold) {
    return '<text x="' + n(x) + '" y="' + n(y) + '"' +
      (anchor ? ' text-anchor="' + anchor + '"' : '') +
      (bold ? ' font-weight="bold"' : '') +
      ' fill="' + COL.text + '">' + esc(s) + '</text>';
  }

  // App-Shell-Integration: jede Statement-Zelle wird in <g class="nd"
  // data-line="..."> gehuellt, damit Klicks auf Quellzeilen abbildbar sind.
  function gOpen(line) {
    var ln = (typeof line === 'number' && isFinite(line)) ? line : 0;
    return '<g class="nd" data-line="' + ln + '" style="cursor:pointer">';
  }

  // Standard-Textzelle (rect + <title> + text) innerhalb eines nd-Wrappers.
  // o: { center, bold, bars }
  function cell(out, x, y, w, h, fill, disp, full, line, o) {
    o = o || {};
    out.push(gOpen(line));
    out.push(rectEl(x, y, w, h, fill));
    var padL = PAD;
    if (o.bars) { // Doppelbalken = Unterprogramm-Aufruf (predefined process)
      out.push(lineEl(x + CALL_INSET, y, x + CALL_INSET, y + h));
      out.push(lineEl(x + w - CALL_INSET, y, x + w - CALL_INSET, y + h));
      padL = CALL_INSET + PAD;
    }
    out.push('<title>' + esc(full == null ? disp : full) + '</title>');
    var t = fitText(disp, Math.max(10, w - 2 * padL));
    var ty = y + h / 2 + 4.5; // Baseline: vertikal zentriert bei 13px
    if (o.center) out.push(textEl(x + w / 2, ty, t, 'middle', o.bold));
    else out.push(textEl(x + padL, ty, t, null, o.bold));
    out.push('</g>');
  }

  // Leere Zelle "—" (kein Statement -> kein nd-Wrapper).
  function emptyCell(out, x, y, w, h) {
    out.push(rectEl(x, y, w, h, COL.process));
    out.push(textEl(x + w / 2, y + h / 2 + 4.5, '—', 'middle'));
  }

  // Auffuell-Rechteck, um kuerzere Spalten auf gleiche Hoehe zu bringen.
  function filler(out, x, y, w, h) {
    if (h > 0.5) out.push(rectEl(x, y, w, h, COL.process));
  }

  // Verteilt W auf Spalten proportional zu deren Mindestbreiten;
  // jede Spalte erhaelt mindestens ihr Minimum, die Summe ist exakt W
  // (sofern W >= Summe der Minima).
  function distribute(W, mins) {
    var count = mins.length;
    if (!count) return [];
    var sum = 0, i;
    for (i = 0; i < count; i++) sum += mins[i];
    var extra = Math.max(0, Math.floor(W - sum));
    var out = [];
    var used = 0;
    for (i = 0; i < count; i++) {
      var add;
      if (i === count - 1) add = extra - used;
      else { add = Math.floor(extra * mins[i] / (sum || 1)); used += add; }
      out.push(mins[i] + add);
    }
    return out;
  }

  // ------------------------------------------- Knoten-Normalisierung / Texte

  function processDisp(s) {
    var t = str(s && s.text, '');
    if (s && s.io === 'input') t = 'E: ' + t;
    else if (s && s.io === 'output') t = 'A: ' + t;
    if (t === '') t = '?';
    return { full: t, disp: trunc(t) };
  }

  function loopText(s) {
    if (s.type === 'foreach') return 'für jedes ' + str(s.header);
    if (s.type === 'for') return 'für ' + str(s.header);
    return 'solange ' + str(s.cond);
  }

  function doText(s) {
    return (s.kind === 'until' ? 'wiederhole bis ' : 'wiederhole solange ') + str(s.cond);
  }

  function catchText(c) {
    return 'Bei Fehler (' + str(c && c.label, 'Fehler') + ')';
  }

  function unknownText(s) {
    var t = s && (s.text || s.cond || s.header || s.subject || s.type);
    return str(t, '?');
  }

  // Zerlegt ein If in linke Spalte (branches[0]) und rechte Spalte:
  // elseif-Ketten kaskadieren als verschachteltes synthetisches If rechts.
  function ifParts(s) {
    var branches = arr(s && s.branches).filter(function (b) { return b != null; });
    var first = branches.length ? branches[0] : { cond: '?', body: [] };
    var p = {
      cond: first && first.cond,
      leftBody: arr(first && first.body),
      rightStmt: null,
      rightBody: null // null = kein else -> leere "—"-Zelle
    };
    if (branches.length > 1) {
      p.rightStmt = {
        type: 'if',
        branches: branches.slice(1),
        elseBody: (s && s.elseBody != null) ? s.elseBody : null,
        line: s && s.line
      };
    } else if (s && s.elseBody != null) {
      p.rightBody = arr(s.elseBody);
    }
    return p;
  }

  // Spalten eines switch: ein Eintrag pro case + immer eine "Sonst"-Spalte.
  function switchCols(s) {
    var cols = [];
    var cases = arr(s && s.cases);
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      var full = str(c && c.label);
      var label = trunc(full);
      var body = arr(c && c.body);
      cols.push({
        label: label,
        full: full,
        body: body,
        // + 2*PAD + 2: deckt das Zell-Padding beim Zeichnen ab (keine Ellipse)
        minW: Math.max(estWidth(label) + 2 * PAD + 2, measureBody(body))
      });
    }
    var defBody = (s && s.defaultBody != null) ? arr(s.defaultBody) : null;
    cols.push({
      label: 'Sonst',
      full: 'Sonst',
      body: defBody,
      minW: Math.max(estWidth('Sonst') + 2 * PAD + 2,
        defBody == null ? MIN_COL : measureBody(defBody))
    });
    return cols;
  }

  // ------------------------------------------------------------ Pass 1: measure

  function measureBody(body) {
    var b = arr(body);
    if (!b.length) return MIN_COL;
    var w = MIN_COL;
    for (var i = 0; i < b.length; i++) w = Math.max(w, measureStmt(b[i]));
    return w;
  }

  function measureStmt(s) {
    try {
      if (s == null) return MIN_COL;
      if (typeof s !== 'object') {
        return estWidth(trunc(String(s))) + 2 * PAD;
      }
      switch (s.type) {
        case 'process': {
          var d = processDisp(s);
          var pad = (arr(s.calls).length ? CALL_INSET + PAD : PAD) * 2;
          return estWidth(d.disp) + pad;
        }
        case 'if': {
          var p = ifParts(s);
          var lm = measureBody(p.leftBody);
          var rm = p.rightStmt ? Math.max(MIN_COL, measureStmt(p.rightStmt))
            : (p.rightBody == null ? MIN_COL : measureBody(p.rightBody));
          var head = Math.max(90, Math.ceil((estWidth(trunc(str(p.cond))) + 10) / TRI));
          return Math.max(lm + rm, head);
        }
        case 'switch': {
          var cols = switchCols(s);
          var sum = 0;
          for (var i = 0; i < cols.length; i++) sum += cols[i].minW;
          return Math.max(sum, estWidth(trunc(str(s.subject))) + 2 * PAD, MIN_COL);
        }
        case 'while':
        case 'for':
        case 'foreach':
          return Math.max(estWidth(trunc(loopText(s))) + 2 * PAD,
            BAR_W + measureBody(s.body));
        case 'doloop':
          return Math.max(estWidth(trunc(doText(s))) + 2 * PAD,
            BAR_W + measureBody(s.body));
        case 'try': {
          var w = Math.max(MIN_COL, estWidth('Versuche') + 2 * PAD, measureBody(s.body));
          var catches = arr(s.catches);
          for (var j = 0; j < catches.length; j++) {
            w = Math.max(w, estWidth(trunc(catchText(catches[j]))) + 2 * PAD,
              measureBody(catches[j] && catches[j].body));
          }
          if (s.finallyBody != null) {
            w = Math.max(w, estWidth('Danach (finally)') + 2 * PAD,
              measureBody(s.finallyBody));
          }
          return w;
        }
        case 'jump':
          return estWidth(trunc(str(s.text, str(s.kind)))) + 2 * PAD;
        default:
          return estWidth(trunc(unknownText(s))) + 2 * PAD;
      }
    } catch (e) {
      return MIN_COL;
    }
  }

  // ------------------------------------------------------------- Pass 2: paint

  // Zeichnet eine Statement-Liste als Stapel voller Breite; liefert die Hoehe.
  function paintBody(out, body, x, y, W) {
    var b = arr(body);
    if (!b.length) { emptyCell(out, x, y, W, ROW_H); return ROW_H; }
    var cy = y;
    for (var i = 0; i < b.length; i++) cy += paintStmt(out, b[i], x, cy, W);
    return cy - y;
  }

  function paintStmt(out, s, x, y, W) {
    try {
      if (s == null) { emptyCell(out, x, y, W, ROW_H); return ROW_H; }
      if (typeof s !== 'object') {
        var raw = trunc(String(s));
        cell(out, x, y, W, ROW_H, COL.process, raw, String(s), 0);
        return ROW_H;
      }
      switch (s.type) {
        case 'process': return paintProcess(out, s, x, y, W);
        case 'if': return paintIf(out, s, x, y, W);
        case 'switch': return paintSwitch(out, s, x, y, W);
        case 'while':
        case 'for':
        case 'foreach': return paintLoop(out, s, x, y, W);
        case 'doloop': return paintDo(out, s, x, y, W);
        case 'try': return paintTry(out, s, x, y, W);
        case 'jump': {
          var t = str(s.text, str(s.kind));
          cell(out, x, y, W, ROW_H, COL.process, trunc(t), t, s.line);
          return ROW_H;
        }
        default: {
          var u = unknownText(s);
          cell(out, x, y, W, ROW_H, COL.process, trunc(u), u, s.line);
          return ROW_H;
        }
      }
    } catch (e) {
      emptyCell(out, x, y, W, ROW_H);
      return ROW_H;
    }
  }

  function paintProcess(out, s, x, y, W) {
    var d = processDisp(s);
    var fill = (s.io === 'input' || s.io === 'output') ? COL.io : COL.process;
    cell(out, x, y, W, ROW_H, fill, d.disp, d.full, s.line,
      { bars: arr(s.calls).length > 0 });
    return ROW_H;
  }

  // if: 44px-Kopf mit Diagonalen zum unteren Mittelpunkt, Ja links / Nein
  // rechts, darunter zwei Spalten (proportional zu ihren Mindestbreiten).
  function paintIf(out, s, x, y, W) {
    var p = ifParts(s);
    var lm = measureBody(p.leftBody);
    var rm = p.rightStmt ? Math.max(MIN_COL, measureStmt(p.rightStmt))
      : (p.rightBody == null ? MIN_COL : measureBody(p.rightBody));
    var ws = distribute(W, [lm, rm]);
    var lw = ws[0], rw = ws[1];

    var condFull = str(p.cond);
    out.push(gOpen(s.line));
    out.push(rectEl(x, y, W, HEAD_H, COL.decision));
    out.push(lineEl(x, y, x + W / 2, y + HEAD_H));
    out.push(lineEl(x + W, y, x + W / 2, y + HEAD_H));
    out.push('<title>' + esc(condFull) + '</title>');
    out.push(textEl(x + W / 2, y + 17,
      fitText(trunc(condFull), Math.max(20, W * TRI - PAD)), 'middle'));
    // Ja/Nein in den unteren Ecken (klassisch, kollidiert nie mit den Diagonalen)
    out.push(textEl(x + 6, y + HEAD_H - 6, 'Ja'));
    out.push(textEl(x + W - 6, y + HEAD_H - 6, 'Nein', 'end'));
    out.push('</g>');

    var b1 = [], b2 = [];
    var h1 = paintBody(b1, p.leftBody, x, y + HEAD_H, lw);
    var h2;
    if (p.rightStmt) h2 = paintStmt(b2, p.rightStmt, x + lw, y + HEAD_H, rw);
    else h2 = paintBody(b2, p.rightBody == null ? [] : p.rightBody, x + lw, y + HEAD_H, rw);
    var hb = Math.max(h1, h2);
    filler(b1, x, y + HEAD_H + h1, lw, hb - h1);
    filler(b2, x + lw, y + HEAD_H + h2, rw, hb - h2);
    out.push.apply(out, b1);
    out.push.apply(out, b2);
    return HEAD_H + hb;
  }

  // switch (einfache Variante): Kopfzelle mit Subjekt, 24px-Zeile mit
  // Fallbeschriftungen (+ "Sonst"), darunter die Fallspalten.
  function paintSwitch(out, s, x, y, W) {
    var cols = switchCols(s);
    var mins = [], i;
    for (i = 0; i < cols.length; i++) mins.push(cols[i].minW);
    var ws = distribute(W, mins);

    var subj = str(s.subject);
    cell(out, x, y, W, HEAD_H, COL.decision, trunc(subj), subj, s.line, { center: true });

    var cx = x;
    for (i = 0; i < cols.length; i++) {
      cell(out, cx, y + HEAD_H, ws[i], CASE_H, COL.decision,
        cols[i].label, cols[i].full, s.line, { center: true });
      cx += ws[i];
    }

    var bufs = [], hs = [], hb = 0;
    cx = x;
    for (i = 0; i < cols.length; i++) {
      var buf = [];
      var h = paintBody(buf, cols[i].body == null ? [] : cols[i].body,
        cx, y + HEAD_H + CASE_H, ws[i]);
      bufs.push(buf); hs.push(h);
      if (h > hb) hb = h;
      cx += ws[i];
    }
    cx = x;
    for (i = 0; i < cols.length; i++) {
      filler(bufs[i], cx, y + HEAD_H + CASE_H + hs[i], ws[i], hb - hs[i]);
      out.push.apply(out, bufs[i]);
      cx += ws[i];
    }
    return HEAD_H + CASE_H + hb;
  }

  // while/for/foreach: Kopfstreifen + L-Balken links, Rumpf eingerueckt.
  function paintLoop(out, s, x, y, W) {
    var txt = loopText(s);
    cell(out, x, y, W, ROW_H, COL.loop, trunc(txt), txt, s.line);
    var bh = paintBody(out, s.body, x + BAR_W, y + ROW_H, Math.max(MIN_COL, W - BAR_W));
    out.push(gOpen(s.line) + rectEl(x, y + ROW_H, BAR_W, bh, COL.loop) + '</g>');
    return ROW_H + bh;
  }

  // doloop: Rumpf zuerst (mit L-Balken), Fussstreifen mit der Bedingung.
  function paintDo(out, s, x, y, W) {
    var bh = paintBody(out, s.body, x + BAR_W, y, Math.max(MIN_COL, W - BAR_W));
    out.push(gOpen(s.line) + rectEl(x, y, BAR_W, bh, COL.loop) + '</g>');
    var txt = doText(s);
    cell(out, x, y + bh, W, ROW_H, COL.loop, trunc(txt), txt, s.line);
    return bh + ROW_H;
  }

  // try: Abschnitte "Versuche" / "Bei Fehler (...)" / "Danach (finally)",
  // aussen ein gestrichelter oranger Container.
  function paintTry(out, s, x, y, W) {
    var cy = y;
    cell(out, x, cy, W, ROW_H, COL.decision, 'Versuche', 'Versuche', s.line, { bold: true });
    cy += ROW_H;
    cy += paintBody(out, s.body, x, cy, W);
    var catches = arr(s.catches);
    for (var i = 0; i < catches.length; i++) {
      var t = catchText(catches[i]);
      cell(out, x, cy, W, ROW_H, COL.decision, trunc(t), t, s.line, { bold: true });
      cy += ROW_H;
      cy += paintBody(out, catches[i] && catches[i].body, x, cy, W);
    }
    if (s.finallyBody != null) {
      cell(out, x, cy, W, ROW_H, COL.decision, 'Danach (finally)', 'Danach (finally)',
        s.line, { bold: true });
      cy += ROW_H;
      cy += paintBody(out, s.finallyBody, x, cy, W);
    }
    out.push('<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(W) +
      '" height="' + n(cy - y) + '" fill="none" stroke="' + COL.tryStroke +
      '" stroke-width="1.5" stroke-dasharray="6 4" pointer-events="none"/>');
    return cy - y;
  }

  // ------------------------------------------------------------------- Wurzel

  function renderStruktogramm(body, opts) {
    try {
      var o = (opts && typeof opts === 'object') ? opts : {};
      var title = str(o.title == null ? 'Ablauf' : o.title, 'Ablauf');
      var stmts = arr(body);

      var contentW = Math.ceil(Math.max(
        measureBody(stmts),
        estWidth(trunc(title)) + 2 * PAD,
        MIN_ROOT
      ));

      var out = [];
      // Titelstreifen (Terminator-Fuellung, fett, zentriert);
      // <title> mit dem Volltext, damit gekuerzte Titel nicht verloren gehen.
      out.push('<g>');
      out.push('<title>' + esc(title) + '</title>');
      out.push(rectEl(MARGIN, MARGIN, contentW, ROW_H, COL.terminator));
      out.push(textEl(MARGIN + contentW / 2, MARGIN + ROW_H / 2 + 4.5,
        fitText(trunc(title), contentW - 2 * PAD), 'middle', true));
      out.push('</g>');

      var bh = paintBody(out, stmts, MARGIN, MARGIN + ROW_H, contentW);

      var W = contentW + 2 * MARGIN;
      var H = MARGIN + ROW_H + bh + MARGIN;
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W +
        '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
        '" font-family="' + FONT + '" font-size="' + FONT_SIZE + '">' +
        '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>' +
        out.join('') +
        '</svg>';
      return { svg: svg, width: W, height: H };
    } catch (e) {
      // Absolute Notbremse: niemals werfen.
      var FW = 220, FH = 62;
      var fsvg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + FW +
        '" height="' + FH + '" viewBox="0 0 ' + FW + ' ' + FH +
        '" font-family="' + FONT + '" font-size="' + FONT_SIZE + '">' +
        '<rect x="0" y="0" width="' + FW + '" height="' + FH + '" fill="#ffffff"/>' +
        '<rect x="16" y="16" width="188" height="30" fill="#ffffff" stroke="' +
        COL.stroke + '" stroke-width="1"/>' +
        '<text x="110" y="35.5" text-anchor="middle" fill="' + COL.text +
        '">Diagramm nicht darstellbar</text>' +
        '</svg>';
      return { svg: fsvg, width: FW, height: FH };
    }
  }

  // ------------------------------------------------------------ Registrierung

  var api = { renderStruktogramm: renderStruktogramm, estWidth: estWidth };
  root.PSViz = root.PSViz || {};
  Object.assign(root.PSViz, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
