import { describe, expect, it } from 'vitest';
import { dijkstra } from '../src/algo/dijkstra';
import { odMatrix } from '../src/algo/od';
import { bestTour, enumerateTours, factorial, heldKarp, tourCost } from '../src/algo/tsp';
import { roadNetwork } from '../src/graph/roadNetwork';
import { buildSearchGraph, makeGraph } from '../src/graph/searchGraph';
import { closeTo, pathCost, randomGraph, rng } from './helpers';

describe('OD マトリックス', () => {
  it('各セルは、その組み合わせの1対1探索の最短コストと一致する（行=出発、列=到着）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = randomGraph(seed, 30, 90);
      const pts = [0, 7, 13, 21, 29];
      const od = odMatrix(g, pts);
      pts.forEach((o, i) =>
        pts.forEach((d, j) => {
          const one = dijkstra(g, { sources: o, targets: [d] }).dist[d];
          expect(od.matrix[i][j]).toBe(o === d ? 0 : one);
          if (Number.isFinite(one) && o !== d) expect(closeTo(pathCost(g, od.paths[i][j]!), one)).toBe(true);
          if (!Number.isFinite(one)) expect(od.paths[i][j]).toBeNull();
        }),
      );
    }
  });

  it('行と列の向きを取り違えない（一方通行で非対称になる）', () => {
    const e = (from: number, to: number, cost: number) => ({ from, to, cost, road: 0, forward: true });
    const g = makeGraph(3, [e(0, 1, 1), e(1, 2, 1), e(2, 0, 1)]);
    const od = odMatrix(g, [0, 1]);
    expect(od.matrix[0][1]).toBe(1); // 0 → 1
    expect(od.matrix[1][0]).toBe(2); // 1 → 2 → 0
  });

  it('到達不能な組み合わせは Infinity', () => {
    const g = makeGraph(2, [{ from: 0, to: 1, cost: 3, road: 0, forward: true }]);
    const od = odMatrix(g, [0, 1]);
    expect(od.matrix[1][0]).toBe(Infinity);
    expect(od.paths[1][0]).toBeNull();
  });
});

describe('巡回セールスマン問題', () => {
  it('全列挙は (n-1)! 通りで、最小は Held-Karp の厳密解と一致する（非対称コスト）', () => {
    const r = rng(11);
    for (let n = 2; n <= 7; n++) {
      for (let trial = 0; trial < 20; trial++) {
        const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 1 + Math.floor(r() * 50))));
        const tours = enumerateTours(m);
        expect(tours).toHaveLength(factorial(n - 1));
        const best = bestTour(tours)!;
        const hk = heldKarp(m)!;
        expect(hk.cost).toBe(best.cost);
        expect(tourCost(m, hk.order)).toBe(hk.cost);
      }
    }
  });

  it('非対称なら、逆回りの巡回はコストが違いうる', () => {
    const m = [
      [0, 1, 9],
      [9, 0, 1],
      [1, 9, 0],
    ];
    expect(tourCost(m, [0, 1, 2])).toBe(3);
    expect(tourCost(m, [0, 2, 1])).toBe(27);
    expect(heldKarp(m)!.order).toEqual([0, 1, 2]);
  });

  it('到達不能な区間しかなければ巡回できない', () => {
    const m = [
      [0, 1],
      [Infinity, 0],
    ];
    expect(bestTour(enumerateTours(m))).toBeNull();
    expect(heldKarp(m)).toBeNull();
  });

  it('道路ネットワーク上で、巡回コストは OD マトリックスの和と一致し、道路上の経路に正しく復元できる', () => {
    const net = roadNetwork();
    const g = buildSearchGraph(net, { mode: 'car', metric: 'time' });
    const pts = [net.poi.depot, net.poi.west, net.poi.east, net.poi.store, net.poi.carStore];
    const od = odMatrix(g, pts);
    const best = bestTour(enumerateTours(od.matrix))!;
    expect(best.cost).toBeCloseTo(heldKarp(od.matrix)!.cost, 9);
    // 区間ごとの経路をつなぐと、出発地点に戻る1本の経路になる
    const legs = best.order.map((i, k) => od.paths[i][best.order[(k + 1) % best.order.length]]!);
    const route = legs.flat();
    let cur = pts[best.order[0]];
    for (const id of route) {
      expect(g.edges[id].from).toBe(cur);
      cur = g.edges[id].to;
    }
    expect(cur).toBe(pts[best.order[0]]);
    expect(closeTo(pathCost(g, route), best.cost)).toBe(true);
  });
});
