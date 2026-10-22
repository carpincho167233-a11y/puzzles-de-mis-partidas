# Puzzles de mis partidas

Una página que convierte tus partidas de **Lichess** y **Chess.com** en puzzles. Ponés tus usuarios, elegís el ritmo (bullet, blitz, rápidas, clásicas) y Stockfish busca los momentos en los que había una jugada ganadora. También acepta un archivo PGN propio.

Todo corre en tu navegador. La página solo consulta las APIs públicas de Lichess y Chess.com para bajar tus partidas. Tus usuarios, tus partidas y tus puzzles se guardan únicamente en el almacenamiento local de tu navegador; este repositorio no contiene nada personal.

## Cómo funciona

La lógica de selección es un port a JavaScript del generador de puzzles de Lichess ([ornicar/lichess-puzzler](https://github.com/ornicar/lichess-puzzler), `generator/generator.py`): detecta el error por el salto en la evaluación, exige que la mejor jugada sea única y sigue la línea mientras lo siga siendo. Diferencias: no usa tablebases, puede sacar varios puzzles por partida y ofrece tres niveles de exigencia.

- `src/core.js`: puntajes, motor UCI y generador de puzzles.
- `src/sources.js`: descarga y lectura de partidas (Lichess, Chess.com, PGN).
- `src/app.js`: interfaz y entrenador.
- `src/engine-browser.js`: Stockfish 19 (lite, un hilo) embebido en un Worker.

Las pruebas reproducen los casos de `generator/test.py` del proyecto original (los que no dependen de tablebases).

## Para construir el archivo

```
npm install
npm run build   # genera index.html, un único archivo con todo embebido
npm test        # casos de prueba del generador de Lichess (tarda unos minutos)
```

## Licencias

El proyecto se distribuye bajo **AGPL-3.0** (ver `LICENSE`), porque deriva del generador de Lichess. Incluye:

- [Stockfish.js](https://github.com/nmrugg/stockfish.js) / [Stockfish](https://github.com/official-stockfish/Stockfish): GPL-3.0.
- [chessground](https://github.com/lichess-org/chessground): GPL-3.0, con las piezas cburnett.
- [chess.js](https://github.com/jhlywa/chess.js): BSD-2-Clause.
- [lichess-puzzler](https://github.com/ornicar/lichess-puzzler): AGPL-3.0.
