import http from 'node:http';
import { createRequire } from 'node:module';
import { UciEngine } from './src/core.js';
const require = createRequire(import.meta.url);
const Stockfish = require('stockfish');
import { Generator, PRESETS } from './src/core.js';

const PORT = Number(process.env.PORT || 10000);
const MAX_GAMES = 80;
const MAX_BODY = 12 * 1024 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 3;
const hits = new Map();
let busy = false;

function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*',
    'access-control-allow-methods': 'POST, OPTIONS, GET',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '', size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY) { reject(Object.assign(new Error('El pedido es demasiado grande.'), { status: 413 })); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function rateLimited(ip) {
  const now = Date.now();
  const a = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (a.length >= MAX_REQUESTS) return true;
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
  return false;
}
async function createEngine() {
  return new Promise((resolve, reject) => {
    let transport;
    let engine;
    let timeout;
    try {
      const sf = Stockfish('lite-single', line => {
        if (transport?.onLine) transport.onLine(String(line));
      });
      transport = {
        onLine: null,
        send: command => sf.processCommand(command),
        terminate: () => { try { sf.terminate(); } catch {} },
      };
      engine = new UciEngine(transport);
      timeout = setTimeout(() => {
        transport.terminate();
        reject(new Error('Stockfish tardó demasiado en iniciar.'));
      }, 30000);
      engine.init({ hash: 64 }).then(() => {
        clearTimeout(timeout);
        resolve(engine);
      }, error => {
        clearTimeout(timeout);
        transport.terminate();
        reject(error);
      });
    } catch (error) {
      clearTimeout(timeout);
      try { transport?.terminate(); } catch {}
      reject(error);
    }
  });
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
  if (req.method === 'GET' && req.url === '/healthz') { send(res, 200, { ok: true, busy }); return; }
  if (req.method !== 'POST' || req.url !== '/api/analyze') { send(res, 404, { error: 'No encontrado.' }); return; }
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) { send(res, 429, { error: 'Demasiados análisis seguidos. Esperá unos minutos.' }); return; }
  if (busy) { send(res, 429, { error: 'El servidor está analizando otras partidas. Probá de nuevo en un momento.' }); return; }
  busy = true;
  let engine;
  try {
    const body = await readBody(req);
    if (!Array.isArray(body.games) || !body.games.length) { send(res, 400, { error: 'No recibí partidas para analizar.' }); return; }
    if (body.games.length > MAX_GAMES) { send(res, 413, { error: `El máximo por análisis es ${MAX_GAMES} partidas.` }); return; }
    const preset = ['rapido', 'normal', 'profundo'].includes(body.options?.preset) ? body.options.preset : 'normal';
    const opts = {
      ...PRESETS[preset],
      exigencia: ['lichess', 'equilibrada', 'todo'].includes(body.options?.exigencia) ? body.options.exigencia : 'equilibrada',
      onlyMe: body.options?.onlyMe !== false,
      maxPerGame: Math.max(1, Math.min(5, Number(body.options?.maxPerGame) || 3)),
    };
    engine = await createEngine();
    const gen = new Generator(engine, opts, new Map());
    const puzzles = [], errors = [], seen = [];
    for (const game of body.games) {
      if (!game || !Array.isArray(game.sans) || game.sans.length > 1000) { errors.push(game?.id || 'partida inválida'); continue; }
      try { puzzles.push(...await gen.analyseGame(game)); seen.push(`${game.site}:${game.id}`); }
      catch { errors.push(`${game.site || ''}:${game.id || 'partida'}`); }
    }
    send(res, 200, { puzzles, errors, seen, analyzed: body.games.length });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Error interno al analizar.' });
  } finally {
    try { engine?.terminate(); } catch {}
    busy = false;
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Puzzle analysis API listening on ${PORT}`));
