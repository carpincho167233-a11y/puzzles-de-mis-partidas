import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import { Generator, PRESETS, uciFrom, uciTo, uciPromo } from './core.js';
import { fetchLichess, fetchChesscom, gameFromPgn, splitPgn } from './sources.js';
import { createBrowserEngine } from './engine-browser.js';
import { h, store, fmtDate, fmtDuration, SPEED_LABEL, SITE_LABEL, sanLine, lineText, fenAfter, puzzleLabel, toPgn, toCsv, download } from './util.js';

/* ───────────── Estado ───────────── */
const DEFAULTS = {
  lichess: '', chesscom: '', speeds: ['blitz', 'rapid'], max: 200, rated: true,
  onlyMe: true, exigencia: 'equilibrada', preset: 'normal', maxPerGame: 3, reanalyze: false, threads: 0, pgnName: '',
  f: { status: 'pending', kind: 'all', missed: false, order: 'recent' },
};
const S = {
  settings: { ...DEFAULTS, ...store.get('settings', {}), f: { ...DEFAULTS.f, ...(store.get('settings', {}).f || {}) } },
  puzzles: store.get('puzzles', []),
  progress: store.get('progress', {}),
  seen: new Set(store.get('seen', [])),
  view: 'buscar',
};
const persist = {
  settings: () => store.set('settings', S.settings),
  puzzles: () => store.set('puzzles', S.puzzles),
  progress: () => store.set('progress', S.progress),
  seen: () => store.set('seen', [...S.seen]),
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ───────────── Esqueleto ───────────── */
const SKELETON = `
<header class="top">
  <div class="brand"><span class="mark" aria-hidden="true"></span><span class="brand-name">Puzzles de mis partidas</span></div>
  <nav class="tabs" role="tablist" aria-label="Secciones">
    <button class="tab" role="tab" data-view="buscar" id="tab-buscar" type="button">Buscar</button>
    <button class="tab" role="tab" data-view="entrenar" id="tab-entrenar" type="button">Entrenar <span class="count" id="count">0</span></button>
  </nav>
</header>
<main>
<section id="view-buscar" class="view">
  <div class="search-grid">
    <form id="setup" class="card setup" autocomplete="off">
      <h1>Convertí tus partidas en puzzles</h1>
      <p class="lede">Ponés tus usuarios, elegís el ritmo y Stockfish busca los momentos en los que había una jugada ganadora. Usa los criterios del generador de puzzles de Lichess.</p>
      <div class="fields">
        <label class="field" for="f-lichess"><span>Usuario de Lichess</span><input id="f-lichess" type="text" placeholder="tu_usuario" spellcheck="false" autocapitalize="off" autocomplete="off"></label>
        <label class="field" for="f-chesscom"><span>Usuario de Chess.com</span><input id="f-chesscom" type="text" placeholder="tu_usuario" spellcheck="false" autocapitalize="off" autocomplete="off"></label>
      </div>
      <p class="hint">Si tenés más de una cuenta en un sitio, separalas con coma.</p>
      <fieldset class="speeds">
        <legend>Ritmo de las partidas</legend>
        <div class="chips" id="speed-chips">
          <label class="chip"><input type="checkbox" value="bullet"><span><b>Bullet</b><small>menos de 3 min</small></span></label>
          <label class="chip"><input type="checkbox" value="blitz"><span><b>Blitz</b><small>3 a 8 min</small></span></label>
          <label class="chip"><input type="checkbox" value="rapid"><span><b>Rápidas</b><small>8 a 25 min</small></span></label>
          <label class="chip"><input type="checkbox" value="classical"><span><b>Clásicas</b><small>más de 25 min o diarias</small></span></label>
        </div>
      </fieldset>
      <div class="row">
        <label class="field narrow" for="f-max"><span>Partidas por cuenta</span>
          <select id="f-max"><option value="50">Últimas 50</option><option value="100">Últimas 100</option><option value="200">Últimas 200</option><option value="500">Últimas 500</option><option value="1000">Últimas 1000</option></select></label>
        <label class="check"><input type="checkbox" id="f-rated"><span>Solo partidas puntuadas</span></label>
      </div>
      <details class="more" id="more">
        <summary>Más opciones</summary>
        <div class="more-grid">
          <label class="field" for="f-onlyme"><span>Puzzles para</span>
            <select id="f-onlyme"><option value="1">Posiciones donde me tocaba a mí</option><option value="0">Ambos lados</option></select></label>
          <label class="field" for="f-exig"><span>Exigencia</span>
            <select id="f-exig"><option value="lichess">Como Lichess (estricta)</option><option value="equilibrada">Equilibrada</option><option value="todo">Todo lo que encuentres</option></select>
            <em class="help" id="exig-help"></em></label>
          <label class="field" for="f-preset"><span>Velocidad de análisis</span>
            <select id="f-preset"><option value="rapido">Rápido (menos preciso)</option><option value="normal">Normal</option><option value="profundo">Profundo (más lento)</option></select></label>
          <label class="field" for="f-mpg"><span>Máximo de puzzles por partida</span>
            <select id="f-mpg"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="5">5</option></select></label>
          <label class="field" for="f-threads"><span>Motores en paralelo</span>
            <select id="f-threads"><option value="0">Automático</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="6">6</option><option value="8">8</option></select></label>
          <label class="check"><input type="checkbox" id="f-reanalyze"><span>Volver a analizar partidas ya revisadas</span></label>
          <div class="field pgn"><span>Archivo PGN propio (opcional)</span>
            <input type="file" id="f-pgn" accept=".pgn,.txt" multiple>
            <input id="f-pgnname" type="text" placeholder="Tu nombre tal como aparece en el PGN" spellcheck="false" autocapitalize="off">
            <em class="help">Sirve para tu base de partidas de ChessBase u otro programa. Si dejás el nombre vacío se usan ambos lados.</em></div>
        </div>
      </details>
      <p class="form-error" id="form-error" role="alert" hidden></p>
      <div class="actions"><button type="submit" class="btn primary" id="go">Buscar mis puzzles</button></div>
      <p class="fine">Todo se calcula en tu navegador. La página solo consulta las APIs públicas de Lichess y Chess.com para bajar tus partidas.</p>
    </form>
    <aside class="card status" id="status" aria-live="polite"></aside>
  </div>
</section>

<section id="view-entrenar" class="view" hidden>
  <div class="train">
    <div class="board-col">
      <div class="board-wrap"><div id="board" class="board"></div></div>
    </div>
    <div class="side-col">
      <div class="card pcard" id="pcard"></div>
      <div class="card lcard">
        <div class="filters">
          <label class="field" for="fl-status"><span>Mostrar</span>
            <select id="fl-status"><option value="pending">Pendientes</option><option value="new">Nuevos</option><option value="failed">Fallados</option><option value="solved">Resueltos</option><option value="all">Todos</option></select></label>
          <label class="field" for="fl-kind"><span>Tipo</span>
            <select id="fl-kind"><option value="all">Todos</option><option value="mate">Mates</option><option value="advantage">Ventaja o material</option></select></label>
          <label class="field" for="fl-order"><span>Orden</span>
            <select id="fl-order"><option value="recent">Recientes</option><option value="random">Al azar</option></select></label>
        </div>
        <label class="check"><input type="checkbox" id="fl-missed"><span>Solo los que no vi en la partida</span></label>
        <ol class="plist" id="plist"></ol>
        <p class="list-note" id="list-note"></p>
        <div class="list-actions">
          <button class="btn ghost" id="btn-pgn" type="button">Exportar PGN</button>
          <button class="btn ghost" id="btn-csv" type="button">Exportar CSV</button>
          <button class="btn ghost" id="btn-json" type="button">Copia de seguridad</button>
          <label class="btn ghost file-btn" for="f-import">Restaurar copia<input type="file" id="f-import" accept=".json" hidden></label>
          <button class="btn ghost danger" id="btn-clear" type="button">Borrar todo</button>
        </div>
      </div>
    </div>
  </div>
</section>
</main>
<footer class="foot">Motor Stockfish 19 (GPL-3.0). Criterios de selección portados de lichess-puzzler (AGPL-3.0). Tablero: chessground.</footer>
`;

const EXIG_HELP = {
  lichess: 'Mismos filtros que Lichess, incluida su regla por nivel de la partida. Salen pocos puzzles.',
  equilibrada: 'Incluye mates en 1 y combinaciones cortas. Descarta las tácticas de una sola jugada.',
  todo: 'Suma tácticas de una sola jugada y acepta soluciones menos únicas. Salen más puzzles, algunos simples.',
};

/* ───────────── Formulario ───────────── */
function loadForm() {
  const s = S.settings;
  $('#f-lichess').value = s.lichess;
  $('#f-chesscom').value = s.chesscom;
  $$('#speed-chips input').forEach((i) => { i.checked = s.speeds.includes(i.value); });
  $('#f-max').value = String(s.max);
  $('#f-rated').checked = s.rated;
  $('#f-onlyme').value = s.onlyMe ? '1' : '0';
  $('#f-exig').value = s.exigencia;
  $('#f-preset').value = s.preset;
  $('#f-mpg').value = String(s.maxPerGame);
  $('#f-threads').value = String(s.threads);
  $('#f-reanalyze').checked = s.reanalyze;
  $('#f-pgnname').value = s.pgnName;
  $('#exig-help').textContent = EXIG_HELP[s.exigencia];
}
function readForm() {
  const s = S.settings;
  s.lichess = $('#f-lichess').value.trim();
  s.chesscom = $('#f-chesscom').value.trim();
  s.speeds = $$('#speed-chips input').filter((i) => i.checked).map((i) => i.value);
  s.max = +$('#f-max').value;
  s.rated = $('#f-rated').checked;
  s.onlyMe = $('#f-onlyme').value === '1';
  s.exigencia = $('#f-exig').value;
  s.preset = $('#f-preset').value;
  s.maxPerGame = +$('#f-mpg').value;
  s.threads = +$('#f-threads').value;
  s.reanalyze = $('#f-reanalyze').checked;
  s.pgnName = $('#f-pgnname').value.trim();
  persist.settings();
  return s;
}
const splitNames = (t) => t.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/* ───────────── Búsqueda y análisis ───────────── */
let R = null; // estado de la corrida actual
let renderTimer = null;
function touch() { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; renderStatus(); }, 180); }

