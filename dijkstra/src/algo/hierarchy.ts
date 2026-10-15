import { makeGraph, reverseGraph, type DEdge, type SearchGraph } from '../graph/searchGraph';
import { dijkstra, pathEdges, type DijkstraResult } from './dijkstra';

/**
 * 領域分割と上位ノードによる階層探索。
 *
 * 前処理：
 *   - 他の領域とエッジでつながるノードを「上位ノード」とする
 *   - 各領域の中だけを通って、上位ノード間の最短コストを求める（ショートカット）
 *   - 上位ネットワーク = ショートカット + 領域をまたぐ元のエッジ
 * 検索：
 *   1. 目的地から逆向きに、目的地の領域内だけを探索 → 各上位ノードから目的地までのコスト
 *   2. 出発地点から、出発地点の領域内だけを探索 → 出発地点から各上位ノードまでのコスト
 *   3. 上位ネットワークを、出発側の上位ノードを（2 のコスト付きで）始点に探索し、
 *      目的地側の上位ノードから (1 のコスト) で仮想ゴールへつなぐ
 *   4. 同じ領域内で完結する経路（2 で目的地に届いたもの）と比べて小さい方を答えにする
 *
 * 正しさの要点：最短経路を「領域ごとの区間」に切ると、各区間の入口と出口は上位ノードで、
 * 区間内のコストは領域内の最短コスト（ショートカット）以上。だから上位ネットワーク上の
 * 最短経路は元の最短経路以下になり、しかも実在の経路に展開できるので一致する。
 * 経路が領域を出て、また戻ってくる場合も同じ理屈で扱える。
 */

export interface Partition {
  /** ノード → 領域番号 */
  region: Int32Array;
  count: number;
}

export interface Hierarchy {
  g: SearchGraph;
  rg: SearchGraph;
  part: Partition;
  isBoundary: Uint8Array;
  /** 領域ごとの上位ノード */
  boundary: number[][];
  /** 上位ネットワーク（ノード番号は元のグラフと同じ。エッジは上位ノード間だけ） */
  overlay: SearchGraph;
  /** 上位ネットワークのエッジ → 元のグラフのエッジ列 */
  unpack: number[][];
  /** 上位ネットワークのエッジがショートカットか（false なら領域をまたぐ元のエッジ） */
  isShortcut: boolean[];
  pre: { searches: number; settled: number; scanned: number; shortcuts: number; crossEdges: number };
}

export function buildHierarchy(g: SearchGraph, part: Partition): Hierarchy {
  const region = part.region;
  const isBoundary = new Uint8Array(g.n);
  for (const e of g.edges) {
    if (region[e.from] !== region[e.to]) {
      isBoundary[e.from] = 1;
      isBoundary[e.to] = 1;
    }
  }
  const boundary: number[][] = Array.from({ length: part.count }, () => []);
  for (let v = 0; v < g.n; v++) if (isBoundary[v]) boundary[region[v]].push(v);

  const edges: Array<Omit<DEdge, 'id'>> = [];
  const unpack: number[][] = [];
  const isShortcut: boolean[] = [];
  const pre = { searches: 0, settled: 0, scanned: 0, shortcuts: 0, crossEdges: 0 };

  // 領域内の上位ノード間の最短コスト（領域の外は通らない）
  for (let r = 0; r < part.count; r++) {
    const bs = boundary[r];
    const inside = (id: number) => region[g.edges[id].from] === r && region[g.edges[id].to] === r;
    for (const b of bs) {
      const res = dijkstra(g, { sources: b, targets: bs.filter((x) => x !== b), edgeFilter: inside });
      pre.searches++;
      pre.settled += res.order.length;
      pre.scanned += res.edgesScanned;
      for (const c of bs) {
        if (c === b || !Number.isFinite(res.dist[c])) continue;
        edges.push({ from: b, to: c, cost: res.dist[c], road: -1, forward: true });
        unpack.push(pathEdges(g, res, c)!);
        isShortcut.push(true);
        pre.shortcuts++;
      }
    }
  }
  // 領域をまたぐ元のエッジ
  for (const e of g.edges) {
    if (region[e.from] === region[e.to]) continue;
    edges.push({ from: e.from, to: e.to, cost: e.cost, road: -1, forward: true });
    unpack.push([e.id]);
    isShortcut.push(false);
    pre.crossEdges++;
  }
  // road にはエッジ番号を入れておく（makeGraph 後の id と同じ順番）
  edges.forEach((e, i) => (e.road = i));
  return { g, rg: reverseGraph(g), part, isBoundary, boundary, overlay: makeGraph(g.n, edges), unpack, isShortcut, pre };
}

