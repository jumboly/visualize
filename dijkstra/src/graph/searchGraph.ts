import type { Metric, Mode, Network, Road, RoadClass } from './types';

/**
 * ダイクストラ法が見る世界：ノード番号と、コスト付きの有向エッジだけ。
 * 道路の種類や規制は、ここに変換する時点ですべて「エッジがあるか・コストはいくつか」に落とし込む。
 */
export interface DEdge {
  id: number;
  from: number;
  to: number;
  /** 非負のコスト（距離なら m、時間なら分） */
  cost: number;
  /** 元になった道路 */
  road: number;
  /** 道路の a→b 方向なら true */
  forward: boolean;
}

export interface SearchGraph {
  n: number;
  edges: DEdge[];
  /** out[v] = v から出るエッジ id の一覧 */
  out: number[][];
}

export function makeGraph(n: number, edges: Omit<DEdge, 'id'>[]): SearchGraph {
  const es: DEdge[] = edges.map((e, id) => {
    if (!(e.cost >= 0)) throw new Error(`負または不正なコスト: ${e.cost}`);
    return { ...e, id };
  });
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const e of es) out[e.from].push(e.id);
  return { n, edges: es, out };
}

/** 向きを反転したグラフ。「各地点から店舗へ」や「目的地からの逆探索」に使う。エッジ id は元と同じ */
export function reverseGraph(g: SearchGraph): SearchGraph {
  const edges = g.edges.map((e) => ({ ...e, from: e.to, to: e.from }));
  const out: number[][] = Array.from({ length: g.n }, () => []);
  for (const e of edges) out[e.from].push(e.id);
  return { n: g.n, edges, out };
}

// ---------------------------------------------------------------------------
// 通行条件 → 探索グラフ
// ---------------------------------------------------------------------------

/** 大型車が通れる最小の道幅 [m] */
export const TRUCK_MIN_WIDTH = 5.5;

/** 移動手段ごとの速度 [km/h]。undefined はその道路種別を通れないことを表す */
export const SPEED_KMH: Record<Mode, Partial<Record<RoadClass, number>>> = {
  walk: { arterial: 4.8, local: 4.8, narrow: 4.8, path: 4.8 },
  car: { expressway: 60, ramp: 30, arterial: 40, local: 25, narrow: 12 },
  truck: { expressway: 50, ramp: 25, arterial: 30, local: 20, narrow: 10 },
};

export interface Conditions {
  mode: Mode;
  metric: Metric;
  /** 通行止めの道路 id */
  closed?: ReadonlySet<number>;
  /** 道路 id → 所要時間の倍率（渋滞など）。距離コストには影響しない */
  slow?: ReadonlyMap<number, number>;
}

export type Passability = { ok: true } | { ok: false; reason: string };

/** その道路を、指定の移動手段で通れるか。理由も返して画面で説明できるようにする */
export function passability(road: Road, c: Conditions): Passability {
  if (c.closed?.has(road.id)) return { ok: false, reason: '通行止め' };
  if (!road.modes.includes(c.mode === 'truck' ? 'car' : c.mode)) {
    return { ok: false, reason: c.mode === 'walk' ? '歩行者通行不可' : '車両通行不可' };
  }
  if (SPEED_KMH[c.mode][road.cls] === undefined) return { ok: false, reason: '通行不可' };
  if (c.mode === 'truck' && road.width < TRUCK_MIN_WIDTH) return { ok: false, reason: `道幅 ${road.width}m < ${TRUCK_MIN_WIDTH}m` };
  return { ok: true };
}

export function roadCost(road: Road, c: Conditions): number {
  if (c.metric === 'distance') return road.length;
  const mPerMin = (SPEED_KMH[c.mode][road.cls]! * 1000) / 60;
  return (road.length / mPerMin) * (c.slow?.get(road.id) ?? 1);
}

/**
 * 道路ネットワークと通行条件から、ダイクストラ法に渡す有向グラフを作る。
 * 一方通行は車両だけに効き、歩行者は両方向に通れる。
 */
export function buildSearchGraph(net: Network, c: Conditions): SearchGraph {
  const edges: Omit<DEdge, 'id'>[] = [];
  for (const r of net.roads) {
    if (!passability(r, c).ok) continue;
    const cost = roadCost(r, c);
    edges.push({ from: r.a, to: r.b, cost, road: r.id, forward: true });
    if (!r.oneway || c.mode === 'walk') edges.push({ from: r.b, to: r.a, cost, road: r.id, forward: false });
  }
  return makeGraph(net.nodes.length, edges);
}
