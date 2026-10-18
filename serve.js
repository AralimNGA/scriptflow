#!/usr/bin/env node
// Mini-Static-Server für ScriptFlow (keine Abhängigkeiten). Start: node serve.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const PORT = 8666;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};
http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400); res.end('400'); return; }
  let p = path.normalize(path.join(ROOT, urlPath));
  if (!p.startsWith(ROOT + path.sep) && p !== path.join(ROOT, 'index.html')) { res.writeHead(403); res.end('403'); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('404: ' + urlPath); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('ScriptFlow läuft auf http://localhost:' + PORT));
