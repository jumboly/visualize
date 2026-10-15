import type { SearchGraph } from '../graph/searchGraph';
import { MinHeap } from './heap';

/**
 * ダイクストラ法（全章で共通）。
 *
 * 可視化のために、計算の途中で起きたことを SearchEvent の列として記録できる。
 * 描画側はこの列を再生するだけで、アルゴリズムを描画処理に埋め込まない。
 */

export type SearchEvent =
  /** 出発地点に初期コストを置いた */
  | { type: 'init'; node: number; cost: number }
  /** 未確定ノードの中で暫定コスト最小の node を取り出し、最短コストを確定した */
  | { type: 'settle'; node: number; cost: number; via: number }
  /** 確定した from から出るエッジを調べた。cand = from のコスト + エッジのコスト */
  | {
      type: 'relax';
      edge: number;
      from: number;
      to: number;
      cand: number;
      /** 調べる前の to の暫定コスト（未到達なら Infinity） */
      old: number;
      /** 暫定コストを更新したか */
      improved: boolean;
      /** to がすでに確定済みだったか（確定済みは決して更新されない） */
      toSettled: boolean;
    }
  | { type: 'done'; reason: StopReason };

export type StopReason = 'targets' | 'exhausted' | 'limit';

export interface DijkstraOptions {
  /** 出発地点。複数指定や初期コスト付き（階層探索で使う）も可 */
  sources: number | Array<{ node: number; cost: number }>;
  /** 指定するとすべて確定した時点で終了する（1対1・1対N）。省略すると1対全点 */
  targets?: number[];
  /** 累積コストがこれを超えるノードは確定させずに終了する（到達圏探索） */
  maxCost?: number;
  /** false を返したエッジは存在しないものとして扱う（領域内に限った探索など） */
  edgeFilter?: (edgeId: number) => boolean;
  /** true ならイベントを記録する（教育用。性能計測時は false） */
  record?: boolean;
}

export interface DijkstraResult {
  /** 確定済みノードでは最短コスト。未確定ノードでは暫定コスト（未到達は Infinity） */
  dist: Float64Array;
  /** 最短経路木で、そのノードに入るエッジ id（出発地点・未到達は -1） */
  prev: Int32Array;
  settled: Uint8Array;
  /** 確定した順のノード */
  order: number[];
  /** 調べたエッジ数 */
  edgesScanned: number;
  reason: StopReason;
  events: SearchEvent[];
}

export function dijkstra(g: SearchGraph, opts: DijkstraOptions): DijkstraResult {
  const n = g.n;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const order: number[] = [];
  const events: SearchEvent[] = [];
  const rec = opts.record ?? false;
  const heap = new MinHeap();
  const maxCost = opts.maxCost ?? Infinity;

  const sources = typeof opts.sources === 'number' ? [{ node: opts.sources, cost: 0 }] : opts.sources;
  for (const s of sources) {
    if (s.cost < dist[s.node]) {
      dist[s.node] = s.cost;
      heap.push(s.cost, s.node);
      if (rec) events.push({ type: 'init', node: s.node, cost: s.cost });
    }
  }

  const remaining = new Set(opts.targets ?? []);
  const useTargets = opts.targets !== undefined;
  let edgesScanned = 0;
  let reason: StopReason = 'exhausted';

  if (useTargets && remaining.size === 0) reason = 'targets';
  else
    for (;;) {
      const top = heap.pop();
      if (!top) break;
      const u = top.val;
      // 遅延削除：古いエントリ（すでに確定済み、またはより良いコストが見つかった）は読み飛ばす
      if (settled[u] || top.key > dist[u]) continue;
      if (dist[u] > maxCost) {
        reason = 'limit';
        break;
      }
      settled[u] = 1;
      order.push(u);
      if (rec) events.push({ type: 'settle', node: u, cost: dist[u], via: prev[u] });

      if (useTargets) {
        remaining.delete(u);
        // 目的地がすべて確定した時点で、それ以上探索しても答えは変わらない
        if (remaining.size === 0) {
          reason = 'targets';
          break;
        }
      }

      for (const eid of g.out[u]) {
        if (opts.edgeFilter && !opts.edgeFilter(eid)) continue;
        const e = g.edges[eid];
        const v = e.to;
        const cand = dist[u] + e.cost;
        const old = dist[v];
        const improved = !settled[v] && cand < old;
        edgesScanned++;
        if (improved) {
          dist[v] = cand;
          prev[v] = eid;
          heap.push(cand, v);
        }
        if (rec) events.push({ type: 'relax', edge: eid, from: u, to: v, cand, old, improved, toSettled: settled[v] === 1 });
      }
    }

  if (rec) events.push({ type: 'done', reason });
  return { dist, prev, settled, order, edgesScanned, reason, events };
}

/** 最短経路木をたどって、出発地点から t までのエッジ列を返す。到達していなければ null */
export function pathEdges(g: SearchGraph, res: Pick<DijkstraResult, 'prev' | 'dist'>, t: number): number[] | null {
  if (!Number.isFinite(res.dist[t])) return null;
  const path: number[] = [];
  let v = t;
  // ループ防止の上限（正しい prev ならノード数以内で出発地点に着く）
  for (let guard = 0; res.prev[v] !== -1; guard++) {
    if (guard > g.n) throw new Error('最短経路木が循環しています');
    const e = g.edges[res.prev[v]];
    path.push(e.id);
    v = e.from;
  }
  return path.reverse();
}

/** エッジ列をノード列に変換する */
export function edgesToNodes(g: SearchGraph, edges: number[], start: number): number[] {
  const nodes = [start];
  for (const id of edges) nodes.push(g.edges[id].to);
  return nodes;
}
