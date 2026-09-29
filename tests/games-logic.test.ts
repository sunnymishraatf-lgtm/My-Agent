/**
 * Game logic tests: pure rules/AI helpers for the board games and arcade
 * helpers. The browser IIFE modules export their logic via module.exports
 * when loaded in node; we stub the minimal NeutronGames surface.
 */
import { describe, it, expect } from "vitest";
// @ts-ignore - stub must load before the game modules
import "./games-stub.js";
// @ts-ignore - plain JS modules with a module.exports fallback
import boardModule from "../src/web/app/games-board.js";
// @ts-ignore - plain JS modules with a module.exports fallback
import arcadeModule from "../src/web/app/games-arcade.js";

const board: any = (boardModule as any).default || boardModule;
const arcade: any = (arcadeModule as any).default || arcadeModule;

describe("game registry", () => {
  it("registers 22 games", () => {
    const regs = (globalThis as any).__gameRegs;
    expect(regs.length).toBe(22);
    const ids = regs.map((r: any) => r.id);
    expect(new Set(ids).size).toBe(22);
    for (const want of ["chess", "checkers", "tictactoe", "connect4", "snake", "tetris",
      "g2048", "minesweeper", "breakout", "pong", "airhockey", "memory", "simon",
      "flappy", "asteroids", "shooter", "sudoku", "racing", "reflex", "boxing",
      "snakebattle", "tankduel"]) {
      expect(ids).toContain(want);
    }
  });
});

describe("tic-tac-toe", () => {
  const TTT = board.TTT;
  it("detects wins and draws", () => {
    expect(TTT.winner([1,1,1,0,0,0,0,0,0])).toBe(1);
    expect(TTT.winner([2,0,0,0,2,0,0,0,2])).toBe(2);
    expect(TTT.winner([1,2,1,1,2,2,2,1,1])).toBe("draw");
    expect(TTT.winner(TTT.empty())).toBe(0);
  });
  it("AI takes a winning move", () => {
    const b = [1,1,0, 2,2,0, 0,0,0];
    expect(TTT.best(b, 1)).toBe(2);
  });
  it("AI blocks the opponent's win", () => {
    const b = [2,2,0, 1,0,0, 0,0,1];
    expect(TTT.best(b, 1)).toBe(2);
  });
  it("AI never loses from empty (draw or win)", () => {
    // AI (1) vs greedy opponent: play out, AI must not lose
    const b = TTT.empty();
    let turn = 1;
    for (let i = 0; i < 9; i++) {
      if (turn === 1) { const m = TTT.best(b, 1); b[m] = 1; }
      else { const e = TTT.empties(b); b[e[0]] = 2; }
      const w = TTT.winner(b);
      if (w) { expect(w).not.toBe(2); break; }
      turn = turn === 1 ? 2 : 1;
    }
  });
});

describe("connect-4", () => {
  const C4 = board.C4;
  function dropSeq(cols: number[], side = 1) {
    const b = C4.empty();
    let s = side;
    for (const c of cols) { C4.play(b, c, s); s = s === 1 ? 2 : 1; }
    return b;
  }
  it("detects horizontal, vertical and diagonal wins", () => {
    expect(C4.winner(dropSeq([0,0,1,1,2,2,3]))).toBe(1); // horizontal bottom
    const v = C4.empty();
    C4.play(v, 0, 2); C4.play(v, 0, 2); C4.play(v, 0, 2); C4.play(v, 0, 2);
    expect(C4.winner(v)).toBe(2); // vertical
    // diagonal: build / shape manually
    const d = C4.empty();
    const put = (r: number, c: number, s: number) => { d[r * 7 + c] = s; };
    put(5,0,1); put(4,1,1); put(3,2,1); put(2,3,1);
    expect(C4.winner(d)).toBe(1);
  });
  it("AI takes an immediate win", () => {
    const b = dropSeq([0,1,0,1,0,1]); // side1 has 3 in col 0 (rows 5,3,1?) — simpler: stack col 3
    const b2 = C4.empty();
    C4.play(b2, 3, 1); C4.play(b2, 3, 1); C4.play(b2, 3, 1);
    expect(C4.best(b2, 1, 3)).toBe(3);
  });
  it("dropRow reports full columns", () => {
    const b = C4.empty();
    for (let i = 0; i < 6; i++) C4.play(b, 0, 1);
    expect(C4.dropRow(b, 0)).toBe(-1);
    expect(C4.dropRow(b, 1)).toBe(5);
  });
});