export interface HierQuery {
  cost: number;
  /** 元のグラフのエッジ列（到達不能なら null） */
  path: number[] | null;
  /** 1. 目的地側の逆探索（反転グラフ上） */
  back: DijkstraResult;
  /** 2. 出発側の局所探索 */
  fwd: DijkstraResult;
  /** 3. 上位ネットワークの探索（ノード n が仮想ゴール） */
  upper: DijkstraResult | null;
  upperGraph: SearchGraph | null;
  /** 上位ネットワークで使ったエッジ（仮想ゴールへの辺は除く） */
  upperPath: number[];
  /** 答えが同じ領域内の直接経路だったか */
  direct: boolean;
  settled: number;
  scanned: number;
}

export function hierQuery(h: Hierarchy, s: number, t: number, record = false): HierQuery {
  const { g, rg, part, boundary } = h;
  const rs = part.region[s];
  const rt = part.region[t];
  const bT = boundary[rt];
  const bS = boundary[rs];
  const insideOf = (r: number, gr: SearchGraph) => (id: number) => part.region[gr.edges[id].from] === r && part.region[gr.edges[id].to] === r;

  // 1. 目的地側：反転グラフで目的地から探索すると「各上位ノード → 目的地」のコストが求まる
  const back = dijkstra(rg, { sources: t, targets: bT.filter((x) => x !== t), edgeFilter: insideOf(rt, rg), record });
  // 2. 出発側（同じ領域なら目的地も目標に含め、領域内で完結する経路の候補にする）
  const fwdTargets = bS.filter((x) => x !== s);
  if (rs === rt && t !== s && !fwdTargets.includes(t)) fwdTargets.push(t);
  const fwd = dijkstra(g, { sources: s, targets: fwdTargets, edgeFilter: insideOf(rs, g), record });

  let best = rs === rt ? fwd.dist[t] : Infinity;
  if (s === t) best = 0;
  let direct = true;
  let upper: DijkstraResult | null = null;
  let upperGraph: SearchGraph | null = null;
  let upperPath: number[] = [];

  const sources = bS.filter((b) => Number.isFinite(fwd.dist[b])).map((b) => ({ node: b, cost: fwd.dist[b] }));
  const sinks = bT.filter((b) => Number.isFinite(back.dist[b]));
  if (s !== t && sources.length && sinks.length) {
    // 3. 上位ネットワーク + 仮想ゴール（ノード番号 g.n）
    const SINK = g.n;
    const es = h.overlay.edges.map((e) => ({ from: e.from, to: e.to, cost: e.cost, road: e.id, forward: true }));
    for (const b of sinks) es.push({ from: b, to: SINK, cost: back.dist[b], road: -1, forward: true });
    upperGraph = makeGraph(g.n + 1, es);
    upper = dijkstra(upperGraph, { sources, targets: [SINK], record });
    if (upper.dist[SINK] < best) {
      best = upper.dist[SINK];
      direct = false;
      upperPath = pathEdges(upperGraph, upper, SINK)!.slice(0, -1);
    }
  }

  let path: number[] | null = null;
  if (Number.isFinite(best)) {
    if (s === t) path = [];
    else if (direct) path = pathEdges(g, fwd, t);
    else {
      // 4. 展開：出発側の局所経路 + 上位ネットワークの各エッジを元のエッジ列に + 目的地側の局所経路
      const ug = upperGraph!;
      const first = ug.edges[upperPath[0]]?.from ?? lastSink(ug, upper!);
      const last = upperPath.length ? ug.edges[upperPath[upperPath.length - 1]].to : first;
      const head = pathEdges(g, fwd, first)!;
      const middle = upperPath.flatMap((id) => h.unpack[ug.edges[id].road]);
      // 反転グラフ上の t → last の経路を逆順にすると、元のグラフの last → t になる
      const tail = pathEdges(rg, back, last)!.slice().reverse();
      path = [...head, ...middle, ...tail];
    }
  }

  const settled = back.order.length + fwd.order.length + (upper?.order.length ?? 0);
  const scanned = back.edgesScanned + fwd.edgesScanned + (upper?.edgesScanned ?? 0);
  return { cost: best, path, back, fwd, upper, upperGraph, upperPath, direct, settled, scanned };
}

/** 上位ネットワークのエッジを使わずに（出発側の上位ノードから直接）仮想ゴールへ行った場合、その上位ノード */
function lastSink(ug: SearchGraph, upper: DijkstraResult): number {
  const sinkEdge = ug.edges[upper.prev[ug.n - 1]];
  return sinkEdge.from;
}
