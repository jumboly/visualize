import { describe, expect, it } from 'vitest';
import { dijkstra, edgesToNodes, pathEdges } from '../src/algo/dijkstra';
import { makeGraph } from '../src/graph/searchGraph';
import { MinHeap } from '../src/algo/heap';
import { bellmanFord, closeTo, pathCost, randomGraph, rng } from './helpers';

const e = (from: number, to: number, cost: number) => ({ from, to, cost, road: 0, forward: true });

describe('MinHeap', () => {
  it('キーの小さい順に取り出し、同点は値の小さい順', () => {
    const h = new MinHeap();
    const r = rng(1);
    const items: Array<[number, number]> = [];
    for (let i = 0; i < 200; i++) items.push([Math.floor(r() * 20), i]);
    for (const [k, v] of items) h.push(k, v);
    const out: Array<[number, number]> = [];
    for (let x = h.pop(); x; x = h.pop()) out.push([x.key, x.val]);
    const sorted = [...items].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(out).toEqual(sorted);
  });
});

describe('ダイクストラ法', () => {
  it('手計算できる小さなグラフで最短コストと経路が正しい', () => {
    // 0→1 (4), 0→2 (1), 2→1 (2), 1→3 (1), 2→3 (5)
    const g = makeGraph(4, [e(0, 1, 4), e(0, 2, 1), e(2, 1, 2), e(1, 3, 1), e(2, 3, 5)]);
    const r = dijkstra(g, { sources: 0 });
    expect(Array.from(r.dist)).toEqual([0, 3, 1, 4]);
    expect(edgesToNodes(g, pathEdges(g, r, 3)!, 0)).toEqual([0, 2, 1, 3]);
  });

  it('ランダムな有向グラフで Bellman-Ford と一致し、復元した経路のコストも一致する', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const g = randomGraph(seed, 30, 70);
      const r = dijkstra(g, { sources: 0 });
      const bf = bellmanFord(g, 0);
      for (let v = 0; v < g.n; v++) {
        expect(closeTo(r.dist[v], bf[v])).toBe(true);
        const p = pathEdges(g, r, v);
        if (Number.isFinite(bf[v])) {
          expect(p).not.toBeNull();
          expect(closeTo(pathCost(g, p!), bf[v])).toBe(true);
          // 経路がつながっている
          let cur = 0;
          for (const id of p!) {
            expect(g.edges[id].from).toBe(cur);
            cur = g.edges[id].to;
          }
          expect(cur).toBe(v);
        } else expect(p).toBeNull();
      }
    }
  });

  it('到達不能なノードは Infinity で、確定されない', () => {
    const g = makeGraph(3, [e(0, 1, 2)]);
    const r = dijkstra(g, { sources: 0 });
    expect(r.dist[2]).toBe(Infinity);
    expect(r.settled[2]).toBe(0);
    expect(pathEdges(g, r, 2)).toBeNull();
  });

  it('一方通行（有向エッジ）は逆向きに通れない', () => {
    const g = makeGraph(2, [e(0, 1, 3)]);
    expect(dijkstra(g, { sources: 0 }).dist[1]).toBe(3);
    expect(dijkstra(g, { sources: 1 }).dist[0]).toBe(Infinity);
  });

  it('暫定コストの更新は単調に小さくなり、最後の更新値が確定コストになる', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = randomGraph(seed, 25, 80);
      const r = dijkstra(g, { sources: 0, record: true });
      const prov = new Map<number, number>([[0, 0]]);
      for (const ev of r.events) {
        if (ev.type === 'relax') {
          expect(ev.cand).toBe(r.dist[ev.from] + g.edges[ev.edge].cost);
          expect(ev.old).toBe(prov.get(ev.to) ?? Infinity);
          if (ev.improved) {
            expect(ev.cand).toBeLessThan(ev.old);
            prov.set(ev.to, ev.cand);
          } else expect(ev.cand >= ev.old || ev.toSettled).toBe(true);
        }
        if (ev.type === 'settle') expect(ev.cost).toBe(prov.get(ev.node));
      }
    }
  });

  it('確定コストは単調非減少で、確定済みノードは二度と更新されない', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = randomGraph(seed, 25, 80);
      const r = dijkstra(g, { sources: 0, record: true });
      let last = -Infinity;
      const done = new Set<number>();
      for (const ev of r.events) {
        if (ev.type === 'settle') {
          expect(ev.cost).toBeGreaterThanOrEqual(last);
          expect(done.has(ev.node)).toBe(false);
          last = ev.cost;
          done.add(ev.node);
        }
        if (ev.type === 'relax' && done.has(ev.to)) {
          expect(ev.toSettled).toBe(true);
          expect(ev.improved).toBe(false);
        }
      }
    }
  });

  it('目的地を指定すると、すべて確定した時点で止まり、そのコストは全点探索と同じ', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = randomGraph(seed, 30, 90);
      const full = dijkstra(g, { sources: 0 });
      const reachable = [...Array(g.n).keys()].filter((v) => Number.isFinite(full.dist[v]));
      const targets = reachable.slice(-3);
      const r = dijkstra(g, { sources: 0, targets });
      expect(r.reason).toBe('targets');
      for (const t of targets) expect(r.dist[t]).toBe(full.dist[t]);
      // 最後に確定したのは目的地のどれか
      expect(targets).toContain(r.order[r.order.length - 1]);
    }
  });

  it('到達不能な目的地が含まれていても、探索し尽くして終了する', () => {
    const g = makeGraph(3, [e(0, 1, 2)]);
    const r = dijkstra(g, { sources: 0, targets: [1, 2] });
    expect(r.reason).toBe('exhausted');
    expect(r.dist[1]).toBe(2);
    expect(r.dist[2]).toBe(Infinity);
  });

  it('maxCost を超えるノードは確定しない', () => {
    const g = makeGraph(4, [e(0, 1, 2), e(1, 2, 2), e(2, 3, 2)]);
    const r = dijkstra(g, { sources: 0, maxCost: 4 });
    expect(r.reason).toBe('limit');
    expect(Array.from(r.settled)).toEqual([1, 1, 1, 0]);
  });

  it('初期コスト付きの複数出発地点を扱える', () => {
    const g = makeGraph(3, [e(0, 2, 5), e(1, 2, 1)]);
    const r = dijkstra(g, { sources: [{ node: 0, cost: 0 }, { node: 1, cost: 10 }] });
    expect(r.dist[2]).toBe(5);
  });

  it('edgeFilter で除外したエッジは使わない', () => {
    const g = makeGraph(3, [e(0, 1, 1), e(1, 2, 1), e(0, 2, 5)]);
    const r = dijkstra(g, { sources: 0, edgeFilter: (id) => id !== 1 });
    expect(r.dist[2]).toBe(5);
  });
});