function showFormError(msg) {
  const el = $('#form-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

function defaultThreads() { return Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)); }

async function startRun() {
  if (R && R.active) return;
  const cfg = readForm();
  const lUsers = splitNames(cfg.lichess), cUsers = splitNames(cfg.chesscom);
  const pgnFiles = [...($('#f-pgn').files || [])];
  showFormError('');
  if (!lUsers.length && !cUsers.length && !pgnFiles.length) return showFormError('Poné al menos un usuario de Lichess o Chess.com, o elegí un archivo PGN.');
  if (!cfg.speeds.length && !pgnFiles.length) return showFormError('Elegí al menos un ritmo de juego.');

  R = { active: true, stopped: false, phase: 'download', abort: new AbortController(), dl: [], note: '', total: 0, done: 0, found: 0, errors: 0, skipped: 0,
        engines: [], last: null, tStart: Date.now(), tAnalyze: 0, message: '', failMsg: '' };
  renderStatus();
  $('#go').disabled = true;
  $('#status').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const signal = R.abort.signal;

  try {
    let games = [];
    const lNames = new Set(lUsers.map((u) => u.toLowerCase())), cNames = new Set(cUsers.map((u) => u.toLowerCase()));
    const base = { speeds: cfg.speeds, rated: cfg.rated, max: cfg.max };
    for (const [site, users, names, fn] of [['Lichess', lUsers, lNames, fetchLichess], ['Chess.com', cUsers, cNames, fetchChesscom]]) {
      for (const u of users) {
        const row = { label: `${site} · ${u}`, n: 0, state: 'run', msg: '' };
        R.dl.push(row); touch();
        try {
          const got = await fn(u, { ...base, names }, { signal, onProgress: (n) => { row.n = n; R.note = ''; touch(); }, onWait: (m) => { R.note = m; touch(); } });
          row.n = got.length; row.state = 'ok'; games.push(...got);
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          row.state = 'err'; row.msg = e.message || String(e);
        }
        touch();
      }
    }
    const pgnNames = new Set(splitNames(cfg.pgnName).map((x) => x.toLowerCase()));
    for (const f of pgnFiles) {
      const row = { label: `Archivo · ${f.name}`, n: 0, state: 'run', msg: '' };
      R.dl.push(row); touch();
      try {
        const parts = splitPgn(await f.text());
        let k = 0;
        for (const part of parts) { const g = gameFromPgn(part, pgnNames, k++); if (g) games.push(g); }
        row.n = games.filter((g) => g.site === 'pgn').length; row.state = 'ok';
      } catch (e) { row.state = 'err'; row.msg = 'No pude leer el archivo.'; }
    }

    // sin repetidos, las más nuevas primero, sin las ya revisadas
    const uniq = new Map();
    for (const g of games) uniq.set(`${g.site}:${g.id}`, g);
    games = [...uniq.values()].sort((a, b) => b.date - a.date);
    const before = games.length;
    if (!cfg.reanalyze) games = games.filter((g) => !S.seen.has(`${g.site}:${g.id}`));
    R.skipped = before - games.length;
    R.total = games.length;
    if (!games.length) {
      R.message = before ? `Las ${before} partidas encontradas ya estaban revisadas. Activá “Volver a analizar partidas ya revisadas” si querés repetir el análisis.` : 'No encontré partidas con esos filtros.';
      return finishRun();
    }

    // motores
    R.phase = 'engine'; touch();
    const K = Math.max(1, Math.min(cfg.threads || defaultThreads(), games.length));
    try {
      R.engines = await Promise.all(Array.from({ length: K }, () => createBrowserEngine({ hash: 32 })));
    } catch (e) {
      R.engines.forEach((x) => x.terminate());
      R.failMsg = (e && e.message) || 'No pude iniciar Stockfish en este navegador.';
      return finishRun();
    }
    if (signal.aborted) throw new DOMException('abort', 'AbortError');

    // análisis
    R.phase = 'analyze'; R.tAnalyze = Date.now(); touch();
    const opts = { ...PRESETS[cfg.preset], exigencia: cfg.exigencia, onlyMe: cfg.onlyMe, maxPerGame: cfg.maxPerGame };
    const cache = new Map();
    const queue = games.slice();
    await Promise.all(R.engines.map(async (eng) => {
      const gen = new Generator(eng, opts, cache);
      while (!R.stopped) {
        const g = queue.shift();
        if (!g) break;
        try {
          const ps = await gen.analyseGame(g);
          for (const p of ps) addPuzzle(p, g);
        } catch (e) {
          if (R.stopped) return;
          R.errors++;
        }
        S.seen.add(`${g.site}:${g.id}`);
        R.done++;
        if (R.done % 5 === 0) persist.seen();
        touch();
      }
    }));
  } catch (e) {
    if (!(e && e.name === 'AbortError')) R.failMsg = (e && e.message) || String(e);
  }
  finishRun();
}

