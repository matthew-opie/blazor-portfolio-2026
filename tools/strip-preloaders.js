/**
 * Strip unused _preloaders registration blocks from cv-engine.js
 * and leave algorithm tryInit paths intact for lazy load.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'wwwroot', 'js', 'cv-engine.js');
let s = fs.readFileSync(file, 'utf8');

// Remove the _preloaders array declaration
s = s.replace(/\n    const _preloaders = \[[\s\S]*?\];\n/, '\n');

// Remove each _preloaders.push({ ... }); block with brace matching
const marker = '_preloaders.push(';
let guard = 0;
while (s.includes(marker) && guard++ < 50) {
  const start = s.indexOf(marker);
  let i = start + marker.length;
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) {
        // consume optional ); and surrounding whitespace/newlines
        let end = i + 1;
        if (s[end] === ';') end++;
        // also remove a preceding blank line-ish indent newline before marker
        let from = start;
        while (from > 0 && (s[from - 1] === ' ' || s[from - 1] === '\t')) from--;
        if (s[from - 1] === '\n') from--;
        if (s[from - 1] === '\r') from--;
        s = s.slice(0, from) + s.slice(end);
        break;
      }
      depth--;
    }
  }
}

fs.writeFileSync(file, s);
console.log('stripped preloaders; remaining pushes:', (s.match(/_preloaders/g) || []).length);
