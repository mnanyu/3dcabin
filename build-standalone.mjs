import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(root, '.build', 'app.min.js');
if (!fs.existsSync(bundlePath)) {
  console.error('Missing .build/app.min.js. Run: esbuild main.js --bundle --minify --format=iife --target=chrome100 --outfile=.build/app.min.js');
  process.exit(1);
}

const js = fs.readFileSync(bundlePath, 'utf8').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace('<link rel="stylesheet" href="./style.css" />', () => '<style>\n' + css + '\n</style>');
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
// Function replacer: a replacement string would expand `html = html.replace('  <script type="module" src="./main.js"></script>', () => '  <script>\n' + js + '\n</script>');` from the bundle.
html = html.replace('  <script type="module" src="./main.js"></script>', () => '  <script>\n' + js + '\n</script>');
html = html.replace('<title>林间小屋 · 程序化 3D 森林</title>', '<title>林间小屋 · 单文件 3D 森林</title>');

// Guard against a premature `</script>` being injected into the inline bundle.
const inlineOpens = (html.match(/<script\b/gi) || []).length;
const inlineCloses = (html.match(/<\/script>/gi) || []).length;
if (inlineOpens !== 1 || inlineCloses !== 1) {
  throw new Error('Invalid standalone script tags: opens=' + inlineOpens + ' closes=' + inlineCloses);
}

const out = path.join(root, '林间小屋-单文件版.html');
fs.writeFileSync(out, html, 'utf8');
console.log('Standalone written:', out);
console.log('Size:', (fs.statSync(out).size / 1024 / 1024).toFixed(2), 'MB');