describe("checkers", () => {
  const D = board.Draughts;
  it("starts with 7 moves for white", () => {
    expect(D.moves(D.initial()).length).toBe(7);
  });
  it("captures are mandatory", () => {
    // white man at (5,2)=42, black man at (4,3)=35 -> must capture to (3,4)=28
    const b = new Array(64).fill(0);
    b[42] = 1; b[35] = 3; b[47] = 1;
    const ms = D.moves({ b, turn: "w" });
    expect(ms.length).toBe(1);
    expect(ms[0].captured).toEqual([35]);
  });
  it("multi-jump expands fully", () => {
    const b = new Array(64).fill(0);
    b[42] = 1; b[35] = 3; b[21] = 3; // (5,2) jumps (4,3)->(3,4), then (2,5)->(1,6)
    const ms = D.moves({ b, turn: "w" });
    expect(ms.length).toBe(1);
    expect(ms[0].captured).toEqual([35, 21]);
    expect(ms[0].to).toBe(14);
  });
  it("crowns on reaching the last rank", () => {
    const b = new Array(64).fill(0);
    b[10] = 1; // (1,2) -> (0,1) or (0,3)
    const ms = D.moves({ b, turn: "w" });
    expect(ms.length).toBe(2);
    const s2 = D.apply({ b, turn: "w" }, ms[0]);
    expect(s2.b[ms[0].to]).toBe(2);
  });
  it("AI returns a legal move", () => {
    const s = D.initial();
    const m = D.bestMove(s, 2);
    expect(m).not.toBeNull();
    expect(D.moves(s).some((x: any) => x.from === m.from && x.to === m.to)).toBe(true);
  });
});

describe("chess", () => {
  const C = board.Chess;
  it("has 20 legal opening moves", () => {
    expect(C.legal(C.initial()).length).toBe(20);
  });
  it("detects fool's mate", () => {
    let s = C.initial();
    const mv = (f: number, t: number) => {
      const m = C.legal(s).find((x: any) => x.from === f && x.to === t);
      expect(m, `move ${f}-${t} legal`).toBeTruthy();
      s = C.apply(s, m);
    };
    // f3 e5 g4 Qh4#
    mv(53, 45); mv(12, 28); mv(54, 38); mv(3, 39);
    expect(C.legal(s).length).toBe(0);
    expect(C.inCheck(s, "w")).toBe(true);
  });
  it("allows kingside castling when clear", () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 — then white can castle
    let s = C.initial();
    const mv = (f: number, t: number) => { s = C.apply(s, C.legal(s).find((x: any) => x.from === f && x.to === t)); };
    mv(52, 36); mv(12, 28); mv(62, 45); mv(1, 18); mv(61, 34); mv(6, 21);
    const castles = C.legal(s).filter((x: any) => x.castle);
    expect(castles.length).toBe(1);
    expect(castles[0].to).toBe(62);
    const s2 = C.apply(s, castles[0]);
    expect(s2.b[62]).toBe("K");
    expect(s2.b[61]).toBe("R");
  });
  it("generates en passant captures", () => {
    let s = C.initial();
    const mv = (f: number, t: number) => { s = C.apply(s, C.legal(s).find((x: any) => x.from === f && x.to === t)); };
    mv(52, 36); mv(8, 24); mv(36, 28); mv(11, 27); // e4 a6 e5 d5
    const eps = C.legal(s).filter((x: any) => x.ep);
    expect(eps.length).toBe(1);
    expect(eps[0].from).toBe(28);
    expect(eps[0].to).toBe(19);
  });
  it("AI returns a legal move", () => {
    const m = C.bestMove(C.initial(), 2);
    expect(m).not.toBeNull();
    expect(C.legal(C.initial()).some((x: any) => x.from === m.from && x.to === m.to)).toBe(true);
  });
  it("stalemate is not checkmate", () => {
    // K vs K+Q stalemate: white Ka6, black Kc8... construct: black king a8, white queen b6, white king c6, black to move
    const b = new Array(64).fill("");
    b[0] = "k"; b[17] = "Q"; b[18] = "K";
    const s = { b, turn: "b", wk: false, wq: false, bk: false, bq: false, ep: -1 };
    expect(C.inCheck(s, "b")).toBe(false);
    expect(C.legal(s).length).toBe(0);
  });
});