function addPuzzle(p, g) {
  if (S.puzzles.some((x) => x.id === p.id)) return;
  S.puzzles.push(p);
  persist.puzzles();
  R.found++;
  const opp = p.me === 'white' ? p.black : p.me === 'black' ? p.white : p.white + ' vs ' + p.black;
  R.last = `${puzzleLabel(p)} · ${SPEED_LABEL[p.speed] || ''} · ${p.me ? 'vs ' : ''}${opp}`;
  $('#count').textContent = String(S.puzzles.length);
}

function finishRun() {
  if (!R) return;
  R.engines.forEach((e) => e.terminate());
  R.engines = [];
  R.active = false;
  R.phase = 'done';
  persist.seen(); persist.puzzles();
  $('#go').disabled = false;
  $('#count').textContent = String(S.puzzles.length);
  renderStatus();
}

function stopRun() {
  if (!R || !R.active) return;
  R.stopped = true;
  R.abort.abort();
  R.engines.forEach((e) => e.terminate());
}

function renderStatus() {
  const el = $('#status');
  el.replaceChildren();
  if (!R) {
    if (S.puzzles.length) {
      el.append(
        h('h2', { text: 'Tus puzzles' }),
        h('p', { class: 'big', text: `${S.puzzles.length} ${S.puzzles.length === 1 ? 'puzzle guardado' : 'puzzles guardados'} en este navegador.` }),
        h('p', { class: 'muted', text: `${S.seen.size} partidas ya revisadas. La próxima búsqueda solo analiza las partidas nuevas.` }),
        h('button', { class: 'btn primary', type: 'button', onclick: () => showView('entrenar'), text: 'Entrenar ahora' }),
      );
    } else {
      el.append(
        h('h2', { text: 'Cómo funciona' }),
        h('ol', { class: 'how' },
          h('li', null, h('b', { text: 'Baja tus partidas. ' }), 'Las últimas de cada cuenta, con el ritmo que elegiste.'),
          h('li', null, h('b', { text: 'Stockfish revisa cada jugada. ' }), 'Busca el momento en que alguien se equivocó y el otro lado tenía una jugada ganadora.'),
          h('li', null, h('b', { text: 'Queda un puzzle si esa jugada era única. ' }), 'Como en Lichess: se descartan las posiciones donde había varias formas de ganar.')),
        h('p', { class: 'muted', text: 'Con 4 núcleos, 100 partidas llevan unos 3 a 5 minutos con la velocidad normal.' }),
      );
    }
    return;
  }
  const rows = R.dl.map((r) => h('li', { class: 'dl-row ' + r.state },
    h('span', { class: 'dl-name', text: r.label }),
    h('span', { class: 'dl-n', text: r.state === 'err' ? r.msg : r.state === 'run' ? 'descargando… ' + r.n : `${r.n} partidas` })));
  if (R.phase === 'download') {
    el.append(h('h2', { text: 'Descargando partidas' }), h('ul', { class: 'dl' }, rows), R.note ? h('p', { class: 'muted', text: R.note }) : null);
  } else if (R.phase === 'engine') {
    el.append(h('h2', { text: 'Preparando Stockfish' }), h('ul', { class: 'dl' }, rows), h('p', { class: 'muted', text: `${R.total} partidas para analizar.` }));
  } else {
    const pct = R.total ? Math.round((R.done / R.total) * 100) : 0;
    const analyzing = R.phase === 'analyze';
    el.append(h('h2', { text: analyzing ? 'Analizando con Stockfish' : (R.stopped ? 'Búsqueda detenida' : 'Búsqueda terminada') }));
    if (R.total) {
      el.append(
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('i', { style: `width:${pct}%` })),
        h('p', { class: 'big' }, h('b', { text: String(R.done) }), ` de ${R.total} partidas · `, h('b', { text: String(R.found) }), R.found === 1 ? ' puzzle' : ' puzzles'),
      );
      if (analyzing && R.done >= 2) {
        const per = (Date.now() - R.tAnalyze) / R.done;
        el.append(h('p', { class: 'muted', text: `Tiempo restante: ${fmtDuration(((R.total - R.done) * per) / 1000)} · ${R.engines.length} ${R.engines.length === 1 ? 'motor' : 'motores'} en paralelo` }));
      } else if (analyzing) el.append(h('p', { class: 'muted', text: `${R.engines.length} ${R.engines.length === 1 ? 'motor' : 'motores'} en paralelo` }));
      if (R.last) el.append(h('p', { class: 'last' }, h('span', { text: 'Último hallazgo' }), R.last));
    }
    if (R.message) el.append(h('p', { class: 'note', text: R.message }));
    if (R.failMsg) el.append(h('p', { class: 'note bad', text: R.failMsg }));
    if (R.errors) el.append(h('p', { class: 'muted', text: `${R.errors} ${R.errors === 1 ? 'partida no se pudo analizar' : 'partidas no se pudieron analizar'}.` }));
    if (R.skipped && !analyzing) el.append(h('p', { class: 'muted', text: `${R.skipped} partidas ya revisadas se saltearon.` }));
    el.append(h('ul', { class: 'dl small' }, rows));
    if (!analyzing && !R.stopped && !R.failMsg && R.done > 0 && R.found === 0) {
      const cfg = S.settings;
      el.append(h('p', { class: 'note', text: cfg.exigencia === 'todo'
        ? 'No salió ningún puzzle. Probá con más partidas, con el ritmo clásico o con la velocidad de análisis en Profundo.'
        : 'No salió ningún puzzle con esta exigencia: son filtros estrictos y en pocas partidas es normal. Podés probar con “Todo lo que encuentres”, que suma tácticas simples y soluciones menos únicas.' }));
      if (cfg.exigencia !== 'todo') el.append(h('button', { class: 'btn', type: 'button', onclick: () => { $('#f-exig').value = 'todo'; $('#exig-help').textContent = EXIG_HELP.todo; $('#f-reanalyze').checked = true; startRun(); }, text: 'Reintentar con “Todo lo que encuentres”' }));
    }
    if (analyzing) el.append(h('button', { class: 'btn', type: 'button', onclick: stopRun, text: 'Detener' }));
    else if (S.puzzles.length) el.append(h('button', { class: 'btn primary', type: 'button', onclick: () => showView('entrenar'), text: `Entrenar con ${S.puzzles.length} ${S.puzzles.length === 1 ? 'puzzle' : 'puzzles'}` }));
  }
  if (R.phase === 'download' || R.phase === 'engine') el.append(h('button', { class: 'btn', type: 'button', onclick: stopRun, text: 'Cancelar' }));
  if (R.phase === 'done' && !R.total) el.append(h('button', { class: 'btn', type: 'button', onclick: () => { R = null; renderStatus(); }, text: 'Entendido' }));
}

