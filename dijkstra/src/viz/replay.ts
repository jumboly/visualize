import type { SearchEvent } from '../algo/dijkstra';

/**
 * 探索イベント列の再生。
 *
 * - SearchReplay: 先頭 k 個のイベントを適用した状態を作る（巻き戻しは作り直しで実現）
 * - Timeline: 各イベントに開始・終了時刻を割り当て、時刻 t → (k, 進行中のイベント, 進捗 u) を引く
 */

export interface SearchState {
  /** 暫定コスト（確定済みなら最短コスト）。未到達は Infinity */
  dist: Float64Array;
  settled: Uint8Array;
  /** そのノードの暫定コストを決めたエッジ */
  prev: Int32Array;
  /** 調べたエッジ */
  examined: Uint8Array;
  /** 最後に確定したノード（現在処理中） */
  current: number;
  /** 最後に確定したノードのコスト */
  frontierCost: number;
  settledCount: number;
  examinedCount: number;
  /** 確定した順のノード */
  order: number[];
  done: boolean;
}

export class SearchReplay {
  private st: SearchState;
  private k = 0;

  constructor(
    readonly n: number,
    readonly m: number,
    readonly events: SearchEvent[],
  ) {
    this.st = this.fresh();
  }

  private fresh(): SearchState {
    return {
      dist: new Float64Array(this.n).fill(Infinity),
      settled: new Uint8Array(this.n),
      prev: new Int32Array(this.n).fill(-1),
      examined: new Uint8Array(this.m),
      current: -1,
      frontierCost: 0,
      settledCount: 0,
      examinedCount: 0,
      order: [],
      done: false,
    };
  }

  /** 先頭 k 個のイベントを適用した状態。返り値は次の呼び出しで書き換わるので保持しないこと */
  at(k: number): SearchState {
    k = Math.max(0, Math.min(this.events.length, k));
    if (k < this.k) {
      this.st = this.fresh();
      this.k = 0;
    }
    const s = this.st;
    for (; this.k < k; this.k++) {
      const ev = this.events[this.k];
      switch (ev.type) {
        case 'init':
          s.dist[ev.node] = ev.cost;
          break;
        case 'settle':
          s.settled[ev.node] = 1;
          s.current = ev.node;
          s.frontierCost = ev.cost;
          s.settledCount++;
          s.order.push(ev.node);
          break;
        case 'relax':
          if (!s.examined[ev.edge]) s.examinedCount++;
          s.examined[ev.edge] = 1;
          if (ev.improved) {
            s.dist[ev.to] = ev.cand;
            s.prev[ev.to] = ev.edge;
          }
          break;
        case 'done':
          s.done = true;
          break;
      }
    }
    return s;
  }
}

export type TimelineMode = 'step' | 'wave';

export interface Timeline {
  mode: TimelineMode;
  starts: Float64Array;
  ends: Float64Array;
  duration: number;
  /** 1ステップ進む／戻るの停止位置 */
  stops: number[];
  /** wave モードで、全体の終わりの半径（maxCost があればそれ） */
  finalRadius: number;
}

export interface Frame {
  /** 完了したイベント数 */
  k: number;
  /** 進行中のイベント（なければ -1） */
  active: number;
  /** 進行中イベントの進捗 0..1 */
  u: number;
  /** 波紋の半径（この累積コスト以内の道路が塗られる） */
  radius: number;
}

/**
 * step: イベント 1 つずつに一定の長さを割り当てる（第1章の「1手ずつ」）。
 * wave: 時刻＝累積コスト。ノードは波紋の半径がそのコストに達した瞬間に確定する。
 */
export function buildTimeline(events: SearchEvent[], mode: TimelineMode, opts: { maxCost?: number } = {}): Timeline {
  const n = events.length;
  const starts = new Float64Array(n);
  const ends = new Float64Array(n);
  const stops: number[] = [];
  let t = 0;
  let lastCost = 0;
  for (let i = 0; i < n; i++) {
    const ev = events[i];
    if (mode === 'step') {
      const d = ev.type === 'settle' ? 1 : ev.type === 'relax' ? (ev.improved ? 0.8 : 0.45) : 0;
      starts[i] = t;
      t += d;
      ends[i] = t;
      if (d > 0) stops.push(t);
    } else {
      if (ev.type === 'settle') {
        starts[i] = lastCost;
        ends[i] = ev.cost;
        lastCost = ev.cost;
        if (stops[stops.length - 1] !== ev.cost) stops.push(ev.cost);
      } else {
        starts[i] = ends[i] = lastCost;
      }
      t = lastCost;
    }
  }
  let finalRadius = lastCost;
  if (mode === 'wave' && opts.maxCost !== undefined && Number.isFinite(opts.maxCost)) {
    finalRadius = opts.maxCost;
    t = Math.max(t, opts.maxCost);
    if (stops[stops.length - 1] !== t) stops.push(t);
  }
  return { mode, starts, ends, duration: t, stops, finalRadius };
}

export function frameAt(tl: Timeline, events: SearchEvent[], t: number): Frame {
  // ends は単調非減少なので二分探索で「終わったイベント数」を求める
  let lo = 0;
  let hi = tl.ends.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tl.ends[mid] <= t + 1e-9) lo = mid + 1;
    else hi = mid;
  }
  const k = lo;
  let active = -1;
  let u = 0;
  if (k < tl.ends.length && tl.starts[k] < t - 1e-9) {
    active = k;
    u = (t - tl.starts[k]) / (tl.ends[k] - tl.starts[k]);
  }
  let radius: number;
  if (tl.mode === 'wave') radius = Math.min(t, tl.finalRadius);
  else {
    // 1手ずつのモードでは、確定のたびに半径をそのノードのコストまで伸ばす
    radius = 0;
    for (let i = k - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === 'settle') {
        radius = ev.cost;
        break;
      }
    }
    const a = active >= 0 ? events[active] : undefined;
    if (a?.type === 'settle') radius = radius + (a.cost - radius) * easeInOut(u);
  }
  return { k, active, u, radius };
}

export function easeInOut(u: number): number {
  return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
}
