// Port a JavaScript del generador de puzzles de Lichess (ornicar/lichess-puzzler, generator/generator.py y util.py).
// La lógica de decisión (umbrales, "única jugada", extensión de la línea) sigue al original.
// Diferencias: no usa tablebases, evalúa con Stockfish WASM en el navegador y puede sacar varios puzzles por partida.
import { Chess } from 'chess.js';

/* ───────────── Puntajes ───────────── */
const MATE_SCORE = 100000;
export const cp = (x) => ({ cp: x });
export const mate = (n) => ({ mate: n });
export const isMate = (s) => s.mate !== undefined;
export function val(s) {
  if (s.mate !== undefined) return s.mate > 0 ? MATE_SCORE - s.mate : -MATE_SCORE - s.mate;
  return s.cp;
}
export const neg = (s) => (s.mate !== undefined ? { mate: -s.mate } : { cp: -s.cp });
export const MATE_SOON = mate(15);
export function winChances(s) {
  if (s.mate !== undefined) return s.mate > 0 ? 1 : -1;
  return 2 / (1 + Math.exp(-0.00368208 * s.cp)) - 1; // https://github.com/lichess-org/lila/pull/11148
}
/** puntaje de quien mueve (stm) → puntaje desde el punto de vista de `color` ('w'|'b') */
export const povFromStm = (s, turn, color) => (turn === color ? s : neg(s));
/** puntaje de las blancas → punto de vista de `color` */
export const povFromWhite = (s, color) => (color === 'w' ? s : neg(s));

/* ───────────── Utilidades de tablero ───────────── */
export const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');
export const turnOf = (fen) => fen.split(' ')[1];
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

export function materialCount(fen, color) {
  let total = 0;
  const placement = fen.split(' ')[0];
  for (const ch of placement) {
    const lower = ch.toLowerCase();
    const v = PIECE_VALUE[lower];
    if (!v) continue;
    const isWhite = ch !== lower;
    if ((color === 'w') === isWhite) total += v;
  }
  return total;
}
export const materialDiff = (fen, color) => materialCount(fen, color) - materialCount(fen, color === 'w' ? 'b' : 'w');

function nonPawnPieces(fen) {
  let n = 0;
  for (const ch of fen.split(' ')[0]) if ('nbrqNBRQ'.includes(ch)) n++;
  return n;
}

/** Derechos de enroque "máximos" según la posición de rey y torres (maximum_castling_rights del original). */
function maxCastling(fen) {
  const rows = fen.split(' ')[0].split('/');
  const expand = (r) => r.replace(/\d/g, (d) => '.'.repeat(+d));
  const r8 = expand(rows[0]), r1 = expand(rows[7]);
  let s = '';
  if (r1[4] === 'K') { if (r1[7] === 'R') s += 'K'; if (r1[0] === 'R') s += 'Q'; }
  if (r8[4] === 'k') { if (r8[7] === 'r') s += 'k'; if (r8[0] === 'r') s += 'q'; }
  return s;
}
const castlingOf = (fen) => { const c = fen.split(' ')[2]; return c === '-' ? '' : c; };
const sortStr = (s) => s.split('').sort().join('');
const castlingMismatch = (fen) => sortStr(castlingOf(fen)) !== sortStr(maxCastling(fen));

export const uciFrom = (u) => u.slice(0, 2);
export const uciTo = (u) => u.slice(2, 4);
export const uciPromo = (u) => (u.length > 4 ? u[4] : undefined);

export function applyUci(fen, uci) {
  const ch = new Chess(fen);
  const m = ch.move({ from: uciFrom(uci), to: uciTo(uci), promotion: uciPromo(uci) });
  return { fen: ch.fen(), san: m.san, chess: ch, move: m };
}
export function legalCount(fen) { return new Chess(fen).moves().length; }
export function countMates(fen) {
  const ch = new Chess(fen);
  let n = 0;
  for (const m of ch.moves({ verbose: true })) {
    ch.move(m);
    if (ch.isCheckmate()) n++;
    ch.undo();
  }
  return n;
}

