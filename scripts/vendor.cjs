const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'desktop', 'renderer', 'vendor');
fs.mkdirSync(destination, { recursive: true });
for (const [source, target] of [
  ['marked/lib/marked.umd.js', 'marked.js'],
  ['dompurify/dist/purify.min.js', 'purify.js'],
  ['katex/dist/katex.min.js', 'katex.js'],
  ['katex/dist/katex.min.css', 'katex.css'],
  ['katex/dist/contrib/auto-render.min.js', 'auto-render.js'],
]) fs.copyFileSync(path.join(root, 'node_modules', source), path.join(destination, target));
fs.cpSync(path.join(root, 'node_modules', 'katex', 'dist', 'fonts'), path.join(destination, 'fonts'), { recursive: true });
