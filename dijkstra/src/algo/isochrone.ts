import type { SearchGraph } from '../graph/searchGraph';

/**
 * 到達圏：コスト上限付きのダイクストラ法の結果から、上限以内に届く「道路の区間」を求める。
 *
 * 道路上の点のコストは「エッジの始点の最短コスト + 始点からの距離ぶんのコスト」。
 * 交差点 A まで 9 分、A→B が 3 分なら、上限 10 分は A→B の 1/3 の地点に来る。
 * ノードだけを見ると「B は届かない」で終わってしまうので、エッジごとに届く割合 reach を求める。
 */
export interface ReachSegment {
  edge: number;
  from: number;
  to: number;
  /** 始点の最短コスト */
  c0: number;
  /** エッジ全体のコスト */
  w: number;
  /** 始点から何割まで届くか（0〜1） */
  reach: number;
}

/**
 * @param dist 最短コスト（maxCost 付きで探索した結果でよい。上限を超えるノードは未確定のまま）
 * @param settled 確定済みか
 */
export function reachableSegments(g: SearchGraph, dist: ArrayLike<number>, settled: ArrayLike<number>, limit: number): ReachSegment[] {
  const out: ReachSegment[] = [];
  for (const e of g.edges) {
    if (!settled[e.from]) continue;
    const c0 = dist[e.from];
    if (c0 > limit) continue;
    const reach = e.cost === 0 ? 1 : Math.min(1, (limit - c0) / e.cost);
    if (reach <= 0) continue;
    out.push({ edge: e.id, from: e.from, to: e.to, c0, w: e.cost, reach });
  }
  return out;
}

/** 道路の a→b 方向を 0..1 として、届く区間の和集合を返す（往復のエッジをまとめて表示するため） */
export function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const xs = intervals.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of xs) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-12) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
