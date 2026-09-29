/* NEUTRON Games — board games: chess, checkers, tic-tac-toe, connect-4.
 * Each: Solo vs AI, 2P on this device, Online (encrypted relay, turn-based).
 * Pure logic is exposed for tests (see tests/games-logic.test.ts).
 */
(function (root) {
  "use strict";
  var NG = root.NeutronGames;
  if (!NG) return;
  var api = NG.api();

  /* ---------------- online session helper ----------------
   * Host: creates code instantly, waits for peer. Join: enter code.
   * cbs: onOpen(net, isHost, setStatus), onMove(data), onFail(). */

  function netGame(box, cbs) {
    var cleanups = [];
    var dead = false;
    function setStatus(t) { statusEl.textContent = t; }

    var statusEl = api.el("p", "net-status", "Host a game and share the code, or join with a code.");
    var row = api.el("div", "net-row");
    var hostBtn = api.el("button", "btn", "Host game");
    var inp = api.el("input", "input net-input");
    inp.placeholder = "GAME-XXXXXX";
    inp.maxLength = 11;
    inp.autocapitalize = "characters";
    var joinBtn = api.el("button", "btn", "Join");
    row.appendChild(hostBtn); row.appendChild(inp); row.appendChild(joinBtn);
    box.appendChild(statusEl); box.appendChild(row);

    function onNetEvent(net, isHost) {
      return function (ev) {
        if (dead) return;
        if (ev.t === "net" && !ev.ok) {
          setStatus("Could not reach the relay. Check internet and retry.");
          if (cbs.onFail) cbs.onFail();
        } else if (ev.t === "peer") {
          cbs.onOpen(net, isHost, setStatus);
        } else if (ev.t === "move") {
          cbs.onMove(ev.d);
        } else if (ev.t === "left") {
          setStatus("Opponent left the game.");
          if (cbs.onPeerLeft) cbs.onPeerLeft();
        }
      };
    }

    hostBtn.onclick = function () {
      box.innerHTML = "";
      var codeEl = api.el("div", "net-code", "…");
      var st = api.el("p", "net-status", "Creating…");
      box.appendChild(api.el("p", "net-code-label", "Share this code with your friend:"));
      box.appendChild(codeEl);
      box.appendChild(st);
      statusEl = st;
      var h = api.host(onNetEvent(h, true));
      h._isHost = true;
      codeEl.textContent = h.code;
      setStatus("Waiting for opponent to join…");
      cleanups.push(function () { try { h.close(); } catch (e) {} });
      // If nobody joins in 90s, say so.
      var to = setTimeout(function () {
        if (!dead && !h._started) setStatus("Still waiting… make sure your friend entered the code.");
      }, 90000);
      cleanups.push(function () { clearTimeout(to); });
      var origOpen = cbs.onOpen;
      cbs.onOpen = function (net, isHost, setS) { net._started = true; origOpen(net, isHost, setS); };
    };

    joinBtn.onclick = function () {
      var code = inp.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
      if (code.length < 8) { setStatus("Enter the full code from your friend."); return; }
      box.innerHTML = "";
      var st = api.el("p", "net-status", "Connecting…");
      box.appendChild(st);
      statusEl = st;
      var g = api.join(code, onNetEvent(g, false));
      cleanups.push(function () { try { g.close(); } catch (e) {} });
      var to = setTimeout(function () {
        if (!dead && !g._started) setStatus("No host found — check the code and retry.");
      }, 20000);
      cleanups.push(function () { clearTimeout(to); });
      var origOpen2 = cbs.onOpen;
      cbs.onOpen = function (net, isHost, setS) { net._started = true; origOpen2(net, isHost, setS); };
    };

    return function () {
      dead = true;
      cleanups.forEach(function (c) { try { c(); } catch (e) {} });
    };
  }

  /* ---------------- generic DOM board shell ---------------- */

  function boardShell(stage, cols, rows, cellCls) {
    var wrap = api.el("div", "board-wrap");
    var status = api.el("div", "game-status");
    wrap.appendChild(status);
    var grid = api.el("div", "board-grid");
    grid.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
    var cells = [];
    for (var i = 0; i < cols * rows; i++) {
      var c = api.el("button", "board-cell" + (cellCls ? " " + cellCls : ""));
      c.type = "button";
      grid.appendChild(c);
      cells.push(c);
    }
    wrap.appendChild(grid);
    stage.appendChild(wrap);
    return {
      cells: cells, grid: grid,
      set: function (t) { status.innerHTML = t; },
      destroy: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); },
    };
  }

  /* ================= TIC-TAC-TOE ================= */

  var TTT = {
    empty: function () { return [0, 0, 0, 0, 0, 0, 0, 0, 0]; },
    lines: [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]],
    winner: function (b) {
      for (var i = 0; i < TTT.lines.length; i++) {
        var l = TTT.lines[i], a = b[l[0]];
        if (a && a === b[l[1]] && a === b[l[2]]) return a;
      }
      return b.indexOf(0) === -1 ? "draw" : 0;
    },
    empties: function (b) {
      var out = [];
      for (var i = 0; i < 9; i++) if (!b[i]) out.push(i);
      return out;
    },
    best: function (b, me) {
      var opp = me === 1 ? 2 : 1;
      function mm(bd, turn) {
        var w = TTT.winner(bd);
        if (w === me) return 10;
        if (w === opp) return -10;
        if (w === "draw") return 0;
        var best = turn === me ? -99 : 99;
        for (var i = 0; i < 9; i++) if (!bd[i]) {
          bd[i] = turn;
          var s = mm(bd, turn === me ? opp : me);
          bd[i] = 0;
          best = turn === me ? Math.max(best, s) : Math.min(best, s);
        }
        return best;
      }
      var bi = -1, bs = -99;
      var order = [4, 0, 2, 6, 8, 1, 3, 5, 7];
      for (var k = 0; k < order.length; k++) {
        var i = order[k];
        if (b[i]) continue;
        b[i] = me;
        var s = mm(b, opp);
        b[i] = 0;
        if (s > bs) { bs = s; bi = i; }
      }
      return bi;
    },
  };

  function playTicTacToe(stage, mode) {
    var ui = boardShell(stage, 3, 3, "ttt");
    var netBox = api.el("div", "net-box");
    stage.insertBefore(netBox, stage.firstChild);
    var b = TTT.empty(), turn = 1, over = false;
    var net = null, mySide = 1, netCleanup = function () {};
    var marks = ["", "✕", "◯"];

    function render() {
      ui.cells.forEach(function (c, i) {
        c.textContent = marks[b[i]];
        c.classList.toggle("p1", b[i] === 1);
        c.classList.toggle("p2", b[i] === 2);
      });
      var w = TTT.winner(b);
      if (w === 1) ui.set("✕ wins! 🏆");
      else if (w === 2) ui.set("◯ wins! 🏆");
      else if (w === "draw") ui.set("It's a draw.");
      else {
        var t = turn === 1 ? "✕" : "◯";
        var extra = mode === "online" ? (turn === mySide ? " — your move" : " — opponent's move")
          : mode === "solo" ? (turn === 2 ? " — AI thinking…" : "") : "";
        ui.set(t + " to move" + extra);
      }
    }

    function applyMove(i, side) {
      if (over || b[i]) return false;
      b[i] = side;
      api.beep(side === 1 ? 440 : 520, 0.06);
      var w = TTT.winner(b);
      if (w) { over = true; if (w !== "draw") api.beep(760, 0.18); }
      else turn = side === 1 ? 2 : 1;
      render();
      return true;
    }

    function aiTurn() {
      if (over || turn !== 2) return;
      setTimeout(function () {
        if (over || turn !== 2) return;
        var i = TTT.best(b, 2);
        if (i >= 0) applyMove(i, 2);
      }, 350);
    }

    ui.cells.forEach(function (c, i) {
      c.onclick = function () {
        if (mode === "online") {
          if (!net || turn !== mySide) return;
          if (applyMove(i, mySide)) net.send({ i: i });
        } else {
          if (mode === "solo" && turn === 2) return;
          if (applyMove(i, turn) && mode === "solo") aiTurn();
        }
      };
    });

    if (mode === "online") {
      netCleanup = netGame(netBox, {
        onOpen: function (n, isHost, setStatus) {
          net = n; mySide = isHost ? 1 : 2;
          netBox.style.display = "none";
          setStatus("");
          render();
          ui.set(mySide === 1 ? "✕ to move — your move" : "✕ to move — opponent's move");
          api.beep(660, 0.1);
        },
        onMove: function (d) {
          if (!net || over || typeof d.i !== "number") return;
          if (turn === mySide) return; // not our turn
          applyMove(d.i, turn);
        },
        onPeerLeft: function () { over = true; },
      });
    } else {
      netBox.style.display = "none";
    }

    render();
    return function () { over = true; netCleanup(); ui.destroy(); };
  }

  NG.reg({ id: "tictactoe", name: "Tic-Tac-Toe", icon: "⭕",
    modes: ["solo", "2p", "online"], start: playTicTacToe });

  /* ================= CONNECT-4 ================= */

  var C4 = {
    COLS: 7, ROWS: 6,
    empty: function () { return new Array(42).fill(0); },
    dropRow: function (b, col) {
      for (var r = 5; r >= 0; r--) if (!b[r * 7 + col]) return r;
      return -1;
    },
    play: function (b, col, side) {
      var r = C4.dropRow(b, col);
      if (r < 0) return -1;
      b[r * 7 + col] = side;
      return r * 7 + col;
    },
    winner: function (b) {
      var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (var r = 0; r < 6; r++) for (var c = 0; c < 7; c++) {
        var p = b[r * 7 + c];
        if (!p) continue;
        for (var d = 0; d < 4; d++) {
          var ok = true;
          for (var k = 1; k < 4; k++) {
            var rr = r + dirs[d][0] * k, cc = c + dirs[d][1] * k;
            if (rr < 0 || rr > 5 || cc < 0 || cc > 6 || b[rr * 7 + cc] !== p) { ok = false; break; }
          }
          if (ok) return p;
        }
      }
      return b.indexOf(0) === -1 ? "draw" : 0;
    },
    score: function (b, me) {
      // window-based heuristic
      var opp = me === 1 ? 2 : 1, s = 0;
      function win(cells) {
        var m = 0, o = 0, e = 0;
        for (var i = 0; i < 4; i++) {
          if (cells[i] === me) m++;
          else if (cells[i] === opp) o++;
          else e++;
        }
        if (m === 4) return 100000;
        if (o === 4) return -100000;
        if (m === 3 && e === 1) return 60;
        if (m === 2 && e === 2) return 8;
        if (o === 3 && e === 1) return -70;
        if (o === 2 && e === 2) return -9;
        return 0;
      }
      var cells = [];
      for (var r = 0; r < 6; r++) for (var c = 0; c < 4; c++) {
        cells = [b[r*7+c], b[r*7+c+1], b[r*7+c+2], b[r*7+c+3]];
        s += win(cells);
      }
      for (var c2 = 0; c2 < 7; c2++) for (var r2 = 0; r2 < 3; r2++) {
        cells = [b[r2*7+c2], b[(r2+1)*7+c2], b[(r2+2)*7+c2], b[(r2+3)*7+c2]];
        s += win(cells);
      }
      for (var r3 = 0; r3 < 3; r3++) for (var c3 = 0; c3 < 4; c3++) {
        cells = [b[r3*7+c3], b[(r3+1)*7+c3+1], b[(r3+2)*7+c3+2], b[(r3+3)*7+c3+3]];
        s += win(cells);
      }
      for (var r4 = 3; r4 < 6; r4++) for (var c4 = 0; c4 < 4; c4++) {
        cells = [b[r4*7+c4], b[(r4-1)*7+c4+1], b[(r4-2)*7+c4+2], b[(r4-3)*7+c4+3]];
        s += win(cells);
      }
      return s;
    },
    best: function (b, me, depth) {
      var opp = me === 1 ? 2 : 1;
      var order = [3, 2, 4, 1, 5, 0, 6];
      // Plain minimax, scores always from me's perspective.
      function search(bd, d, alpha, beta, turn) {
        var w = C4.winner(bd);
        if (w === me) return 1000000 + d;
        if (w === opp) return -1000000 - d;
        if (w === "draw") return 0;
        if (d === 0) return C4.score(bd, me);
        if (turn === me) {
          var best = -Infinity;
          for (var k = 0; k < 7; k++) {
            var col = order[k], r = C4.dropRow(bd, col);
            if (r < 0) continue;
            bd[r * 7 + col] = turn;
            var sc = search(bd, d - 1, alpha, beta, opp);
            bd[r * 7 + col] = 0;
            if (sc > best) best = sc;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
          }
          return best;
        } else {
          var best2 = Infinity;
          for (var k2 = 0; k2 < 7; k2++) {
            var col2 = order[k2], r2 = C4.dropRow(bd, col2);
            if (r2 < 0) continue;
            bd[r2 * 7 + col2] = turn;
            var sc2 = search(bd, d - 1, alpha, beta, me);
            bd[r2 * 7 + col2] = 0;
            if (sc2 < best2) best2 = sc2;
            if (best2 < beta) beta = best2;
            if (alpha >= beta) break;
          }
          return best2;
        }
      }
      var bc = -1, bs = -Infinity;
      for (var k = 0; k < 7; k++) {
        var col = order[k], r = C4.dropRow(b, col);
        if (r < 0) continue;
        b[r * 7 + col] = me;
        var sc = search(b, depth - 1, -Infinity, Infinity, opp);
        b[r * 7 + col] = 0;
        if (sc > bs) { bs = sc; bc = col; }
      }
      return bc;
    },
  };

  function playConnect4(stage, mode) {
    var ui = boardShell(stage, 7, 6, "c4");
    var netBox = api.el("div", "net-box");
    stage.insertBefore(netBox, stage.firstChild);
    var b = C4.empty(), turn = 1, over = false;
    var net = null, mySide = 1, netCleanup = function () {};
    var dots = ["", "🔴", "🟡"];

    function render() {
      ui.cells.forEach(function (c, i) {
        c.textContent = dots[b[i]];
        c.classList.toggle("p1", b[i] === 1);
        c.classList.toggle("p2", b[i] === 2);
      });
      var w = C4.winner(b);
      if (w === 1) ui.set("🔴 wins! 🏆");
      else if (w === 2) ui.set("🟡 wins! 🏆");
      else if (w === "draw") ui.set("It's a draw.");
      else {
        var t = turn === 1 ? "🔴" : "🟡";
        var extra = mode === "online" ? (turn === mySide ? " — your move" : " — opponent's move")
          : mode === "solo" ? (turn === 2 ? " — AI thinking…" : "") : "";
        ui.set(t + " to move" + extra);
      }
    }

    function applyCol(col, side) {
      if (over) return false;
      var idx = C4.play(b, col, side);
      if (idx < 0) return false;
      api.beep(side === 1 ? 440 : 520, 0.06);
      var w = C4.winner(b);
      if (w) { over = true; if (w !== "draw") api.beep(760, 0.18); }
      else turn = side === 1 ? 2 : 1;
      render();
      return true;
    }

    function aiTurn() {
      if (over || turn !== 2) return;
      setTimeout(function () {
        if (over || turn !== 2) return;
        var col = C4.best(b, 2, 4);
        if (col >= 0) applyCol(col, 2);
      }, 400);
    }

    ui.cells.forEach(function (c, i) {
      c.onclick = function () {
        var col = i % 7;
        if (mode === "online") {
          if (!net || turn !== mySide) return;
          if (applyCol(col, mySide)) net.send({ col: col });
        } else {
          if (mode === "solo" && turn === 2) return;
          if (applyCol(col, turn) && mode === "solo") aiTurn();
        }
      };
    });

    if (mode === "online") {
      netCleanup = netGame(netBox, {
        onOpen: function (n, isHost, setStatus) {
          net = n; mySide = isHost ? 1 : 2;
          netBox.style.display = "none";
          render();
          api.beep(660, 0.1);
        },
        onMove: function (d) {
          if (!net || over || typeof d.col !== "number") return;
          if (turn === mySide) return;
          applyCol(d.col, turn);
        },
        onPeerLeft: function () { over = true; },
      });
    } else {
      netBox.style.display = "none";
    }

    render();
    return function () { over = true; netCleanup(); ui.destroy(); };
  }

  NG.reg({ id: "connect4", name: "Connect 4", icon: "🔴",
    modes: ["solo", "2p", "online"], start: playConnect4 });

  /* ================= CHECKERS (English draughts) ================= */

  var Draughts = (function () {
    function on(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
    function isW(p) { return p === 1 || p === 2; }
    function initial() {
      var b = new Array(64).fill(0);
      for (var r = 0; r < 3; r++) for (var c = 0; c < 8; c++)
        if ((r + c) % 2 === 1) b[r * 8 + c] = 3;
      for (var r2 = 5; r2 < 8; r2++) for (var c2 = 0; c2 < 8; c2++)
        if ((r2 + c2) % 2 === 1) b[r2 * 8 + c2] = 1;
      return { b: b, turn: "w" };
    }
    function dirsFor(piece, white) {
      var king = piece === 2 || piece === 4;
      if (king) return [[-1,-1],[-1,1],[1,-1],[1,1]];
      return white ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
    }
    function jumps(b, sq, piece, white) {
      var res = [], king = piece === 2 || piece === 4;
      var dirs = dirsFor(piece, white), r = sq >> 3, c = sq & 7;
      for (var i = 0; i < dirs.length; i++) {
        var mr = r + dirs[i][0], mc = c + dirs[i][1];
        var tr = r + 2 * dirs[i][0], tc = c + 2 * dirs[i][1];
        if (!on(tr, tc)) continue;
        var mid = b[mr * 8 + mc], land = b[tr * 8 + tc];
        if (mid && isW(mid) !== white && !land) {
          var nb = b.slice();
          nb[sq] = 0; nb[mr * 8 + mc] = 0;
          var crowned = !king && ((white && tr === 0) || (!white && tr === 7));
          var np = crowned ? (white ? 2 : 4) : piece;
          nb[tr * 8 + tc] = np;
          if (crowned) {
            res.push({ to: tr * 8 + tc, captured: [mr * 8 + mc], crown: true });
          } else {
            var sub = jumps(nb, tr * 8 + tc, np, white);
            if (sub.length) sub.forEach(function (s2) {
              res.push({ to: s2.to, captured: [mr * 8 + mc].concat(s2.captured), crown: s2.crown });
            });
            else res.push({ to: tr * 8 + tc, captured: [mr * 8 + mc], crown: false });
          }
        }
      }
      return res;
    }
    function moves(s) {
      var b = s.b, white = s.turn === "w", caps = [], quiet = [];
      for (var sq = 0; sq < 64; sq++) {
        var p = b[sq];
        if (!p || isW(p) !== white) continue;
        var js = jumps(b, sq, p, white);
        if (js.length) js.forEach(function (j) {
          caps.push({ from: sq, to: j.to, captured: j.captured, crown: j.crown });
        });
        else {
          var dirs = dirsFor(p, white), r = sq >> 3, c = sq & 7;
          for (var i = 0; i < dirs.length; i++) {
            var tr = r + dirs[i][0], tc = c + dirs[i][1];
            if (!on(tr, tc) || b[tr * 8 + tc]) continue;
            var crown = (p === 1 || p === 3) && ((white && tr === 0) || (!white && tr === 7));
            quiet.push({ from: sq, to: tr * 8 + tc, captured: [], crown: crown });
          }
        }
      }
      return caps.length ? caps : quiet;
    }
    function apply(s, m) {
      var b = s.b.slice(), p = b[m.from];
      b[m.from] = 0;
      m.captured.forEach(function (sq) { b[sq] = 0; });
      b[m.to] = m.crown ? (p === 1 || p === 2 ? 2 : 4) : p;
      return { b: b, turn: s.turn === "w" ? "b" : "w" };
    }
    function evaluate(s) {
      var sc = 0;
      for (var i = 0; i < 64; i++) {
        var p = s.b[i];
        if (!p) continue;
        var r = i >> 3, v = 0;
        if (p === 1) v = 100 + (7 - r) * 4;
        else if (p === 2) v = 140;
        else if (p === 3) v = -(100 + r * 4);
        else v = -140;
        sc += v;
      }
      return s.turn === "w" ? sc : -sc;
    }
    function search(s, depth, alpha, beta) {
      var ms = moves(s);
      if (!ms.length) return -100000 - depth;
      if (depth === 0) return evaluate(s);
      ms.sort(function (a, b2) { return b2.captured.length - a.captured.length; });
      var best = -Infinity;
      for (var i = 0; i < ms.length; i++) {
        var sc = -search(apply(s, ms[i]), depth - 1, -beta, -alpha);
        if (sc > best) best = sc;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    function bestMove(s, depth) {
      var ms = moves(s);
      if (!ms.length) return null;
      ms.sort(function (a, b2) { return b2.captured.length - a.captured.length; });
      var best = null, bs = -Infinity;
      for (var i = 0; i < ms.length; i++) {
        var sc = -search(apply(s, ms[i]), depth - 1, -Infinity, Infinity);
        if (sc > bs + Math.random() * 4) { bs = sc; best = ms[i]; }
      }
      return best;
    }
    return { initial: initial, moves: moves, apply: apply, bestMove: bestMove, evaluate: evaluate };
  })();

  var CHK_GLYPH = ["", "⚪", "👑", "⚫", "🏴"];

  function playCheckers(stage, mode) {
    var ui = boardShell(stage, 8, 8, "chk");
    var netBox = api.el("div", "net-box");
    stage.insertBefore(netBox, stage.firstChild);
    var s = Draughts.initial(), sel = -1, selMoves = [], over = false;
    var net = null, mySide = "w", netCleanup = function () {};

    // paint checkerboard colors
    ui.cells.forEach(function (c, i) {
      c.classList.add(((i >> 3) + (i & 7)) % 2 === 1 ? "dark" : "lite");
    });

    function render() {
      ui.cells.forEach(function (c, i) {
        var p = s.b[i];
        c.textContent = p ? (p === 2 ? "🤍" : p === 4 ? "🖤" : CHK_GLYPH[p]) : "";
        c.classList.toggle("sel", i === sel);
        c.classList.toggle("mv", selMoves.some(function (m) { return m.to === i; }));
        c.classList.toggle("cap", selMoves.some(function (m) { return m.to === i && m.captured.length; }));
      });
      var ms = Draughts.moves(s);
      if (!ms.length) ui.set(s.turn === "w" ? "⚫ wins! 🏆" : "⚪ wins! 🏆");
      else {
        var t = s.turn === "w" ? "⚪" : "⚫";
        var extra = mode === "online" ? (s.turn === mySide ? " — your move" : " — opponent's move")
          : mode === "solo" ? (s.turn === "b" ? " — AI thinking…" : "") : "";
        ui.set(t + " to move" + extra + (ms[0].captured.length ? " · capture required!" : ""));
      }
    }

    function doMove(m) {
      s = Draughts.apply(s, m);
      sel = -1; selMoves = [];
      api.beep(m.captured.length ? 600 : 440, 0.06);
      if (!Draughts.moves(s).length) { over = true; api.beep(760, 0.2); }
      render();
    }

    function aiTurn() {
      if (over || s.turn !== "b") return;
      setTimeout(function () {
        if (over || s.turn !== "b") return;
        var m = Draughts.bestMove(s, 4);
        if (m) doMove(m);
      }, 400);
    }

    ui.cells.forEach(function (c, i) {
      c.onclick = function () {
        if (over) return;
        if (mode === "online" && (!net || s.turn !== mySide)) return;
        if (mode === "solo" && s.turn === "b") return;
        var p = s.b[i], white = s.turn === "w";
        if (sel !== -1) {
          var m = selMoves.filter(function (x) { return x.to === i; })[0];
          if (m) {
            doMove(m);
            if (mode === "online" && net) net.send({ from: m.from, to: m.to });
            else if (mode === "solo") aiTurn();
            return;
          }
        }
        if (p && ((white && (p === 1 || p === 2)) || (!white && (p === 3 || p === 4)))) {
          sel = i;
          selMoves = Draughts.moves(s).filter(function (x) { return x.from === i; });
          api.beep(330, 0.04);
        } else { sel = -1; selMoves = []; }
        render();
      };
    });

    if (mode === "online") {
      netCleanup = netGame(netBox, {
        onOpen: function (n, isHost, setStatus) {
          net = n; mySide = isHost ? "w" : "b";
          netBox.style.display = "none";
          render();
          api.beep(660, 0.1);
        },
        onMove: function (d) {
          if (!net || over || typeof d.from !== "number") return;
          if (s.turn === mySide) return;
          var m = Draughts.moves(s).filter(function (x) { return x.from === d.from && x.to === d.to; })[0];
          if (m) doMove(m);
        },
        onPeerLeft: function () { over = true; },
      });
    } else {
      netBox.style.display = "none";
    }

    render();
    return function () { over = true; netCleanup(); ui.destroy(); };
  }

  NG.reg({ id: "checkers", name: "Checkers", icon: "⚫",
    modes: ["solo", "2p", "online"], start: playCheckers });

  /* ================= CHESS ================= */

  var Chess = (function () {
    var VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
    function on(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
    function side(p) { return p === p.toUpperCase() ? "w" : "b"; }

    function initial() {
      var back = ["r", "n", "b", "q", "k", "b", "n", "r"];
      var b = new Array(64).fill("");
      for (var i = 0; i < 8; i++) {
        b[i] = back[i]; b[8 + i] = "p";
        b[48 + i] = "P"; b[56 + i] = back[i].toUpperCase();
      }
      return { b: b, turn: "w", wk: true, wq: true, bk: true, bq: true, ep: -1 };
    }

    function attacked(s, sq, by) {
      var b = s.b, r = sq >> 3, c = sq & 7, i, rr, cc, p;
      var pawn = by === "w" ? "P" : "p";
      var pr = by === "w" ? r + 1 : r - 1;
      if (pr >= 0 && pr < 8) for (var dc = -1; dc <= 1; dc += 2) {
        cc = c + dc;
        if (cc >= 0 && cc < 8 && b[pr * 8 + cc] === pawn) return true;
      }
      var knight = by === "w" ? "N" : "n";
      var NN = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (i = 0; i < 8; i++) {
        rr = r + NN[i][0]; cc = c + NN[i][1];
        if (on(rr, cc) && b[rr * 8 + cc] === knight) return true;
      }
      var king = by === "w" ? "K" : "k";
      for (var dr = -1; dr <= 1; dr++) for (var dc2 = -1; dc2 <= 1; dc2++) {
        if (!dr && !dc2) continue;
        rr = r + dr; cc = c + dc2;
        if (on(rr, cc) && b[rr * 8 + cc] === king) return true;
      }
      var rq = by === "w" ? "Q" : "q", rk = by === "w" ? "R" : "r", bk = by === "w" ? "B" : "b";
      var RD = [[-1,0],[1,0],[0,-1],[0,1]], BD = [[-1,-1],[-1,1],[1,-1],[1,1]];
      for (i = 0; i < 4; i++) {
        rr = r + RD[i][0]; cc = c + RD[i][1];
        while (on(rr, cc)) {
          p = b[rr * 8 + cc];
          if (p) { if (p === rq || p === rk) return true; break; }
          rr += RD[i][0]; cc += RD[i][1];
        }
      }
      for (i = 0; i < 4; i++) {
        rr = r + BD[i][0]; cc = c + BD[i][1];
        while (on(rr, cc)) {
          p = b[rr * 8 + cc];
          if (p) { if (p === rq || p === bk) return true; break; }
          rr += BD[i][0]; cc += BD[i][1];
        }
      }
      return false;
    }

    function kingSq(s, color) {
      var k = color === "w" ? "K" : "k";
      for (var i = 0; i < 64; i++) if (s.b[i] === k) return i;
      return -1;
    }
    function inCheck(s, color) {
      return attacked(s, kingSq(s, color), color === "w" ? "b" : "w");
    }

    function pseudo(s, sq) {
      var b = s.b, p = b[sq];
      if (!p) return [];
      var r = sq >> 3, c = sq & 7, out = [], me = side(p), i, rr, cc, t;
      var isW = me === "w";
      function add(to, extra) {
        var m = { from: sq, to: to, piece: p, cap: b[to] || "" };
        if (extra) for (var k in extra) m[k] = extra[k];
        out.push(m);
      }
      var pl = p.toLowerCase();
      if (pl === "p") {
        var dir = isW ? -1 : 1, start = isW ? 6 : 1, lastR = isW ? 0 : 7;
        if (on(r + dir, c) && !b[(r + dir) * 8 + c]) {
          if (r + dir === lastR) {
            ["Q", "R", "B", "N"].forEach(function (q) { add((r + dir) * 8 + c, { promo: isW ? q : q.toLowerCase() }); });
          } else {
            add((r + dir) * 8 + c);
            if (r === start && !b[(r + 2 * dir) * 8 + c]) add((r + 2 * dir) * 8 + c, { dbl: true });
          }
        }
        for (var dc = -1; dc <= 1; dc += 2) {
          rr = r + dir; cc = c + dc;
          if (!on(rr, cc)) continue;
          t = rr * 8 + cc;
          if (b[t] && side(b[t]) !== me) {
            if (rr === lastR) {
              ["Q", "R", "B", "N"].forEach(function (q) { add(t, { promo: isW ? q : q.toLowerCase() }); });
            } else add(t);
          } else if (t === s.ep) add(t, { ep: true });
        }
      } else if (pl === "n") {
        var NN = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        for (i = 0; i < 8; i++) {
          rr = r + NN[i][0]; cc = c + NN[i][1];
          if (!on(rr, cc)) continue;
          t = rr * 8 + cc;
          if (!b[t] || side(b[t]) !== me) add(t);
        }
      } else if (pl === "k") {
        for (var dr = -1; dr <= 1; dr++) for (var dc3 = -1; dc3 <= 1; dc3++) {
          if (!dr && !dc3) continue;
          rr = r + dr; cc = c + dc3;
          if (!on(rr, cc)) continue;
          t = rr * 8 + cc;
          if (!b[t] || side(b[t]) !== me) add(t);
        }
        var home = isW ? 60 : 4, enemy = isW ? "b" : "w";
        if (sq === home && !inCheck(s, me)) {
          var ks = isW ? s.wk : s.bk, qs = isW ? s.wq : s.bq;
          var rook = isW ? "R" : "r";
          if (ks && !b[home + 1] && !b[home + 2] && b[home + 3] === rook &&
              !attacked(s, home + 1, enemy) && !attacked(s, home + 2, enemy))
            add(home + 2, { castle: "K" });
          if (qs && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === rook &&
              !attacked(s, home - 1, enemy) && !attacked(s, home - 2, enemy))
            add(home - 2, { castle: "Q" });
        }
      } else {
        var dirs = pl === "r" ? [[-1,0],[1,0],[0,-1],[0,1]] :
                   pl === "b" ? [[-1,-1],[-1,1],[1,-1],[1,1]] :
                   [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
        for (i = 0; i < dirs.length; i++) {
          rr = r + dirs[i][0]; cc = c + dirs[i][1];
          while (on(rr, cc)) {
            t = rr * 8 + cc;
            if (!b[t]) add(t);
            else { if (side(b[t]) !== me) add(t); break; }
            rr += dirs[i][0]; cc += dirs[i][1];
          }
        }
      }
      return out;
    }

    function apply(s, m) {
      var b = s.b.slice(), me = side(m.piece);
      var n = { b: b, turn: me === "w" ? "b" : "w", wk: s.wk, wq: s.wq, bk: s.bk, bq: s.bq, ep: -1 };
      b[m.from] = "";
      if (m.ep) b[m.to + (me === "w" ? 8 : -8)] = "";
      b[m.to] = m.promo || m.piece;
      if (m.castle === "K") { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = ""; }
      if (m.castle === "Q") { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = ""; }
      if (m.dbl) n.ep = m.from + (me === "w" ? -8 : 8);
      if (m.piece === "K") { n.wk = false; n.wq = false; }
      if (m.piece === "k") { n.bk = false; n.bq = false; }
      var clr = [[63, "wk"], [56, "wq"], [7, "bk"], [0, "bq"]];
      for (var i = 0; i < 4; i++)
        if (m.from === clr[i][0] || m.to === clr[i][0]) n[clr[i][1]] = false;
      return n;
    }

    function legal(s) {
      var out = [];
      for (var sq = 0; sq < 64; sq++) {
        var p = s.b[sq];
        if (!p || side(p) !== s.turn) continue;
        var ps = pseudo(s, sq);
        for (var i = 0; i < ps.length; i++) {
          if (!inCheck(apply(s, ps[i]), s.turn)) out.push(ps[i]);
        }
      }
      return out;
    }

    function evaluate(s) {
      var sc = 0;
      for (var i = 0; i < 64; i++) {
        var p = s.b[i];
        if (!p) continue;
        var v = VAL[p.toLowerCase()];
        var r = i >> 3, c = i & 7;
        // tiny centrality nudge for knights/pawns
        if (p === "N" || p === "n" || p === "P" || p === "p") {
          var cen = 3.5 - (Math.abs(3.5 - r) + Math.abs(3.5 - c)) / 2;
          v += Math.round(cen * 6);
        }
        sc += side(p) === "w" ? v : -v;
      }
      return s.turn === "w" ? sc : -sc;
    }

    function search(s, depth, alpha, beta) {
      var ms = legal(s);
      if (!ms.length) return inCheck(s, s.turn) ? -100000 - depth : 0;
      if (depth === 0) return evaluate(s);
      ms.sort(function (a, b2) { return (b2.cap ? 1 : 0) - (a.cap ? 1 : 0); });
      var best = -Infinity;
      for (var i = 0; i < ms.length; i++) {
        var sc = -search(apply(s, ms[i]), depth - 1, -beta, -alpha);
        if (sc > best) best = sc;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }

    function bestMove(s, depth) {
      var ms = legal(s);
      if (!ms.length) return null;
      ms.sort(function (a, b2) { return (b2.cap ? 1 : 0) - (a.cap ? 1 : 0); });
      var best = null, bs = -Infinity;
      for (var i = 0; i < ms.length; i++) {
        var sc = -search(apply(s, ms[i]), depth - 1, -Infinity, Infinity) + Math.random() * 8;
        if (sc > bs) { bs = sc; best = ms[i]; }
      }
      return best;
    }

    return {
      initial: initial, legal: legal, apply: apply, inCheck: inCheck,
      bestMove: bestMove, evaluate: evaluate, side: side,
    };
  })();

  var CHESS_GLYPH = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟",
                      k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

  function playChess(stage, mode) {
    var ui = boardShell(stage, 8, 8, "chess");
    var netBox = api.el("div", "net-box");
    stage.insertBefore(netBox, stage.firstChild);
    var s = Chess.initial(), sel = -1, selMoves = [], over = false, lastMove = null;
    var net = null, mySide = "w", netCleanup = function () {};

    ui.cells.forEach(function (c, i) {
      c.classList.add(((i >> 3) + (i & 7)) % 2 === 0 ? "lite" : "dark");
    });

    function render() {
      ui.cells.forEach(function (c, i) {
        var p = s.b[i];
        c.textContent = p ? CHESS_GLYPH[p] : "";
        c.classList.toggle("white", !!p && Chess.side(p) === "w");
        c.classList.toggle("black", !!p && Chess.side(p) === "b");
        c.classList.toggle("sel", i === sel);
        c.classList.toggle("mv", selMoves.some(function (m) { return m.to === i; }));
        c.classList.toggle("cap", selMoves.some(function (m) { return m.to === i && (m.cap || m.ep); }));
        c.classList.toggle("last", !!lastMove && (lastMove.from === i || lastMove.to === i));
        c.classList.toggle("check", !!p && p.toLowerCase() === "k" && Chess.side(p) === s.turn && Chess.inCheck(s, s.turn));
      });
      var ms = Chess.legal(s);
      if (!ms.length) {
        ui.set(Chess.inCheck(s, s.turn)
          ? (s.turn === "w" ? "Black wins — checkmate! 🏆" : "White wins — checkmate! 🏆")
          : "Stalemate — draw.");
        if (!over) { over = true; api.beep(760, 0.25); }
      } else {
        var t = s.turn === "w" ? "White" : "Black";
        var extra = mode === "online" ? (s.turn === mySide ? " — your move" : " — opponent's move")
          : mode === "solo" ? (s.turn === "b" ? " — AI thinking…" : "") : "";
        var chk = Chess.inCheck(s, s.turn) ? " · check!" : "";
        ui.set(t + " to move" + extra + chk);
      }
    }

    function doMove(m) {
      // auto-queen promotions (casual play)
      if (m.promo && (m.promo === "Q" || m.promo === "q")) { /* keep */ }
      else if (m.piece.toLowerCase() === "p") {
        // collapse the 4 promo options to queen for simplicity
        var tr = m.to >> 3;
        if (tr === 0 || tr === 7) m = { from: m.from, to: m.to, piece: m.piece, cap: m.cap, promo: Chess.side(m.piece) === "w" ? "Q" : "q" };
      }
      lastMove = m;
      s = Chess.apply(s, m);
      sel = -1; selMoves = [];
      api.beep(m.cap || m.ep ? 600 : 440, 0.06);
      render();
    }

    function aiTurn() {
      if (over || s.turn !== "b") return;
      render();
      setTimeout(function () {
        if (over || s.turn !== "b") return;
        var m = Chess.bestMove(s, 2);
        if (m) doMove(m);
      }, 450);
    }

    ui.cells.forEach(function (c, i) {
      c.onclick = function () {
        if (over) return;
        if (mode === "online" && (!net || s.turn !== mySide)) return;
        if (mode === "solo" && s.turn === "b") return;
        if (sel !== -1) {
          var m = selMoves.filter(function (x) { return x.to === i; })[0];
          if (m) {
            doMove(m);
            if (mode === "online" && net) net.send({ from: m.from, to: m.to });
            else if (mode === "solo") aiTurn();
            return;
          }
        }
        var p = s.b[i];
        if (p && Chess.side(p) === s.turn) {
          sel = i;
          selMoves = Chess.legal(s).filter(function (x) { return x.from === i; });
          api.beep(330, 0.04);
        } else { sel = -1; selMoves = []; }
        render();
      };
    });

    if (mode === "online") {
      netCleanup = netGame(netBox, {
        onOpen: function (n, isHost, setStatus) {
          net = n; mySide = isHost ? "w" : "b";
          netBox.style.display = "none";
          render();
          api.beep(660, 0.1);
        },
        onMove: function (d) {
          if (!net || over || typeof d.from !== "number") return;
          if (s.turn === mySide) return;
          var m = Chess.legal(s).filter(function (x) { return x.from === d.from && x.to === d.to; })[0];
          if (m) doMove(m);
        },
        onPeerLeft: function () { over = true; },
      });
    } else {
      netBox.style.display = "none";
    }

    render();
    return function () { over = true; netCleanup(); ui.destroy(); };
  }

  NG.reg({ id: "chess", name: "Chess", icon: "♞",
    modes: ["solo", "2p", "online"], start: playChess });

  /* expose pure logic for tests */
  var exp = { TTT: TTT, C4: C4, Draughts: Draughts, Chess: Chess };
  if (typeof module !== "undefined" && module.exports) module.exports = exp;
})(typeof window !== "undefined" ? window : globalThis);
