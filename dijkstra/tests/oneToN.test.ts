import { describe, expect, it } from 'vitest';
import { dijkstra } from '../src/algo/dijkstra';
import { makeGraph } from '../src/graph/searchGraph';
import { randomGraph } from './helpers';

describe('1対N', () => {
  it('1回の1対N探索の結果は、目的地ごとの1対1探索の結果と一致する', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = randomGraph(seed, 40, 120);
      const targets = [3, 11, 17, 25, 39];
      const many = dijkstra(g, { sources: 0, targets });
      for (const t of targets) {
        const one = dijkstra(g, { sources: 0, targets: [t] });
        expect(many.dist[t]).toBe(one.dist[t]);
      }
    }
  });

  it('確定の順番は、1対1・1対N・1対全点で共通（終了位置だけが違う）', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = randomGraph(seed, 40, 120);
      const all = dijkstra(g, { sources: 0 }).order;
      for (const targets of [[5], [5, 9, 30], [12, 38]]) {
        const r = dijkstra(g, { sources: 0, targets });
        expect(all.slice(0, r.order.length)).toEqual(r.order);
      }
    }
  });

  it('目的地がすべて確定した時点で終了し、それ以上は確定しない', () => {
    // 0 -1-> 1 -1-> 2 -1-> 3
    const g = makeGraph(4, [0, 1, 2].map((i) => ({ from: i, to: i + 1, cost: 1, road: i, forward: true })));
    const r = dijkstra(g, { sources: 0, targets: [2, 1] });
    expect(r.reason).toBe('targets');
    expect(r.order).toEqual([0, 1, 2]);
    expect(r.settled[3]).toBe(0);
  });

  it('到達不能な目的地が含まれていても、到達可能な目的地は正しく求まる', () => {
    const g = makeGraph(4, [
      { from: 0, to: 1, cost: 2, road: 0, forward: true },
      { from: 3, to: 0, cost: 1, road: 1, forward: true },
    ]);
    const r = dijkstra(g, { sources: 0, targets: [1, 3] });
    expect(r.dist[1]).toBe(2);
    expect(r.dist[3]).toBe(Infinity);
    expect(r.reason).toBe('exhausted');
  });
});
