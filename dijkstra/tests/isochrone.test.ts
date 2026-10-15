import { describe, expect, it } from 'vitest';
import { dijkstra } from '../src/algo/dijkstra';
import { mergeIntervals, reachableSegments } from '../src/algo/isochrone';
import { buildMesh, cellKey, meshOutline, visitCells } from '../src/algo/mesh';
import { roadNetwork } from '../src/graph/roadNetwork';
import { buildSearchGraph, makeGraph, reverseGraph } from '../src/graph/searchGraph';
import { rng } from './helpers';

const e = (from: number, to: number, cost: number) => ({ from, to, cost, road: 0, forward: true });

describe('到達圏', () => {
  it('交差点 A まで 9 分、A→B が 3 分なら、10 分の到達限界は A→B の 1/3 の地点', () => {
    // S -9-> A -3-> B
    const g = makeGraph(3, [e(0, 1, 9), e(1, 2, 3)]);
    const r = dijkstra(g, { sources: 0, maxCost: 10 });
    const segs = reachableSegments(g, r.dist, r.settled, 10);
    const ab = segs.find((s) => s.from === 1)!;
    expect(ab.reach).toBeCloseTo(1 / 3, 12);
    expect(segs.find((s) => s.from === 0)!.reach).toBe(1);
    expect(r.settled[2]).toBe(0);
  });

  it('上限以内のノードは全点探索の結果と一致し、上限を超えるノードは確定しない', () => {
    const net = roadNetwork();
    const g = buildSearchGraph(net, { mode: 'walk', metric: 'time' });
    const full = dijkstra(g, { sources: net.poi.store });
    const lim = dijkstra(g, { sources: net.poi.store, maxCost: 10 });
    for (let v = 0; v < g.n; v++) {
      if (full.dist[v] <= 10) {
        expect(lim.settled[v]).toBe(1);
        expect(lim.dist[v]).toBe(full.dist[v]);
      } else expect(lim.settled[v]).toBe(0);
    }
    // 各区間の終点のコストは上限以下で、途中で止まる区間はちょうど上限に達している
    for (const s of reachableSegments(g, lim.dist, lim.settled, 10)) {
      const end = s.c0 + s.w * s.reach;
      expect(end).toBeLessThanOrEqual(10 + 1e-9);
      if (s.reach < 1) expect(end).toBeCloseTo(10, 9);
    }
  });

  it('一方通行があると「店舗から」と「店舗へ」（反転グラフ）で到達範囲が違う', () => {
    // 0 -> 1 は一方通行（1 -> 0 は遠回り）
    const g = makeGraph(3, [e(0, 1, 2), e(1, 2, 2), e(2, 0, 2)]);
    const out = dijkstra(g, { sources: 0, maxCost: 3 });
    const inn = dijkstra(reverseGraph(g), { sources: 0, maxCost: 3 });
    expect(out.settled[1]).toBe(1); // 0 から 1 へは 2
    expect(inn.settled[1]).toBe(0); // 1 から 0 へは 1→2→0 で 4
    expect(inn.settled[2]).toBe(1); // 2 から 0 へは 2
  });

  it('区間の和集合', () => {
    expect(mergeIntervals([[0, 0.3], [0.7, 1]])).toEqual([[0, 0.3], [0.7, 1]]);
    expect(mergeIntervals([[0, 0.6], [0.5, 1]])).toEqual([[0, 1]]);
  });
});

describe('メッシュ化', () => {
  it('水平な線分は同じ行のセルを順に通る', () => {
    const got: string[] = [];
    visitCells(5, 5, 95, 5, 10, (ix, iy) => got.push(cellKey(ix, iy)));
    expect(got).toEqual([...Array(10).keys()].map((i) => cellKey(i, 0)));
  });

  it('線分上の点を細かく取ったときのセルはすべて含まれ、余分なセルは線分と接している', () => {
    const r = rng(3);
    for (let n = 0; n < 300; n++) {
      const [x0, y0, x1, y1] = [r() * 500, r() * 500, r() * 500, r() * 500];
      const size = 10 + r() * 40;
      const got = new Map<string, number>();
      visitCells(x0, y0, x1, y1, size, (ix, iy, t) => got.set(cellKey(ix, iy), t));
      for (let i = 0; i <= 2000; i++) {
        const t = i / 2000;
        const k = cellKey(Math.floor((x0 + (x1 - x0) * t) / size), Math.floor((y0 + (y1 - y0) * t) / size));
        expect(got.has(k)).toBe(true);
        // 入口の t は、その点の t 以下
        expect(got.get(k)!).toBeLessThanOrEqual(t + 1e-9);
      }
      for (const k of got.keys()) {
        const [ix, iy] = k.split(',').map(Number);
        expect(segmentTouchesRect(x0, y0, x1, y1, ix * size, iy * size, size)).toBe(true);
      }
    }
  });

  it('セルの値は、そのセルに入る点のコスト（最小コスト）', () => {
    const m = buildMesh([{ x0: 5, y0: 5, x1: 25, y1: 5, c0: 0, c1: 20 }], 10);
    expect(m.cells.get(cellKey(0, 0))).toBe(0);
    expect(m.cells.get(cellKey(1, 0))).toBeCloseTo(5, 9);
    expect(m.cells.get(cellKey(2, 0))).toBeCloseTo(15, 9);
  });

  it('輪郭は隣にセルがない辺だけ', () => {
    const m = buildMesh([{ x0: 5, y0: 5, x1: 15, y1: 5, c0: 0, c1: 1 }], 10);
    expect(meshOutline(m)).toHaveLength(6);
  });
});

/** 線分と正方形（境界を含む）が交わるか */
function segmentTouchesRect(x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, s: number): boolean {
  // Liang–Barsky で線分を矩形にクリップし、残るかどうか
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const eps = 1e-7;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-15) return q >= -eps;
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    return true;
  };
  if (!clip(-dx, x0 - rx + eps)) return false;
  if (!clip(dx, rx + s - x0 + eps)) return false;
  if (!clip(-dy, y0 - ry + eps)) return false;
  if (!clip(dy, ry + s - y0 + eps)) return false;
  return t0 <= t1 + 1e-9;
}
