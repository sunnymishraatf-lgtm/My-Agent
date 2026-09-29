/* NEUTRON Games — arcade: 18 games, all offline-capable.
 * Solo games run with no connection after page load. "2p" modes are
 * same-device multiplayer (pass-and-play / split controls).
 */
(function (root) {
  "use strict";
  var NG = root.NeutronGames;
  if (!NG) return;
  var api = NG.api();

  var LOGIC = {}; // pure helpers exposed for tests

  /* ---------- shared bits ---------- */

  function swipe(elm, onDir) {
    var x0 = 0, y0 = 0;
    function ts(e) {
      var t = e.changedTouches[0];
      x0 = t.clientX; y0 = t.clientY;
    }
    function te(e) {
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
      onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U"));
    }
    elm.addEventListener("touchstart", ts, { passive: true });
    elm.addEventListener("touchend", te, { passive: true });
    return function () {
      elm.removeEventListener("touchstart", ts);
      elm.removeEventListener("touchend", te);
    };
  }

  function gameOver(stage, title, sub, onRetry) {
    return api.overlay(stage,
      "<h2>" + title + "</h2><p>" + sub + "</p>",
      [{ label: "Play again", onClick: onRetry },
       { label: "All games", onClick: function () { NG.renderGames(stage.closest(".games-wrap").parentNode || document.body); } }]);
  }

  /* ================= SNAKE ================= */

  function playSnake(stage, mode) {
    var N = 20, CELL = 20;
    var C = api.canvas(N * CELL, N * CELL);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();
    var snake = [{ x: 10, y: 10 }], dir = { x: 1, y: 0 }, pend = { x: 1, y: 0 };
    var food = null, score = 0, acc = 0, step = 0.14, dead = false;

    function place() {
      while (true) {
        var f = { x: (Math.random() * N) | 0, y: (Math.random() * N) | 0 };
        if (!snake.some(function (s) { return s.x === f.x && s.y === f.y; })) { food = f; return; }
      }
    }
    place();
    st.set("Score: <b>0</b> · arrows / WASD / swipe");

    var unswipe = swipe(C.cv, function (d) {
      if (d === "U") pend = { x: 0, y: -1 };
      if (d === "D") pend = { x: 0, y: 1 };
      if (d === "L") pend = { x: -1, y: 0 };
      if (d === "R") pend = { x: 1, y: 0 };
    });

    function die() {
      dead = true;
      api.beep(160, 0.3, "sawtooth");
      gameOver(stage, "Game over 🐍", "Score: <b>" + score + "</b>", function () {
        NG.openGame(stage.closest(".games-wrap").parentNode, "snake", "solo");
      });
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      if (k.isDown("arrowup") || k.isDown("w")) pend = { x: 0, y: -1 };
      if (k.isDown("arrowdown") || k.isDown("s")) pend = { x: 0, y: 1 };
      if (k.isDown("arrowleft") || k.isDown("a")) pend = { x: -1, y: 0 };
      if (k.isDown("arrowright") || k.isDown("d")) pend = { x: 1, y: 0 };
      if (!(pend.x === -dir.x && pend.y === -dir.y)) dir = pend;
      acc += dt;
      if (acc >= step) {
        acc = 0;
        var h = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
        if (h.x < 0 || h.y < 0 || h.x >= N || h.y >= N ||
            snake.some(function (s) { return s.x === h.x && s.y === h.y; })) { die(); return; }
        snake.unshift(h);
        if (h.x === food.x && h.y === food.y) {
          score += 10;
          step = Math.max(0.07, step - 0.003);
          st.set("Score: <b>" + score + "</b> · arrows / WASD / swipe");
          api.beep(700, 0.06);
          place();
        } else snake.pop();
      }
      var T = api.theme(), ctx = C.ctx;
      ctx.fillStyle = T.bgSoft; ctx.fillRect(0, 0, C.W, C.H);
      ctx.fillStyle = "#e04444";
      ctx.fillRect(food.x * CELL + 3, food.y * CELL + 3, CELL - 6, CELL - 6);
      snake.forEach(function (s, i) {
        ctx.fillStyle = i === 0 ? T.primary : T.green;
        ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
      });
    });

    return function () { stop(); k.detach(); unswipe(); };
  }
  NG.reg({ id: "snake", name: "Snake", icon: "🐍", modes: ["solo"], start: playSnake });

  /* ================= TETRIS ================= */

  var TET = {
    shapes: {
      I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
      O: [[1,1],[1,1]],
      T: [[0,1,0],[1,1,1],[0,0,0]],
      S: [[0,1,1],[1,1,0],[0,0,0]],
      Z: [[1,1,0],[0,1,1],[0,0,0]],
      J: [[1,0,0],[1,1,1],[0,0,0]],
      L: [[0,0,1],[1,1,1],[0,0,0]],
    },
    colors: { I: "#22d3ee", O: "#facc15", T: "#c084fc", S: "#4ade80", Z: "#f87171", J: "#60a5fa", L: "#fb923c" },
    rotate: function (m) {
      var n = m.length, out = [];
      for (var i = 0; i < n; i++) { out.push([]); for (var j = 0; j < n; j++) out[i].push(m[n - 1 - j][i]); }
      return out;
    },
  };
  LOGIC.tetrisRotate = TET.rotate;

  function playTetris(stage, mode) {
    var COLS = 10, ROWS = 20, CELL = 20;
    var C = api.canvas(COLS * CELL, ROWS * CELL);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();
    var grid = [];
    for (var i = 0; i < ROWS; i++) grid.push(new Array(COLS).fill(""));
    var keys = Object.keys(TET.shapes);
    var cur = null, score = 0, lines = 0, acc = 0, speed = 0.7, dead = false;

    function spawn() {
      var t = keys[(Math.random() * keys.length) | 0];
      cur = { m: TET.shapes[t], t: t, x: 3, y: 0 };
      if (collide(cur.m, cur.x, cur.y)) { die(); }
    }
    function collide(m, x, y) {
      for (var r = 0; r < m.length; r++) for (var c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        var gx = x + c, gy = y + r;
        if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
        if (gy >= 0 && grid[gy][gx]) return true;
      }
      return false;
    }
    function lock() {
      cur.m.forEach(function (row, r) { row.forEach(function (v, c) {
        if (v && cur.y + r >= 0) grid[cur.y + r][cur.x + c] = cur.t;
      }); });
      var cleared = 0;
      for (var r = ROWS - 1; r >= 0; r--) {
        if (grid[r].every(function (v) { return v; })) {
          grid.splice(r, 1); grid.unshift(new Array(COLS).fill(""));
          cleared++; r++;
        }
      }
      if (cleared) {
        lines += cleared;
        score += [0, 40, 100, 300, 1200][cleared] * (1 + ((lines / 10) | 0));
        speed = Math.max(0.12, 0.7 - ((lines / 10) | 0) * 0.06);
        api.beep(600 + cleared * 120, 0.1);
      }
      st.set("Score: <b>" + score + "</b> · Lines: <b>" + lines + "</b>");
      spawn();
    }
    function die() {
      dead = true;
      api.beep(160, 0.3, "sawtooth");
      gameOver(stage, "Game over 🧱", "Score: <b>" + score + "</b> · Lines: <b>" + lines + "</b>", function () {
        NG.openGame(stage.closest(".games-wrap").parentNode, "tetris", "solo");
      });
    }
    function tryRotate() {
      var m2 = TET.rotate(cur.m);
      if (!collide(m2, cur.x, cur.y)) cur.m = m2;
      else if (!collide(m2, cur.x - 1, cur.y)) { cur.m = m2; cur.x--; }
      else if (!collide(m2, cur.x + 1, cur.y)) { cur.m = m2; cur.x++; }
    }
    st.set("Score: <b>0</b> · ← → move · ↑ rotate · ↓ soft drop · space hard drop");
    spawn();

    var stop = api.loop(function (dt) {
      if (dead) return;
      if (k.pressed("arrowleft") || k.pressed("a")) { if (!collide(cur.m, cur.x - 1, cur.y)) cur.x--; }
      if (k.pressed("arrowright") || k.pressed("d")) { if (!collide(cur.m, cur.x + 1, cur.y)) cur.x++; }
      if (k.pressed("arrowup") || k.pressed("w")) tryRotate();
      if (k.isDown("arrowdown") || k.isDown("s")) acc += dt * 8;
      if (k.pressed(" ")) {
        while (!collide(cur.m, cur.x, cur.y + 1)) cur.y++;
        lock(); k.clearPressed(); return;
      }
      acc += dt;
      if (acc >= speed) { acc = 0; if (!collide(cur.m, cur.x, cur.y + 1)) cur.y++; else lock(); }
      k.clearPressed();
      var T = api.theme(), ctx = C.ctx;
      ctx.fillStyle = T.bgSoft; ctx.fillRect(0, 0, C.W, C.H);
      for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
        if (grid[r][c]) {
          ctx.fillStyle = TET.colors[grid[r][c]];
          ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
        }
      }
      if (cur) cur.m.forEach(function (row, r2) { row.forEach(function (v, c2) {
        if (v && cur.y + r2 >= 0) {
          ctx.fillStyle = TET.colors[cur.t];
          ctx.fillRect((cur.x + c2) * CELL + 1, (cur.y + r2) * CELL + 1, CELL - 2, CELL - 2);
        }
      }); });
    });

    // touch: tap left/right half to move, swipe down hard drop
    var unswipe = swipe(C.cv, function (d) {
      if (dead || !cur) return;
      if (d === "L" && !collide(cur.m, cur.x - 1, cur.y)) cur.x--;
      if (d === "R" && !collide(cur.m, cur.x + 1, cur.y)) cur.x++;
      if (d === "U") tryRotate();
      if (d === "D") { while (!collide(cur.m, cur.x, cur.y + 1)) cur.y++; lock(); }
    });

    return function () { stop(); k.detach(); unswipe(); };
  }
  NG.reg({ id: "tetris", name: "Tetris", icon: "🧱", modes: ["solo"], start: playTetris });

  /* ================= 2048 ================= */

  var G2048 = {
    slide: function (row) {
      // slide a 4-array left, merging. Returns {row, gained}.
      var t = row.filter(function (v) { return v; }), gained = 0;
      for (var i = 0; i < t.length - 1; i++) {
        if (t[i] === t[i + 1]) { t[i] *= 2; gained += t[i]; t.splice(i + 1, 1); }
      }
      while (t.length < 4) t.push(0);
      return { row: t, gained: gained };
    },
    move: function (g, dir) {
      // dir: L R U D. Returns {grid, gained, moved}.
      var ng = g.map(function (r) { return r.slice(); }), gained = 0, moved = false;
      function proc(r) {
        var res = G2048.slide(r);
        gained += res.gained;
        return res.row;
      }
      if (dir === "L") ng = ng.map(proc);
      else if (dir === "R") ng = ng.map(function (r) { return proc(r.reverse()).reverse(); });
      else {
        for (var c = 0; c < 4; c++) {
          var col = [ng[0][c], ng[1][c], ng[2][c], ng[3][c]];
          if (dir === "D") col = col.reverse();
          var res = proc(dir === "D" ? col : col);
          var out = dir === "D" ? res.reverse() : res;
          for (var r = 0; r < 4; r++) ng[r][c] = out[r];
        }
      }
      for (var r2 = 0; r2 < 4; r2++) for (var c2 = 0; c2 < 4; c2++)
        if (ng[r2][c2] !== g[r2][c2]) moved = true;
      return { grid: ng, gained: gained, moved: moved };
    },
    canMove: function (g) {
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
        if (!g[r][c]) return true;
        if (c < 3 && g[r][c] === g[r][c + 1]) return true;
        if (r < 3 && g[r][c] === g[r + 1][c]) return true;
      }
      return false;
    },
  };
  LOGIC.g2048 = G2048;

  function play2048(stage, mode) {
    var wrap = api.el("div", "n2048");
    stage.appendChild(wrap);
    var st = api.status(stage);
    var k = api.keys();
    var g = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    var score = 0, over = false, won = false;

    function addTile() {
      var empty = [];
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) if (!g[r][c]) empty.push([r, c]);
      if (!empty.length) return;
      var p = empty[(Math.random() * empty.length) | 0];
      g[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    }
    function render() {
      wrap.innerHTML = "";
      g.forEach(function (row) {
        row.forEach(function (v) {
          var t = api.el("div", "t2048 t" + v, v || "");
          wrap.appendChild(t);
        });
      });
      st.set("Score: <b>" + score + "</b>" + (won ? " · 🎉 2048!" : ""));
    }
    function doMove(dir) {
      if (over) return;
      var res = G2048.move(g, dir);
      if (!res.moved) return;
      g = res.grid; score += res.gained;
      if (!won && g.some(function (r) { return r.indexOf(2048) !== -1; })) { won = true; api.beep(880, 0.2); }
      else api.beep(440, 0.04);
      addTile();
      render();
      if (!G2048.canMove(g)) {
        over = true;
        api.beep(160, 0.3, "sawtooth");
        gameOver(stage, "Game over 🔢", "Score: <b>" + score + "</b>", function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "g2048", "solo");
        });
      }
    }
    addTile(); addTile(); render();
    st.set("Score: <b>0</b> · arrows / WASD / swipe");

    var kd = function (e) {
      var k2 = e.key.toLowerCase(), d = null;
      if (k2 === "arrowup" || k2 === "w") d = "U";
      else if (k2 === "arrowdown" || k2 === "s") d = "D";
      else if (k2 === "arrowleft" || k2 === "a") d = "L";
      else if (k2 === "arrowright" || k2 === "d") d = "R";
      if (d) { e.preventDefault(); doMove(d); }
    };
    window.addEventListener("keydown", kd);
    var unswipe = swipe(wrap, doMove);

    return function () { window.removeEventListener("keydown", kd); k.detach(); unswipe(); };
  }
  NG.reg({ id: "g2048", name: "2048", icon: "🔢", modes: ["solo"], start: play2048 });

  /* ================= MINESWEEPER ================= */

  var MS = {
    build: function (rows, cols, mines, safeR, safeC) {
      var g = [];
      for (var r = 0; r < rows; r++) g.push(new Array(cols).fill(0));
      var placed = 0, guard = 0;
      while (placed < mines && guard++ < 10000) {
        var r = (Math.random() * rows) | 0, c = (Math.random() * cols) | 0;
        if (g[r][c] === -1) continue;
        if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;
        g[r][c] = -1; placed++;
      }
      for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
        if (g[r2][c2] === -1) continue;
        var n = 0;
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          var rr = r2 + dr, cc = c2 + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && g[rr][cc] === -1) n++;
        }
        g[r2][c2] = n;
      }
      return g;
    },
  };
  LOGIC.minesweeper = MS;

  function playMinesweeper(stage, mode) {
    var ROWS = 9, COLS = 9, MINES = 10;
    var ui = api.el("div", "board-wrap");
    var st = api.el("div", "game-status");
    ui.appendChild(st);
    var grid = api.el("div", "ms-grid");
    grid.style.gridTemplateColumns = "repeat(" + COLS + ", 1fr)";
    ui.appendChild(grid);
    stage.appendChild(ui);

    var g = null, rev = null, flag = null, over = false, started = false, nRev = 0;

    function newGame() {
      g = null; started = false; over = false; nRev = 0;
      rev = []; flag = [];
      for (var r = 0; r < ROWS; r++) { rev.push(new Array(COLS).fill(false)); flag.push(new Array(COLS).fill(false)); }
      paint();
      st.innerHTML = "💣 <b>" + MINES + "</b> · tap to reveal, long-press to flag";
    }
    function paint() {
      grid.innerHTML = "";
      var nf = 0;
      for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
        (function (r, c) {
          var b = api.el("button", "ms-cell");
          b.type = "button";
          if (flag[r][c]) { b.textContent = "🚩"; b.classList.add("flag"); nf++; }
          else if (rev[r][c] && g) {
            b.classList.add("open");
            var v = g[r][c];
            if (v === -1) { b.textContent = "💥"; b.classList.add("boom"); }
            else if (v) { b.textContent = v; b.classList.add("n" + v); }
          }
          var lt = null;
          b.addEventListener("touchstart", function () {
            lt = setTimeout(function () { toggleFlag(r, c); lt = null; }, 450);
          }, { passive: true });
          b.addEventListener("touchend", function () { if (lt) { clearTimeout(lt); lt = null; reveal(r, c); } });
          b.addEventListener("contextmenu", function (e) { e.preventDefault(); toggleFlag(r, c); });
          b.onclick = function (e) { if (e.detail) reveal(r, c); };
          grid.appendChild(b);
        })(r, c);
      }
      st.innerHTML = "💣 <b>" + (MINES - nf) + "</b> left";
    }
    function toggleFlag(r, c) {
      if (over || rev[r][c]) return;
      flag[r][c] = !flag[r][c];
      api.beep(500, 0.04);
      paint();
    }
    function reveal(r, c) {
      if (over || flag[r][c] || rev[r][c]) return;
      if (!started) { g = MS.build(ROWS, COLS, MINES, r, c); started = true; }
      if (g[r][c] === -1) {
        over = true;
        for (var i = 0; i < ROWS; i++) for (var j = 0; j < COLS; j++) if (g[i][j] === -1) rev[i][j] = true;
        api.beep(150, 0.4, "sawtooth");
        paint();
        gameOver(stage, "Boom! 💥", "You hit a mine.", function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "minesweeper", "solo");
        });
        return;
      }
      flood(r, c);
      api.beep(440, 0.03);
      paint();
      if (nRev === ROWS * COLS - MINES) {
        over = true;
        api.beep(880, 0.2);
        gameOver(stage, "You win! 🏆", "Board cleared with <b>" + MINES + "</b> mines dodged.", function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "minesweeper", "solo");
        });
      }
    }
    function flood(r, c) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || rev[r][c] || flag[r][c]) return;
      rev[r][c] = true; nRev++;
      if (g[r][c] === 0) {
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++)
          if (dr || dc) flood(r + dr, c + dc);
      }
    }
    newGame();
    return function () {};
  }
  NG.reg({ id: "minesweeper", name: "Minesweeper", icon: "💣", modes: ["solo"], start: playMinesweeper });

  /* ================= BREAKOUT ================= */

  function playBreakout(stage, mode) {
    var W = 400, H = 480;
    var C = api.canvas(W, H);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();
    var paddle = { x: W / 2 - 40, w: 80 };
    var ball = { x: W / 2, y: H - 60, vx: 2.4, vy: -3.2, r: 7 };
    var bricks = [], score = 0, lives = 3, dead = false;

    function buildBricks() {
      bricks = [];
      var cols = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#60a5fa"];
      for (var r = 0; r < 5; r++) for (var c = 0; c < 8; c++)
        bricks.push({ x: 8 + c * 48, y: 40 + r * 26, w: 44, h: 20, col: cols[r], on: true });
    }
    buildBricks();
    st.set("Lives: <b>3</b> · Score: <b>0</b> · ← → or drag");

    function pointer(e) {
      var rect = C.cv.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      paddle.x = Math.max(0, Math.min(W - paddle.w, x / rect.width * W - paddle.w / 2));
    }
    C.cv.addEventListener("mousemove", pointer);
    C.cv.addEventListener("touchmove", pointer, { passive: true });

    function reset() {
      ball = { x: paddle.x + paddle.w / 2, y: H - 60, vx: 2.4 * (Math.random() < 0.5 ? -1 : 1), vy: -3.2, r: 7 };
    }
    function die() {
      lives--;
      api.beep(150, 0.25, "sawtooth");
      if (lives <= 0) {
        dead = true;
        gameOver(stage, "Game over 🧱", "Score: <b>" + score + "</b>", function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "breakout", "solo");
        });
      } else { st.set("Lives: <b>" + lives + "</b> · Score: <b>" + score + "</b>"); reset(); }
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      if (k.isDown("arrowleft") || k.isDown("a")) paddle.x = Math.max(0, paddle.x - 320 * dt);
      if (k.isDown("arrowright") || k.isDown("d")) paddle.x = Math.min(W - paddle.w, paddle.x + 320 * dt);
      ball.x += ball.vx; ball.y += ball.vy;
      if (ball.x < ball.r || ball.x > W - ball.r) { ball.vx *= -1; api.beep(300, 0.03); }
      if (ball.y < ball.r) { ball.vy *= -1; api.beep(300, 0.03); }
      if (ball.y > H + 20) { die(); return; }
      if (ball.vy > 0 && ball.y + ball.r > H - 24 && ball.y + ball.r < H - 8 &&
          ball.x > paddle.x - ball.r && ball.x < paddle.x + paddle.w + ball.r) {
        var rel = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        ball.vx = rel * 4; ball.vy = -Math.abs(ball.vy);
        api.beep(500, 0.04);
      }
      for (var i = 0; i < bricks.length; i++) {
        var br = bricks[i];
        if (!br.on) continue;
        if (ball.x > br.x - ball.r && ball.x < br.x + br.w + ball.r &&
            ball.y > br.y - ball.r && ball.y < br.y + br.h + ball.r) {
          br.on = false; ball.vy *= -1;
          score += 10;
          st.set("Lives: <b>" + lives + "</b> · Score: <b>" + score + "</b>");
          api.beep(650, 0.05);
          break;
        }
      }
      if (!bricks.some(function (b2) { return b2.on; })) {
        buildBricks(); reset();
        ball.vx *= 1.15; ball.vy *= 1.15;
        api.beep(880, 0.15);
      }
      var T = api.theme(), ctx = C.ctx;
      ctx.fillStyle = T.bgSoft; ctx.fillRect(0, 0, W, H);
      bricks.forEach(function (br) {
        if (!br.on) return;
        ctx.fillStyle = br.col;
        ctx.fillRect(br.x, br.y, br.w, br.h);
      });
      ctx.fillStyle = T.primary;
      ctx.fillRect(paddle.x, H - 18, paddle.w, 10);
      ctx.fillStyle = T.text;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, 7); ctx.fill();
    });

    return function () { stop(); k.detach(); };
  }
  NG.reg({ id: "breakout", name: "Breakout", icon: "🧱", modes: ["solo"], start: playBreakout });

  /* ================= PONG ================= */

  function playPong(stage, mode) {
    var W = 400, H = 300;
    var C = api.canvas(W, H);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();
    var p1 = { y: H / 2 - 30, s: 0 }, p2 = { y: H / 2 - 30, s: 0 };
    var ball, dead = false, serveT = 0;
    var is2p = mode === "2p";

    function serve() {
      ball = { x: W / 2, y: H / 2, vx: (Math.random() < 0.5 ? -1 : 1) * 3, vy: (Math.random() * 4 - 2), r: 6 };
      serveT = 0.8;
    }
    serve();
    st.set(is2p ? "P1: <b>W/S</b> · P2: <b>↑/↓</b> · first to 7" : "You: <b>↑/↓</b> or drag · first to 7");

    function pointer(e) {
      if (is2p) return;
      var rect = C.cv.getBoundingClientRect();
      var y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      p1.y = Math.max(0, Math.min(H - 60, y / rect.height * H - 30));
    }
    C.cv.addEventListener("mousemove", pointer);
    C.cv.addEventListener("touchmove", pointer, { passive: true });

    function point(winner) {
      if (winner === 1) p1.s++; else p2.s++;
      api.beep(winner === 1 ? 700 : 350, 0.12);
      st.set("🔵 <b>" + p1.s + "</b> · <b>" + p2.s + "</b> 🔴");
      if (p1.s >= 7 || p2.s >= 7) {
        dead = true;
        var msg = is2p ? (p1.s >= 7 ? "Player 1 wins! 🏆" : "Player 2 wins! 🏆")
          : (p1.s >= 7 ? "You win! 🏆" : "AI wins!");
        gameOver(stage, "Game over 🏓", msg, function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "pong", mode);
        });
        return;
      }
      serve();
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      if (is2p) {
        if (k.isDown("w")) p1.y = Math.max(0, p1.y - 300 * dt);
        if (k.isDown("s")) p1.y = Math.min(H - 60, p1.y + 300 * dt);
      } else {
        // AI for p2, player p1
        var target = ball.vx > 0 ? ball.y - 30 : H / 2 - 30;
        p2.y += Math.max(-260 * dt, Math.min(260 * dt, target - p2.y));
      }
      if (k.isDown("arrowup")) p2.y = Math.max(0, p2.y - 300 * dt);
      if (k.isDown("arrowdown")) p2.y = Math.min(H - 60, p2.y + 300 * dt);
      if (!is2p) {
        if (k.isDown("arrowup")) p1.y = Math.max(0, p1.y - 300 * dt);
        if (k.isDown("arrowdown")) p1.y = Math.min(H - 60, p1.y + 300 * dt);
      }
      if (serveT > 0) { serveT -= dt; }
      else {
        ball.x += ball.vx; ball.y += ball.vy;
        if (ball.y < ball.r || ball.y > H - ball.r) { ball.vy *= -1; api.beep(280, 0.03); }
        // paddles
        if (ball.vx < 0 && ball.x - ball.r < 14 && ball.x > 4 && ball.y > p1.y - 4 && ball.y < p1.y + 64) {
          ball.vx = Math.abs(ball.vx) * 1.05;
          ball.vy += (ball.y - (p1.y + 30)) * 0.06;
          api.beep(500, 0.04);
        }
        if (ball.vx > 0 && ball.x + ball.r > W - 14 && ball.x < W - 4 && ball.y > p2.y - 4 && ball.y < p2.y + 64) {
          ball.vx = -Math.abs(ball.vx) * 1.05;
          ball.vy += (ball.y - (p2.y + 30)) * 0.06;
          api.beep(500, 0.04);
        }
        if (ball.x < -20) point(2);
        if (ball.x > W + 20) point(1);
      }
      var T = api.theme(), ctx = C.ctx;
      ctx.fillStyle = T.bgSoft; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = T.border; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#60a5fa"; ctx.fillRect(8, p1.y, 6, 60);
      ctx.fillStyle = "#f87171"; ctx.fillRect(W - 14, p2.y, 6, 60);
      ctx.fillStyle = T.text;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, 7); ctx.fill();
    });

    return function () { stop(); k.detach(); };
  }
  NG.reg({ id: "pong", name: "Pong", icon: "🏓", modes: ["solo", "2p"], start: playPong });

  /* ================= AIR HOCKEY ================= */

  function playAirHockey(stage, mode) {
    var W = 360, H = 480;
    var C = api.canvas(W, H);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var is2p = mode === "2p";
    var m1 = { x: W / 2, y: H - 90, s: 0 }, m2 = { x: W / 2, y: 90, s: 0 };
    var puck = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 10 };
    var dead = false, touches = {};

    function serve(dir) {
      puck.x = W / 2; puck.y = H / 2;
      puck.vx = (Math.random() * 2 - 1); puck.vy = 3 * dir;
    }
    serve(1);
    st.set(is2p ? "Drag your mallet · first to 5" : "Drag your mallet (bottom) · first to 5");

    function onDown(e) {
      var rect = C.cv.getBoundingClientRect();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var x = (t.clientX - rect.left) / rect.width * W;
        var y = (t.clientY - rect.top) / rect.height * H;
        touches[t.identifier] = y > H / 2 ? 1 : 2;
        moveMallet(touches[t.identifier], x, y);
      }
      e.preventDefault();
    }
    function onMove(e) {
      var rect = C.cv.getBoundingClientRect();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i], who = touches[t.identifier];
        if (!who || (!is2p && who === 2)) continue;
        var x = (t.clientX - rect.left) / rect.width * W;
        var y = (t.clientY - rect.top) / rect.height * H;
        moveMallet(who, x, y);
      }
      e.preventDefault();
    }
    function onUp(e) {
      for (var i = 0; i < e.changedTouches.length; i++) delete touches[e.changedTouches[i].identifier];
    }
    function moveMallet(who, x, y) {
      var m = who === 1 ? m1 : m2;
      m.x = Math.max(24, Math.min(W - 24, x));
      if (who === 1) m.y = Math.max(H / 2 + 24, Math.min(H - 24, y));
      else m.y = Math.max(24, Math.min(H / 2 - 24, y));
    }
    C.cv.addEventListener("touchstart", onDown, { passive: false });
    C.cv.addEventListener("touchmove", onMove, { passive: false });
    C.cv.addEventListener("touchend", onUp);
    C.cv.addEventListener("touchcancel", onUp);

    function point(w) {
      if (w === 1) m1.s++; else m2.s++;
      api.beep(w === 1 ? 700 : 350, 0.15);
      if (m1.s >= 5 || m2.s >= 5) {
        dead = true;
        var msg = is2p ? (m1.s >= 5 ? "Player 1 (bottom) wins! 🏆" : "Player 2 (top) wins! 🏆")
          : (m1.s >= 5 ? "You win! 🏆" : "AI wins!");
        gameOver(stage, "Game over 🏒", msg, function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "airhockey", mode);
        });
        return;
      }
      serve(w === 1 ? -1 : 1);
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      if (!is2p) {
        // simple AI for top mallet
        var tx = puck.vy < 0 ? puck.x : W / 2;
        m2.x += Math.max(-220 * dt, Math.min(220 * dt, tx - m2.x));
        m2.y += Math.max(-160 * dt, Math.min(160 * dt, (puck.vy < 0 ? Math.max(40, puck.y - 30) : 90) - m2.y));
      }
      // puck physics
      puck.x += puck.vx * 60 * dt; puck.y += puck.vy * 60 * dt;
      puck.vx *= 0.995; puck.vy *= 0.995;
      if (puck.x < puck.r) { puck.x = puck.r; puck.vx = Math.abs(puck.vx); }
      if (puck.x > W - puck.r) { puck.x = W - puck.r; puck.vx = -Math.abs(puck.vx); }
      // goals (center gap)
      var goalW = 90;
      if (puck.y < puck.r) {
        if (Math.abs(puck.x - W / 2) < goalW / 2) { point(1); return; }
        puck.y = puck.r; puck.vy = Math.abs(puck.vy);
      }
      if (puck.y > H - puck.r) {
        if (Math.abs(puck.x - W / 2) < goalW / 2) { point(2); return; }
        puck.y = H - puck.r; puck.vy = -Math.abs(puck.vy);
      }
      // mallet collisions
      [m1, m2].forEach(function (m) {
        var dx = puck.x - m.x, dy = puck.y - m.y;
        var d = Math.sqrt(dx * dx + dy * dy), min = puck.r + 20;
        if (d < min && d > 0.01) {
          var nx = dx / d, ny = dy / d;
          puck.x = m.x + nx * min; puck.y = m.y + ny * min;
          var sp = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy) + 1.2;
          puck.vx = nx * sp; puck.vy = ny * sp;
          api.beep(520, 0.04);
        }
      });

      var T = api.theme(), ctx = C.ctx;
      ctx.fillStyle = T.bgSoft; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = T.border; ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, W - 8, H - 8);
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 40, 0, 7); ctx.stroke();
      // goals
      ctx.fillStyle = T.bgSoft;
      ctx.fillRect(W / 2 - goalW / 2, 0, goalW, 8);
      ctx.fillRect(W / 2 - goalW / 2, H - 8, goalW, 8);
      ctx.fillStyle = T.green;
      ctx.fillRect(W / 2 - goalW / 2, 0, goalW, 4);
      ctx.fillStyle = T.red;
      ctx.fillRect(W / 2 - goalW / 2, H - 4, goalW, 4);
      // puck + mallets
      ctx.fillStyle = T.text;
      ctx.beginPath(); ctx.arc(puck.x, puck.y, puck.r, 0, 7); ctx.fill();
      ctx.fillStyle = "#60a5fa";
      ctx.beginPath(); ctx.arc(m1.x, m1.y, 20, 0, 7); ctx.fill();
      ctx.fillStyle = "#f87171";
      ctx.beginPath(); ctx.arc(m2.x, m2.y, 20, 0, 7); ctx.fill();
      ctx.fillStyle = T.text;
      ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(m1.s + " : " + m2.s, W / 2, H / 2 + 6);
    });

    return function () {
      stop();
      C.cv.removeEventListener("touchstart", onDown);
      C.cv.removeEventListener("touchmove", onMove);
      C.cv.removeEventListener("touchend", onUp);
      C.cv.removeEventListener("touchcancel", onUp);
    };
  }
  NG.reg({ id: "airhockey", name: "Air Hockey", icon: "🏒", modes: ["solo", "2p"], start: playAirHockey });

  /* ================= MEMORY MATCH ================= */

  function playMemory(stage, mode) {
    var icons = ["🐶","🐱","🦊","🐼","🦁","🐸","🐵","🐷","🐮","🐰","🐨","🐯"];
    var deck = icons.concat(icons);
    for (var i = deck.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0, t = deck[i];
      deck[i] = deck[j]; deck[j] = t;
    }
    var wrap = api.el("div", "mem-grid");
    stage.appendChild(wrap);
    var st = api.status(stage);
    var first = -1, lock = false, found = 0, moves = 0;
    st.set("Moves: <b>0</b> · Pairs: <b>0/12</b>");

    deck.forEach(function (ic, i) {
      var c = api.el("button", "mem-card");
      c.type = "button";
      c.dataset.i = i;
      c.onclick = function () { flip(i, c); };
      wrap.appendChild(c);
    });
    function flip(i, c) {
      if (lock || c.classList.contains("open") || c.classList.contains("done")) return;
      c.textContent = deck[i];
      c.classList.add("open");
      api.beep(500, 0.04);
      if (first === -1) { first = i; return; }
      moves++;
      if (deck[first] === deck[i]) {
        var a = wrap.children[first], b = c;
        setTimeout(function () { a.classList.add("done"); b.classList.add("done"); }, 250);
        found++;
        api.beep(760, 0.1);
        first = -1;
      } else {
        lock = true;
        var f = first, cf = wrap.children[first];
        setTimeout(function () {
          cf.textContent = ""; cf.classList.remove("open");
          c.textContent = ""; c.classList.remove("open");
          lock = false;
        }, 700);
        first = -1;
      }
      st.set("Moves: <b>" + moves + "</b> · Pairs: <b>" + found + "/12</b>");
      if (found === 12) {
        setTimeout(function () {
          gameOver(stage, "You win! 🧠", "All pairs found in <b>" + moves + "</b> moves.", function () {
            NG.openGame(stage.closest(".games-wrap").parentNode, "memory", "solo");
          });
        }, 600);
      }
    }
    return function () {};
  }
  NG.reg({ id: "memory", name: "Memory Match", icon: "🧠", modes: ["solo"], start: playMemory });

  /* ================= SIMON ================= */

  function playSimon(stage, mode) {
    var wrap = api.el("div", "simon-wrap");
    var st = api.el("div", "game-status");
    wrap.appendChild(st);
    var pads = api.el("div", "simon-pads");
    var colors = [["#4ade80", 392], ["#f87171", 311], ["#facc15", 261], ["#60a5fa", 523]];
    var seq = [], idx = 0, accepting = false, score = 0, dead = false;
    colors.forEach(function (cc, i) {
      var p = api.el("button", "simon-pad");
      p.type = "button";
      p.style.background = cc[0];
      p.onclick = function () { press(i); };
      pads.appendChild(p);
    });
    wrap.appendChild(pads);
    stage.appendChild(wrap);

    function flash(i, dur) {
      var p = pads.children[i];
      p.classList.add("lit");
      api.beep(colors[i][1], 0.25, "sine");
      setTimeout(function () { p.classList.remove("lit"); }, dur || 300);
    }
    function next() {
      seq.push((Math.random() * 4) | 0);
      idx = 0; accepting = false;
      st.innerHTML = "Watch… round <b>" + seq.length + "</b>";
      seq.forEach(function (v, k) {
        setTimeout(function () { if (!dead) flash(v); }, 600 + k * 550);
      });
      setTimeout(function () {
        if (!dead) { accepting = true; st.innerHTML = "Your turn! Round <b>" + seq.length + "</b>"; }
      }, 600 + seq.length * 550);
    }
    function press(i) {
      if (!accepting || dead) return;
      flash(i, 180);
      if (i !== seq[idx]) {
        dead = true;
        api.beep(150, 0.4, "sawtooth");
        gameOver(stage, "Wrong! 🔔", "You reached round <b>" + seq.length + "</b>.", function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "simon", "solo");
        });
        return;
      }
      idx++;
      if (idx === seq.length) { score = seq.length; accepting = false; setTimeout(next, 700); }
    }
    st.innerHTML = "Repeat the sequence. <b>Tap to start.</b>";
    pads.onclick = function () { if (!seq.length && !dead) next(); };
    return function () { dead = true; };
  }
  NG.reg({ id: "simon", name: "Simon", icon: "🔔", modes: ["solo"], start: playSimon });

  /* ================= FLAPPY ================= */

  function playFlappy(stage, mode) {
    var W = 360, H = 480;
    var C = api.canvas(W, H);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var bird = { y: H / 2, v: 0, r: 12 };
    var pipes = [], score = 0, dead = false, started = false, t = 0;

    function flap() {
      if (dead) return;
      if (!started) started = true;
      bird.v = -5.2;
      api.beep(600, 0.05, "sine");
    }
    st.set("Tap / space to flap");

    function onTap(e) { e.preventDefault(); flap(); }
    C.cv.addEventListener("touchstart", onTap, { passive: false });
    C.cv.addEventListener("mousedown", onTap);
    var kd = function (e) { if (e.key === " ") { e.preventDefault(); flap(); } };
    window.addEventListener("keydown", kd);

    var stop = api.loop(function (dt) {
      t += dt;
      if (!dead && started) {
        bird.v += 0.32; bird.y += bird.v;
        if (pipes.length === 0 || pipes[pipes.length - 1].x < W - 190) {
          var gap = 130, gy = 120 + Math.random() * (H - 240 - gap);
          pipes.push({ x: W, gy: gy, gap: gap, scored: false });
        }
        for (var i = 0; i < pipes.length; i++) {
          var p = pipes[i];
          p.x -= 2.6;
          if (!p.scored && p.x + 52 < 60) { p.scored = true; score++; api.beep(800, 0.07); st.set("Score: <b>" + score + "</b>"); }
          if (60 + bird.r > p.x && 60 - bird.r < p.x + 52 &&
              (bird.y - bird.r < p.gy || bird.y + bird.r > p.gy + p.gap)) { die(); return; }
        }
        pipes = pipes.filter(function (p2) { return p2.x > -60; });
        if (bird.y > H - bird.r || bird.y < bird.r) { die(); return; }
      }
      var T = api.theme(), ctx = C.ctx;
      // sky
      var sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#7dd3fc"); sky.addColorStop(1, "#e0f2fe");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#4ade80";
      pipes.forEach(function (p) {
        ctx.fillRect(p.x, 0, 52, p.gy);
        ctx.fillRect(p.x, p.gy + p.gap, 52, H - p.gy - p.gap);
        ctx.fillStyle = "#16a34a";
        ctx.fillRect(p.x - 3, p.gy - 18, 58, 18);
        ctx.fillRect(p.x - 3, p.gy + p.gap, 58, 18);
        ctx.fillStyle = "#4ade80";
      });
      // bird
      ctx.save();
      ctx.translate(60, bird.y);
      ctx.rotate(Math.max(-0.4, Math.min(0.6, bird.v * 0.08)));
      ctx.fillStyle = "#facc15";
      ctx.beginPath(); ctx.arc(0, 0, bird.r, 0, 7); ctx.fill();
      ctx.fillStyle = "#f97316";
      ctx.fillRect(8, -3, 10, 6); // beak
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(4, -5, 2.5, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.font = "bold 28px sans-serif"; ctx.textAlign = "center";
      if (!started && !dead) ctx.fillText("Tap to start 🐤", W / 2, H / 2);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 32px sans-serif";
      ctx.fillText(score, W / 2, 50);
    });

    function die() {
      dead = true;
      api.beep(150, 0.35, "sawtooth");
      gameOver(stage, "Game over 🐤", "Score: <b>" + score + "</b>", function () {
        NG.openGame(stage.closest(".games-wrap").parentNode, "flappy", "solo");
      });
    }

    return function () {
      stop();
      C.cv.removeEventListener("touchstart", onTap);
      C.cv.removeEventListener("mousedown", onTap);
      window.removeEventListener("keydown", kd);
    };
  }
  NG.reg({ id: "flappy", name: "Flappy", icon: "🐤", modes: ["solo"], start: playFlappy });

  /* ================= ASTEROIDS ================= */

  function playAsteroids(stage, mode) {
    var W = 400, H = 480;
    var C = api.canvas(W, H);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();
    var ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0 };
    var rocks = [], bullets = [], score = 0, lives = 3, dead = false, cd = 0;

    function spawnRocks(n) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, edge = (Math.random() * 4) | 0;
        var x = edge === 0 ? 0 : edge === 1 ? W : Math.random() * W;
        var y = edge === 2 ? 0 : edge === 3 ? H : Math.random() * H;
        rocks.push({ x: x, y: y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, r: 26 + Math.random() * 14, rot: Math.random() * 7 });
      }
    }
    spawnRocks(5);
    st.set("Lives: <b>3</b> · Score: <b>0</b> · ← → turn · ↑ thrust · space fire");

    function hit() {
      lives--;
      api.beep(140, 0.3, "sawtooth");
      ship.x = W / 2; ship.y = H / 2; ship.vx = 0; ship.vy = 0;
      st.set("Lives: <b>" + lives + "</b> · Score: <b>" + score + "</b>");
      if (lives <= 0) {
        dead = true;
        gameOver(stage, "Game over 🚀", "Score: <b>" + score + "</b>", function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "asteroids", "solo");
        });
      }
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      if (k.isDown("arrowleft") || k.isDown("a")) ship.a -= 4.5 * dt;
      if (k.isDown("arrowright") || k.isDown("d")) ship.a += 4.5 * dt;
      if (k.isDown("arrowup") || k.isDown("w")) {
        ship.vx += Math.cos(ship.a) * 220 * dt;
        ship.vy += Math.sin(ship.a) * 220 * dt;
      }
      cd -= dt;
      if ((k.isDown(" ") || k.isDown("j")) && cd <= 0) {
        cd = 0.22;
        bullets.push({ x: ship.x + Math.cos(ship.a) * 14, y: ship.y + Math.sin(ship.a) * 14,
          vx: Math.cos(ship.a) * 320 + ship.vx, vy: Math.sin(ship.a) * 320 + ship.vy, life: 1.2 });
        api.beep(900, 0.05, "sawtooth");
      }
      ship.x = (ship.x + ship.vx * dt + W) % W;
      ship.y = (ship.y + ship.vy * dt + H) % H;
      ship.vx *= 0.995; ship.vy *= 0.995;

      rocks.forEach(function (r) {
        r.x = (r.x + r.vx * dt + W) % W; r.y = (r.y + r.vy * dt + H) % H;
        var dx = r.x - ship.x, dy = r.y - ship.y;
        if (dx * dx + dy * dy < (r.r + 8) * (r.r + 8)) { hit(); r.x = -999; }
      });
      rocks = rocks.filter(function (r) { return r.x > -900; });

      bullets.forEach(function (bl) {
        bl.x += bl.vx * dt; bl.y += bl.vy * dt; bl.life -= dt;
        for (var i = 0; i < rocks.length; i++) {
          var r = rocks[i], dx = r.x - bl.x, dy = r.y - bl.y;
          if (dx * dx + dy * dy < r.r * r.r) {
            bl.life = 0; score += r.r > 30 ? 20 : 50;
            api.beep(400, 0.08, "sawtooth");
            if (r.r > 22) {
              for (var s = 0; s < 2; s++) {
                var a = Math.random() * Math.PI * 2;
                rocks.push({ x: r.x, y: r.y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, r: r.r / 2, rot: Math.random() * 7 });
              }
            }
            r.x = -999;
            break;
          }
        }
      });
      bullets = bullets.filter(function (b2) { return b2.life > 0; });
      rocks = rocks.filter(function (r) { return r.x > -900; });
      if (!rocks.length) { spawnRocks(5 + ((score / 500) | 0)); api.beep(700, 0.12); }
      st.set("Lives: <b>" + lives + "</b> · Score: <b>" + score + "</b>");

      var T = api.theme(), ctx = C.ctx;
      ctx.fillStyle = "#050810"; ctx.fillRect(0, 0, W, H);
      // ship
      ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.a);
      ctx.fillStyle = T.primary;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 2;
      rocks.forEach(function (r) {
        ctx.beginPath();
        for (var i = 0; i <= 8; i++) {
          var a = i / 8 * Math.PI * 2 + r.rot, rr = r.r * (0.85 + 0.15 * Math.sin(i * 3 + r.rot));
          var px = r.x + Math.cos(a) * rr, py = r.y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
      ctx.fillStyle = "#facc15";
      bullets.forEach(function (b2) { ctx.beginPath(); ctx.arc(b2.x, b2.y, 3, 0, 7); ctx.fill(); });
    });

    // touch: left half = turn+thrust via drag, right side tap = fire
    var unswipe = swipe(C.cv, function (d) { if (d === "L") ship.a -= 0.4; if (d === "R") ship.a += 0.4; });
    var fireIv = null;
    C.cv.addEventListener("touchstart", function () {
      ship.vx += Math.cos(ship.a) * 60; ship.vy += Math.sin(ship.a) * 60;
    }, { passive: true });

    return function () { stop(); k.detach(); unswipe(); };
  }
  NG.reg({ id: "asteroids", name: "Asteroids", icon: "🚀", modes: ["solo"], start: playAsteroids });

  /* ================= SKY STRIKE (vertical shooter) ================= */

  function playShooter(stage, mode) {
    var W = 400, H = 520;
    var C = api.canvas(W, H);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();
    var ship = { x: W / 2, y: H - 60 };
    var bullets = [], foes = [], fbul = [], parts = [];
    var score = 0, lives = 3, dead = false, t = 0, cd = 0, spawnT = 0;

    st.set("Lives: <b>3</b> · move: arrows / drag · auto-fire");

    var dragX = null;
    function pd(e) {
      var rect = C.cv.getBoundingClientRect();
      dragX = (e.touches[0].clientX - rect.left) / rect.width * W;
      e.preventDefault();
    }
    function pm(e) {
      if (dragX === null) return;
      var rect = C.cv.getBoundingClientRect();
      dragX = (e.touches[0].clientX - rect.left) / rect.width * W;
      e.preventDefault();
    }
    C.cv.addEventListener("touchstart", pd, { passive: false });
    C.cv.addEventListener("touchmove", pm, { passive: false });
    C.cv.addEventListener("touchend", function () { dragX = null; });

    function explode(x, y, col) {
      for (var i = 0; i < 10; i++) {
        var a = Math.random() * Math.PI * 2;
        parts.push({ x: x, y: y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 0.5, col: col });
      }
    }
    function hit() {
      lives--;
      api.beep(140, 0.3, "sawtooth");
      explode(ship.x, ship.y, "#f87171");
      st.set("Lives: <b>" + lives + "</b> · Score: <b>" + score + "</b>");
      if (lives <= 0) {
        dead = true;
        gameOver(stage, "Game over ✈️", "Score: <b>" + score + "</b>", function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "shooter", "solo");
        });
      }
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      t += dt;
      if (k.isDown("arrowleft") || k.isDown("a")) ship.x = Math.max(16, ship.x - 300 * dt);
      if (k.isDown("arrowright") || k.isDown("d")) ship.x = Math.min(W - 16, ship.x + 300 * dt);
      if (k.isDown("arrowup") || k.isDown("w")) ship.y = Math.max(H / 2, ship.y - 240 * dt);
      if (k.isDown("arrowdown") || k.isDown("s")) ship.y = Math.min(H - 30, ship.y + 240 * dt);
      if (dragX !== null) ship.x = Math.max(16, Math.min(W - 16, dragX));

      cd -= dt;
      if (cd <= 0) {
        cd = 0.16;
        bullets.push({ x: ship.x - 8, y: ship.y - 14, vy: -420 });
        bullets.push({ x: ship.x + 8, y: ship.y - 14, vy: -420 });
        api.beep(880, 0.03, "sawtooth");
      }
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = Math.max(0.35, 1.1 - t * 0.008);
        var kind = Math.random();
        foes.push({ x: 30 + Math.random() * (W - 60), y: -24, vy: 90 + Math.random() * 60 + t,
          kind: kind < 0.75 ? 0 : 1, hp: kind < 0.75 ? 1 : 3, ph: Math.random() * 7, shoot: 1 + Math.random() * 2 });
      }
      bullets.forEach(function (b2) { b2.y += b2.vy * dt; });
      bullets = bullets.filter(function (b2) { return b2.y > -20; });

      foes.forEach(function (f) {
        f.y += f.vy * dt; f.ph += dt;
        f.x += Math.sin(f.ph * 2) * 30 * dt;
        f.shoot -= dt;
        if (f.shoot <= 0 && f.y > 0 && f.y < H / 2) {
          f.shoot = 1.5 + Math.random() * 2;
          var a = Math.atan2(ship.y - f.y, ship.x - f.x);
          fbul.push({ x: f.x, y: f.y + 12, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200 });
        }
        for (var i = 0; i < bullets.length; i++) {
          var b3 = bullets[i], dx = b3.x - f.x, dy = b3.y - f.y;
          if (dx * dx + dy * dy < 20 * 20) {
            bullets.splice(i, 1); i--;
            f.hp--;
            if (f.hp <= 0) {
              f.y = H + 99;
              score += f.kind === 0 ? 50 : 150;
              explode(f.x, f.y, f.kind === 0 ? "#fb923c" : "#c084fc");
              api.beep(420, 0.08, "sawtooth");
            } else api.beep(300, 0.04);
            break;
          }
        }
        var dx2 = f.x - ship.x, dy2 = f.y - ship.y;
        if (dx2 * dx2 + dy2 * dy2 < 26 * 26) { f.y = H + 99; hit(); }
      });
      foes = foes.filter(function (f) { return f.y < H + 90; });

      fbul.forEach(function (b4) { b4.x += b4.vx * dt; b4.y += b4.vy * dt; });
      fbul = fbul.filter(function (b4) {
        var dx = b4.x - ship.x, dy = b4.y - ship.y;
        if (dx * dx + dy * dy < 14 * 14) { hit(); return false; }
        return b4.y < H + 20 && b4.y > -20 && b4.x > -20 && b4.x < W + 20;
      });
      parts.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
      parts = parts.filter(function (p) { return p.life > 0; });
      st.set("Lives: <b>" + lives + "</b> · Score: <b>" + score + "</b>");

      var ctx = C.ctx;
      var sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#0b1026"); sky.addColorStop(1, "#1e1b4b");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,.5)";
      for (var s2 = 0; s2 < 40; s2++) {
        var sy = (s2 * 97 + t * 60) % H;
        ctx.fillRect((s2 * 53) % W, sy, 2, 2);
      }
      // ship
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.moveTo(ship.x, ship.y - 16); ctx.lineTo(ship.x - 12, ship.y + 10);
      ctx.lineTo(ship.x, ship.y + 4); ctx.lineTo(ship.x + 12, ship.y + 10);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#facc15";
      bullets.forEach(function (b5) { ctx.fillRect(b5.x - 2, b5.y - 8, 4, 10); });
      foes.forEach(function (f) {
        ctx.fillStyle = f.kind === 0 ? "#fb923c" : "#c084fc";
        ctx.beginPath();
        ctx.moveTo(f.x, f.y + 14); ctx.lineTo(f.x - 14, f.y - 8);
        ctx.lineTo(f.x, f.y - 2); ctx.lineTo(f.x + 14, f.y - 8);
        ctx.closePath(); ctx.fill();
      });
      ctx.fillStyle = "#f87171";
      fbul.forEach(function (b6) { ctx.beginPath(); ctx.arc(b6.x, b6.y, 4, 0, 7); ctx.fill(); });
      parts.forEach(function (p) {
        ctx.fillStyle = p.col;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      });
    });

    return function () {
      stop(); k.detach();
      C.cv.removeEventListener("touchstart", pd);
      C.cv.removeEventListener("touchmove", pm);
    };
  }
  NG.reg({ id: "shooter", name: "Sky Strike", icon: "✈️", modes: ["solo"], start: playShooter });

  /* ================= SUDOKU ================= */

  var SUD = {
    solved: function () {
      // pattern-based valid grid, then shuffle
      var g = [];
      for (var r = 0; r < 9; r++) {
        g.push([]);
        for (var c = 0; c < 9; c++) g[r].push(((r * 3 + ((r / 3) | 0) + c) % 9) + 1);
      }
      function swap2(gg, a, b2, c3) { var t = gg[a][c3]; gg[a][c3] = gg[b2][c3]; gg[b2][c3] = t; }
      for (var s = 0; s < 20; s++) {
        var b = (Math.random() * 3) | 0, r1 = b * 3 + ((Math.random() * 3) | 0), r2 = b * 3 + ((Math.random() * 3) | 0);
        for (var c2 = 0; c2 < 9; c2++) swap2(g, r1, r2, c2);
      }
      function swap2(gg, a, b2, c3) { var t = gg[a][c3]; gg[a][c3] = gg[b2][c3]; gg[b2][c3] = t; }
      for (var s2 = 0; s2 < 20; s2++) {
        var b3 = (Math.random() * 3) | 0, c4 = b3 * 3 + ((Math.random() * 3) | 0), c5 = b3 * 3 + ((Math.random() * 3) | 0);
        for (var r3 = 0; r3 < 9; r3++) { var t2 = g[r3][c4]; g[r3][c4] = g[r3][c5]; g[r3][c5] = t2; }
      }
      // transpose sometimes
      if (Math.random() < 0.5) {
        var ng = [];
        for (var r4 = 0; r4 < 9; r4++) { ng.push([]); for (var c6 = 0; c6 < 9; c6++) ng[r4].push(g[c6][r4]); }
        g = ng;
      }
      return g;
    },
    puzzle: function (holes) {
      var sol = SUD.solved();
      var p = sol.map(function (r) { return r.slice(); });
      var n = 0, guard = 0;
      while (n < holes && guard++ < 2000) {
        var r = (Math.random() * 9) | 0, c = (Math.random() * 9) | 0;
        if (p[r][c]) { p[r][c] = 0; n++; }
      }
      return { p: p, sol: sol };
    },
    valid: function (g, r, c, v) {
      for (var i = 0; i < 9; i++) {
        if (g[r][i] === v || g[i][c] === v) return false;
      }
      var br = (r / 3 | 0) * 3, bc = (c / 3 | 0) * 3;
      for (var dr = 0; dr < 3; dr++) for (var dc = 0; dc < 3; dc++)
        if (g[br + dr][bc + dc] === v) return false;
      return true;
    },
  };
  LOGIC.sudoku = SUD;

  function playSudoku(stage, mode) {
    var puz = SUD.puzzle(44);
    var g = puz.p.map(function (r) { return r.slice(); });
    var fixed = puz.p.map(function (r) { return r.map(function (v) { return !!v; }); });
    var sel = null, mistakes = 0, done = false;

    var wrap = api.el("div", "sud-wrap");
    var st = api.el("div", "game-status");
    wrap.appendChild(st);
    var grid = api.el("div", "sud-grid");
    var cells = [];
    for (var r = 0; r < 9; r++) for (var c = 0; c < 9; c++) {
      (function (r, c) {
        var b = api.el("button", "sud-cell");
        b.type = "button";
        if (r % 3 === 0) b.classList.add("bt");
        if (c % 3 === 0) b.classList.add("bl");
        b.onclick = function () {
          if (done || fixed[r][c]) return;
          sel = [r, c];
          paint();
          api.beep(400, 0.03);
        };
        grid.appendChild(b);
        cells.push(b);
      })(r, c);
    }
    wrap.appendChild(grid);
    var pad = api.el("div", "sud-pad");
    for (var n = 1; n <= 9; n++) {
      (function (n) {
        var b = api.el("button", "btn sud-num", n);
        b.onclick = function () { enter(n); };
        pad.appendChild(b);
      })(n);
    }
    var clr = api.el("button", "btn sud-num", "⌫");
    clr.onclick = function () { if (sel && !done) { g[sel[0]][sel[1]] = 0; paint(); } };
    pad.appendChild(clr);
    wrap.appendChild(pad);
    stage.appendChild(wrap);

    function paint() {
      cells.forEach(function (b, i) {
        var r = (i / 9) | 0, c = i % 9, v = g[r][c];
        b.textContent = v || "";
        b.classList.toggle("fixed", fixed[r][c]);
        b.classList.toggle("sel", !!sel && sel[0] === r && sel[1] === c);
        b.classList.toggle("same", !!sel && v && v === g[sel[0]][sel[1]] && !(sel[0] === r && sel[1] === c));
      });
      st.innerHTML = "Mistakes: <b>" + mistakes + "</b>/3 · tap a cell, then a number";
    }
    function enter(n) {
      if (!sel || done || fixed[sel[0]][sel[1]]) return;
      var r = sel[0], c = sel[1];
      if (puz.sol[r][c] === n) {
        g[r][c] = n;
        api.beep(600, 0.06);
        var full = true;
        for (var i = 0; i < 9; i++) for (var j = 0; j < 9; j++) if (!g[i][j]) full = false;
        if (full) {
          done = true;
          api.beep(880, 0.2);
          gameOver(stage, "You win! 🔢", "Sudoku solved with <b>" + mistakes + "</b> mistakes.", function () {
            NG.openGame(stage.closest(".games-wrap").parentNode, "sudoku", "solo");
          });
        }
      } else {
        mistakes++;
        api.beep(200, 0.15, "sawtooth");
        if (mistakes >= 3) {
          done = true;
          gameOver(stage, "Game over 🔢", "Too many mistakes.", function () {
            NG.openGame(stage.closest(".games-wrap").parentNode, "sudoku", "solo");
          });
        }
      }
      paint();
    }
    paint();
    return function () {};
  }
  NG.reg({ id: "sudoku", name: "Sudoku", icon: "🔢", modes: ["solo"], start: playSudoku });

  /* ================= TURBO DRIVE (racing) ================= */

  function playRacing(stage, mode) {
    var W = 400, H = 520;
    var C = api.canvas(W, H);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();
    var lanes = [70, 165, 260, 345];
    var car = { lane: 1, x: lanes[1], y: H - 120 };
    var foes = [], score = 0, speed = 5, dead = false, t = 0, spawnT = 0;
    var roadOff = 0;

    st.set("Score: <b>0</b> · ← → / A D / swipe to steer");

    var unswipe = swipe(C.cv, function (d) {
      if (d === "L" && car.lane > 0) { car.lane--; api.beep(500, 0.04); }
      if (d === "R" && car.lane < 3) { car.lane++; api.beep(500, 0.04); }
    });

    function die() {
      dead = true;
      api.beep(150, 0.4, "sawtooth");
      gameOver(stage, "Crash! 🏎️", "Score: <b>" + score + "</b>", function () {
        NG.openGame(stage.closest(".games-wrap").parentNode, "racing", "solo");
      });
    }

    function drawCar(ctx, x, y, col, flip) {
      ctx.save();
      ctx.translate(x, y);
      if (flip) ctx.rotate(Math.PI);
      ctx.fillStyle = col;
      ctx.fillRect(-22, -40, 44, 80);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(-18, -28, 36, 20); // windshield
      ctx.fillStyle = "#111";
      ctx.fillRect(-26, -30, 8, 16); ctx.fillRect(18, -30, 8, 16);
      ctx.fillRect(-26, 16, 8, 16); ctx.fillRect(18, 16, 8, 16);
      ctx.fillStyle = "#fef08a";
      ctx.fillRect(-20, flip ? 34 : -40, 12, 6); ctx.fillRect(8, flip ? 34 : -40, 12, 6);
      ctx.restore();
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      t += dt;
      speed = Math.min(11, 5 + t * 0.12);
      roadOff = (roadOff + speed * 60 * dt) % 40;
      if (k.pressed("arrowleft") || k.pressed("a")) { if (car.lane > 0) { car.lane--; api.beep(500, 0.04); } }
      if (k.pressed("arrowright") || k.pressed("d")) { if (car.lane < 3) { car.lane++; api.beep(500, 0.04); } }
      k.clearPressed();
      car.x += (lanes[car.lane] - car.x) * Math.min(1, 12 * dt);

      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = Math.max(0.45, 1.3 - t * 0.01);
        var lane = (Math.random() * 4) | 0;
        if (!foes.some(function (f) { return f.lane === lane && f.y < 120; }))
          foes.push({ lane: lane, y: -100, v: 0.75 + Math.random() * 0.2 });
      }
      score += Math.round(speed * dt * 2);
      var hit = false;
      // foes drive forward too, just slower — they drift down relative to you
      foes.forEach(function (f) { f.y += (speed * 60 * dt) * (1 - f.v) + 40 * dt; });
      foes = foes.filter(function (f) {
        if (f.y > H + 120) return false;
        var fx = lanes[f.lane];
        if (Math.abs(fx - car.x) < 40 && Math.abs(f.y - car.y) < 76) hit = true;
        return true;
      });
      if (hit) { die(); return; }
      st.set("Score: <b>" + score + "</b> · speed " + speed.toFixed(0));

      var T = api.theme(), ctx = C.ctx;
      // grass
      ctx.fillStyle = "#166534"; ctx.fillRect(0, 0, W, H);
      // road
      ctx.fillStyle = "#27272a"; ctx.fillRect(30, 0, W - 60, H);
      ctx.strokeStyle = "#fafafa"; ctx.lineWidth = 4; ctx.setLineDash([24, 16]);
      ctx.lineDashOffset = -roadOff;
      for (var l = 1; l < 4; l++) {
        ctx.beginPath(); ctx.moveTo(30 + l * ((W - 60) / 4), 0); ctx.lineTo(30 + l * ((W - 60) / 4), H); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = "#facc15"; ctx.lineWidth = 6;
      ctx.strokeRect(30, 0, W - 60, H);
      foes.forEach(function (f) { drawCar(ctx, lanes[f.lane], f.y, "#f87171", true); });
      drawCar(ctx, car.x, car.y, T.primary, false);
    });

    return function () { stop(); k.detach(); unswipe(); };
  }
  NG.reg({ id: "racing", name: "Turbo Drive", icon: "🏎️", modes: ["solo"], start: playRacing });

  /* ================= REFLEX TAP ================= */

  function playReflex(stage, mode) {
    var wrap = api.el("div", "reflex-wrap");
    stage.appendChild(wrap);
    var st = api.el("div", "game-status");
    wrap.appendChild(st);
    var pad = api.el("button", "reflex-pad");
    pad.type = "button";
    wrap.appendChild(pad);
    var board = api.el("div", "reflex-board");
    wrap.appendChild(board);

    var state = "idle", t0 = 0, to = null, times = [], round = 0;

    function setPad(txt, cls) { pad.textContent = txt; pad.className = "reflex-pad " + cls; }
    function start() {
      times = []; round = 0;
      board.innerHTML = "";
      next();
    }
    function next() {
      if (round >= 5) {
        var avg = Math.round(times.reduce(function (a, b) { return a + b; }, 0) / times.length);
        state = "idle";
        setPad("Done! Avg: " + avg + "ms — tap to retry", "idle");
        api.beep(880, 0.2);
        return;
      }
      round++;
      state = "wait";
      setPad("Wait for green… (" + round + "/5)", "wait");
      st.innerHTML = "Round <b>" + round + "</b>/5 — tap when it turns green!";
      to = setTimeout(function () {
        state = "go";
        t0 = performance.now();
        setPad("TAP!", "go");
        api.beep(700, 0.08);
      }, 1200 + Math.random() * 2800);
    }
    pad.onclick = function () {
      if (state === "idle") { start(); return; }
      if (state === "wait") {
        clearTimeout(to);
        state = "idle";
        setPad("Too soon! Tap to retry", "idle");
        api.beep(180, 0.2, "sawtooth");
        return;
      }
      if (state === "go") {
        var ms = Math.round(performance.now() - t0);
        times.push(ms);
        var row = api.el("div", "reflex-row", "Round " + round + ": " + ms + "ms " +
          (ms < 250 ? "⚡" : ms < 400 ? "👍" : "🐢"));
        board.appendChild(row);
        state = "cool";
        setPad(ms + "ms", "idle");
        api.beep(600, 0.06);
        setTimeout(next, 900);
      }
    };
    setPad("Tap to start — test your reflexes!", "idle");
    st.innerHTML = "Tap the pad as fast as you can when it turns green.";

    return function () { if (to) clearTimeout(to); };
  }
  NG.reg({ id: "reflex", name: "Reflex Tap", icon: "⚡", modes: ["solo"], start: playReflex });

  /* ================= BOXING ================= */

  function playBoxing(stage, mode) {
    var W = 400, H = 420;
    var C = api.canvas(W, H);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();
    var is2p = mode === "2p";

    function fighter(x, col, face) {
      return { x: x, y: H - 140, hp: 100, col: col, face: face,
        punch: 0, punchKind: 0, block: false, cd: 0, bob: Math.random() * 7 };
    }
    var a = fighter(120, "#60a5fa", 1), b = fighter(280, "#f87171", -1);
    var dead = false, t = 0, round = 1;

    st.set(is2p
      ? "P1 (blue): A/D move · W jab · S block · E hook — P2 (red): ←/→ · ↑ jab · ↓ block · Enter hook"
      : "You (blue): ←/→ move · Z jab · X hook · ↓/S block");

    // touch buttons for solo
    var pad = null, touch = { left: false, right: false, jab: false, hook: false, block: false };
    if (!is2p) {
      pad = api.el("div", "fight-pad");
      [["◀", "left"], ["▶", "right"], ["👊", "jab"], ["🪝", "hook"], ["🛡️", "block"]].forEach(function (x) {
        var btn = api.el("button", "fight-btn", x[0]);
        btn.type = "button";
        var nm = x[1];
        btn.addEventListener("touchstart", function (e) { e.preventDefault(); touch[nm] = true; doAct(a, nm); }, { passive: false });
        btn.addEventListener("touchend", function () { touch[nm] = false; });
        btn.addEventListener("mousedown", function () { doAct(a, nm); });
        pad.appendChild(btn);
      });
      stage.appendChild(pad);
    }

    function doAct(f, act) {
      if (dead || f.cd > 0) return;
      if (act === "jab" || act === "hook") {
        f.punch = 0.28; f.punchKind = act === "jab" ? 1 : 2;
        f.cd = act === "jab" ? 0.45 : 0.7;
        api.beep(act === "jab" ? 500 : 380, 0.06, "sawtooth");
      }
    }

    function damage(victim, amt, from) {
      if (victim.block) amt *= 0.25;
      victim.hp -= amt;
      api.beep(220, 0.1, "sawtooth");
      victim.x += from * 14; // knockback
      if (victim.hp <= 0) {
        victim.hp = 0;
        dead = true;
        var winner = victim === a ? (is2p ? "Player 2 (red)" : "AI") : (is2p ? "Player 1 (blue)" : "You");
        gameOver(stage, "KO! 🥊", winner + " wins round " + round + "!", function () {
          NG.openGame(stage.closest(".games-wrap").parentNode, "boxing", mode);
        });
      }
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      t += dt;
      [a, b].forEach(function (f) {
        f.cd = Math.max(0, f.cd - dt);
        f.punch = Math.max(0, f.punch - dt);
        f.bob += dt * 6;
        f.x = Math.max(50, Math.min(W - 50, f.x));
      });

      if (is2p) {
        // P1
        if (k.isDown("a")) a.x -= 200 * dt;
        if (k.isDown("d")) a.x += 200 * dt;
        a.block = k.isDown("s");
        if (k.pressed("w")) doAct(a, "jab");
        if (k.pressed("e")) doAct(a, "hook");
        // P2
        if (k.isDown("arrowleft")) b.x -= 200 * dt;
        if (k.isDown("arrowright")) b.x += 200 * dt;
        b.block = k.isDown("arrowdown");
        if (k.pressed("arrowup")) doAct(b, "jab");
        if (k.pressed("enter")) doAct(b, "hook");
      } else {
        if (k.isDown("arrowleft") || k.isDown("a") || touch.left) a.x -= 220 * dt;
        if (k.isDown("arrowright") || k.isDown("d") || touch.right) a.x += 220 * dt;
        a.block = k.isDown("arrowdown") || k.isDown("s") || touch.block;
        if (k.pressed("z")) doAct(a, "jab");
        if (k.pressed("x")) doAct(a, "hook");
        // AI
        b.block = false;
        var d = Math.abs(a.x - b.x);
        if (b.cd <= 0) {
          if (d > 90) b.x += (a.x > b.x ? 1 : -1) * 170 * dt;
          else if (d < 60) b.x += (a.x > b.x ? -1 : 1) * 120 * dt;
          else {
            var r = Math.random();
            if (r < 0.12) doAct(b, Math.random() < 0.6 ? "jab" : "hook");
            else if (r < 0.16) b.block = true;
          }
        }
        if (a.punch > 0 && Math.random() < 0.3) b.block = true;
      }
      k.clearPressed();

      // keep them facing / apart
      if (Math.abs(a.x - b.x) < 56) {
        var mid = (a.x + b.x) / 2;
        a.x = mid - 28; b.x = mid + 28;
      }

      // punch connects?
      [[a, b, 1], [b, a, -1]].forEach(function (pair) {
        var f = pair[0], v = pair[1], dir = pair[2];
        if (f.punch > 0.12 && f.punch < 0.26) {
          var reach = f.punchKind === 1 ? 78 : 66;
          var dd = (v.x - f.x) * dir;
          if (dd > 30 && dd < reach && Math.abs(v.y - f.y) < 90) {
            f.punch = 0.1; // single hit per punch
            damage(v, f.punchKind === 1 ? 7 : 12, dir);
          }
        }
      });

      st.set("🔵 <b>" + Math.round(a.hp) + "</b> · <b>" + Math.round(b.hp) + "</b> 🔴 · round " + round);

      var T = api.theme(), ctx = C.ctx;
      ctx.fillStyle = T.bgSoft; ctx.fillRect(0, 0, W, H);
      // ring
      ctx.strokeStyle = T.border; ctx.lineWidth = 6;
      ctx.strokeRect(20, H - 260, W - 40, 230);
      [a, b].forEach(function (f) {
        var bobY = Math.sin(f.bob) * 4;
        var x = f.x, y = f.y + bobY;
        // legs
        ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(x, y + 40); ctx.lineTo(x - 12, y + 95); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y + 40); ctx.lineTo(x + 12, y + 95); ctx.stroke();
        // body
        ctx.fillStyle = f.col;
        ctx.fillRect(x - 18, y - 20, 36, 62);
        // head
        ctx.fillStyle = "#fcd9b8";
        ctx.beginPath(); ctx.arc(x, y - 38, 16, 0, 7); ctx.fill();
        // guard arms
        ctx.strokeStyle = "#fcd9b8"; ctx.lineWidth = 9;
        var guard = f.block ? -6 : 6;
        ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + f.face * 6, y - 14 + guard); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 14, y); ctx.lineTo(x + f.face * 6, y - 14 + guard); ctx.stroke();
        // punch arm
        if (f.punch > 0) {
          var ext = (0.28 - f.punch) / 0.28;
          var px = x + f.face * (20 + ext * 52);
          ctx.strokeStyle = "#fcd9b8"; ctx.lineWidth = 10;
          ctx.beginPath(); ctx.moveTo(x + f.face * 14, y - 6); ctx.lineTo(px, y - 10); ctx.stroke();
          ctx.fillStyle = "#dc2626";
          ctx.beginPath(); ctx.arc(px, y - 10, 9, 0, 7); ctx.fill();
        }
        // hp bar
        ctx.fillStyle = "rgba(0,0,0,.25)";
        ctx.fillRect(x - 26, y - 66, 52, 7);
        ctx.fillStyle = f.hp > 30 ? "#4ade80" : "#f87171";
        ctx.fillRect(x - 26, y - 66, 52 * f.hp / 100, 7);
      });
    });

    return function () { stop(); k.detach(); };
  }
  NG.reg({ id: "boxing", name: "Boxing", icon: "🥊", modes: ["solo", "2p"], start: playBoxing });

  /* ================= SNAKE BATTLE (2P) ================= */

  function playSnakeBattle(stage, mode) {
    var N = 22, CELL = 18;
    var C = api.canvas(N * CELL, N * CELL);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();

    function mk(x, col) { return { body: [{ x: x, y: 11 }], dir: { x: 0, y: 0 }, pend: { x: 0, y: 0 }, col: col, alive: true, score: 0 }; }
    var p1 = mk(6, "#60a5fa"), p2 = mk(15, "#f87171");
    p1.dir = p1.pend = { x: 1, y: 0 };
    p2.dir = p2.pend = { x: -1, y: 0 };
    var foods = [], dead = false, acc = 0;

    function place() {
      for (var i = 0; i < 3 - foods.length; i++) {
        var f = { x: (Math.random() * N) | 0, y: (Math.random() * N) | 0 };
        foods.push(f);
      }
    }
    place();
    st.set("P1 🔵 <b>WASD</b> · P2 🔴 <b>arrows</b> · eat to grow, don't crash!");

    function stepSnake(p, other) {
      if (!p.alive) return;
      var d = p.pend;
      if (!(d.x === -p.dir.x && d.y === -p.dir.y) && (d.x || d.y)) p.dir = d;
      var h = { x: p.body[0].x + p.dir.x, y: p.body[0].y + p.dir.y };
      var crash = h.x < 0 || h.y < 0 || h.x >= N || h.y >= N ||
        p.body.some(function (s) { return s.x === h.x && s.y === h.y; }) ||
        (other.alive && other.body.some(function (s) { return s.x === h.x && s.y === h.y; }));
      if (crash) { p.alive = false; api.beep(150, 0.3, "sawtooth"); return; }
      p.body.unshift(h);
      var fi = foods.findIndex(function (f) { return f.x === h.x && f.y === h.y; });
      if (fi >= 0) { foods.splice(fi, 1); p.score += 10; api.beep(700, 0.05); }
      else p.body.pop();
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      if (k.isDown("w")) p1.pend = { x: 0, y: -1 };
      if (k.isDown("s")) p1.pend = { x: 0, y: 1 };
      if (k.isDown("a")) p1.pend = { x: -1, y: 0 };
      if (k.isDown("d")) p1.pend = { x: 1, y: 0 };
      if (k.isDown("arrowup")) p2.pend = { x: 0, y: -1 };
      if (k.isDown("arrowdown")) p2.pend = { x: 0, y: 1 };
      if (k.isDown("arrowleft")) p2.pend = { x: -1, y: 0 };
      if (k.isDown("arrowright")) p2.pend = { x: 1, y: 0 };
      acc += dt;
      if (acc > 0.12) {
        acc = 0;
        stepSnake(p1, p2); stepSnake(p2, p1);
        place();
        if (!p1.alive || !p2.alive) {
          dead = true;
          var msg = !p1.alive && !p2.alive ? "Both crashed — draw!"
            : !p1.alive ? "🔴 Player 2 wins! 🏆" : "🔵 Player 1 wins! 🏆";
          gameOver(stage, "Game over 🐍", msg + " (" + p1.score + " : " + p2.score + ")", function () {
            NG.openGame(stage.closest(".games-wrap").parentNode, "snakebattle", "2p");
          });
          return;
        }
      }
      var T = api.theme(), ctx = C.ctx;
      ctx.fillStyle = T.bgSoft; ctx.fillRect(0, 0, C.W, C.H);
      ctx.fillStyle = "#e04444";
      foods.forEach(function (f) { ctx.fillRect(f.x * CELL + 3, f.y * CELL + 3, CELL - 6, CELL - 6); });
      [p1, p2].forEach(function (p) {
        ctx.fillStyle = p.col;
        p.body.forEach(function (s, i) {
          ctx.fillRect(s.x * CELL + (i ? 2 : 1), s.y * CELL + (i ? 2 : 1), CELL - (i ? 4 : 2), CELL - (i ? 4 : 2));
        });
      });
      st.set("🔵 <b>" + p1.score + "</b> · <b>" + p2.score + "</b> 🔴");
    });

    return function () { stop(); k.detach(); };
  }
  NG.reg({ id: "snakebattle", name: "Snake Battle", icon: "🐍", modes: ["2p"], start: playSnakeBattle });

  /* ================= TANK DUEL (2P) ================= */

  function playTankDuel(stage, mode) {
    var W = 440, H = 440;
    var C = api.canvas(W, H);
    stage.appendChild(C.cv);
    var st = api.status(stage);
    var k = api.keys();

    // maze walls
    var walls = [
      { x: 120, y: 120, w: 200, h: 18 }, { x: 120, y: 302, w: 200, h: 18 },
      { x: 120, y: 138, w: 18, h: 80 }, { x: 302, y: 222, w: 18, h: 80 },
      { x: 200, y: 200, w: 40, h: 40 },
    ];
    function mkTank(x, y, a, col) {
      return { x: x, y: y, a: a, col: col, hp: 3, cd: 0, alive: true };
    }
    var p1 = mkTank(60, 60, 0, "#60a5fa"), p2 = mkTank(W - 60, H - 60, Math.PI, "#f87171");
    var bullets = [], dead = false;

    st.set("P1 🔵: <b>WASD</b> move · <b>Space</b> fire — P2 🔴: <b>arrows</b> · <b>Enter</b> fire · 3 hits win");

    function hitWall(x, y, r) {
      if (x < r || x > W - r || y < r || y > H - r) return true;
      return walls.some(function (wl) {
        return x + r > wl.x && x - r < wl.x + wl.w && y + r > wl.y && y - r < wl.y + wl.h;
      });
    }
    function fire(t) {
      if (t.cd > 0 || !t.alive) return;
      t.cd = 0.5;
      bullets.push({ x: t.x + Math.cos(t.a) * 22, y: t.y + Math.sin(t.a) * 22,
        vx: Math.cos(t.a) * 320, vy: Math.sin(t.a) * 320, from: t, bounces: 1 });
      api.beep(300, 0.08, "sawtooth");
    }
    function boom(x, y) {
      api.beep(140, 0.25, "sawtooth");
    }

    var stop = api.loop(function (dt) {
      if (dead) return;
      [[p1, "w", "s", "a", "d", " "], [p2, "arrowup", "arrowdown", "arrowleft", "arrowright", "enter"]].forEach(function (cfg) {
        var t = cfg[0];
        if (!t.alive) return;
        t.cd = Math.max(0, t.cd - dt);
        var sp = 150 * dt;
        if (k.isDown(cfg[1])) { var nx = t.x + Math.cos(t.a) * sp, ny = t.y + Math.sin(t.a) * sp; if (!hitWall(nx, ny, 14)) { t.x = nx; t.y = ny; } }
        if (k.isDown(cfg[2])) { var nx2 = t.x - Math.cos(t.a) * sp, ny2 = t.y - Math.sin(t.a) * sp; if (!hitWall(nx2, ny2, 14)) { t.x = nx2; t.y = ny2; } }
        if (k.isDown(cfg[3])) t.a -= 3.4 * dt;
        if (k.isDown(cfg[4])) t.a += 3.4 * dt;
        if (k.pressed(cfg[5])) fire(t);
      });
      k.clearPressed();

      bullets.forEach(function (b) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        var hitSomething = false;
        // walls -> bounce once
        walls.forEach(function (wl) {
          if (b.x > wl.x && b.x < wl.x + wl.w && b.y > wl.y && b.y < wl.y + wl.h) hitSomething = true;
        });
        if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) hitSomething = true;
        if (hitSomething) {
          if (b.bounces > 0) {
            b.bounces--;
            // simple axis bounce: reverse the smaller penetration axis
            b.vx *= -1; b.vy *= -1;
            b.x += b.vx * dt * 2; b.y += b.vy * dt * 2;
          } else { b.dead = true; boom(b.x, b.y); }
          return;
        }
        [p1, p2].forEach(function (t) {
          if (!t.alive || b.from === t) return;
          var dx = b.x - t.x, dy = b.y - t.y;
          if (dx * dx + dy * dy < 16 * 16) {
            b.dead = true;
            t.hp--;
            boom(t.x, t.y);
            if (t.hp <= 0) {
              t.alive = false;
              dead = true;
              var winner = t === p1 ? "🔴 Player 2 wins! 🏆" : "🔵 Player 1 wins! 🏆";
              gameOver(stage, "Tank destroyed! 💥", winner, function () {
                NG.openGame(stage.closest(".games-wrap").parentNode, "tankduel", "2p");
              });
            }
          }
        });
      });
      bullets = bullets.filter(function (b) { return !b.dead; });

      st.set("🔵 " + "❤️".repeat(Math.max(0, p1.hp)) + " · " + "❤️".repeat(Math.max(0, p2.hp)) + " 🔴");

      var T = api.theme(), ctx = C.ctx;
      ctx.fillStyle = "#1c1917"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#44403c";
      walls.forEach(function (wl) { ctx.fillRect(wl.x, wl.y, wl.w, wl.h); });
      [p1, p2].forEach(function (t) {
        if (!t.alive) return;
        ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.a);
        ctx.fillStyle = t.col;
        ctx.fillRect(-14, -12, 28, 24);
        ctx.fillStyle = "rgba(0,0,0,.3)";
        ctx.fillRect(-14, -12, 6, 24); ctx.fillRect(8, -12, 6, 24);
        ctx.fillStyle = "#111";
        ctx.fillRect(0, -4, 22, 8);
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
        ctx.restore();
      });
      ctx.fillStyle = "#facc15";
      bullets.forEach(function (b) { ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, 7); ctx.fill(); });
    });

    return function () { stop(); k.detach(); };
  }
  NG.reg({ id: "tankduel", name: "Tank Duel", icon: "💥", modes: ["2p"], start: playTankDuel });

  /* expose pure logic for tests */
  if (typeof module !== "undefined" && module.exports) module.exports = LOGIC;
})(typeof window !== "undefined" ? window : globalThis);
