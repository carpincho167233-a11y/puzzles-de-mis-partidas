// Descarga y normalización de partidas: Lichess, Chess.com y archivos PGN.
// Una "partida normalizada" tiene la forma:
// { id, site, url, white, black, whiteElo, blackElo, me: 'w'|'b'|null, speed, rated, date, tc, result, startFen?, sans[], evals? }

export const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical'];

/* ───────────── PGN ───────────── */
export function parseHeaders(text) {
  const h = {};
  const re = /^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/gm;
  let m;
  while ((m = re.exec(text))) h[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
  return h;
}

function parseEvalComment(c) {
  const m = /\[%eval\s+([#+\-\d.]+)/.exec(c);
  if (!m) return null;
  const v = m[1];
  if (v[0] === '#') { const n = parseInt(v.slice(1), 10); return Number.isNaN(n) ? null : { mate: n }; }
  const f = parseFloat(v);
  return Number.isNaN(f) ? null : { cp: Math.round(f * 100) };
}

/** Lee una partida PGN: jugadas en SAN, evaluaciones [%eval] (desde las blancas) y cabeceras. Ignora variantes y NAGs. */
export function parsePgnGame(text) {
  const headers = parseHeaders(text);
  const body = text.replace(/^\s*\[.*\]\s*$/gm, '').trim();
  const sans = [], evals = [];
  let i = 0, depth = 0;
  const n = body.length;
  while (i < n) {
    const ch = body[i];
    if (ch === '{') {
      const j = body.indexOf('}', i);
      const end = j < 0 ? n : j;
      if (depth === 0 && sans.length) {
        const e = parseEvalComment(body.slice(i, end));
        if (e && evals[sans.length - 1] === undefined) evals[sans.length - 1] = e;
      }
      i = end + 1; continue;
    }
    if (ch === ';') { const j = body.indexOf('\n', i); i = j < 0 ? n : j + 1; continue; }
    if (ch === '(') { depth++; i++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    let j = i;
    while (j < n && !/[\s{}();]/.test(body[j])) j++;
    let tok = body.slice(i, j);
    i = j;
    if (depth > 0) continue;
    if (tok[0] === '$') continue;
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
    tok = tok.replace(/^\d+\.+/, '');
    if (!tok || /^\d+\.*$/.test(tok)) continue;
    tok = tok.replace(/[!?]+$/, '');
    sans.push(tok);
  }
  const hasEvals = sans.length > 0 && sans.every((_, k) => evals[k] !== undefined);
  const startFen = headers.SetUp === '1' && headers.FEN ? headers.FEN : undefined;
  return { headers, sans, evals: hasEvals ? sans.map((_, k) => evals[k]) : null, startFen };
}

export function splitPgn(text) {
  const t = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const parts = t.split(/\n(?=\[Event\s)/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [];
}

function meFromNames(white, black, names) {
  const w = (white || '').toLowerCase(), b = (black || '').toLowerCase();
  if (names.has(w)) return 'w';
  if (names.has(b)) return 'b';
  return null;
}

function speedFromTc(tc) {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc || '');
  if (!m) return 'classical';
  const t = +m[1] + (m[2] ? +m[2] : 0) * 40;
  return t < 180 ? 'bullet' : t < 480 ? 'blitz' : t < 1500 ? 'rapid' : 'classical';
}

/** Partida desde un bloque PGN de un archivo cualquiera (por ejemplo, exportado de ChessBase) */
export function gameFromPgn(text, names, idx) {
  const p = parsePgnGame(text);
  if (!p.sans.length) return null;
  const h = p.headers;
  if (h.Variant && !/^standard$/i.test(h.Variant)) return null;
  const site = h.Site || '';
  const li = /lichess\.org\/(\w{8})/.exec(site);
  const cc = /chess\.com\/game\/(?:live|daily)\/(\d+)/.exec(site);
  const dateStr = (h.UTCDate || h.Date || '').replace(/\./g, '-');
  const date = Date.parse(dateStr + (h.UTCTime ? 'T' + h.UTCTime + 'Z' : '')) || 0;
  const tc = h.TimeControl && /^\d+(\+\d+)?$/.test(h.TimeControl) ? h.TimeControl : null;
  return {
    id: li ? li[1] : cc ? cc[1] : 'pgn' + idx,
    site: 'pgn',
    url: /^https?:\/\//.test(site) ? site : null,
    white: h.White || 'Blancas', black: h.Black || 'Negras',
    whiteElo: parseInt(h.WhiteElo, 10) || 0, blackElo: parseInt(h.BlackElo, 10) || 0,
    me: meFromNames(h.White, h.Black, names),
    speed: tc ? speedFromTc(tc) : 'classical',
    rated: true, date, tc, result: h.Result || null,
    startFen: p.startFen, sans: p.sans, evals: p.evals,
  };
}

/* ───────────── Lichess ───────────── */
export function fromLichess(j, names) {
  if (!j || !j.players || !j.moves) return null;
  if (j.variant && j.variant !== 'standard' && j.variant !== 'fromPosition') return null;
  const nameOf = (p) => (p.user && p.user.name) || (p.aiLevel ? 'Stockfish nivel ' + p.aiLevel : 'Anónimo');
  const w = j.players.white, b = j.players.black;
  const white = nameOf(w), black = nameOf(b);
  let evals = null;
  if (Array.isArray(j.analysis) && j.analysis.length) {
    evals = j.analysis.map((a) => (a && a.mate !== undefined ? { mate: a.mate } : a && a.eval !== undefined ? { cp: a.eval } : null));
  }
  const speed = j.speed === 'ultraBullet' ? 'bullet' : (j.speed === 'correspondence' ? 'classical' : j.speed);
  return {
    id: j.id, site: 'lichess', url: 'https://lichess.org/' + j.id,
    white, black, whiteElo: w.rating || 0, blackElo: b.rating || 0,
    me: meFromNames(w.user && w.user.id, b.user && b.user.id, names) || meFromNames(white, black, names),
    speed, rated: !!j.rated, date: j.createdAt || 0,
    tc: j.clock ? `${j.clock.initial}+${j.clock.increment}` : null,
    result: j.winner ? (j.winner === 'white' ? '1-0' : '0-1') : '1/2-1/2',
    startFen: j.initialFen && j.initialFen !== 'startpos' ? j.initialFen : undefined,
    sans: j.moves.trim().split(/\s+/).filter(Boolean), evals,
  };
}

/* ───────────── Chess.com ───────────── */
export function fromChesscom(g, names) {
  if (!g || g.rules !== 'chess' || !g.pgn) return null;
  let p;
  try { p = parsePgnGame(g.pgn); } catch (_) { return null; }
  if (!p.sans.length) return null;
  const white = g.white && g.white.username, black = g.black && g.black.username;
  const id = (g.url || '').split('/').pop() || g.uuid;
  return {
    id, site: 'chesscom', url: g.url,
    white, black, whiteElo: (g.white && g.white.rating) || 0, blackElo: (g.black && g.black.rating) || 0,
    me: meFromNames(white, black, names),
    speed: g.time_class === 'daily' ? 'classical' : g.time_class,
    rated: !!g.rated, date: (g.end_time || 0) * 1000, tc: g.time_control || null,
    result: p.headers.Result || null,
    startFen: p.startFen, sans: p.sans, evals: null,
  };
}

/* ───────────── Red ───────────── */
export class FetchError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('abort', 'AbortError')); }, { once: true });
});

async function get(url, init, { signal, user, site, onWait }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try { res = await fetch(url, { ...init, signal }); }
    catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new FetchError('network', `No pude conectar con ${site}. Revisá tu conexión a internet.`);
    }
    if (res.status === 429) {
      if (onWait) onWait(`${site} pidió esperar un poco. Reintento en 60 segundos…`);
      await sleep(61000, signal);
      continue;
    }
    if (res.status === 404) throw new FetchError('notfound', `No encontré al usuario “${user}” en ${site}.`);
    if (!res.ok) throw new FetchError('http', `${site} respondió con error ${res.status}.`);
    return res;
  }
  throw new FetchError('http', `${site} sigue limitando las consultas. Probá de nuevo en unos minutos.`);
}

