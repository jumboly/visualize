import type { SearchGraph } from '../graph/searchGraph';
import type { Network } from '../graph/types';
import type { SearchState } from './replay';
import { el, fmt, setAttrs } from './svg';
import './net.css';

/**
 * 道路ネットワークと探索状態の SVG 描画（全章で共通）。
 *
 * 探索状態（SearchState）と波紋の半径を受け取って見た目を更新するだけで、
 * アルゴリズムの知識は持たない。章ごとの追加表現は layer() で得たグループに描く。
 */

export type ViewStyle = 'graph' | 'road';

export interface Marker {
  node: number;
  kind: 'start' | 'goal' | 'target' | 'visit';
  label?: string;
}

export interface PathSpec {
  edges: number[];
  cls?: string;
  /** 0..1 で描きかけの経路を表す（未指定なら全体） */
  progress?: number;
  /** エッジ id の解釈に使うグラフ（条件の違う経路を並べて描くとき用。省略時は setGraph したもの） */
  g?: SearchGraph;
}

type LayerName = 'under' | 'roads' | 'wave' | 'path' | 'over-roads' | 'nodes' | 'markers' | 'over';

export class NetworkView {
  readonly svg: SVGSVGElement;
  private layers = new Map<LayerName, SVGGElement>();
  private roadEls: SVGLineElement[] = [];
  private nodeEls: SVGGElement[] = [];
  private costEls: SVGTextElement[] = [];
  private waveEls = new Map<number, SVGLineElement>();
  private waveLast = new Map<number, number>();
  private g: SearchGraph | null = null;
  onNodeClick?: (id: number, ev: MouseEvent) => void;
  onRoadClick?: (id: number, ev: MouseEvent) => void;

  constructor(
    parent: HTMLElement,
    readonly net: Network,
    readonly style: ViewStyle,
    viewBox: { x: number; y: number; w: number; h: number },
  ) {
    this.svg = el('svg', {
      viewBox: `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`,
      class: `net net-${style}`,
      preserveAspectRatio: 'xMidYMid meet',
    });
    parent.appendChild(this.svg);
    for (const name of ['under', 'roads', 'wave', 'path', 'over-roads', 'nodes', 'markers', 'over'] as LayerName[]) {
      this.layers.set(name, el('g', { class: `layer-${name}` }, this.svg));
    }
    this.drawRoads();
    this.drawNodes();
  }

