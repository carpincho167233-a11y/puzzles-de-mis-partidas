// Stockfish 19 (lite, un solo hilo) embebido en el propio archivo: un Worker por motor.
import { UciEngine } from './core.js';
import SF_JS_B64 from './sf-js.b64';
import SF_WASM_B64 from './sf-wasm.b64';

function b64ToBytes(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

let workerUrl = null;
function getWorkerUrl() {
  if (workerUrl) return workerUrl;
  // El motor busca su .wasm con fetch(location.hash). Interceptamos ese fetch y le damos los bytes embebidos.
  const prelude =
    '(()=>{const s=atob("' + SF_WASM_B64 + '");const u=new Uint8Array(s.length);' +
    'for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);const f=self.fetch;' +
    'self.fetch=function(x){if(String(x)==="sfwasm:local")return Promise.resolve(new Response(u.slice().buffer,' +
    '{status:200,headers:{"Content-Type":"application/wasm"}}));return f.apply(self,arguments)};})();\n';
  const blob = new Blob([prelude, b64ToBytes(SF_JS_B64)], { type: 'text/javascript' });
  workerUrl = URL.createObjectURL(blob) + '#' + encodeURIComponent('sfwasm:local');
  return workerUrl;
}

export function createBrowserEngine({ hash = 32, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(getWorkerUrl()); } catch (e) { reject(new Error('Este navegador no permite crear el motor de ajedrez.')); return; }
    const transport = { onLine: null, send: (c) => worker.postMessage(c), terminate: () => worker.terminate() };
    worker.onmessage = (e) => { if (typeof e.data === 'string' && transport.onLine) transport.onLine(e.data); };
    let settled = false;
    worker.onerror = (ev) => { if (!settled) { settled = true; reject(new Error('El motor de ajedrez no pudo arrancar' + (ev && ev.message ? ': ' + ev.message : '.'))); } };
    const eng = new UciEngine(transport);
    const timer = setTimeout(() => { if (!settled) { settled = true; worker.terminate(); reject(new Error('El motor de ajedrez tardó demasiado en arrancar.')); } }, timeoutMs);
    eng.init({ hash }).then(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(eng); } }, (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
  });
}
