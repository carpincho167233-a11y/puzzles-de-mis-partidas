import { Chess } from 'chess.js';
import { uciFrom, uciTo, uciPromo } from './core.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem('pmp1.' + k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('pmp1.' + k, JSON.stringify(v)); return true; } catch (_) { return false; } },
  del(k) { try { localStorage.removeItem('pmp1.' + k); } catch (_) { /* nada */ } },
};

const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDate = (ms) => (ms ? dateFmt.format(new Date(ms)).replace('.', '') : '');
export const SPEED_LABEL = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápida', classical: 'Clásica' };
export const SITE_LABEL = { lichess: 'Lichess', chesscom: 'Chess.com', pgn: 'PGN' };

export function fmtDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '';
  if (sec < 45) return 'menos de un minuto';
  const m = Math.round(sec / 60);
  if (m < 60) return m === 1 ? 'alrededor de 1 minuto' : `alrededor de ${m} minutos`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return `alrededor de ${hh} h ${mm} min`;
}

/** Lista de jugadas en SAN con numeración a partir de un FEN */
export function sanLine(fen, ucis) {
  const ch = new Chess(fen);
  const out = [];
  for (const u of ucis) {
    const turn = ch.turn();
    const num = Number(ch.fen().split(' ')[5]);
    const m = ch.move({ from: uciFrom(u), to: uciTo(u), promotion: uciPromo(u) });
    out.push({ san: m.san, turn, num, uci: u });
  }
  return out;
}
export function lineText(items, firstMark = '') {
  let s = '';
  items.forEach((it, i) => {
    const mark = i === 0 ? firstMark : '';
    if (it.turn === 'w') s += `${it.num}. ${it.san}${mark} `;
    else s += (i === 0 ? `${it.num}... ` : '') + it.san + mark + ' ';
  });
  return s.trim();
}
export function fenAfter(fen, uci) {
  const ch = new Chess(fen);
  ch.move({ from: uciFrom(uci), to: uciTo(uci), promotion: uciPromo(uci) });
  return ch.fen();
}

/* ───────────── Exportación ───────────── */
export function puzzleLabel(p) {
  if (p.kind === 'mate') return `Mate en ${p.mateIn}`;
  if (p.tags.includes('decisivo')) return 'Ventaja decisiva';
  if (p.tags.includes('material')) return 'Ganá material';
  return 'Ventaja';
}

export function toPgn(puzzles) {
  return puzzles.map((p) => {
    const items = sanLine(p.fen, [p.blunder, ...p.solution]);
    const text = lineText(items, '?');
    const date = p.date ? new Date(p.date).toISOString().slice(0, 10).replace(/-/g, '.') : '????.??.??';
    const q = (s) => String(s || '?').replace(/["\\]/g, '');
    return [
      `[Event "Puzzle de mis partidas"]`, `[Site "${q(p.url || p.site)}"]`, `[Date "${date}"]`,
      `[White "${q(p.white)}"]`, `[Black "${q(p.black)}"]`, `[Result "*"]`,
      `[PuzzleId "${q(p.id)}"]`, `[Themes "${p.tags.join(' ')}"]`,
      `[SetUp "1"]`, `[FEN "${p.fen}"]`, '',
      `${text} { La primera jugada es el error; la solución empieza en la segunda. } *`, '',
    ].join('\n');
  }).join('\n');
}

/** Mismo formato que la base de puzzles de Lichess: FEN antes del error y jugadas en UCI (la primera es el error). */
export function toCsv(puzzles) {
  const rows = ['PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags'];
  for (const p of puzzles) {
    const id = p.id.replace(/[^\w]/g, '').slice(0, 12);
    rows.push([id, p.fen, [p.blunder, ...p.solution].join(' '), 0, 0, 0, 0, p.tags.join(' '), p.url || '', ''].join(','));
  }
  return rows.join('\n') + '\n';
}

export function download(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