/* ───────────── Entrenamiento ───────────── */
let cg = null;
const T = { id: null, p: null, chess: null, idx: 0, locked: true, failed: false, done: false, hinted: false, lastMove: null, timers: [], seed: Math.random() };
const colorName = (c) => (c === 'w' ? 'white' : 'black');
const later = (ms, fn) => { T.timers.push(setTimeout(fn, ms)); };
const clearTimers = () => { T.timers.forEach(clearTimeout); T.timers = []; };

function ensureBoard() {
  if (cg) return;
  cg = Chessground($('#board'), {
    fen: '8/8/8/8/8/8/8/8 w - - 0 1', coordinates: true, animation: { duration: 220 },
    highlight: { lastMove: true, check: true },
    movable: { free: false, color: undefined, dests: new Map(), showDests: true, events: { after: onUserMove } },
    premovable: { enabled: false }, draggable: { showGhost: true }, drawable: { enabled: true },
  });
  if (window.ResizeObserver) new ResizeObserver(() => cg.redrawAll()).observe($('#board'));
}

const puzzleById = (id) => S.puzzles.find((p) => p.id === id);
const stateOf = (p) => (S.progress[p.id] && S.progress[p.id].state) || 'new';

function filtered() {
  const f = S.settings.f;
  let list = S.puzzles.filter((p) => {
    const st = stateOf(p);
    if (f.status === 'pending' && st === 'solved' && p.id !== T.id) return false;
    if (f.status === 'new' && st !== 'new') return false;
    if (f.status === 'failed' && st !== 'failed') return false;
    if (f.status === 'solved' && st !== 'solved') return false;
    if (f.kind !== 'all' && p.kind !== f.kind) return false;
    if (f.missed && p.found) return false;
    return true;
  });
  if (f.order === 'random') {
    const hash = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (Math.imul(x, 31) + s.charCodeAt(i) + Math.floor(T.seed * 1e6)) | 0; return x; };
    list = list.sort((a, b) => hash(a.id) - hash(b.id));
  } else list = list.sort((a, b) => b.date - a.date || b.ply - a.ply);
  return list;
}