/**
 * Descarga las últimas partidas de un usuario de Lichess (más nuevas primero).
 * opts: { speeds[], rated, max, since(ms)|null, names:Set }
 */
export async function fetchLichess(user, opts, { signal, onProgress, onWait } = {}) {
  const perf = [];
  for (const s of opts.speeds) { if (s === 'bullet') perf.push('ultraBullet', 'bullet'); else perf.push(s); }
  const q = new URLSearchParams({
    max: String(opts.max), moves: 'true', evals: 'true', opening: 'false', clocks: 'false', pgnInJson: 'false',
    perfType: perf.join(','),
  });
  if (opts.rated) q.set('rated', 'true');
  if (opts.since) q.set('since', String(opts.since));
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?${q}`;
  const res = await get(url, { headers: { Accept: 'application/x-ndjson' } }, { signal, user, site: 'Lichess', onWait });
  const games = [];
  const handle = (line) => {
    line = line.trim();
    if (!line) return;
    let j; try { j = JSON.parse(line); } catch (_) { return; }
    const g = fromLichess(j, opts.names);
    if (g) { games.push(g); if (onProgress) onProgress(games.length); }
  };
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(handle);
    }
    handle(buf);
  } else {
    (await res.text()).split('\n').forEach(handle);
  }
  return games;
}

/** Descarga las últimas partidas de un usuario de Chess.com recorriendo los archivos mensuales de nuevo a viejo. */
export async function fetchChesscom(user, opts, { signal, onProgress, onWait } = {}) {
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}`;
  const ctx = { signal, user, site: 'Chess.com', onWait };
  const arch = await (await get(base + '/games/archives', {}, ctx)).json();
  const months = (arch.archives || []).slice().reverse();
  const want = new Set(opts.speeds);
  const out = [];
  for (const m of months) {
    if (out.length >= opts.max) break;
    // /pub/player/x/games/YYYY/MM → fecha del mes
    const mm = /(\d{4})\/(\d{2})$/.exec(m);
    if (opts.since && mm && Date.UTC(+mm[1], +mm[2], 1) < opts.since) break;
    const data = await (await get(m, {}, ctx)).json();
    const list = (data.games || []).slice().reverse();
    for (const raw of list) {
      if (out.length >= opts.max) break;
      const tclass = raw.time_class === 'daily' ? 'classical' : raw.time_class;
      if (!want.has(tclass)) continue;
      if (opts.rated && !raw.rated) continue;
      if (opts.since && (raw.end_time || 0) * 1000 < opts.since) continue;
      const g = fromChesscom(raw, opts.names);
      if (g) out.push(g);
    }
    if (onProgress) onProgress(out.length);
  }
  return out;
}
