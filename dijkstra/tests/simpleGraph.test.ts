import { describe, expect, it } from 'vitest';
import { dijkstra, edgesToNodes, pathEdges } from '../src/algo/dijkstra';
import { buildSearchGraph } from '../src/graph/searchGraph';
import { nodeId, simpleGraph } from '../src/graph/simpleGraph';

/** 第1章の演出が前提にしているグラフの性質を固定する */
describe('第1章のグラフ', () => {
  const net = simpleGraph();
  const g = buildSearchGraph(net, { mode: 'car', metric: 'distance' });
  const id = (l: string) => nodeId(net, l);
  const label = (v: number) => net.nodes[v].label;
  const r = dijkstra(g, { sources: id('A'), targets: [id('B')], record: true });

  it('A→B の最短コストは 17 で、北の橋を渡る', () => {
    expect(r.dist[id('B')]).toBe(17);
    const nodes = edgesToNodes(g, pathEdges(g, r, id('B'))!, id('A')).map(label);
    expect(nodes).toEqual(['A', 'G', 'H', 'P', 'Q', 'B']);
  });

  it('B が確定する前に、川の西側のノードはすべて確定している', () => {
    const west = net.nodes.filter((v) => v.x < 600).map((v) => v.id);
    for (const v of west) expect(r.settled[v]).toBe(1);
  });

  it('F の暫定コストは 12 → 9 → 7 と改善される', () => {
    const hist = r.events.filter((e) => e.type === 'relax' && e.to === id('F') && e.improved).map((e) => (e.type === 'relax' ? e.cand : 0));
    expect(hist).toEqual([12, 9, 7]);
  });

  it('F を確定する瞬間、ほかの暫定ノードはすべて 7 より大きい', () => {
    const i = r.events.findIndex((e) => e.type === 'settle' && e.node === id('F'));
    const prov = new Map<number, number>();
    const settled = new Set<number>();
    for (const ev of r.events.slice(0, i)) {
      if (ev.type === 'init') prov.set(ev.node, ev.cost);
      if (ev.type === 'relax' && ev.improved) prov.set(ev.to, ev.cand);
      if (ev.type === 'settle') settled.add(ev.node);
    }
    const frontier = [...prov].filter(([v]) => !settled.has(v) && v !== id('F'));
    expect(frontier.length).toBeGreaterThan(2);
    for (const [, c] of frontier) expect(c).toBeGreaterThan(7);
  });

  it('同じコストで確定するノードがない区間で、確定順が意図どおり', () => {
    const order = r.order.map(label).join('');
    expect(order.startsWith('AJNGF')).toBe(true);
    // K（西の端）は B より先に確定する
    expect(order.indexOf('K')).toBeLessThan(order.indexOf('B'));
  });
});