function renderList() {
  const list = filtered();
  const ol = $('#plist');
  ol.replaceChildren();
  const shown = list.slice(0, 150);
  for (const p of shown) {
    const st = stateOf(p);
    const opp = p.me === 'white' ? p.black : p.me === 'black' ? p.white : `${p.white} - ${p.black}`;
    ol.append(h('li', null, h('button', { class: 'prow' + (p.id === T.id ? ' current' : ''), type: 'button', onclick: () => startPuzzle(p.id), dataset: { id: p.id } },
      h('span', { class: 'dot ' + st, title: { new: 'Nuevo', failed: 'Fallado', solved: 'Resuelto' }[st] }),
      h('span', { class: 'ptxt' }, h('b', { text: puzzleLabel(p) }), h('small', { text: `${p.me ? 'vs ' : ''}${opp} · ${fmtDate(p.date)}` })),
      !p.found && p.mine !== false ? h('span', { class: 'tag', text: 'no lo vi' }) : null)));
  }
  $('#list-note').textContent = !S.puzzles.length ? 'Todavía no hay puzzles.' : !list.length ? 'No hay puzzles con estos filtros.' : list.length > shown.length ? `Mostrando ${shown.length} de ${list.length}.` : `${list.length} ${list.length === 1 ? 'puzzle' : 'puzzles'} en la lista.`;
  $('#count').textContent = String(S.puzzles.length);
}