  /** 表示範囲を変える（一部を拡大して説明するため） */
  setViewBox(vb: { x: number; y: number; w: number; h: number }): void {
    this.svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  layer(name: LayerName): SVGGElement {
    return this.layers.get(name)!;
  }

  pos(id: number): { x: number; y: number } {
    return this.net.nodes[id];
  }

  /** 探索に使っているグラフ（波紋の描画に有向エッジの情報が要る） */
  setGraph(g: SearchGraph): void {
    this.g = g;
    for (const e of this.waveEls.values()) e.remove();
    this.waveEls.clear();
    this.waveLast.clear();
  }

  private drawRoads(): void {
    const roads = this.layer('roads');
    for (const r of this.net.roads) {
      const a = this.net.nodes[r.a];
      const b = this.net.nodes[r.b];
      const line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `road c-${r.cls}${r.bridge ? ' bridge' : ''}` }, roads);
      line.dataset.id = String(r.id);
      this.roadEls.push(line);
      if (this.style === 'graph') {
        // コストのラベル（道路の中点）
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const g = el('g', { class: 'wlabel', transform: `translate(${mx},${my})` }, this.layer('over-roads'));
        el('rect', { x: -13, y: -11, width: 26, height: 22, rx: 6 }, g);
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g).textContent = fmt(r.length);
      }
    }
    roads.addEventListener('click', (ev) => {
      const t = ev.target as SVGElement;
      if (t.dataset.id && this.onRoadClick) this.onRoadClick(Number(t.dataset.id), ev as MouseEvent);
    });
  }

  private drawNodes(): void {
    const layer = this.layer('nodes');
    for (const v of this.net.nodes) {
      const g = el('g', { class: 'node unreached', transform: `translate(${v.x},${v.y})` }, layer);
      g.dataset.id = String(v.id);
      if (this.style === 'graph') {
        el('circle', { r: 21, class: 'body' }, g);
        const cost = el('text', { class: 'cost', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
        cost.textContent = '∞';
        this.costEls.push(cost);
        if (v.label) {
          el('text', { class: 'name', x: -22, y: -20, 'text-anchor': 'end' }, g).textContent = v.label;
        }
      } else {
        el('circle', { r: 4.5, class: 'body' }, g);
      }
      this.nodeEls.push(g);
    }
    layer.addEventListener('click', (ev) => {
      const g = (ev.target as Element).closest('.node') as SVGGElement | null;
      if (g && this.onNodeClick) this.onNodeClick(Number(g.dataset.id), ev as MouseEvent);
    });
  }

  /** 探索状態を反映する。state が null なら未探索の状態に戻す */
  render(state: SearchState | null, radius: number): void {
    const n = this.net.nodes.length;
    for (let v = 0; v < n; v++) {
      const d = state ? state.dist[v] : Infinity;
      const cls = !state || !Number.isFinite(d) ? 'unreached' : state.settled[v] ? (state.current === v ? 'settled current' : 'settled') : 'tentative';
      const g = this.nodeEls[v];
      const full = `node ${cls}`;
      if (g.getAttribute('class') !== full) g.setAttribute('class', full);
      if (this.style === 'graph') {
        const txt = fmt(d);
        if (this.costEls[v].textContent !== txt) this.costEls[v].textContent = txt;
      }
    }
    if (this.style === 'graph' && this.g) {
      // 調べたエッジ：どちらかの向きで調べられた道路に印をつける
      const examined = new Set<number>();
      if (state) for (const e of this.g.edges) if (state.examined[e.id]) examined.add(e.road);
      this.roadEls.forEach((line, id) => line.classList.toggle('examined', examined.has(id)));
    }
    this.renderWave(state, radius);
  }

  /**
   * 波紋：確定済みノード u から出るエッジを、累積コストが radius に達するところまで塗る。
   * 道路上の点のコストは「u の最短コスト + u からの距離」なので、これは
   * 「出発地点から radius 以内で到達できる道路区間」をそのまま表している。
   */
  private renderWave(state: SearchState | null, radius: number): void {
    const used = new Set<number>();
    if (state && this.g) {
      const layer = this.layer('wave');
      for (const u of state.order) {
        const du = state.dist[u];
        for (const eid of this.g.out[u]) {
          const e = this.g.edges[eid];
          const f = e.cost === 0 ? (radius >= du ? 1 : 0) : Math.max(0, Math.min(1, (radius - du) / e.cost));
          if (f <= 0) continue;
          used.add(eid);
          let line = this.waveEls.get(eid);
          const a = this.net.nodes[e.from];
          const b = this.net.nodes[e.to];
          if (!line) {
            line = el('line', { x1: a.x, y1: a.y, class: 'wave' }, layer);
            this.waveEls.set(eid, line);
          }
          if (this.waveLast.get(eid) !== f) {
            setAttrs(line, { x2: a.x + (b.x - a.x) * f, y2: a.y + (b.y - a.y) * f, visibility: 'visible' });
            this.waveLast.set(eid, f);
          }
        }
      }
    }
    for (const [eid, line] of this.waveEls) {
      if (!used.has(eid) && this.waveLast.get(eid) !== 0) {
        line.setAttribute('visibility', 'hidden');
        this.waveLast.set(eid, 0);
      }
    }
  }

  setMarkers(markers: Marker[]): void {
    const layer = this.layer('markers');
    layer.innerHTML = '';
    for (const m of markers) {
      const p = this.pos(m.node);
      const g = el('g', { class: `marker m-${m.kind}`, transform: `translate(${p.x},${p.y})` }, layer);
      // 道路網は縮小表示されるので、マーカーは世界座標で大きめに描く
      const big = this.style === 'road';
      el('circle', { r: big ? 26 : 27, class: 'ring' }, g);
      if (m.label) {
        // ノード名（左上）と重ならないよう、第1章のグラフではタグをノードの下に出す
        const dy = big ? -62 : 44;
        const t = el('g', { class: 'tag', transform: `translate(0,${dy})` }, g);
        const fs = big ? 40 : 15;
        const w = [...m.label].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? fs : fs * 0.6), 0) + fs;
        const h = big ? 58 : 24;
        el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: h / 2 }, t);
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': fs }, t).textContent = m.label;
      }
    }
  }

  /** 経路を描く。エッジ id は setGraph したグラフ（またはその反転グラフ）のもの */
  setPaths(paths: PathSpec[], g: SearchGraph | null = this.g): void {
    const layer = this.layer('path');
    layer.innerHTML = '';
    for (const p of paths) {
      const pg = p.g ?? g;
      if (!pg || p.edges.length === 0) continue;
      const pts = [pg.edges[p.edges[0]].from, ...p.edges.map((id) => pg.edges[id].to)].map((v) => this.net.nodes[v]);
      const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join('');
      const attrs: Record<string, string | number> = { d, class: `path ${p.cls ?? ''}` };
      if (p.progress !== undefined) {
        attrs.pathLength = 1;
        attrs['stroke-dasharray'] = '1 1';
        attrs['stroke-dashoffset'] = 1 - Math.max(0, Math.min(1, p.progress));
      }
      el('path', attrs, layer);
    }
  }

  nodeEl(id: number): SVGGElement {
    return this.nodeEls[id];
  }

  roadEl(id: number): SVGLineElement {
    return this.roadEls[id];
  }

  destroy(): void {
    this.svg.remove();
  }
}