/** Reproduce una partida y devuelve todo lo necesario para analizarla. */
export function replay(game) {
  const ch = new Chess(game.startFen || undefined);
  const fens = [ch.fen()];
  const ucis = [], sans = [], irrev = [];
  const nLegal = [ch.moves().length];
  for (const san of game.sans) {
    const before = castlingOf(ch.fen());
    const m = ch.move(san);
    ucis.push(m.from + m.to + (m.promotion || ''));
    sans.push(m.san);
    const f = ch.fen();
    irrev.push(m.piece === 'p' || !!m.captured || castlingOf(f) !== before);
    fens.push(f);
    nLegal.push(ch.moves().length);
  }
  return { fens, ucis, sans, irrev, nLegal, epds: fens.map(epd) };
}

/* ───────────── Tiers del original ───────────── */
export const ratingTier = (r) => (r > 1750 ? 3 : r > 1600 ? 2 : r > 1500 ? 1 : 0);
export function timeControlTier(tc) {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc || '');
  if (!m) return 0;
  const total = +m[1] + (m[2] ? +m[2] : 0) * 40;
  return total >= 480 ? 3 : total >= 180 ? 2 : total > 60 ? 1 : 0;
}
export function gameTier(game, nPlies) {
  let t = 4;
  t = Math.min(t, ratingTier(game.whiteElo || 0), ratingTier(game.blackElo || 0), timeControlTier(game.tc));
  if (nPlies < 38) t++;
  if (nPlies < 21) t++;
  return t;
}

/* ───────────── Motor UCI ───────────── */
function parseInfo(line, store) {
  const t = line.split(' ');
  const iScore = t.indexOf('score');
  const iPv = t.indexOf('pv');
  if (iScore < 0 || iPv < 0) return;
  const mpvIdx = t.indexOf('multipv');
  const k = mpvIdx >= 0 ? +t[mpvIdx + 1] : 1;
  const kind = t[iScore + 1], num = +t[iScore + 2];
  const bound = t[iScore + 3] === 'lowerbound' || t[iScore + 3] === 'upperbound';
  const get = (key) => { const i = t.indexOf(key); return i >= 0 ? +t[i + 1] : undefined; };
  const entry = {
    move: t[iPv + 1],
    pv: t.slice(iPv + 1),
    score: kind === 'mate' ? { mate: num } : { cp: num },
    depth: get('depth'), nodes: get('nodes'), nps: get('nps'), bound,
  };
  const prev = store.get(k);
  if (bound && prev && !prev.bound) return;
  store.set(k, entry);
}

export class UciEngine {
  /** transport: { send(cmd), onLine: fn(line) (la asigna el motor), terminate() } */
  constructor(transport) {
    this.t = transport;
    this.chain = Promise.resolve();
    this.cur = null;
    this.dead = false;
    this.mpv = 1;
    this.lastNps = 0;
    transport.onLine = (line) => { if (this.cur) this.cur.onLine(line); };
  }
  _task(fn) {
    const p = this.chain.then(() => { if (this.dead) throw new Error('terminated'); return fn(); });
    this.chain = p.catch(() => {});
    return p;
  }
  _await(test, collect) {
    return new Promise((resolve, reject) => {
      this.cur = { reject, onLine: (l) => { if (collect) collect(l); if (test(l)) { this.cur = null; resolve(l); } } };
    });
  }
  async init({ hash = 32 } = {}) {
    await this._task(async () => {
      let p = this._await((l) => l === 'uciok');
      this.t.send('uci'); await p;
      this.t.send(`setoption name Hash value ${hash}`);
      p = this._await((l) => l === 'readyok');
      this.t.send('isready'); await p;
    });
  }
  /** Devuelve un arreglo por línea (multipv) con { move, pv, score (desde quien mueve), depth, nodes, nps } */
  analyse(fen, { multipv = 1, nodes = 100000 } = {}) {
    return this._task(async () => {
      const store = new Map();
      const done = this._await((l) => l.startsWith('bestmove'), (l) => { if (l.startsWith('info ')) parseInfo(l, store); });
      if (multipv !== this.mpv) { this.t.send(`setoption name MultiPV value ${multipv}`); this.mpv = multipv; }
      this.t.send(`position fen ${fen}`);
      this.t.send(`go nodes ${nodes}`);
      await done;
      const out = [...store.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).filter((e) => e.move && e.move !== '(none)');
      if (out[0] && out[0].nps) this.lastNps = out[0].nps;
      return out;
    });
  }
  terminate() {
    this.dead = true;
    if (this.cur) { const c = this.cur; this.cur = null; c.reject(new Error('terminated')); }
    try { this.t.terminate(); } catch (_) { /* nada */ }
  }
}

