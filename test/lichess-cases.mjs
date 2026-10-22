// Casos tomados de lichess-puzzler/generator/test.py (sin los que dependen de tablebases)
import { Generator, cp, mate, applyUci, turnOf, PRESETS } from '../src/core.js';
import { makeNodeEngine } from './node-engine.mjs';

const nodes = +(process.argv[2] || 1200000);
const eng = await makeNodeEngine();
const gen = new Generator(eng, { ...PRESETS.normal, pairNodes: nodes, defNodes: Math.floor(nodes / 3), exigencia: process.argv[3] || 'equilibrada' });
const S = (s) => (s.mate !== undefined ? 'Mate(' + s.mate + ')' : 'Cp(' + s.cp + ')');

const puzzles = [
  ['puzzle_1', '3q1k2/p7/1p2Q2p/5P1K/1P4P1/P7/8/8 w - - 5 57', cp(-1000), 'h5g6', mate(2), 'd8g5 g6h7 g5g7'],
  ['puzzle_3', '1r4k1/5p1p/pr1p2p1/q2Bb3/2P5/P1R3PP/KB1R1Q2/8 b - - 1 31', cp(-4), 'e5c3', mate(3), 'f2f7 g8h8 f7f6 c3f6 b2f6'],
  ['puzzle_5', 'r1b3k1/pp3p1p/2pp2p1/8/2P2q2/2N1r2P/PP2BPP1/R2Q1K1R w - - 0 17', cp(-520), 'd1d2', cp(410), 'e3h3 h1h3 f4d2'],
  ['puzzle_9', '7k/p3r1bP/1p1rp2q/8/2PBB3/4P3/P3KQ2/6R1 b - - 0 38', cp(-110), 'e6e5', mate(2), 'f2f8 g7f8 g1g8'],
  ['puzzle_10', '5rk1/pp3p2/1q1R3p/6p1/5pBb/2P4P/PPQ2PP1/3Rr1K1 w - - 6 26', cp(-450), 'g1h2', mate(2), 'h4g3 f2g3 b6g1'],
  ['puzzle_16', 'kr6/p5pp/Q4np1/3p4/6P1/2P1qP2/PK4P1/3R3R w - - 1 26', cp(-30), 'b2a1', mate(1), 'e3c3'],
];
const nots = [
  ['not_1', 'r2q1rk1/1pp2pp1/p4n1p/b1pP4/4PB2/P3RQ2/1P3PPP/RN4K1 w - - 1 17', cp(-230), 'b1c3', cp(160)],
  ['not_2', '5b1r/kpQ2ppp/4p3/4P3/1P4q1/8/P3N3/1nK2B2 b - - 0 26', cp(-1520), 'b1a3', cp(0)],
  ['not_4', 'r2qk2r/p1p1bppp/1p1ppn2/8/2PP1B2/3Q1N2/PP3PPP/3RR1K1 b kq - 6 12', cp(-110), 'h7h6', cp(150)],
  ['not_5', '4Rb2/N4k1p/8/5pp1/1n2p2P/4P1K1/3P4/8 w - - 1 47', cp(-40), 'e8c8', cp(610)],
  ['not_6', '5r1k/1Q3p2/5q1p/8/2P4p/1P4P1/P4P2/R4RK1 w - - 0 29', cp(-1020), 'g3h4', cp(0)],
  ['not_7', 'rnb1k1nr/ppp2p1p/3p1qp1/2b1p3/2B1P3/2NP1Q2/PPP2PPP/R1B1K1NR b KQkq - 1 6', cp(-50), 'c8g4', cp(420)],
  ['not_8', 'r1bq1rk1/pp1nbppp/4p3/3pP3/8/1P1B4/PBP2PPP/RN1Q1RK1 w - - 1 11', cp(-40), 'd3h7', cp(380)],
  ['not_9', '5k2/5ppp/2r1p3/1p6/1b1R4/p1n1P1P1/B4PKP/1N6 w - - 2 34', cp(0), 'b1c3', cp(520)],
  ['not_10', '2Qr3k/p2P2p1/2p1n3/4n1p/8/4q1P1/PP2P2P/R4R1K w - - 0 33'.replace('4n1p/8','4n1p1/8'), cp(100), 'c8d8', cp(500)],
  ['not_11', '2kr3r/ppp2pp1/1b6/1P2p3/4P3/P2B2P1/2P2PP1/R4RK1 w - - 0 18', cp(20), 'f1d1', mate(4)],
  ['not_13', '8/5p1k/4p1p1/4Q3/3Pp1Kp/4P2P/5qP1/8 w - - 2 44', cp(-6360), 'e5e4', mate(1)],
  ['not_14', '3R4/1Q2nk2/4p2p/4n3/BP3ppP/P7/5PP1/2r3K1 w - - 2 39', cp(-1000), 'g1h2', mate(4)],
  ['not_15', '3r4/8/2p2n2/7k/P1P4p/1P6/2K5/6R1 w - - 0 43', cp(-1000), 'b3b4', mate(4)],
  ['not_16', '8/Pkp3pp/8/4p3/1P2b3/4K3/1P3r1P/R7 b - - 1 30', cp(0), 'f2f3', cp(5000)],
];
async function run(fen, prev, move, score) {
  const after = applyUci(fen, move).fen;
  const winner = turnOf(after);
  return gen.analysePosition({ fenAfter: after, winner, prev, score, tier: 10, rep: new Map() });
}
let ok = 0, bad = 0;
for (const [name, fen, prev, move, score, exp] of puzzles) {
  const t0 = Date.now();
  const r = await run(fen, prev, move, score);
  const got = r.puzzle ? r.puzzle.moves.join(' ') : '(no puzzle)';
  const pass = got === exp; pass ? ok++ : bad++;
  console.log((pass ? 'OK  ' : 'DIFF'), name, '| got:', got, '| exp:', exp, '|', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
for (const [name, fen, prev, move, score] of nots) {
  const t0 = Date.now();
  const r = await run(fen, prev, move, score);
  const pass = !r.puzzle; pass ? ok++ : bad++;
  console.log((pass ? 'OK  ' : 'DIFF'), name, '| puzzle?', r.puzzle ? r.puzzle.moves.join(' ') : 'no', '|', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
console.log(`\n${ok} coinciden, ${bad} difieren  (pairNodes=${nodes})`);
eng.terminate();
process.exit(0);
