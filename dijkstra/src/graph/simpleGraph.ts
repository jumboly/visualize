import type { Network, Road } from './types';

/**
 * 第1章・第2章の単純なグラフ。
 *
 * 設計意図（数値は tests/simpleGraph.test.ts で検証している）:
 * - A（出発）と B（目的地）は直線では近いが、間に川があり、橋は北と南の端にしかない。
 *   → B が確定する前に、A から見て反対側（西）のノードがすべて確定する。
 * - F の暫定コストは A から 12 → J 経由で 9 → G 経由で 7 と改善されてから確定する。
 *   （A–F は見た目は近いが遅い道。コストは見た目の長さではないことも示せる）
 * - 同点を避け、確定順が一意に決まるように重みを選んでいる。
 */

const NODES: Array<[string, number, number]> = [
  ['A', 470, 320],
  ['B', 740, 330],
  ['C', 360, 80],
  ['D', 200, 120],
  ['E', 60, 220],
  ['F', 340, 200],
  ['G', 480, 180],
  ['H', 560, 80],
  ['I', 180, 300],
  ['J', 330, 330],
  ['K', 70, 400],
  ['L', 350, 460],
  ['M', 200, 480],
  ['N', 480, 470],
  ['O', 560, 560],
  ['P', 690, 80],
  ['Q', 720, 200],
  ['R', 840, 160],
  ['S', 950, 250],
  ['T', 850, 330],
  ['U', 720, 460],
  ['V', 950, 430],
  ['W', 840, 480],
  ['X', 690, 560],
];

/** [端点, 端点, コスト, 橋か] */
const EDGES: Array<[string, string, number, boolean?]> = [
  ['A', 'F', 12],
  ['A', 'J', 4],
  ['A', 'G', 5],
  ['A', 'N', 4],
  ['J', 'F', 5],
  ['G', 'F', 2],
  ['J', 'L', 5],
  ['J', 'I', 4],
  ['F', 'D', 4],
  ['F', 'C', 3],
  ['G', 'H', 3],
  ['C', 'H', 5],
  ['C', 'D', 4],
  ['D', 'E', 4],
  ['I', 'E', 4],
  ['I', 'K', 3],
  ['L', 'M', 4],
  ['L', 'N', 4],
  ['M', 'K', 3],
  ['N', 'O', 4],
  ['H', 'P', 3, true],
  ['O', 'X', 3, true],
  ['P', 'Q', 3],
  ['P', 'R', 4],
  ['Q', 'B', 3],
  ['Q', 'R', 3],
  ['B', 'T', 3],
  ['B', 'U', 4],
  ['R', 'S', 3],
  ['T', 'S', 3],
  ['T', 'V', 3],
  ['U', 'W', 3],
  ['U', 'X', 3],
  ['W', 'V', 3],
  ['X', 'W', 4],
];

export function simpleGraph(): Network {
  const idx = new Map(NODES.map(([l], i) => [l, i]));
  const nodes = NODES.map(([label, x, y], id) => ({ id, x, y, label }));
  const roads: Road[] = EDGES.map(([a, b, cost, bridge], id) => ({
    id,
    a: idx.get(a)!,
    b: idx.get(b)!,
    length: cost,
    cls: 'local',
    width: 6,
    oneway: false,
    modes: ['walk', 'car'],
    bridge: bridge ?? false,
  }));
  return { nodes, roads };
}

/** ラベルからノード id を引く */
export function nodeId(net: Network, label: string): number {
  const n = net.nodes.find((v) => v.label === label);
  if (!n) throw new Error(`ノード ${label} がありません`);
  return n.id;
}

/** 川の形（表示用）。x の範囲を y ごとに返す */
export const SIMPLE_RIVER: Array<[number, number, number]> = [
  // [y, 左岸x, 右岸x]
  [0, 598, 652],
  [160, 606, 660],
  [320, 600, 654],
  [480, 592, 646],
  [640, 598, 652],
];

export const SIMPLE_VIEWBOX = { x: 0, y: 30, w: 1010, h: 580 };