/* ───────────── Generador ───────────── */
export const PRESETS = {
  rapido:   { screenNodes: 25000,  verifyNodes: 200000, pairNodes: 600000,  defNodes: 200000 },
  normal:   { screenNodes: 50000,  verifyNodes: 400000, pairNodes: 1200000, defNodes: 300000 },
  profundo: { screenNodes: 120000, verifyNodes: 900000, pairNodes: 2500000, defNodes: 600000 },
};

/** Ajustes por modo de exigencia. 'lichess' y 'equilibrada' usan los umbrales originales (0.6 y 0.7). */
export function modeOptions(exigencia) {
  if (exigencia === 'todo') return { swing: 0.5, gap: 0.55, allowOne: true };
  return { swing: 0.6, gap: 0.7, allowOne: false };
}

export class Generator {
  /**
   * opts: { screenNodes, verifyNodes, pairNodes, defNodes,
   *         exigencia: 'lichess' | 'equilibrada' | 'todo', onlyMe: bool, maxPerGame: n }
   * cache: Map compartido entre generadores (evaluaciones por posición)
   */
  constructor(engine, opts = {}, cache = new Map()) {
    this.e = engine;
    this.o = { ...PRESETS.normal, exigencia: 'equilibrada', onlyMe: true, maxPerGame: 3, ...opts };
    this.m = modeOptions(this.o.exigencia);
    this.cache = cache;
  }

  /** evaluación desde el punto de vista de las blancas, con caché por posición y presupuesto de nodos */
  async evalWhite(fen, nodes) {
    const key = nodes + '|' + epd(fen);
    if (this.cache.has(key)) return this.cache.get(key);
    const info = await this.e.analyse(fen, { multipv: 1, nodes });
    if (!info.length) return null;
    const s = povFromStm(info[0].score, turnOf(fen), 'w');
    this.cache.set(key, s);
    return s;
  }

  async getNextPair(fen, winner) {
    const info = await this.e.analyse(fen, { multipv: 2, nodes: this.o.pairNodes });
    if (!info.length) return null;
    const turn = turnOf(fen);
    const best = { move: info[0].move, score: povFromStm(info[0].score, turn, winner) };
    const second = info[1] ? { move: info[1].move, score: povFromStm(info[1].score, turn, winner) } : null;
    const pair = { fen, winner, best, second };
    if (turn === winner && !(await this.isValidAttack(pair))) return null;
    return pair;
  }

  async isValidMateInOne(pair) {
    if (pair.best.score.mate !== 1) return false;
    const thr = 0.6;
    if (!pair.second || winChances(pair.second.score) <= thr) return true;
    if (pair.second.score.mate === 1) {
      const mates = countMates(pair.fen);
      const info = await this.e.analyse(pair.fen, { multipv: mates + 1, nodes: this.o.pairNodes });
      const turn = turnOf(pair.fen);
      const scores = info.map((x) => povFromStm(x.score, turn, pair.winner));
      const last = scores[scores.length - 1];
      if (val(last) < val(mate(1)) && winChances(last) > thr) return false;
      return true;
    }
    return false;
  }

  /** ¿es pair.best la única continuación? */
  async isValidAttack(pair) {
    return (
      pair.second === null ||
      (await this.isValidMateInOne(pair)) ||
      winChances(pair.best.score) > winChances(pair.second.score) + this.m.gap
    );
  }

  async cookMate(fen, winner, depth = 0) {
    const ch = new Chess(fen);
    if (ch.isGameOver()) return [];
    if (depth > 40) return null;
    let move;
    if (ch.turn() === winner) {
      const pair = await this.getNextPair(fen, winner);
      if (!pair) return null;
      if (val(pair.best.score) < val(MATE_SOON)) return null; // el mejor movimiento no es mate: probablemente no buscamos lo bastante hondo
      move = pair.best.move;
    } else {
      const info = await this.e.analyse(fen, { multipv: 1, nodes: this.o.defNodes });
      if (!info.length) return null;
      move = info[0].move;
    }
    const follow = await this.cookMate(applyUci(fen, move).fen, winner, depth + 1);
    if (follow === null) return null;
    return [move, ...follow];
  }

