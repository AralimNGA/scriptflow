#!/usr/bin/env node
// Baut dist/ScriptFlow.html: index.html mit allen js/-Modulen inline (eine Datei, überall lauffähig).
'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const modules = ['parser', 'flowchart', 'struktogramm', 'mermaid'];
for (const m of modules) {
  const src = fs.readFileSync(path.join(root, 'js', m + '.js'), 'utf8');
  const tag = `<script src="js/${m}.js"></script>`;
  if (!html.includes(tag)) { console.error('Tag nicht gefunden: ' + tag); process.exit(1); }
  const inlined = '<script>\n/* === js/' + m + '.js === */\n' + src.replace(/<\/script/gi, '<\\/script') + '\n</script>';
  html = html.replace(tag, () => inlined);
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'ScriptFlow.html'), html);
console.log('OK: dist/ScriptFlow.html (' + Math.round(html.length / 1024) + ' KB)');
