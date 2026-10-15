import { dijkstra, type DijkstraOptions, type DijkstraResult } from '../algo/dijkstra';
import type { Player } from '../app/player';
import type { SearchGraph } from '../graph/searchGraph';
import { SIMPLE_RIVER } from '../graph/simpleGraph';
import type { NetworkView } from '../viz/networkView';
import { buildTimeline, frameAt, SearchReplay, type Frame, type SearchState, type Timeline, type TimelineMode } from '../viz/replay';
import { el } from '../viz/svg';

/** 1回の探索と、その再生に必要なものをまとめたもの */
export interface Run {
  g: SearchGraph;
  res: DijkstraResult;
  replay: SearchReplay;
  tl: Timeline;
}

export function makeRun(g: SearchGraph, opts: DijkstraOptions, mode: TimelineMode = 'wave'): Run {
  const res = dijkstra(g, { ...opts, record: true });
  return { g, res, replay: new SearchReplay(g.n, g.edges.length, res.events), tl: buildTimeline(res.events, mode, { maxCost: opts.maxCost }) };
}

/** 時刻 t の状態 */
export function stateAt(run: Run, t: number): { st: SearchState; fr: Frame } {
  const fr = frameAt(run.tl, run.res.events, t);
  return { st: run.replay.at(fr.k), fr };
}

/** run をプレイヤーに載せる。onFrame で章ごとの追加描画をする */
export function playRun(
  player: Player,
  run: Run,
  view: NetworkView,
  onFrame: (st: SearchState, fr: Frame, t: number) => void,
  opts: { rate?: number; at?: number; autoplay?: boolean; pauses?: number[]; onPause?: (t: number) => void } = {},
): void {
  view.setGraph(run.g);
  player.load(
    {
      duration: run.tl.duration,
      stops: run.tl.stops,
      rate: opts.rate ?? 2.6,
      render(t) {
        const { st, fr } = stateAt(run, t);
        view.render(st, fr.radius);
        onFrame(st, fr, t);
      },
      pauses: opts.pauses,
      onPause: opts.onPause,
    },
    { at: opts.at, autoplay: opts.autoplay },
  );
}

/** 第1・2章のグラフの川 */
export function drawSimpleRiver(view: NetworkView): void {
  const left = SIMPLE_RIVER.map(([y, x]) => `${x},${y}`);
  const right = [...SIMPLE_RIVER].reverse().map(([y, , x]) => `${x},${y}`);
  const under = view.layer('under');
  el('polygon', { points: [...left, ...right].join(' '), class: 'river' }, under);
  el('text', { x: 628, y: 250, class: 'river-label', 'writing-mode': 'tb', 'text-anchor': 'middle' }, under).textContent = '川';
}

export function stageOverlay(stage: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'stage-overlay';
  stage.appendChild(d);
  return d;
}
