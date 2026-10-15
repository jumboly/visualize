import { describe, expect, it } from 'vitest';
import { dijkstra } from '../src/algo/dijkstra';
import { buildHierarchy, hierQuery, type Partition } from '../src/algo/hierarchy';
import { regionsByRiverRail, roadNetwork } from '../src/graph/roadNetwork';
import { buildSearchGraph, makeGraph, type SearchGraph } from '../src/graph/searchGraph';
import { closeTo, pathCost, randomGraph, rng } from './helpers';

/** 経路が s から t へ連続していて、コストが期待どおりか */
function checkPath(g: SearchGraph, path: number[], s: number, t: number, cost: number): void {
  let cur = s;
  for (const id of path) {
    expect(g.edges[id].from).toBe(cur);
    cur = g.edges[id].to;
  }
  expect(cur).toBe(t);
  expect(closeTo(pathCost(g, path), cost)).toBe(true);
}

function compareAll(g: SearchGraph, part: Partition, pairs: Array<[number, number]>): { direct: number; viaUpper: number } {
  const h = buildHierarchy(g, part);
  let direct = 0;
  let viaUpper = 0;
  for (const [s, t] of pairs) {
    const plain = dijkstra(g, { sources: s, targets: [t] }).dist[t];
    const q = hierQuery(h, s, t);
    expect(closeTo(q.cost, plain)).toBe(true);
    if (Number.isFinite(plain)) {
      expect(q.path).not.toBeNull();
      checkPath(g, q.path!, s, t, plain);
      if (q.direct) direct++;
      else viaUpper++;
    } else expect(q.path).toBeNull();
  }
  return { direct, viaUpper };
}

describe('階層探索', () => {
  it('ランダムな有向グラフ×ランダムな領域分割で、通常のダイクストラ法と最短コストが一致する', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = randomGraph(seed, 30, 80);
      const r = rng(seed + 1000);
      const count = 2 + (seed % 3);
      const part: Partition = { region: Int32Array.from({ length: g.n }, () => Math.floor(r() * count)), count };
      const pairs: Array<[number, number]> = [];
      for (let s = 0; s < g.n; s += 3) for (let t = 0; t < g.n; t += 2) pairs.push([s, t]);
      compareAll(g, part, pairs);
    }
  });

  it('いったん領域を出てから同じ領域に戻る経路でも正しい', () => {
    // 領域0: 0,1 / 領域1: 2。0→1 の直通は遅く、0→2→1 が速い
    const e = (from: number, to: number, cost: number) => ({ from, to, cost, road: 0, forward: true });
    const g = makeGraph(3, [e(0, 1, 10), e(0, 2, 1), e(2, 1, 1)]);
    const part: Partition = { region: Int32Array.from([0, 0, 1]), count: 2 };
    const h = buildHierarchy(g, part);
    const q = hierQuery(h, 0, 1);
    expect(q.cost).toBe(2);
    expect(q.direct).toBe(false);
    checkPath(g, q.path!, 0, 1, 2);
  });

  it('道路ネットワーク（車・時間、一方通行あり）で、多数の組み合わせが通常のダイクストラ法と一致する', () => {
    const net = roadNetwork();
    const g = buildSearchGraph(net, { mode: 'car', metric: 'time' });
    const part = regionsByRiverRail(net);
    const r = rng(42);
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < 600; i++) pairs.push([Math.floor(r() * g.n), Math.floor(r() * g.n)]);
    // 同じ領域内の組み合わせも必ず含める
    const nw = [...Array(g.n).keys()].filter((v) => part.region[v] === 0);
    for (let i = 0; i < 100; i++) pairs.push([nw[Math.floor(r() * nw.length)], nw[Math.floor(r() * nw.length)]]);
    const { direct, viaUpper } = compareAll(g, part, pairs);
    expect(direct).toBeGreaterThan(20);
    expect(viaUpper).toBeGreaterThan(200);
  });

  it('道路ネットワーク（徒歩・距離）でも一致する', () => {
    const net = roadNetwork();
    const g = buildSearchGraph(net, { mode: 'walk', metric: 'distance' });
    const r = rng(7);
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < 300; i++) pairs.push([Math.floor(r() * g.n), Math.floor(r() * g.n)]);
    compareAll(g, regionsByRiverRail(net), pairs);
  });

  it('方向を正しく扱う：往路と復路のコストが通常のダイクストラ法とそれぞれ一致する', () => {
    const net = roadNetwork();
    const g = buildSearchGraph(net, { mode: 'car', metric: 'distance' });
    const h = buildHierarchy(g, regionsByRiverRail(net));
    const { west, east } = net.poi;
    const go = hierQuery(h, west, east).cost;
    const back = hierQuery(h, east, west).cost;
    expect(go).toBe(dijkstra(g, { sources: west, targets: [east] }).dist[east]);
    expect(back).toBe(dijkstra(g, { sources: east, targets: [west] }).dist[west]);
    expect(back).not.toBe(go);
  });

  it('上位ノードは他の領域とつながるノードだけ', () => {
    const net = roadNetwork();
    const g = buildSearchGraph(net, { mode: 'car', metric: 'time' });
    const part = regionsByRiverRail(net);
    const h = buildHierarchy(g, part);
    for (let v = 0; v < g.n; v++) {
      const crosses = g.edges.some((e) => (e.from === v || e.to === v) && part.region[e.from] !== part.region[e.to]);
      expect(h.isBoundary[v] === 1).toBe(crosses);
    }
  });
});
