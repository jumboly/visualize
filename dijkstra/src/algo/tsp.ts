/**
 * 巡回セールスマン問題（非対称にも対応）。入力はコスト行列だけで、道路のことは知らない。
 *
 * - enumerateTours: 出発地点を固定して、残りの訪問順序をすべて列挙する（(n-1)! 通り）。
 *   小さな問題で「全部比べて最小を選ぶ」様子を見せるための厳密解法。
 * - heldKarp: 動的計画法による厳密解法（O(2^n n^2)）。列挙の結果の検証にも使う。
 */

export interface Tour {
  /** 訪問順（地点の添字）。order[0] は出発地点で、最後に出発地点へ戻る */
  order: number[];
  cost: number;
}

/** 巡回のコスト（最後に出発地点へ戻る区間を含む）。到達不能な区間があれば Infinity */
export function tourCost(m: number[][], order: number[]): number {
  let c = 0;
  for (let i = 0; i < order.length; i++) c += m[order[i]][order[(i + 1) % order.length]];
  return c;
}

/** 出発地点 start を固定し、残りの地点の順列を辞書順に列挙する */
export function enumerateTours(m: number[][], start = 0): Tour[] {
  const rest = [...m.keys()].filter((i) => i !== start);
  const out: Tour[] = [];
  const perm = (prefix: number[], remain: number[]) => {
    if (remain.length === 0) {
      const order = [start, ...prefix];
      out.push({ order, cost: tourCost(m, order) });
      return;
    }
    for (let i = 0; i < remain.length; i++) perm([...prefix, remain[i]], [...remain.slice(0, i), ...remain.slice(i + 1)]);
  };
  perm([], rest);
  return out;
}

/** 最小コストの巡回（同点なら先に列挙されたもの）。巡回できなければ null */
export function bestTour(tours: Tour[]): Tour | null {
  let best: Tour | null = null;
  for (const t of tours) if (Number.isFinite(t.cost) && (!best || t.cost < best.cost)) best = t;
  return best;
}

export function heldKarp(m: number[][], start = 0): Tour | null {
  const n = m.length;
  if (n === 1) return { order: [start], cost: 0 };
  const others = [...m.keys()].filter((i) => i !== start);
  const k = others.length;
  const FULL = 1 << k;
  // dp[mask][j] = start から mask の地点をすべて通って others[j] に着く最小コスト
  const dp = Array.from({ length: FULL }, () => new Float64Array(k).fill(Infinity));
  const par = Array.from({ length: FULL }, () => new Int32Array(k).fill(-1));
  for (let j = 0; j < k; j++) dp[1 << j][j] = m[start][others[j]];
  for (let mask = 1; mask < FULL; mask++) {
    for (let j = 0; j < k; j++) {
      if (!(mask & (1 << j)) || !Number.isFinite(dp[mask][j])) continue;
      for (let x = 0; x < k; x++) {
        if (mask & (1 << x)) continue;
        const nm = mask | (1 << x);
        const c = dp[mask][j] + m[others[j]][others[x]];
        if (c < dp[nm][x]) {
          dp[nm][x] = c;
          par[nm][x] = j;
        }
      }
    }
  }
  let best = Infinity;
  let last = -1;
  for (let j = 0; j < k; j++) {
    const c = dp[FULL - 1][j] + m[others[j]][start];
    if (c < best) {
      best = c;
      last = j;
    }
  }
  if (!Number.isFinite(best)) return null;
  const rev: number[] = [];
  let mask = FULL - 1;
  for (let j = last; j !== -1; ) {
    rev.push(others[j]);
    const p = par[mask][j];
    mask &= ~(1 << j);
    j = p;
  }
  return { order: [start, ...rev.reverse()], cost: best };
}

/** 階乗（組み合わせ爆発の説明用） */
export function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}
