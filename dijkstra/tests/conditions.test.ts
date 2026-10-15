import { describe, expect, it } from 'vitest';
import { dijkstra, pathEdges } from '../src/algo/dijkstra';
import { roadNetwork } from '../src/graph/roadNetwork';
import { buildSearchGraph, roadCost, SPEED_KMH, TRUCK_MIN_WIDTH, type Conditions } from '../src/graph/searchGraph';
import type { Network } from '../src/graph/types';

const tiny: Network = {
  nodes: [
    { id: 0, x: 0, y: 0 },
    { id: 1, x: 100, y: 0 },
    { id: 2, x: 200, y: 0 },
  ],
  roads: [
    { id: 0, a: 0, b: 1, length: 100, cls: 'local', width: 6, oneway: true, modes: ['walk', 'car'] },
    { id: 1, a: 1, b: 2, length: 100, cls: 'narrow', width: 4, oneway: false, modes: ['walk', 'car'] },
    { id: 2, a: 0, b: 2, length: 500, cls: 'path', width: 2, oneway: false, modes: ['walk'] },
  ],
};

describe('通行条件 → 探索グラフ', () => {
  it('一方通行は車両だけ片方向。歩行者は両方向に通れる', () => {
    const car = buildSearchGraph(tiny, { mode: 'car', metric: 'distance' });
    expect(car.edges.filter((e) => e.road === 0).map((e) => [e.from, e.to])).toEqual([[0, 1]]);
    const walk = buildSearchGraph(tiny, { mode: 'walk', metric: 'distance' });
    expect(walk.edges.filter((e) => e.road === 0)).toHaveLength(2);
    expect(dijkstra(car, { sources: 1 }).dist[0]).toBe(Infinity);
    expect(dijkstra(walk, { sources: 1 }).dist[0]).toBe(100);
  });

  it('通行止めの道路はエッジにならない', () => {
    const g = buildSearchGraph(tiny, { mode: 'walk', metric: 'distance', closed: new Set([1]) });
    expect(g.edges.some((e) => e.road === 1)).toBe(false);
    expect(dijkstra(g, { sources: 0 }).dist[2]).toBe(500);
  });

  it('大型車は道幅 5.5m 未満の道を通れず、歩行者専用道は車両が通れない', () => {
    const truck = buildSearchGraph(tiny, { mode: 'truck', metric: 'distance' });
    expect(truck.edges.map((e) => e.road)).toEqual([0]);
    const car = buildSearchGraph(tiny, { mode: 'car', metric: 'distance' });
    expect(car.edges.some((e) => e.road === 2)).toBe(false);
    expect(TRUCK_MIN_WIDTH).toBe(5.5);
  });

  it('距離と時間でコストを切り替えられ、渋滞の倍率は時間だけに効く', () => {
    const r = tiny.roads[0];
    const c: Conditions = { mode: 'car', metric: 'distance', slow: new Map([[0, 3]]) };
    expect(roadCost(r, c)).toBe(100);
    const t = roadCost(r, { ...c, metric: 'time' });
    expect(t).toBeCloseTo((100 / ((SPEED_KMH.car.local! * 1000) / 60)) * 3, 10);
  });
});

describe('第3章以降の道路ネットワーク', () => {
  const net = roadNetwork();
  const route = (c: Conditions, s = net.poi.west, t = net.poi.east) => {
    const g = buildSearchGraph(net, c);
    const r = dijkstra(g, { sources: s, targets: [t] });
    const roads = (pathEdges(g, r, t) ?? []).map((e) => net.roads[g.edges[e].road]);
    return { cost: r.dist[t], roads, bridges: roads.filter((x) => x.bridge).map((x) => x.name) };
  };

  it('毎回同じネットワークが生成され、道路 id は添字と一致する', () => {
    const again = roadNetwork();
    expect(again).toEqual(net);
    net.roads.forEach((r, i) => expect(r.id).toBe(i));
  });

  it('歩行者は、歩ける道に接するすべてのノードに到達できる（高速の IC だけは到達できない）', () => {
    const g = buildSearchGraph(net, { mode: 'walk', metric: 'distance' });
    const r = dijkstra(g, { sources: 0 });
    const walkable = new Set(net.roads.filter((x) => x.modes.includes('walk')).flatMap((x) => [x.a, x.b]));
    for (const v of walkable) expect(r.settled[v]).toBe(1);
    expect(net.nodes.length - walkable.size).toBe(4);
  });

  it('例1: 一方通行の旧橋のため、往路と復路で経路とコストが違う', () => {
    const go = route({ mode: 'car', metric: 'distance' });
    const back = route({ mode: 'car', metric: 'distance' }, net.poi.east, net.poi.west);
    expect(go.bridges).toEqual(['旧橋']);
    expect(back.bridges).not.toContain('旧橋');
    expect(back.cost).toBeGreaterThan(go.cost);
  });

  it('例2: 大型車は狭い道（旧橋を含む）を使わない', () => {
    const truck = route({ mode: 'truck', metric: 'distance' });
    expect(truck.roads.every((r) => r.width >= TRUCK_MIN_WIDTH)).toBe(true);
    expect(truck.bridges).not.toContain('旧橋');
    expect(Number.isFinite(truck.cost)).toBe(true);
  });

  it('例3: 距離最短と時間最短で経路が違う', () => {
    const d = route({ mode: 'car', metric: 'distance' });
    const t = route({ mode: 'car', metric: 'time' });
    expect(t.bridges).not.toEqual(d.bridges);
  });

  it('例4: 旧橋を通行止めにすると、別の橋へ迂回してコストが増える', () => {
    const base = route({ mode: 'car', metric: 'distance' });
    const closed = route({ mode: 'car', metric: 'distance', closed: new Set([net.named.oldBridge]) });
    expect(closed.bridges).not.toContain('旧橋');
    expect(closed.cost).toBeGreaterThan(base.cost * 1.3);
  });

  it('大型車でも北大橋を止めると高速道路経由で到達できる', () => {
    const r = route({ mode: 'truck', metric: 'time', closed: new Set([net.named.northBridge]) });
    expect(Number.isFinite(r.cost)).toBe(true);
    expect(r.roads.some((x) => x.cls === 'expressway')).toBe(true);
  });
});
