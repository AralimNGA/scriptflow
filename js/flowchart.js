/*
 * ScriptFlow — js/flowchart.js
 * DIN-66001-style flowchart renderer per CONTRACT.md.
 * Pure string-in/string-out, no DOM access, never throws.
 *
 *   renderFlowchart(body, opts) => { svg: string, width: number, height: number }
 *
 * Layout scheme: recursive composition. Every construct produces a layout
 * object { w, h, cx, term, paint(dx, dy, out) } where cx is the x of the
 * vertical entry/exit spine inside the construct's own bounding box and
 * term=true means control flow does not leave the construct at the bottom
 * (return/exit). paint() pushes SVG fragment strings into `out`.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ constants

  const COLOR = {
    text: '#1d1d1f',
    line: '#3a3a3c',
    process: '#ffffff',
    decision: '#fff6e5',
    io: '#eaf2ff',
    terminator: '#e9f7ef',
    loopHeader: '#f4edfb',
    tryStroke: '#ff9f0a',
    jump: '#fdecea'
  };
  const FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
  const LH = 17;          // text line height @ font-size 13
  const GAP = 26;         // vertical arrow gap between stacked constructs
  const MARGIN = 24;      // outer margin around the whole diagram
  const MAX_LINE_W = 230; // wrap label lines at ~230px
  const MAX_CHARS = 46;   // hard label truncation
  const COLGAP = 34;      // horizontal gap between branch columns

  let UID = 0;            // per-render unique arrowhead marker id
  let MID = 'psvizArrow0';

  // ------------------------------------------------------------ utilities

  function num(n) { n = +n; return isFinite(n) ? Math.round(n * 100) / 100 : 0; }

  function collapse(s) { return s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function lineOf(st) {
    const n = st && +st.line;
    return isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  // Estimated text width at font-size 13 (-apple-system / Helvetica / Arial).
  // Slight overestimation is preferred over clipping.
  function estWidth(str) {
    let w = 0;
    const s = str == null ? '' : String(str);
    for (const ch of s) {
      if (ch === ' ') w += 4;
      else if ("ilIj.,:;'|!`´".includes(ch)) w += 4;
      else if ("tfr()[]{}\"".includes(ch)) w += 5;
      else if ("mw".includes(ch)) w += 11;
      else if ("MW@%…".includes(ch)) w += 13;
      else if (ch >= 'A' && ch <= 'Z') w += 9.5;
      else w += 7.2;
    }
    return w;
  }

  // Truncate at MAX_CHARS, then wrap into up to 3 lines of <= MAX_LINE_W px.
  // All cutting is done on code points (Array.from) so UTF-16 surrogate pairs
  // (emoji etc.) are never split — a lone surrogate would make the SVG invalid
  // XML and break encodeURIComponent-based export.
  function wrapLabel(raw) {
    const full = collapse(raw);
    const cps = Array.from(full);
    const t = cps.length > MAX_CHARS ? cps.slice(0, MAX_CHARS - 1).join('') + '…' : full;
    const words = t.split(' ');
    const lines = [];
    let cur = '';
    for (const wd of words) {
      const cand = cur ? cur + ' ' + wd : wd;
      if (!cur && estWidth(wd) > MAX_LINE_W) {
        // hard-break an overlong single word
        let piece = '';
        for (const ch of wd) {
          if (estWidth(piece + ch) > MAX_LINE_W) { lines.push(piece); piece = ch; }
          else piece += ch;
        }
        cur = piece;
      } else if (estWidth(cand) <= MAX_LINE_W || !cur) {
        cur = cand;
      } else {
        lines.push(cur);
        cur = wd;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length > 3) {
      lines.length = 3;
      const last = Array.from(lines[2]);
      lines[2] = last.slice(0, Math.max(0, last.length - 1)).join('') + '…';
    }
    if (!lines.length) lines.push('');
    return { lines: lines, full: full || ' ' };
  }

  function trunc18(s) {
    s = String(s);
    const cps = Array.from(s); // code-point safe: never split a surrogate pair
    return cps.length > 18 ? cps.slice(0, 17).join('') + '…' : s;
  }

  function edgeLabelW(s) { return estWidth(trunc18(s)) * 0.85 + 8; }

  // ------------------------------------------------------------ SVG helpers

  // Orthogonal polyline edge; opts: { arrow, dash }
  function edge(pts, o) {
    o = o || {};
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      d += (i ? ' L' : 'M') + num(pts[i][0]) + ' ' + num(pts[i][1]);
    }
    return '<path d="' + d + '" fill="none" stroke="' + COLOR.line + '" stroke-width="1.3"'
      + (o.dash ? ' stroke-dasharray="5 4"' : '')
      + (o.arrow ? ' marker-end="url(#' + MID + ')"' : '') + '/>';
  }

  // Small 11px edge label with a white halo for readability.
  function elabel(x, y, text, anchor) {
    return '<text x="' + num(x) + '" y="' + num(y) + '" font-size="11" text-anchor="'
      + (anchor || 'start') + '" fill="' + COLOR.text
      + '" stroke="#ffffff" stroke-width="3" paint-order="stroke">' + esc(trunc18(text)) + '</text>';
  }

  function dot(x, y) {
    return '<circle cx="' + num(x) + '" cy="' + num(y) + '" r="2.7" fill="' + COLOR.line + '"/>';
  }

  // Dashed rounded try/catch/finally container with a small colored label.
  function cont(x, y, w, h, label) {
    return '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h)
      + '" rx="10" fill="none" stroke="' + COLOR.tryStroke + '" stroke-width="1.4" stroke-dasharray="7 5"/>'
      + '<text x="' + num(x + 9) + '" y="' + num(y + 13) + '" font-size="11" font-weight="600" fill="'
      + COLOR.tryStroke + '" stroke="#ffffff" stroke-width="3" paint-order="stroke">' + esc(label) + '</text>';
  }

  function textBlock(cx, cy, lines) {
    const th = lines.length * LH;
    const y0 = cy - th / 2 + 12;
    let s = '<text x="' + num(cx) + '" y="' + num(y0) + '" text-anchor="middle" fill="' + COLOR.text + '">';
    for (let i = 0; i < lines.length; i++) {
      s += '<tspan x="' + num(cx) + '"' + (i ? ' dy="' + LH + '"' : '') + '>' + esc(lines[i]) + '</tspan>';
    }
    return s + '</text>';
  }

  function shapeSvg(kind, x, y, w, h) {
    const S = ' stroke="' + COLOR.line + '" stroke-width="1.3"';
    const cy = y + h / 2;
    const pts = function (arr) { return arr.map(p => num(p[0]) + ',' + num(p[1])).join(' '); };
    if (kind === 'diamond') {
      return '<polygon points="' + pts([[x + w / 2, y], [x + w, cy], [x + w / 2, y + h], [x, cy]])
        + '" fill="' + COLOR.decision + '"' + S + '/>';
    }
    if (kind === 'io') {
      return '<polygon points="' + pts([[x + 13, y], [x + w, y], [x + w - 13, y + h], [x, y + h]])
        + '" fill="' + COLOR.io + '"' + S + '/>';
    }
    if (kind === 'hexagon') {
      return '<polygon points="' + pts([[x + 14, y], [x + w - 14, y], [x + w, cy],
        [x + w - 14, y + h], [x + 14, y + h], [x, cy]]) + '" fill="' + COLOR.loopHeader + '"' + S + '/>';
    }
    if (kind === 'stadium') {
      return '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h)
        + '" rx="' + num(h / 2) + '" fill="' + COLOR.terminator + '"' + S + '/>';
    }
    if (kind === 'jump') {
      return '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h)
        + '" rx="12" fill="' + COLOR.jump + '"' + S + '/>';
    }
    if (kind === 'pre') {
      return '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h)
        + '" rx="2" fill="' + COLOR.process + '"' + S + '/>'
        + '<line class="pp" x1="' + num(x + 8) + '" y1="' + num(y) + '" x2="' + num(x + 8) + '" y2="' + num(y + h) + '"' + S + '/>'
        + '<line class="pp" x1="' + num(x + w - 8) + '" y1="' + num(y) + '" x2="' + num(x + w - 8) + '" y2="' + num(y + h) + '"' + S + '/>';
    }
    return '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h)
      + '" rx="6" fill="' + COLOR.process + '"' + S + '/>';
  }

  // ------------------------------------------------------------ node factory

  function baseNode(kind, rawText, line) {
    const wl = wrapLabel(rawText);
    const lines = wl.lines, full = wl.full;
    let tw = 14;
    lines.forEach(l => { const e = estWidth(l); if (e > tw) tw = e; });
    const th = lines.length * LH;
    let w, h;
    if (kind === 'diamond') { h = Math.max(52, th + 40); w = Math.max(76, tw * h / (h - th) + 14); }
    else if (kind === 'stadium') { h = Math.max(34, th + 12); w = tw + 36; }
    else if (kind === 'io') { h = Math.max(36, th + 16); w = tw + 28 + 26; }
    else if (kind === 'hexagon') { h = Math.max(38, th + 16); w = tw + 28 + 30; }
    else if (kind === 'pre') { h = Math.max(36, th + 16); w = tw + 28 + 18; }
    else if (kind === 'jump') { h = Math.max(34, th + 14); w = tw + 26; }
    else { h = Math.max(36, th + 16); w = tw + 28; }
    w = Math.ceil(w); h = Math.ceil(h);
    return {
      w: w, h: h, cx: w / 2, term: false,
      paint: function (dx, dy, out) {
        out.push('<g class="nd" data-line="' + line + '" style="cursor:pointer">');
        out.push(shapeSvg(kind, dx, dy, w, h));
        out.push('<title>' + esc(full) + '</title>');
        out.push(textBlock(dx + w / 2, dy + h / 2, lines));
        out.push('</g>');
      }
    };
  }

  // ------------------------------------------------------------ sequences

  // Empty body: a short pass-through spine segment.
  function emptySeq() {
    return {
      w: 2, h: 14, cx: 1, term: false, empty: true,
      paint: function (dx, dy, out) { out.push(edge([[dx + 1, dy], [dx + 1, dy + 14]])); }
    };
  }

  // Stack layouts vertically, aligned on their spines, arrows in between.
  function stack(kids) {
    kids = kids.filter(Boolean);
    if (!kids.length) return emptySeq();
    const L = Math.max.apply(null, kids.map(k => k.cx));
    const R = Math.max.apply(null, kids.map(k => k.w - k.cx));
    let h = 0;
    const ys = [];
    kids.forEach((k, i) => { if (i) h += GAP; ys.push(h); h += k.h; });
    return {
      w: L + R, h: h, cx: L, term: kids[kids.length - 1].term === true,
      paint: function (dx, dy, out) {
        kids.forEach((k, i) => {
          if (i && !kids[i - 1].term) {
            out.push(edge([[dx + L, dy + ys[i] - GAP], [dx + L, dy + ys[i]]], { arrow: true }));
          }
          k.paint(dx + L - k.cx, dy + ys[i], out);
        });
      }
    };
  }

  function layoutSeq(stmts) {
    if (!Array.isArray(stmts) || !stmts.length) return emptySeq();
    return stack(stmts.map(layoutStmt));
  }

  // ------------------------------------------------------------ statements

  function processLayout(st) {
    const text = collapse(st && st.text) || collapse(st && st.type) || '?';
    const kind = st && st.io ? 'io'
      : (st && Array.isArray(st.calls) && st.calls.length ? 'pre' : 'process');
    return baseNode(kind, text, lineOf(st));
  }

  function jumpLayout(st) {
    const kind = st && st.kind;
    const line = lineOf(st);
    const text = collapse(st && st.text) || collapse(kind) || 'jump';
    if (kind === 'return' || kind === 'exit') {
      const t = baseNode('stadium', text, line);
      t.term = true; // no outgoing edge — parents skip the connector
      return t;
    }
    const map = { 'break': 'Schleife verlassen', 'continue': 'nächste Iteration', 'throw': 'Fehler werfen' };
    if (!map[kind]) return baseNode('process', text, line);
    const n = baseNode('jump', text, line);
    const lbl = map[kind];
    const stub = 26;
    const extra = Math.max(stub + 6, estWidth(lbl) * 0.85 + 10);
    return {
      w: n.w + extra, h: n.h, cx: n.w / 2, term: false,
      paint: function (dx, dy, out) {
        n.paint(dx, dy, out);
        out.push(edge([[dx + n.w, dy + n.h / 2], [dx + n.w + stub, dy + n.h / 2]], { arrow: true, dash: true }));
        out.push(elabel(dx + n.w + 4, dy + n.h / 2 - 8, lbl));
      }
    };
  }

  // if / elseif / else: diamond cascade on one row, branch bodies in columns
  // below, non-terminating branches merged on a common line with a junction dot.
  function ifLayout(st) {
    const line = lineOf(st);
    const brs = (st && Array.isArray(st.branches) && st.branches.length)
      ? st.branches : [{ cond: '?', body: [] }];
    const cols = brs.map(br => ({
      d: baseNode('diamond', collapse(br && br.cond) || '?', line),
      b: layoutSeq(br && br.body)
    }));
    const els = (st && st.elseBody != null) ? layoutSeq(st.elseBody) : null;

    let x = 0;
    const info = cols.map(c => {
      const L = Math.max(c.d.w / 2, c.b.cx);
      const R = Math.max(c.d.w / 2, c.b.w - c.b.cx);
      const o = { spine: x + L, c: c };
      x += L + R + COLGAP;
      return o;
    });
    let elseSpine = 0;
    if (els) { elseSpine = x + els.cx; x += els.w; } else { x -= COLGAP; }
    const chanX = els ? 0 : x + 30;          // right channel for the final Nein
    const W = els ? x : chanX + 3;

    const cy = Math.max.apply(null, cols.map(c => c.d.h)) / 2;
    const bodyTop = cy * 2 + GAP;
    const maxBodyH = Math.max.apply(null, [els ? els.h : 0].concat(cols.map(c => c.b.h)));
    const mergeY = bodyTop + maxBodyH + 20;
    const term = !!(els && els.term && cols.every(c => c.b.term));
    const H = term ? bodyTop + maxBodyH : mergeY;
    const cx = info[0].spine;

    return {
      w: W, h: H, cx: cx, term: term,
      paint: function (dx, dy, out) {
        const d0 = cols[0].d;
        if (cy - d0.h / 2 > 0.5) out.push(edge([[dx + cx, dy], [dx + cx, dy + cy - d0.h / 2]]));
        info.forEach((inf, i) => {
          const d = inf.c.d, b = inf.c.b;
          d.paint(dx + inf.spine - d.w / 2, dy + cy - d.h / 2, out);
          out.push(edge([[dx + inf.spine, dy + cy + d.h / 2], [dx + inf.spine, dy + bodyTop]], { arrow: true }));
          out.push(elabel(dx + inf.spine + 6, dy + cy + d.h / 2 + 13, 'Ja'));
          b.paint(dx + inf.spine - b.cx, dy + bodyTop, out);
          const vx = dx + inf.spine + d.w / 2; // right vertex
          if (i < info.length - 1) {
            const nd = info[i + 1].c.d;
            const tx = dx + info[i + 1].spine - nd.w / 2;
            out.push(edge([[vx, dy + cy], [tx, dy + cy]], { arrow: true }));
            out.push(elabel((vx + tx) / 2, dy + cy - 6, 'Nein', 'middle'));
          } else if (els) {
            out.push(edge([[vx, dy + cy], [dx + elseSpine, dy + cy], [dx + elseSpine, dy + bodyTop]], { arrow: true }));
            out.push(elabel(vx + 5, dy + cy - 6, 'Nein'));
          } else {
            out.push(edge([[vx, dy + cy], [dx + chanX, dy + cy], [dx + chanX, dy + mergeY]]));
            out.push(elabel(vx + 5, dy + cy - 6, 'Nein'));
          }
        });
        if (els) els.paint(dx + elseSpine - els.cx, dy + bodyTop, out);
        if (!term) {
          const xs = [cx];
          info.forEach(inf => {
            if (!inf.c.b.term) {
              out.push(edge([[dx + inf.spine, dy + bodyTop + inf.c.b.h], [dx + inf.spine, dy + mergeY]]));
              xs.push(inf.spine);
            }
          });
          if (els && !els.term) {
            out.push(edge([[dx + elseSpine, dy + bodyTop + els.h], [dx + elseSpine, dy + mergeY]]));
            xs.push(elseSpine);
          }
          if (!els) xs.push(chanX);
          const mn = Math.min.apply(null, xs), mx = Math.max.apply(null, xs);
          if (mx - mn > 0.5) {
            out.push(edge([[dx + mn, dy + mergeY], [dx + mx, dy + mergeY]]));
            out.push(dot(dx + cx, dy + mergeY));
          }
        }
      }
    };
  }

  // switch: subject diamond, fan-out bus, one column per case (+ Sonst).
  function switchLayout(st) {
    const line = lineOf(st);
    const d = baseNode('diamond', collapse(st && st.subject) || '?', line);
    const cases = (st && Array.isArray(st.cases)) ? st.cases : [];
    const colsRaw = cases.map(c => ({ label: collapse(c && c.label) || '?', lay: layoutSeq(c && c.body) }));
    const hasDefault = !!(st && st.defaultBody != null);
    if (hasDefault) colsRaw.push({ label: 'Sonst', lay: layoutSeq(st.defaultBody) });
    if (!colsRaw.length) {
      // degenerate switch: just the diamond, straight through
      return { w: d.w, h: d.h, cx: d.w / 2, term: false, paint: function (dx, dy, out) { d.paint(dx, dy, out); } };
    }
    let x = 0;
    const info = colsRaw.map(c => {
      const lw = edgeLabelW(c.label);
      const L = Math.max(c.lay.cx, lw / 2, 22);
      const R = Math.max(c.lay.w - c.lay.cx, lw / 2, 22);
      const o = { spine: x + L, c: c };
      x += L + R + COLGAP;
      return o;
    });
    const colsW = x - COLGAP;
    const shift = Math.max(0, d.w / 2 - colsW / 2);
    info.forEach(o => { o.spine += shift; });
    const dCx = shift + colsW / 2;
    const right0 = Math.max(colsW + shift, dCx + d.w / 2);
    const chanX = hasDefault ? 0 : right0 + 30;
    const W = hasDefault ? right0 : chanX + 3;
    const busY = d.h + 16;
    const colTop = busY + 30;
    const maxH = Math.max.apply(null, info.map(o => o.c.lay.h));
    const mergeY = colTop + maxH + 20;
    const term = hasDefault && colsRaw.every(c => c.lay.term);
    const H = term ? colTop + maxH : mergeY;

    return {
      w: W, h: H, cx: dCx, term: term,
      paint: function (dx, dy, out) {
        d.paint(dx + dCx - d.w / 2, dy, out);
        out.push(edge([[dx + dCx, dy + d.h], [dx + dCx, dy + busY]]));
        const spines = info.map(o => o.spine);
        const busL = Math.min.apply(null, [dCx].concat(spines));
        const busR = Math.max.apply(null, [dCx].concat(spines, hasDefault ? [] : [chanX]));
        out.push(edge([[dx + busL, dy + busY], [dx + busR, dy + busY]]));
        info.forEach(o => {
          out.push(edge([[dx + o.spine, dy + busY], [dx + o.spine, dy + colTop]], { arrow: true }));
          out.push(elabel(dx + o.spine, dy + busY + 18, o.c.label, 'middle'));
          o.c.lay.paint(dx + o.spine - o.c.lay.cx, dy + colTop, out);
        });
        if (!hasDefault) {
          out.push(edge([[dx + chanX, dy + busY], [dx + chanX, dy + mergeY]]));
          out.push(elabel(dx + chanX + 2, dy + busY + 18, 'Sonst', 'end'));
        }
        if (!term) {
          const xs = [dCx];
          info.forEach(o => {
            if (!o.c.lay.term) {
              out.push(edge([[dx + o.spine, dy + colTop + o.c.lay.h], [dx + o.spine, dy + mergeY]]));
              xs.push(o.spine);
            }
          });
          if (!hasDefault) xs.push(chanX);
          const mn = Math.min.apply(null, xs), mx = Math.max.apply(null, xs);
          if (mx - mn > 0.5) {
            out.push(edge([[dx + mn, dy + mergeY], [dx + mx, dy + mergeY]]));
            out.push(dot(dx + dCx, dy + mergeY));
          }
        }
      }
    };
  }

  // while: diamond top, Ja into body, loop-back via left channel, Nein exits
  // via right channel and rejoins the spine below.
  function whileLayout(st) {
    const d = baseNode('diamond', collapse(st && st.cond) || '?', lineOf(st));
    const b = layoutSeq(st && st.body);
    const LE = Math.max(d.w / 2, b.cx), RE = Math.max(d.w / 2, b.w - b.cx);
    const chanL = 3, spine = 30 + LE;
    const chanR = spine + RE + 34;
    const cy = d.h / 2;
    const bodyTop = d.h + GAP;
    const bodyBot = bodyTop + b.h;
    const lbY = bodyBot + 14;
    const exitY = bodyBot + 30;
    return {
      w: chanR + 3, h: exitY, cx: spine, term: false,
      paint: function (dx, dy, out) {
        d.paint(dx + spine - d.w / 2, dy, out);
        out.push(edge([[dx + spine, dy + d.h], [dx + spine, dy + bodyTop]], { arrow: true }));
        out.push(elabel(dx + spine + 6, dy + d.h + 15, 'Ja'));
        b.paint(dx + spine - b.cx, dy + bodyTop, out);
        if (!b.term) {
          out.push(edge([[dx + spine, dy + bodyBot], [dx + spine, dy + lbY], [dx + chanL, dy + lbY],
            [dx + chanL, dy + cy], [dx + spine - d.w / 2, dy + cy]], { arrow: true }));
        }
        out.push(edge([[dx + spine + d.w / 2, dy + cy], [dx + chanR, dy + cy],
          [dx + chanR, dy + exitY], [dx + spine, dy + exitY]]));
        out.push(elabel(dx + spine + d.w / 2 + 5, dy + cy - 6, 'Nein'));
      }
    };
  }

  // for / foreach: hexagon header, body below, back edge into the hexagon's
  // left vertex, exit from the right vertex labeled "fertig".
  function forLayout(st) {
    const hx = baseNode('hexagon', collapse(st && st.header) || '?', lineOf(st));
    const b = layoutSeq(st && st.body);
    const LE = Math.max(hx.w / 2, b.cx), RE = Math.max(hx.w / 2, b.w - b.cx);
    const chanL = 3, spine = 30 + LE;
    const chanR = spine + RE + 46;
    const cy = hx.h / 2;
    const bodyTop = hx.h + GAP;
    const bodyBot = bodyTop + b.h;
    const lbY = bodyBot + 14;
    const exitY = bodyBot + 30;
    return {
      w: chanR + 3, h: exitY, cx: spine, term: false,
      paint: function (dx, dy, out) {
        hx.paint(dx + spine - hx.w / 2, dy, out);
        out.push(edge([[dx + spine, dy + hx.h], [dx + spine, dy + bodyTop]], { arrow: true }));
        b.paint(dx + spine - b.cx, dy + bodyTop, out);
        if (!b.term) {
          out.push(edge([[dx + spine, dy + bodyBot], [dx + spine, dy + lbY], [dx + chanL, dy + lbY],
            [dx + chanL, dy + cy], [dx + spine - hx.w / 2, dy + cy]], { arrow: true }));
        }
        out.push(edge([[dx + spine + hx.w / 2, dy + cy], [dx + chanR, dy + cy],
          [dx + chanR, dy + exitY], [dx + spine, dy + exitY]]));
        out.push(elabel(dx + spine + hx.w / 2 + 5, dy + cy - 6, 'fertig'));
      }
    };
  }

  // do/while and do/until: body first, diamond below; loop-back via left
  // channel arrows into the spine above the body entry.
  function doLayout(st) {
    const until = !!(st && st.kind === 'until');
    const d = baseNode('diamond', collapse(st && st.cond) || '?', lineOf(st));
    const b = layoutSeq(st && st.body);
    const LE = Math.max(d.w / 2, b.cx), RE = Math.max(d.w / 2, b.w - b.cx, 44);
    const chanL = 3, spine = 38 + LE;
    const jY = 8, bodyTop = 18;
    const bodyBot = bodyTop + b.h;
    const dTop = bodyBot + GAP, cy = dTop + d.h / 2, dBot = dTop + d.h;
    const H = dBot + 12;
    const backLbl = until ? 'Nein' : 'Ja';
    const exitLbl = until ? 'Ja' : 'Nein';
    return {
      w: spine + RE, h: H, cx: spine, term: false,
      paint: function (dx, dy, out) {
        out.push(edge([[dx + spine, dy], [dx + spine, dy + bodyTop]]));
        b.paint(dx + spine - b.cx, dy + bodyTop, out);
        if (!b.term) out.push(edge([[dx + spine, dy + bodyBot], [dx + spine, dy + dTop]], { arrow: true }));
        d.paint(dx + spine - d.w / 2, dy + dTop, out);
        out.push(edge([[dx + spine - d.w / 2, dy + cy], [dx + chanL, dy + cy],
          [dx + chanL, dy + jY], [dx + spine, dy + jY]], { arrow: true }));
        out.push(elabel(dx + spine - d.w / 2 - 5, dy + cy - 6, backLbl, 'end'));
        out.push(edge([[dx + spine, dy + dBot], [dx + spine, dy + H]]));
        out.push(elabel(dx + spine + 6, dy + dBot + 12, exitLbl));
      }
    };
  }

  // try: dashed orange container around the try body; catches in their own
  // containers to the right, connected by dashed "bei Fehler" arrows; merge
  // below; finally in a container on the spine after the merge.
  function tryLayout(st) {
    const line = lineOf(st);
    // Containers are clickable nodes too: same wrapper as baseNode(), so the
    // app's click-to-source works for the try statement's line.
    const ndCont = function (out, x, y, w, h, label) {
      out.push('<g class="nd" data-line="' + line + '" style="cursor:pointer">');
      out.push(cont(x, y, w, h, label));
      out.push('</g>');
    };
    const tb = layoutSeq(st && st.body);
    const cats = ((st && Array.isArray(st.catches)) ? st.catches : []).map(c => ({
      label: collapse(c && c.label) || 'Fehler',
      lay: layoutSeq(c && c.body)
    }));
    const fin = (st && st.finallyBody != null) ? layoutSeq(st.finallyBody) : null;
    const PAD = 14, HDR = 18;
    const tW = tb.w + PAD * 2, tH = tb.h + PAD * 2 + HDR;
    const cx = PAD + tb.cx;
    let cursor = tW;
    const catInfo = cats.map(c => {
      const gap = Math.max(66, edgeLabelW('bei Fehler') + 14, edgeLabelW(c.label) + 14);
      const o = { x: cursor + gap, w: c.lay.w + PAD * 2, h: c.lay.h + PAD * 2 + HDR, c: c };
      cursor = o.x + o.w;
      return o;
    });
    const bottomMost = Math.max.apply(null, [tH].concat(catInfo.map(o => o.h)));
    const mergeY = bottomMost + 22;
    const termAll = tb.term && (cats.length ? cats.every(c => c.lay.term) : true);
    let fx = 0, fW = 0, fH = 0, shift = 0;
    if (fin) {
      fW = fin.w + PAD * 2; fH = fin.h + PAD * 2 + HDR;
      fx = cx - PAD - fin.cx;
      shift = Math.max(0, -fx);
    }
    const W = Math.max(cursor, fin ? fx + fW : 0) + shift;
    const H = fin ? mergeY + 24 + fH : (termAll ? bottomMost : mergeY);
    const term = fin ? (fin.term || termAll) : termAll;

    return {
      w: W, h: H, cx: cx + shift, term: term,
      paint: function (dx0, dy, out) {
        const dx = dx0 + shift;
        ndCont(out, dx, dy, tW, tH, 'Try');
        out.push(edge([[dx + cx, dy], [dx + cx, dy + PAD + HDR]], { arrow: true }));
        tb.paint(dx + PAD, dy + PAD + HDR, out);
        let prevRight = tW;
        catInfo.forEach(o => {
          const mid = (prevRight + o.x) / 2;
          out.push(edge([[dx + prevRight, dy + 26], [dx + o.x, dy + 26]], { arrow: true, dash: true }));
          out.push(elabel(dx + mid, dy + 12, 'bei Fehler', 'middle'));
          out.push(elabel(dx + mid, dy + 23, o.c.label, 'middle'));
          ndCont(out, dx + o.x, dy, o.w, o.h, 'Catch');
          o.c.lay.paint(dx + o.x + PAD, dy + PAD + HDR, out);
          prevRight = o.x + o.w;
        });
        if (!termAll || fin) {
          const xs = [cx];
          if (!tb.term) out.push(edge([[dx + cx, dy + PAD + HDR + tb.h], [dx + cx, dy + mergeY]]));
          catInfo.forEach(o => {
            if (!o.c.lay.term) {
              const sp = o.x + PAD + o.c.lay.cx;
              out.push(edge([[dx + sp, dy + PAD + HDR + o.c.lay.h], [dx + sp, dy + mergeY]]));
              xs.push(sp);
            }
          });
          const mn = Math.min.apply(null, xs), mx = Math.max.apply(null, xs);
          if (mx - mn > 0.5) {
            out.push(edge([[dx + mn, dy + mergeY], [dx + mx, dy + mergeY]]));
            out.push(dot(dx + cx, dy + mergeY));
          }
        }
        if (fin) {
          out.push(edge([[dx + cx, dy + mergeY], [dx + cx, dy + mergeY + 24]], { arrow: true }));
          ndCont(out, dx + fx, dy + mergeY + 24, fW, fH, 'Finally');
          out.push(edge([[dx + cx, dy + mergeY + 24], [dx + cx, dy + mergeY + 24 + PAD + HDR]]));
          fin.paint(dx + fx + PAD, dy + mergeY + 24 + PAD + HDR, out);
          if (!fin.term) out.push(edge([[dx + cx, dy + mergeY + 24 + PAD + HDR + fin.h], [dx + cx, dy + H]]));
        }
      }
    };
  }

  // ------------------------------------------------------------ dispatch

  function layoutStmt(st) {
    if (!st || typeof st !== 'object') {
      return baseNode('process', st == null ? '?' : String(st), 0);
    }
    try {
      switch (st.type) {
        case 'if': return ifLayout(st);
        case 'switch': return switchLayout(st);
        case 'while': return whileLayout(st);
        case 'doloop': return doLayout(st);
        case 'for':
        case 'foreach': return forLayout(st);
        case 'try': return tryLayout(st);
        case 'jump': return jumpLayout(st);
        case 'process':
        default: return processLayout(st);
      }
    } catch (e) {
      return baseNode('process', collapse(st.text) || String(st.type || '?'), lineOf(st));
    }
  }

  // ------------------------------------------------------------ root render

  function renderFlowchart(body, opts) {
    MID = 'psvizArrow' + (++UID);
    try {
      const title = collapse(opts && opts.title) || 'Start';
      const items = [baseNode('stadium', title, 0)];
      const arr = Array.isArray(body) ? body : [];
      const seq = arr.length ? layoutSeq(arr) : null;
      if (seq) items.push(seq);
      if (!seq || !seq.term) items.push(baseNode('stadium', 'Ende', 0));
      const lay = stack(items);
      const W = Math.ceil(lay.w + MARGIN * 2);
      const H = Math.ceil(lay.h + MARGIN * 2);
      const out = [];
      out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H
        + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + FONT + '" font-size="13">');
      out.push('<defs><marker id="' + MID + '" markerWidth="9" markerHeight="8" refX="7.5" refY="3.5"'
        + ' orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 3.5 L0 7 Z" fill="'
        + COLOR.line + '"/></marker></defs>');
      out.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>');
      lay.paint(MARGIN, MARGIN, out);
      out.push('</svg>');
      return { svg: out.join(''), width: W, height: H };
    } catch (e) {
      const w2 = 360, h2 = 90;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w2 + '" height="' + h2
        + '" viewBox="0 0 ' + w2 + ' ' + h2 + '" font-family="' + FONT + '" font-size="13">'
        + '<rect x="0" y="0" width="' + w2 + '" height="' + h2 + '" fill="#ffffff"/>'
        + '<g class="nd" data-line="0" style="cursor:pointer">'
        + '<rect x="20" y="25" width="320" height="40" rx="6" fill="#ffffff" stroke="' + COLOR.line + '" stroke-width="1.3"/>'
        + '<title>' + esc(String((e && e.message) || e)) + '</title>'
        + '<text x="180" y="50" text-anchor="middle" fill="' + COLOR.text + '">Diagramm konnte nicht erzeugt werden</text>'
        + '</g></svg>';
      return { svg: svg, width: w2, height: h2 };
    }
  }

  // ------------------------------------------------------------ registration

  const api = { renderFlowchart, estWidth };
  root.PSViz = root.PSViz || {};
  Object.assign(root.PSViz, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