function renderCard() {
  const el = $('#pcard');
  el.replaceChildren();
  const p = T.p;
  if (!p) {
    el.append(
      h('h2', { text: S.puzzles.length ? 'No hay puzzles con estos filtros' : 'Todavía no hay puzzles' }),
      h('p', { class: 'muted', text: S.puzzles.length ? 'Cambiá los filtros de la lista para ver otros.' : 'Andá a la pestaña Buscar, poné tus usuarios y Stockfish los arma por vos.' }),
      !S.puzzles.length ? h('button', { class: 'btn primary', type: 'button', onclick: () => showView('buscar'), text: 'Ir a Buscar' }) : null);
    return;
  }
  const opp = p.me === 'white' ? [p.black, p.blackElo] : p.me === 'black' ? [p.white, p.whiteElo] : null;
  const side = p.color === 'white' ? 'blancas' : 'negras';
  el.append(
    h('div', { class: 'pc-head' },
      h('span', { class: 'kind' + (p.kind === 'mate' ? ' mate' : ''), text: puzzleLabel(p) }),
      h('span', { class: 'side' }, h('i', { class: 'swatch ' + p.color }), p.mine === false ? `Juegan ${side} (tu rival)` : `Jugás con ${side}`)),
    h('p', { class: 'pc-status info', id: 'pc-status', role: 'status', text: '' }),
    h('div', { class: 'pc-reveal', id: 'pc-reveal', hidden: true }),
    h('div', { class: 'pc-actions' },
      h('button', { class: 'btn', id: 'b-hint', type: 'button', onclick: hint, text: 'Pista' }),
      h('button', { class: 'btn', id: 'b-sol', type: 'button', onclick: showSolution, text: 'Ver solución' }),
      h('button', { class: 'btn primary', id: 'b-next', type: 'button', onclick: nextPuzzle, text: 'Siguiente' })),
    h('dl', { class: 'pc-meta' },
      h('div', null, h('dt', { text: 'Partida' }), h('dd', { text: `${SPEED_LABEL[p.speed] || ''} · ${SITE_LABEL[p.site] || ''} · ${fmtDate(p.date)}` })),
      opp ? h('div', null, h('dt', { text: 'Rival' }), h('dd', { text: `${opp[0]}${opp[1] ? ' (' + opp[1] + ')' : ''} · jugada ${Math.ceil(p.ply / 2)}` })) :
        h('div', null, h('dt', { text: 'Partida' }), h('dd', { text: `${p.white} - ${p.black} · jugada ${Math.ceil(p.ply / 2)}` }))),
    h('div', { class: 'pc-tags' }, p.tags.filter((t) => !/^mate\d$/.test(t)).map((t) => h('span', { class: 'tag', text: t }))),
    h('div', { class: 'pc-links' },
      p.url ? h('a', { href: p.site === 'lichess' ? `${p.url}#${p.ply}` : p.url, target: '_blank', rel: 'noopener', text: 'Ver la partida ↗' }) : null,
      h('a', { href: 'https://lichess.org/analysis/' + fenAfter(p.fen, p.blunder).replace(/ /g, '_'), target: '_blank', rel: 'noopener', text: 'Analizar en Lichess ↗' })),
  );
}

