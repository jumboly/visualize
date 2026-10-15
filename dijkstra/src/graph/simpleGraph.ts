import type { Network, Road } from './types';

/**
 * 第1章・第2章の単純なグラフ。
 *
 * 設計意図（数値は tests/simpleGraph.test.ts で検証している）:
 * - A（出発）から B（目的地）へは、まっすぐ東へ向かう大通り A–S–T–B がある（混雑していて 8+5+7 = 20）。
 * - 最短経路は、いったん目的地と反対の西（J）へ戻り、北を大きく回る A–J–D–C–H–P–Q–B（17）。
 *   → 「どう見ても遠回りなのに、実は近い」。目的地の方向へ進もうとすると見落とす道を、
 *     方向を見ないダイクストラ法は見つける。
 * - B が確定する前に、西の端の K まで確定する（探索は目的地の方向を見ない）。
 * - F の暫定コストは A から 12 → J 経由で 9 → D 経由で 7 と改善されてから確定する。
 *   （A–F は見た目は近いが遅い道。コストは見た目の長さではないことも示せる）
 * - F を確定する瞬間、ほかの暫定ノードはすべて 7 より大きい（「なぜ最小から確定してよいか」の説明用）。
 */

const NODES: Array<[string, number, number]> = [
  ['A', 330, 330],
  ['B', 790, 330],
  ['C', 310, 80],
  ['D', 170, 170],
  ['E', 60, 260],
  ['F', 330, 200],
  ['G', 480, 200],
  ['H', 500, 70],
  ['I', 180, 440],
  ['J', 200, 320],
  ['K', 60, 430],
  ['L', 270, 560],
  ['M', 120, 560],
  ['N', 350, 460],
  ['O', 520, 550],
  ['P', 690, 70],
  ['Q', 800, 190],
  ['R', 930, 150],
  ['S', 480, 330],
  ['T', 630, 330],
  ['U', 790, 470],
  ['V', 950, 330],
  ['W', 930, 520],
  ['X', 680, 550],
];

/** [端点, 端点, コスト] */
const EDGES: Array<[string, string, number]> = [
  // まっすぐ目的地へ向かう大通り（混雑していて遅い）
  ['A', 'S', 8],
  ['S', 'T', 5],
  ['T', 'B', 7],
  // 西へ戻って北を回る道（最短経路）
  ['A', 'J', 2],
  ['J', 'D', 3],
  ['D', 'C', 3],
  ['C', 'H', 3],
  ['H', 'P', 2],
  ['P', 'Q', 2],
  ['Q', 'B', 2],
  // そのほか
  ['A', 'F', 12],
  ['A', 'N', 4],
  ['J', 'F', 7],
  ['D', 'F', 2],
  ['J', 'I', 4],
  ['D', 'E', 3],
  ['E', 'K', 4],
  ['I', 'K', 3],
  ['I', 'L', 4],
  ['L', 'M', 3],
  ['M', 'K', 5],
  ['L', 'N', 4],
  ['F', 'G', 3],
  ['G', 'H', 3],
  ['G', 'S', 3],
  ['P', 'R', 4],
  ['Q', 'R', 3],
  ['R', 'V', 3],
  ['V', 'B', 4],
  ['B', 'U', 4],
  ['U', 'W', 3],
  ['W', 'V', 4],
  ['N', 'O', 5],
  ['O', 'X', 4],
  ['X', 'U', 3],
  ['T', 'X', 5],
];

/** まっすぐ目的地へ向かう大通り（比較表示用） */
export const DIRECT_ROUTE = ['A', 'S', 'T', 'B'];

export function simpleGraph(): Network {
  const idx = new Map(NODES.map(([l], i) => [l, i]));
  const nodes = NODES.map(([label, x, y], id) => ({ id, x, y, label }));
  const roads: Road[] = EDGES.map(([a, b, cost], id) => ({
    id,
    a: idx.get(a)!,
    b: idx.get(b)!,
    length: cost,
    cls: 'local',
    width: 6,
    oneway: false,
    modes: ['walk', 'car'],
  }));
  return { nodes, roads };
}

/** ラベルからノード id を引く */
export function nodeId(net: Network, label: string): number {
  const n = net.nodes.find((v) => v.label === label);
  if (!n) throw new Error(`ノード ${label} がありません`);
  return n.id;
}

// 下端のノードの下に出るタグが切れないよう、下側に余白を取る
export const SIMPLE_VIEWBOX = { x: 0, y: 30, w: 1010, h: 610 };