  async cookAdvantage(fen, winner, rep, root = true, depth = 0) {
    if (!root) {
      const k = epd(fen);
      rep.set(k, (rep.get(k) || 0) + 1);
      if (rep.get(k) >= 2) return null; // repetición → cancelar
    }
    if (depth > 40) return null;
    const pair = await this.getNextPair(fen, winner);
    if (!pair) return [];
    if (val(pair.best.score) < 200) return null; // ya no gana lo suficiente
    const follow = await this.cookAdvantage(applyUci(fen, pair.best.move).fen, winner, rep, false, depth + 1);
    if (follow === null) return null;
    return [pair, ...follow];
  }

  /**
   * Equivalente a analyze_position del original.
   * ctx: { fenAfter, winner, prev, score, tier, rep }  (prev y score desde el punto de vista del ganador)
   * Devuelve { puzzle: { kind, moves[], cp, mateIn } } o { score }
   */
  async analysePosition(ctx) {
    const { fenAfter, winner, prev, score, tier, rep } = ctx;
    const allowOne = this.m.allowOne;
    if (legalCount(fenAfter) < 2) return { score };
    if (val(prev) > 300 && val(score) < val(MATE_SOON)) return { score }; // ya ganaba de sobra
    if (materialDiff(fenAfter, winner) > 0) return { score }; // ya está arriba en material
    if (val(score) >= val(mate(1)) && tier < 3) return { score }; // mate en 1
    if (val(score) > val(MATE_SOON)) {
      const sol = await this.cookMate(fenAfter, winner);
      if (sol === null || (tier === 1 && sol.length === 3)) return { score };
      return { puzzle: { kind: 'mate', moves: sol, cp: null, mateIn: Math.ceil(sol.length / 2) } };
    }
    if (val(score) >= 200 && winChances(score) > winChances(prev) + this.m.swing) {
      if (val(score) < 400 && materialDiff(fenAfter, winner) > -1) return { score }; // no gana claramente y no viene de estar abajo
      const sol = await this.cookAdvantage(fenAfter, winner, rep || new Map(), true);
      if (!sol) return { score };
      while (sol.length && (sol.length % 2 === 0 || !sol[sol.length - 1].second)) sol.pop();
      if (!sol.length || (sol.length === 1 && !allowOne)) return { score };
      if (tier < 3 && sol.length === 3) return { score };
      const last = sol[sol.length - 1].best.score;
      return { puzzle: { kind: 'advantage', moves: sol.map((p) => p.best.move), cp: last.cp ?? null, mateIn: null } };
    }
    return { score };
  }

  /** ¿vale la pena gastar motor en esta posición? (mismos filtros que el original pero con margen para el ruido del análisis rápido) */
  screenCandidate(score, prev, fenAfter, winner, tier) {
    if (val(prev) > 400 && val(score) < val(mate(18))) return false;
    if (materialDiff(fenAfter, winner) > 0) return false;
    if (val(score) >= val(mate(1)) && tier < 3) return false;
    if (val(score) > val(mate(18))) return true;
    return val(score) >= 120 && winChances(score) > winChances(prev) + this.m.swing - 0.3;
  }

  /**
   * Analiza una partida normalizada. Devuelve la lista de puzzles encontrados.
   * game: { id, site, url, sans[], startFen?, evals? (blancas, por ply), me: 'w'|'b', whiteElo, blackElo, tc, ... }
   */
  async analyseGame(game, hooks = {}) {
    const R = replay(game);
    const n = R.ucis.length;
    if (n < 6) return [];
    const useGiven = !!(game.evals && game.evals.length >= n - 1);
    const tier = this.o.exigencia === 'lichess' ? gameTier(game, n) : 3;

    // 1) Evaluación rápida de todas las posiciones
    const scr = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (R.nLegal[i + 1] === 0) continue;
      const given = useGiven ? game.evals[i] : null;
      // en posiciones ya decididas solo hace falta ver si aparece un mate cercano: alcanza con menos nodos
      const decided = i > 0 && scr[i - 1] && Math.abs(val(scr[i - 1])) > 700;
      const nodes = decided ? Math.max(8000, Math.floor(this.o.screenNodes / 3)) : this.o.screenNodes;
      scr[i] = given || (await this.evalWhite(R.fens[i + 1], nodes));
    }

