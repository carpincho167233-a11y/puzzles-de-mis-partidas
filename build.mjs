import fs from 'fs';
import path from 'path';
import { build } from 'esbuild';
const root = path.dirname(new URL(import.meta.url).pathname);
const sf = path.join(root, 'node_modules/stockfish/bin/');
fs.writeFileSync(path.join(root, 'src/sf-js.b64'), fs.readFileSync(sf + 'stockfish-19-lite-single.js').toString('base64'));
fs.writeFileSync(path.join(root, 'src/sf-wasm.b64'), fs.readFileSync(sf + 'stockfish-19-lite-single.wasm').toString('base64'));
const out = await build({
  entryPoints: [path.join(root, 'src/main.js')], bundle: true, write: false, format: 'iife', minify: true, target: 'es2020',
  loader: { '.b64': 'text' }, legalComments: 'none',
});
let js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const ga = path.join(root, 'node_modules/chessground/assets/');
const css = [fs.readFileSync(ga + 'chessground.base.css', 'utf8'), fs.readFileSync(ga + 'chessground.cburnett.css', 'utf8'), fs.readFileSync(path.join(root, 'src/style.css'), 'utf8')].join('\n');
let html;
// reemplazo seguro (sin interpretar $& en el contenido)
const [a, b] = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8').replace('/*__CSS__*/', () => css).split('/*__JS__*/');
html = a + js + b;

const dest = path.join(root, 'index.html');
fs.writeFileSync(dest, html);
console.log('OK', (html.length / 1e6).toFixed(2) + ' MB →', dest);
