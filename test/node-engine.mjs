import { createRequire } from 'module';
import { UciEngine } from '../src/core.js';
const require = createRequire(import.meta.url);
export async function makeNodeEngine(flavor = 'lite-single') {
  const sf = require('stockfish')(flavor);
  const transport = {
    onLine: null,
    send: (c) => sf.processCommand(c),
    terminate: () => { try { sf.terminate && sf.terminate(); } catch (e) {} },
  };
  sf.listener = (line) => { if (transport.onLine) transport.onLine(line); };
  const eng = new UciEngine(transport);
  await eng.init({ hash: 64 });
  return eng;
}