    // 2) Recorrido tipo Lichess
    const puzzles = [];
    const seen = new Set();
    let skipUntilIrrev = false;
    let cooldown = -1;
    for (let i = 0; i < n && puzzles.length < this.o.maxPerGame; i++) {
      if (skipUntilIrrev) {
        if (R.irrev[i]) { skipUntilIrrev = false; seen.clear(); } else continue;
      }
      const key = R.epds[i + 1];
      if (seen.has(key)) { skipUntilIrrev = true; continue; }
      seen.add(key);
      if (castlingMismatch(R.fens[i + 1])) continue;
      if (i <= cooldown || R.nLegal[i + 1] < 2 || !scr[i]) continue;

      const winner = turnOf(R.fens[i + 1]);
      if (this.o.onlyMe && game.me && winner !== game.me) continue;
      let score = povFromWhite(scr[i], winner);
      let prev = i === 0 ? cp(20) : (scr[i - 1] ? povFromWhite(scr[i - 1], winner) : cp(20));
      if (!this.screenCandidate(score, prev, R.fens[i + 1], winner, tier)) continue;

      // 3) Verificación con más nodos (si las evaluaciones no vinieron del análisis de Lichess)
      if (!useGiven) {
        const a = await this.evalWhite(R.fens[i + 1], this.o.verifyNodes);
        const b = i === 0 ? null : await this.evalWhite(R.fens[i], this.o.verifyNodes);
        if (!a) continue;
        score = povFromWhite(a, winner);
        prev = b ? povFromWhite(b, winner) : cp(20);
      }
      const rep = new Map();
      for (let k = 0; k <= i + 1; k++) rep.set(R.epds[k], (rep.get(R.epds[k]) || 0) + 1);

      const res = await this.analysePosition({ fenAfter: R.fens[i + 1], winner, prev, score, tier, rep });
      if (!res.puzzle) continue;

      const puzzle = this.buildPuzzle(game, R, i, winner, res.puzzle);
      puzzles.push(puzzle);
      cooldown = i + res.puzzle.moves.length;
      if (hooks.onPuzzle) hooks.onPuzzle(puzzle);
    }
    return puzzles;
  }

  buildPuzzle(game, R, i, winner, p) {
    const fenBefore = R.fens[i];
    const fenAfter = R.fens[i + 1];
    // material al final de la línea
    let fen = fenAfter;
    for (const m of p.moves) fen = applyUci(fen, m).fen;
    const gain = materialDiff(fen, winner) - materialDiff(fenAfter, winner);
    const played = i + 1 < R.ucis.length ? R.ucis[i + 1] : null;
    const np = nonPawnPieces(fenAfter);
    const tags = [];
    if (p.kind === 'mate') { tags.push('mate', 'mate' + Math.min(p.mateIn, 4)); }
    else {
      tags.push('ventaja');
      if (gain >= 1) tags.push('material');
      if (p.cp !== null && p.cp >= 600) tags.push('decisivo');
    }
    tags.push(i < 20 ? 'apertura' : np <= 6 ? 'final' : 'medio');
    if (p.moves.length >= 5) tags.push('larga');
    const mover = winner === 'w' ? 'b' : 'w';
    return {
      id: `${game.site}:${game.id}:${i + 1}`,
      site: game.site, gameId: game.id, url: game.url,
      fen: fenBefore, blunder: R.ucis[i], blunderSan: R.sans[i],
      solution: p.moves, ply: i + 1,
      color: winner === 'w' ? 'white' : 'black',
      mine: game.me ? winner === game.me : null,
      blunderBy: game.me ? (mover === game.me ? 'me' : 'opp') : null,
      kind: p.kind, mateIn: p.mateIn, cp: p.cp, gain, tags,
      played, found: played !== null && played === p.moves[0],
      speed: game.speed, date: game.date,
      me: game.me ? (game.me === 'w' ? 'white' : 'black') : null,
      white: game.white, black: game.black, whiteElo: game.whiteElo, blackElo: game.blackElo,
      result: game.result || null,
    };
  }
}