describe("2048", () => {
  const G = arcade.g2048;
  it("slides and merges left once per tile", () => {
    expect(G.slide([2, 2, 4, 4])).toEqual({ row: [4, 8, 0, 0], gained: 12 });
    expect(G.slide([2, 2, 2, 2])).toEqual({ row: [4, 4, 0, 0], gained: 8 });
    expect(G.slide([4, 0, 4, 2])).toEqual({ row: [8, 2, 0, 0], gained: 8 });
  });
  it("move detects no-ops", () => {
    const g = [[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,2]];
    expect(G.move(g, "L").moved).toBe(false);
    expect(G.canMove(g)).toBe(false);
  });
  it("move shifts up correctly", () => {
    const g = [[0,0,0,0],[0,0,0,0],[2,0,0,0],[2,0,0,0]];
    const r = G.move(g, "U");
    expect(r.moved).toBe(true);
    expect(r.grid[0][0]).toBe(4);
    expect(r.gained).toBe(4);
  });
});

describe("tetris", () => {
  it("rotate is a 4-cycle", () => {
    const T = [[0,1,0],[1,1,1],[0,0,0]];
    let m: number[][] = T;
    for (let i = 0; i < 4; i++) m = arcade.tetrisRotate(m);
    expect(m).toEqual(T);
  });
  it("I-piece rotates to vertical", () => {
    const I = [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]];
    const v = arcade.tetrisRotate(I);
    // horizontal bar on row 1 -> vertical bar on column 2
    expect(v.map((r: number[]) => r[2])).toEqual([1, 1, 1, 1]);
    expect(v[0][0]).toBe(0);
    expect(v[3][3]).toBe(0);
  });
});

describe("minesweeper", () => {
  it("places the right mine count and keeps the safe zone clear", () => {
    const g = arcade.minesweeper.build(9, 9, 10, 4, 4);
    let mines = 0;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (g[r][c] === -1) {
        mines++;
        expect(Math.abs(r - 4) <= 1 && Math.abs(c - 4) <= 1).toBe(false);
      }
    }
    expect(mines).toBe(10);
  });
  it("neighbor counts are consistent", () => {
    const g = arcade.minesweeper.build(9, 9, 10, 0, 0);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (g[r][c] === -1) continue;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < 9 && cc >= 0 && cc < 9 && g[rr][cc] === -1) n++;
      }
      expect(g[r][c]).toBe(n);
    }
  });
});

describe("sudoku", () => {
  function validGrid(g: number[][]) {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const v = g[r]![c]!;
      for (let i = 0; i < 9; i++) {
        if (i !== c && g[r]![i] === v) return false;
        if (i !== r && g[i]![c] === v) return false;
      }
      const br = ((r / 3) | 0) * 3, bc = ((c / 3) | 0) * 3;
      for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
        const rr = br + dr, cc = bc + dc;
        if ((rr !== r || cc !== c) && g[rr]![cc] === v) return false;
      }
    }
    return true;
  }
  it("generates valid solved grids", () => {
    for (let i = 0; i < 5; i++) expect(validGrid(arcade.sudoku.solved())).toBe(true);
  });
  it("puzzle matches its solution on givens", () => {
    const { p, sol } = arcade.sudoku.puzzle(44);
    let holes = 0;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (!p[r][c]) holes++;
      else expect(p[r][c]).toBe(sol[r][c]);
    }
    expect(holes).toBe(44);
  });
});