function setStatus(text, kind) {
  const el = $('#pc-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'pc-status ' + (kind || 'info');
}

function syncBoard(extra = {}) {
  const ch = T.chess;
  cg.set({
    fen: ch.fen(), lastMove: T.lastMove || undefined, turnColor: colorName(ch.turn()),
    check: ch.inCheck() ? colorName(ch.turn()) : false, ...extra,
  });
}

function startPuzzle(id) {
  clearTimers();
  const p = puzzleById(id);
  if (!p) return;
  ensureBoard();
  T.id = id; T.p = p; T.chess = new Chess(p.fen); T.idx = 0; T.locked = true; T.failed = false; T.done = false; T.hinted = false; T.lastMove = null;
  renderCard();
  cg.setAutoShapes([]);
  cg.set({ orientation: p.color, movable: { color: undefined, dests: new Map() }, viewOnly: false });
  syncBoard();
  setStatus('Mirá la última jugada…', 'info');
  $('#b-next').disabled = false;
  later(450, () => {
    playUci(p.blunder);
    later(500, () => {
      setStatus(p.mine === false ? 'Tu rival tiene una jugada ganadora. Encontrala.' : 'Tu turno. Encontrá la mejor jugada.', 'info');
      enableUser();
    });
  });
  renderList();
}

function playUci(uci) {
  const from = uciFrom(uci), to = uciTo(uci);
  T.chess.move({ from, to, promotion: uciPromo(uci) });
  T.lastMove = [from, to];
  syncBoard({ movable: { color: undefined, dests: new Map() } });
}

function enableUser() {
  const dests = new Map();
  for (const m of T.chess.moves({ verbose: true })) { if (!dests.has(m.from)) dests.set(m.from, []); dests.get(m.from).push(m.to); }
  T.locked = false;
  cg.set({ turnColor: colorName(T.chess.turn()), movable: { color: colorName(T.chess.turn()), dests, free: false, showDests: true, events: { after: onUserMove } } });
}

function onUserMove(orig, dest) {
  if (T.locked || T.done) return;
  const p = T.p;
  const legal = T.chess.moves({ verbose: true }).filter((m) => m.from === orig && m.to === dest);
  if (!legal.length) { syncBoard(); return; }
  const expected = p.solution[T.idx];
  let promo;
  if (legal[0].promotion) promo = expected && expected.slice(0, 4) === orig + dest ? expected[4] : 'q';
  const uci = orig + dest + (promo || '');
  const snapshot = T.chess.fen();
  const prevLast = T.lastMove;
  T.chess.move({ from: orig, to: dest, promotion: promo });
  const mateAlt = p.kind === 'mate' && T.chess.isCheckmate();
  if (uci === expected || mateAlt) {
    T.lastMove = [orig, dest];
    T.idx++;
    T.locked = true;
    syncBoard({ movable: { color: undefined, dests: new Map() } });
    cg.setAutoShapes([]);
    if (T.idx >= p.solution.length || T.chess.isCheckmate()) { finish(); return; }
    setStatus('Bien. Seguí así…', 'ok');
    later(450, () => {
      playUci(p.solution[T.idx]);
      T.idx++;
      if (T.idx >= p.solution.length) finish();
      else { enableUser(); setStatus('Tu turno otra vez.', 'info'); }
    });
  } else {
    T.chess.undo();
    T.locked = true;
    T.failed = true;
    setProgress(p.id, 'failed');
    setStatus('Esa no es. Probá otra jugada.', 'bad');
    later(380, () => { T.lastMove = prevLast; T.chess = new Chess(snapshot); syncBoard(); enableUser(); });
  }
}

function setProgress(id, state) {
  const prev = S.progress[id] || {};
  S.progress[id] = { state, at: Date.now(), tries: (prev.tries || 0) + (state === 'failed' && prev.state === 'failed' ? 0 : 1) };
  persist.progress();
  renderList();
}

function revealText(p) {
  const after = fenAfter(p.fen, p.blunder);
  const line = lineText(sanLine(after, p.solution));
  let played = '';
  if (p.mine === false) played = '';
  else if (p.found) played = 'En la partida también encontraste esta jugada.';
  else if (p.played) played = `En la partida jugaste ${sanLine(after, [p.played])[0].san}.`;
  else played = 'La partida terminó en esa posición.';
  return { line, played, blunder: sanLine(p.fen, [p.blunder])[0] };
}

function finish() {
  const p = T.p;
  T.done = true; T.locked = true;
  cg.set({ movable: { color: undefined, dests: new Map() } });
  const clean = !T.failed && !T.hinted;
  setProgress(p.id, clean ? 'solved' : 'failed');
  setStatus(clean ? '¡Correcto!' : 'Resuelto, pero con ayuda o con errores. Queda para repasar.', clean ? 'ok' : 'warn');
  const r = revealText(p);
  const box = $('#pc-reveal');
  box.hidden = false;
  box.replaceChildren(h('b', { text: 'Línea: ' }), r.line, h('br'), r.played);
  $('#b-next').focus({ preventScroll: true });
}

function hint() {
  if (!T.p || T.done || T.locked) return;
  const from = uciFrom(T.p.solution[T.idx]);
  T.hinted = true;
  cg.setAutoShapes([{ orig: from, brush: 'green' }]);
  setStatus('La pieza marcada es la que tenés que mover.', 'info');
}

function showSolution() {
  const p = T.p;
  if (!p || T.done) return;
  clearTimers();
  T.failed = true; T.locked = true;
  setProgress(p.id, 'failed');
  cg.setAutoShapes([]);
  setStatus('Mirá la solución…', 'info');
  let delay = 0;
  const remaining = p.solution.length - T.idx;
  for (let k = 0; k < remaining; k++) {
    delay += 650;
    later(delay, () => { playUci(p.solution[T.idx]); T.idx++; if (T.idx >= p.solution.length) { T.done = true; const r = revealText(p); setStatus('Esta era la solución. Queda para repasar.', 'warn'); const box = $('#pc-reveal'); box.hidden = false; box.replaceChildren(h('b', { text: 'Línea: ' }), r.line, h('br'), r.played); $('#b-next').focus({ preventScroll: true }); } });
  }
}

function nextPuzzle() {
  const list = filtered();
  if (!list.length) { T.p = null; T.id = null; clearTimers(); renderCard(); renderList(); return; }
  const i = list.findIndex((p) => p.id === T.id);
  const next = list[(i + 1) % list.length];
  if (next.id === T.id && T.done) { setStatus('No hay más puzzles con estos filtros.', 'info'); return; }
  startPuzzle(next.id);
}

function loadFilters() {
  const f = S.settings.f;
  $('#fl-status').value = f.status; $('#fl-kind').value = f.kind; $('#fl-order').value = f.order; $('#fl-missed').checked = f.missed;
}

function openFirst() {
  const list = filtered();
  if (list.length) startPuzzle(list[0].id);
  else { T.p = null; T.id = null; renderCard(); renderList(); ensureBoard(); cg.set({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', lastMove: undefined, check: false }); }
}

/* ───────────── Vistas ───────────── */
function showView(v) {
  S.view = v;
  $('#view-buscar').hidden = v !== 'buscar';
  $('#view-entrenar').hidden = v !== 'entrenar';
  $$('.tab').forEach((t) => { const on = t.dataset.view === v; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); });
  if (v === 'entrenar') {
    ensureBoard();
    if (!T.p || !puzzleById(T.id)) openFirst();
    else { renderList(); cg.redrawAll(); }
  }
  window.scrollTo({ top: 0 });
}

/* ───────────── Inicio ───────────── */
function wire() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#setup').addEventListener('submit', (e) => { e.preventDefault(); startRun(); });
  $('#f-exig').addEventListener('change', () => { $('#exig-help').textContent = EXIG_HELP[$('#f-exig').value]; });
  for (const id of ['fl-status', 'fl-kind', 'fl-order', 'fl-missed']) {
    $('#' + id).addEventListener('change', () => {
      const f = S.settings.f;
      f.status = $('#fl-status').value; f.kind = $('#fl-kind').value; f.order = $('#fl-order').value; f.missed = $('#fl-missed').checked;
      if (id === 'fl-order') T.seed = Math.random();
      persist.settings();
      renderList();
      if (!T.p || !filtered().some((p) => p.id === T.id)) openFirst();
    });
  }
  $('#btn-pgn').addEventListener('click', () => S.puzzles.length && download('puzzles-de-mis-partidas.pgn', 'application/x-chess-pgn', toPgn(S.puzzles)));
  $('#btn-csv').addEventListener('click', () => S.puzzles.length && download('puzzles-de-mis-partidas.csv', 'text/csv', toCsv(S.puzzles)));
  $('#btn-json').addEventListener('click', () => S.puzzles.length && download('puzzles-copia.json', 'application/json', JSON.stringify({ puzzles: S.puzzles, progress: S.progress, seen: [...S.seen] })));
  $('#f-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      const have = new Set(S.puzzles.map((p) => p.id));
      for (const p of d.puzzles || []) if (p && p.id && !have.has(p.id)) S.puzzles.push(p);
      Object.assign(S.progress, d.progress || {});
      for (const s of d.seen || []) S.seen.add(s);
      persist.puzzles(); persist.progress(); persist.seen();
      $('#list-note').textContent = 'Copia restaurada.';
      renderList(); renderStatus();
    } catch (_) { $('#list-note').textContent = 'No pude leer ese archivo.'; }
    e.target.value = '';
  });
  let armed = false;
  $('#btn-clear').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!armed) { armed = true; b.textContent = '¿Seguro? Tocá de nuevo'; setTimeout(() => { armed = false; b.textContent = 'Borrar todo'; }, 3500); return; }
    armed = false; b.textContent = 'Borrar todo';
    S.puzzles = []; S.progress = {}; S.seen = new Set(); T.p = null; T.id = null;
    persist.puzzles(); persist.progress(); persist.seen();
    R = null; renderStatus(); openFirst();
  });
  document.addEventListener('keydown', (e) => {
    if (S.view !== 'entrenar' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    if (e.key === 'n' || e.key === 'N') nextPuzzle();
    else if (e.key === 'h' || e.key === 'H') hint();
    else if (e.key === 's' || e.key === 'S') showSolution();
  });
}

export function boot() {
  document.getElementById('app').innerHTML = SKELETON;
  loadForm(); loadFilters(); wire(); renderStatus(); renderList();
  $('#count').textContent = String(S.puzzles.length);
  showView(S.puzzles.length ? 'entrenar' : 'buscar');
  window.__pmp = { S, T, get R() { return R; }, startPuzzle, showView };
}
