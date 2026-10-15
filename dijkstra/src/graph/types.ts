/**
 * 道路ネットワークのデータモデル（物理的な道路の世界）。
 *
 * ここでは「道路がどうなっているか」だけを表し、探索用の有向グラフは searchGraph.ts が
 * 移動手段や通行規制から組み立てる。ダイクストラ法は道路の意味を知らない、という
 * 役割分担をコード上でもそのまま表すため。
 */

export type Mode = 'walk' | 'car' | 'truck';
export type Metric = 'distance' | 'time';

export type RoadClass =
  | 'expressway' // 高速道路（自動車専用）
  | 'ramp' // 高速の出入口
  | 'arterial' // 幹線道路
  | 'local' // 一般道
  | 'narrow' // 狭い道
  | 'path'; // 歩行者専用

export interface NetNode {
  id: number;
  x: number;
  y: number;
  /** 表示名（第1章のグラフなど） */
  label?: string;
}

export interface Road {
  id: number;
  a: number;
  b: number;
  /** 長さ [m]。第1章の抽象グラフではコストそのもの */
  length: number;
  cls: RoadClass;
  /** 道幅 [m] */
  width: number;
  /** true なら車両は a→b の向きにしか走れない。歩行者は両方向に歩ける */
  oneway: boolean;
  /** この道路を通行できる移動手段（道幅による大型車の制限は別途 width で判定） */
  modes: Mode[];
  bridge?: boolean;
  name?: string;
}

export interface Network {
  nodes: NetNode[];
  roads: Road[];
}
