import type { SearchGraph } from '../graph/searchGraph';
import { dijkstra, pathEdges, type DijkstraResult } from './dijkstra';

/**
 * OD マトリックス（Origin–Destination Matrix）。
 *
 * matrix[i][j] = 地点 i を出発して地点 j に着くまでの最短コスト（行 = 出発、列 = 到着）。
 * 一方通行があると matrix[i][j] と matrix[j][i] は一致しないので、対称だとは仮定しない。
 * 各行は「地点 i から他の全地点への 1対N 探索」1回で求まる。
 */
export interface OdMatrix {
  points: number[];
  matrix: number[][];
  /** paths[i][j] = i→j の最短経路（元のグラフのエッジ列）。到達不能なら null */
  paths: Array<Array<number[] | null>>;
  /** 行ごとの探索結果（可視化用にイベントを記録できる） */
  runs: DijkstraResult[];
}

export function odMatrix(g: SearchGraph, points: number[], record = false): OdMatrix {
  const matrix: number[][] = [];
  const paths: Array<Array<number[] | null>> = [];
  const runs: DijkstraResult[] = [];
  for (const o of points) {
    const res = dijkstra(g, { sources: o, targets: points.filter((p) => p !== o), record });
    runs.push(res);
    matrix.push(points.map((d) => (d === o ? 0 : res.dist[d])));
    paths.push(points.map((d) => (d === o ? [] : pathEdges(g, res, d))));
  }
  return { points, matrix, paths, runs };
}
