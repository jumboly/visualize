import { pathEdges } from '../algo/dijkstra';
import { button, hint, renderLegend, row, segmented, SW } from '../app/ui';
import { roadNetwork } from '../graph/roadNetwork';
import { buildSearchGraph, roadCost, type Conditions, type SearchGraph } from '../graph/searchGraph';
import type { Metric, Mode } from '../graph/types';
import { CITY_VIEWBOX, drawCity, drawOneways } from '../viz/cityDecor';
import { NetworkView, type PathSpec } from '../viz/networkView';
import type { SearchState } from '../viz/replay';
import { el } from '../viz/svg';
import { makeRun, playRun, type Run } from './common';
import type { ChapterDef } from './types';

const MODE_LABEL: Record<Mode, string> = { walk: '徒歩', car: '普通車', truck: '大型車' };
const METRIC_LABEL: Record<Metric, string> = { distance: '距離', time: '時間' };
/** 道路をクリックしたときに順に切り替わる状態 */
type RoadState = 'normal' | 'slow' | 'closed';
const SLOW_FACTOR = 3;

interface RouteSummary {
  label: string;
  edges: number[];
  g: SearchGraph;
  distance: number;
  time: number;
  reachable: boolean;
}

export const ch3: ChapterDef = {
  no: 3,
  title: '道路ネットワークの世界',
  model: '最短経路は、道路のコストと通行可能性で決まる',
  create(host) {
    const net = roadNetwork();
    const view = new NetworkView(host.stage, net, 'road', CITY_VIEWBOX);
    drawCity(view.layer('under'), view.layer('over-roads'), net);
    drawOneways(view.layer('over-roads'), net);
    const gviewLayer = view.layer('over-roads');
    const gviewGroup = el('g', { class: 'gview-edges' }, gviewLayer);
    const closedLayer = el('g', {}, view.layer('over'));

    let s = net.poi.west;
    let t = net.poi.east;
    let mode: Mode = 'car';
    let metric: Metric = 'distance';
    const roadState = new Map<number, RoadState>();
    let graphView = false;
    let pinned: RouteSummary | null = null;
    let clickRole: 'start' | 'goal' | 'road' = 'road';
    let run!: Run;
    let g!: SearchGraph;

    const conditions = (): Conditions => ({
      mode,
      metric,
      closed: new Set([...roadState].filter(([, v]) => v === 'closed').map(([k]) => k)),
      slow: new Map([...roadState].filter(([, v]) => v === 'slow').map(([k]) => [k, SLOW_FACTOR])),
    });
    const condLabel = () => {
      const c = conditions();
      const extra = [c.closed!.size ? `通行止め${c.closed!.size}` : '', c.slow!.size ? `渋滞${c.slow!.size}` : ''].filter(Boolean).join('・');
      return `${MODE_LABEL[mode]}・${METRIC_LABEL[metric]}最短${extra ? `・${extra}` : ''}`;
    };

    function compute(): void {
      g = buildSearchGraph(net, conditions());
      run = makeRun(g, { sources: s, targets: [t] });
      drawGraphView();
      drawRoadStates();
      view.setMarkers([
        { node: s, kind: 'start', label: '出発' },
        { node: t, kind: 'goal', label: '目的地' },
      ]);
    }

    /** 経路の距離と時間（指標によらず両方を出して比べられるようにする） */
    function summarize(label: string, gr: SearchGraph, edges: number[] | null): RouteSummary {
      const c = conditions();
      const tc: Conditions = { ...c, metric: 'time' };
      const roads = (edges ?? []).map((e) => net.roads[gr.edges[e].road]);
      return {
        label,
        edges: edges ?? [],
        g: gr,
        reachable: edges !== null,
        distance: roads.reduce((a, r) => a + r.length, 0),
        time: roads.reduce((a, r) => a + roadCost(r, tc), 0),
      };
    }

    function render(st: SearchState): void {
      const reached = st.settled[t] === 1;
      const paths: PathSpec[] = [];
      if (pinned?.reachable) paths.push({ edges: pinned.edges, cls: 'alt', g: pinned.g });
      if (reached) paths.push({ edges: pathEdges(g, st, t) ?? [] });
      view.setPaths(paths);
      const cur = reached ? summarize(condLabel(), g, pathEdges(g, st, t)) : null;
      renderTable(cur, st);
      if (st.done && !reached) host.setNote(`<b>到達できません</b>。この条件では、目的地へつながるエッジが探索グラフにありません。`);
      else if (reached) host.setNote(`最短経路が確定：距離 <b>${fmtDist(cur!.distance)}</b>・時間 <b>${fmtMin(cur!.time)}</b>`);
      else host.setNote(`探索中… 確定ノード ${st.settledCount}`);
    }

    function renderTable(cur: RouteSummary | null, st: SearchState): void {
      const rowHtml = (r: RouteSummary | null, cls: string, label: string) =>
        `<tr class="${cls}"><td>${label}</td><td>${r ? (r.reachable ? fmtDist(r.distance) : '到達不能') : '…'}</td><td>${r && r.reachable ? fmtMin(r.time) : r ? '' : '…'}</td></tr>`;
      const html = `
        <div class="stat wide"><div class="k">いまの条件</div><div class="v" style="font-size:15px">${condLabel()}</div></div>
        <div class="stat"><div class="k">探索グラフの有向エッジ数</div><div class="v">${g.edges.length}</div></div>
        <div class="stat"><div class="k">確定ノード数</div><div class="v">${st.settledCount}</div></div>
        <div class="stat wide compare"><div class="k">経路の比較</div><table><thead><tr><th></th><th>距離</th><th>時間</th></tr></thead><tbody>
        ${pinned ? rowHtml(pinned, 'pin', `<span class="sw-alt"></span>${pinned.label}`) : ''}
        ${rowHtml(cur, 'hl', `<span class="sw-cur"></span>${condLabel()}`)}
        </tbody></table></div>`;
      if (host.stats.dataset.html !== html) {
        host.stats.innerHTML = html;
        host.stats.dataset.html = html;
      }
    }

    /** 探索グラフに含まれるエッジだけを描く（向きが片方だけなら矢印） */
    function drawGraphView(): void {
      gviewGroup.innerHTML = '';
      view.svg.classList.toggle('gview', graphView);
      if (!graphView) return;
      const dirs = new Map<number, number>();
      for (const e of g.edges) dirs.set(e.road, (dirs.get(e.road) ?? 0) + 1);
      for (const r of net.roads) {
        const a = net.nodes[r.a];
        const b = net.nodes[r.b];
        const n = dirs.get(r.id) ?? 0;
        el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: n === 0 ? 'gone' : n === 1 ? 'gedge one' : 'gedge' }, gviewGroup);
        if (n === 1) {
          const e = g.edges.find((x) => x.road === r.id)!;
          const p = net.nodes[e.from];
          const q = net.nodes[e.to];
          const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
          el('path', { d: 'M-12,-8 L8,0 L-12,8 Z', class: 'garrow', transform: `translate(${(p.x + q.x) / 2},${(p.y + q.y) / 2}) rotate(${ang})` }, gviewGroup);
        }
      }
    }

    function drawRoadStates(): void {
      closedLayer.innerHTML = '';
      for (const r of net.roads) {
        const st = roadState.get(r.id) ?? 'normal';
        const line = view.roadEl(r.id);
        line.classList.toggle('closed', st === 'closed');
        line.classList.toggle('slow', st === 'slow');
        if (st === 'closed') {
          const a = net.nodes[r.a];
          const b = net.nodes[r.b];
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          el('path', { d: `M${mx - 16},${my - 16}L${mx + 16},${my + 16}M${mx + 16},${my - 16}L${mx - 16},${my + 16}`, class: 'closed-x' }, closedLayer);
        }
      }
    }

    function load(autoplay = true): void {
      // どの条件でも約5秒で探索し終わるように、再生速度をコストの大きさに合わせる
      playRun(host.player, run, view, render, { autoplay, rate: Math.max(run.tl.duration, 1e-6) / 5 });
    }

    function rerun(): void {
      compute();
      load(true);
    }

    function pinCurrent(): void {
      const full = makeRun(g, { sources: s, targets: [t] });
      pinned = summarize(condLabel(), g, pathEdges(g, full.res, t));
    }

    /** ビートの初期化：条件 A で経路を求めて固定し、条件 B で探索をアニメーションする */
    function scenario(a: () => void, b: () => void): void {
      reset();
      a();
      compute();
      pinCurrent();
      b();
      syncControls();
      rerun();
    }

    function reset(): void {
      s = net.poi.west;
      t = net.poi.east;
      mode = 'car';
      metric = 'distance';
      roadState.clear();
      graphView = false;
      pinned = null;
      syncControls();
    }

    // ---- 自由操作 ----
    const modeSeg = segmented<Mode>(
      (['walk', 'car', 'truck'] as Mode[]).map((m) => ({ value: m, label: MODE_LABEL[m] })),
      mode,
      (v) => {
        mode = v;
        rerun();
      },
    );
    const metricSeg = segmented<Metric>(
      [
        { value: 'distance', label: '距離' },
        { value: 'time', label: '時間' },
      ],
      metric,
      (v) => {
        metric = v;
        rerun();
      },
    );
    const roleSeg = segmented<'road' | 'start' | 'goal'>(
      [
        { value: 'road', label: '道路の状態' },
        { value: 'start', label: '出発地点' },
        { value: 'goal', label: '目的地' },
      ],
      clickRole,
      (v) => (clickRole = v),
    );
    const gviewSeg = segmented<boolean>(
      [
        { value: false, label: '地図' },
        { value: true, label: '探索グラフ' },
      ],
      graphView,
      (v) => {
        graphView = v;
        drawGraphView();
      },
    );
    function syncControls(): void {
      modeSeg.set(mode);
      metricSeg.set(metric);
      gviewSeg.set(graphView);
    }
    host.controls.append(
      row('移動手段', modeSeg.el),
      row('コスト', metricSeg.el),
      row('表示', gviewSeg.el),
      row('クリックで', roleSeg.el),
      row(
        '',
        button('往路⇄復路', () => {
          [s, t] = [t, s];
          rerun();
        }),
        button('いまの経路を比較用に固定', () => {
          pinCurrent();
          host.player.seek(host.player.time);
        }),
        button('初期状態に戻す', () => {
          reset();
          rerun();
        }),
      ),
      hint(`「道路の状態」では、道路をクリックするたびに 通常 → 渋滞（時間×${SLOW_FACTOR}） → 通行止め と切り替わります。`),
    );
    view.onRoadClick = (id) => {
      if (clickRole !== 'road') return;
      const cur = roadState.get(id) ?? 'normal';
      const next: RoadState = cur === 'normal' ? 'slow' : cur === 'slow' ? 'closed' : 'normal';
      if (next === 'normal') roadState.delete(id);
      else roadState.set(id, next);
      rerun();
    };
    view.onNodeClick = (v) => {
      if (clickRole === 'start' && v !== t) s = v;
      else if (clickRole === 'goal' && v !== s) t = v;
      else return;
      rerun();
    };

    renderLegend(host.legend, [
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#2a7d68" stroke-width="7"/>', label: '高速道路（自動車専用）' },
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#5b6d8f" stroke-width="6"/>', label: '幹線道路' },
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#36435b" stroke-width="3.5"/>', label: '一般道' },
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#3a475d" stroke-width="2"/>', label: '狭い道（幅5.5m未満）' },
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#4b7a5c" stroke-width="2.5" stroke-dasharray="4 3"/>', label: '歩行者専用' },
      { swatch: '<path d="M7,4 L19,9 L7,14 Z" fill="#c9d3e3"/>', label: '一方通行（車両）' },
      { swatch: SW.wave, label: '波紋（確定コスト以内）' },
      { swatch: SW.path, label: '最短経路' },
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#5fd3e6" stroke-width="4" stroke-dasharray="6 4"/>', label: '比較用に固定した経路' },
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#ff6b6b" stroke-width="3" stroke-dasharray="5 4"/>', label: '通行止め' },
    ]);

    reset();
    compute();

    /** 条件 c で west→east の最短経路が渡る橋の名前（説明文を実際の計算結果に合わせるため） */
    const bridgeOf = (c: Conditions): string => {
      const gr = buildSearchGraph(net, c);
      const r = makeRun(gr, { sources: net.poi.west, targets: [net.poi.east] }).res;
      const names = (pathEdges(gr, r, net.poi.east) ?? []).map((e) => net.roads[gr.edges[e].road]).filter((x) => x.bridge).map((x) => x.name);
      return names.join('・') || '（橋なし）';
    };
    const ex3Bridge = bridgeOf({ mode: 'car', metric: 'time' });
    const ex4Bridge = bridgeOf({ mode: 'car', metric: 'distance', closed: new Set([net.named.oldBridge]) });

    return {
      beats: [
        {
          title: '道路ネットワーク',
          caption: `<p>ここからは架空の街で考えます。川・橋・線路・高速道路・狭い道・一方通行があります。</p>
            <p>道路にはそれぞれ<strong>距離・道幅・通れる移動手段・向き</strong>があります。</p>
            <p class="muted">▶ で、川の西から東へ普通車の距離最短経路を探索します。</p>`,
          enter() {
            reset();
            compute();
            load(false);
            host.setNote('同じ探索エンジン（ダイクストラ法）を、道路網に使います。');
          },
        },
        {
          title: '例1：行きと帰りで道が違う',
          caption: `<p>普通車・距離最短で、行き（<span class="c-alt">水色の破線</span>）は<strong>旧橋</strong>を渡ります。</p>
            <p>帰りは？ 旧橋は<strong>東向きの一方通行</strong>なので、西向きには渡れません。</p>
            <p>一方通行があると、A→B と B→A のコストは<strong>一致するとは限りません</strong>。</p>`,
          enter() {
            scenario(
              () => {},
              () => {
                pinned!.label = `往路（${pinned!.label}）`;
                [s, t] = [t, s];
              },
            );
          },
        },
        {
          title: '例2：普通車と大型車',
          caption: `<p>普通車（<span class="c-alt">水色の破線</span>）は幅 4m の旧橋を渡れます。</p>
            <p>大型車は<strong>道幅 5.5m 未満の道を通れない</strong>ので、旧橋も旧市街の路地も探索の対象から外れ、別のルートで川を渡ります。</p>
            <p>同じ出発地・目的地でも、移動手段で経路が変わります。</p>`,
          enter() {
            scenario(
              () => {},
              () => (mode = 'truck'),
            );
          },
        },
        {
          title: '例3：距離最短と時間最短',
          caption: `<p>距離最短（<span class="c-alt">水色の破線</span>）は旧橋を渡るまっすぐな道。</p>
            <p>時間最短では、少し遠回りでも<strong>速く走れる道（${ex3Bridge}）</strong>を選びます。</p>
            <p>アルゴリズムは同じ。変わったのは<strong>エッジのコスト</strong>だけです。</p>`,
          enter() {
            scenario(
              () => {},
              () => (metric = 'time'),
            );
          },
        },
        {
          title: '例4：橋が通行止めになると',
          caption: `<p>普通車・距離最短の経路（<span class="c-alt">水色の破線</span>）は旧橋を渡ります。</p>
            <p>旧橋を<strong>通行止め</strong>にすると、目的地は川のすぐ向こうなのに、${ex4Bridge}まで<strong>大きく迂回</strong>します。</p>
            <p class="muted">「操作して試す」で道路をクリックすると、ほかの道も通行止めにできます。</p>`,
          enter() {
            scenario(
              () => {},
              () => roadState.set(net.named.oldBridge, 'closed'),
            );
          },
        },
        {
          title: 'ダイクストラ法から見える世界',
          caption: `<p>大型車・北大橋通行止めの条件で、<strong>ダイクストラ法に渡されるグラフ</strong>だけを表示しました。</p>
            <p>通れない道（<span style="color:var(--red)">赤い点線</span>）は最初から存在せず、一方通行は片方向のエッジ（矢印）になっています。</p>
            <p><strong>道路データ ＋ 通行条件 → 探索グラフ → ダイクストラ法</strong>。道路の意味を判断するのは探索グラフを作る側で、ダイクストラ法はコスト最小の経路を求めるだけです。</p>`,
          enter() {
            reset();
            mode = 'truck';
            metric = 'time';
            roadState.set(net.named.northBridge, 'closed');
            graphView = true;
            syncControls();
            compute();
            load(false);
            host.player.seek(run.tl.duration);
          },
        },
      ],
      dispose() {
        view.destroy();
      },
    };
  },
};

export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function fmtMin(min: number): string {
  return `${min.toFixed(1)} 分`;
}
