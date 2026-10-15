import { makeGraph, type SearchGraph } from '../src/graph/searchGraph';

/** 再現可能な乱数（テストの失敗を再現できるように固定シード） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ランダムな有向グラフ（非負の整数コスト、到達不能ノードも生じうる） */
export function randomGraph(seed: number, n: number, m: number): SearchGraph {
  const r = rng(seed);
  const edges = [];
  for (let i = 0; i < m; i++) {
    const from = Math.floor(r() * n);
    const to = Math.floor(r() * n);
    edges.push({ from, to, cost: Math.floor(r() * 10), road: i, forward: true });
  }
  return makeGraph(n, edges);
}

/** 検証用の素朴な最短コスト計算（Bellman-Ford）。ダイクストラ法とは独立した実装 */
export function bellmanFord(g: SearchGraph, src: number, edgeOk: (id: number) => boolean = () => true): number[] {
  const d = new Array(g.n).fill(Infinity);
  d[src] = 0;
  for (let i = 0; i < g.n; i++) {
    let changed = false;
    for (const e of g.edges) {
      if (!edgeOk(e.id)) continue;
      if (d[e.from] + e.cost < d[e.to]) {
        d[e.to] = d[e.from] + e.cost;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return d;
}

export function pathCost(g: SearchGraph, edges: number[]): number {
  return edges.reduce((s, id) => s + g.edges[id].cost, 0);
}

export function closeTo(a: number, b: number, eps = 1e-9): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
}
