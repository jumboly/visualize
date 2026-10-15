import { dijkstra, pathEdges, type DijkstraResult } from '../algo/dijkstra';
import { buildHierarchy, hierQuery, type Hierarchy, type HierQuery } from '../algo/hierarchy';
import { hint, renderLegend, row, segmented, SW } from '../app/ui';
import { nearestNode, RAIL_Y, REGION_NAMES, regionsByRiverRail, riverX, roadNetwork, WORLD } from '../graph/roadNetwork';
import { buildSearchGraph, type SearchGraph } from '../graph/searchGraph';
import { CITY_VIEWBOX, drawCity } from '../viz/cityDecor';
import { NetworkView } from '../viz/networkView';
import { el } from '../viz/svg';
import type { ChapterDef } from './types';

const REGION_COLORS = ['#3b5bdb', '#2f9e44', '#e8590c', '#ae3ec9'];

/** 探索した範囲の描き方：確定したノードと、そこから調べたエッジ */
interface Paint {
  edges: SVGPathElement;
  nodes: SVGPathElement;
}

export const ch5: ChapterDef = {
  no: 5,
  title: '階層探索で高速化する',
  model: 'アルゴリズムだけでなく、探索する対象の構造を工夫する',
  create(host) {
    const net = roadNetwork();
    const g = buildSearchGraph(net, { mode: 'car', metric: 'time' });
    const part = regionsByRiverRail(net);
    const t0 = performance.now();
    const h: Hierarchy = buildHierarchy(g, part);
    const preMs = performance.now() - t0;

    // ---- 画面：左に通常のダイクストラ法、右に階層探索 ----
    host.stage.innerHTML = `<div class="dual single"><div class="pane plain"><div class="pane-title">通常のダイクストラ法</div></div><div class="pane hier"><div class="pane-title">階層探索</div></div></div>`;
    const dual = host.stage.querySelector('.dual') as HTMLElement;
    const left = new NetworkView(host.stage.querySelector('.plain') as HTMLElement, net, 'road', CITY_VIEWBOX);
    const right = new NetworkView(host.stage.querySelector('.hier') as HTMLElement, net, 'road', CITY_VIEWBOX);
    for (const v of [left, right]) {
      v.svg.classList.add('h5');
      drawCity(v.layer('under'), v.layer('over-roads'), net);
    }
    drawRegions(right.layer('under'));
    const mkPaint = (v: NetworkView, cls: string): Paint => ({
      edges: el('path', { class: `paint-e ${cls}` }, v.layer('wave')),
      nodes: el('path', { class: `paint-n ${cls}` }, v.layer('wave')),
    });
    const pPlain = mkPaint(left, 'p-plain');
    const pBack = mkPaint(right, 'p-back');
    const pFwd = mkPaint(right, 'p-fwd');
    const upperLayer = el('g', { class: 'upper' }, right.layer('over-roads'));
    const upperHot = el('g', { class: 'upper-hot' }, right.layer('over-roads'));
    const boundaryLayer = el('g', {}, right.layer('over'));
    const labelLayer = el('g', {}, right.layer('over'));

    let s = net.poi.west;
    let t = nearestNode(net, 2150, 1350);
    let q!: HierQuery;
    let plain!: DijkstraResult;
    let clickRole: 'start' | 'goal' = 'start';
    const show = { upper: false, boundary: true };

    function compute(): void {
      plain = dijkstra(g, { sources: s, targets: [t] });
      q = hierQuery(h, s, t);
      for (const v of [left, right]) {
        v.setMarkers([
          { node: s, kind: 'start', label: '出発' },
          { node: t, kind: 'goal', label: '目的地' },
        ]);
      }
    }

    /** 探索結果 res の先頭 k ノードについて、確定ノードと調べたエッジを描く */
    function paint(p: Paint, gr: SearchGraph, res: DijkstraResult | null, k: number, filter?: (id: number) => boolean): void {
      const de: string[] = [];
      const dn: string[] = [];
      if (res) {
        const n = Math.min(k, res.order.length);
        for (let i = 0; i < n; i++) {
          const u = res.order[i];
          const a = net.nodes[u];
          dn.push(`M${a.x - 7},${a.y}a7,7 0 1,0 14,0a7,7 0 1,0 -14,0`);
          for (const id of gr.out[u]) {
            if (filter && !filter(id)) continue;
            const b = net.nodes[gr.edges[id].to];
            de.push(`M${a.x},${a.y}L${b.x},${b.y}`);
          }
        }
      }
      p.edges.setAttribute('d', de.join(''));
      p.nodes.setAttribute('d', dn.join(''));
    }

    const inside = (gr: SearchGraph, r: number) => (id: number) => part.region[gr.edges[id].from] === r && part.region[gr.edges[id].to] === r;

    /** 上位ネットワーク（ショートカットは曲線、領域をまたぐ実在の道路は直線） */
    function drawUpper(): void {
      upperLayer.innerHTML = '';
      if (!show.upper) return;
      const seen = new Set<string>();
      h.overlay.edges.forEach((e, i) => {
        const key = [Math.min(e.from, e.to), Math.max(e.from, e.to), h.isShortcut[i] ? 's' : 'c'].join(',');
        if (seen.has(key)) return;
        seen.add(key);
        el('path', { d: upperD(i), class: h.isShortcut[i] ? 'shortcut' : 'cross' }, upperLayer);
      });
    }
    function upperD(i: number): string {
      const e = h.overlay.edges[i];
      const a = net.nodes[e.from];
      const b = net.nodes[e.to];
      if (!h.isShortcut[i]) return `M${a.x},${a.y}L${b.x},${b.y}`;
      // 往復で同じ曲線になるよう、ノード番号の小さい方から見た向きで膨らませる
      const [p, r] = e.from < e.to ? [a, b] : [b, a];
      const mx = (p.x + r.x) / 2 - (r.y - p.y) * 0.18;
      const my = (p.y + r.y) / 2 + (r.x - p.x) * 0.18;
      return `M${a.x},${a.y}Q${mx},${my} ${b.x},${b.y}`;
    }

    function drawBoundary(): void {
      boundaryLayer.innerHTML = '';
      if (!show.boundary) return;
      for (const v of h.boundary.flat()) {
        const p = net.nodes[v];
        el('rect', { x: p.x - 14, y: p.y - 14, width: 28, height: 28, transform: `rotate(45 ${p.x} ${p.y})`, class: 'bnode' }, boundaryLayer);
      }
    }

    function labels(items: Array<{ v: number; text: string; cls?: string }>): void {
      labelLayer.innerHTML = '';
      for (const it of items) {
        const p = net.nodes[it.v];
        const g2 = el('g', { class: `note-callout ${it.cls ?? ''}`, transform: `translate(${p.x},${p.y - 40})` }, labelLayer);
        const w = [...it.text].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 24 : 14), 0) + 20;
        el('rect', { x: -w / 2, y: -20, width: w, height: 40, rx: 10 }, g2);
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', style: 'font-size:24px' }, g2).textContent = it.text;
      }
    }

    /** 上位ネットワークの探索のうち、先頭 k ノードまでで調べたエッジを強調する */
    function drawUpperProgress(k: number, final: boolean): void {
      upperHot.innerHTML = '';
      const ug = q.upperGraph;
      const up = q.upper;
      if (!ug || !up) return;
      const n = Math.min(k, up.order.length);
      for (let i = 0; i < n; i++) {
        const u = up.order[i];
        for (const id of ug.out[u]) {
          const e = ug.edges[id];
          if (e.road >= 0) el('path', { d: upperD(e.road), class: 'hot' }, upperHot);
          else {
            // 仮想ゴールへの辺：上位ノードから目的地へ、目的地側の局所探索のコストでつなぐ
            const a = net.nodes[u];
            const b = net.nodes[t];
            el('path', { d: `M${a.x},${a.y}L${b.x},${b.y}`, class: 'hot sink' }, upperHot);
          }
        }
      }
      if (final) for (const id of q.upperPath) el('path', { d: upperD(ug.edges[id].road), class: 'best' }, upperHot);
    }

    function costLabels(kind: 'back' | 'fwd' | 'upper', k = Infinity): void {
      const items: Array<{ v: number; text: string; cls?: string }> = [];
      if (kind === 'back') {
        for (const b of h.boundary[part.region[t]]) if (Number.isFinite(q.back.dist[b])) items.push({ v: b, text: `目的地まで ${q.back.dist[b].toFixed(1)}分` });
      } else if (kind === 'fwd') {
        for (const b of h.boundary[part.region[s]]) if (Number.isFinite(q.fwd.dist[b])) items.push({ v: b, text: `出発から ${q.fwd.dist[b].toFixed(1)}分` });
      } else if (q.upper) {
        const n = Math.min(k, q.upper.order.length);
        for (let i = 0; i < n; i++) {
          const v = q.upper.order[i];
          if (v < g.n) items.push({ v, text: `${q.upper.dist[v].toFixed(1)}分` });
        }
      }
      labels(items);
    }

    function setPathRight(on: boolean): void {
      right.setPaths(on && q.path ? [{ edges: q.path }] : [], g);
    }
    function setPathLeft(on: boolean): void {
      left.setPaths(on ? [{ edges: pathEdges(g, plain, t) ?? [] }] : [], g);
    }

    // ---- 段階ごとの再生 ----
    const nBack = () => q.back.order.length;
    const nFwd = () => q.fwd.order.length;
    const nUp = () => q.upper?.order.length ?? 0;
    const rt = () => part.region[t];
    const rs = () => part.region[s];

    function phase(kind: 'back' | 'fwd' | 'upper', autoplay = true): void {
      const n = kind === 'back' ? nBack() : kind === 'fwd' ? nFwd() : nUp();
      host.player.load(
        {
          duration: n,
          stops: [...Array(n).keys()].map((i) => i + 1),
          rate: Math.max(4, n / (kind === 'upper' ? 6 : 4)),
          render(time) {
            // 再生位置は連続値なので、確定したノード数（整数）に直してから使う
            const k = Math.floor(time + 1e-9);
            paint(pBack, h.rg, q.back, kind === 'back' ? k : Infinity, inside(h.rg, rt()));
            paint(pFwd, g, q.fwd, kind === 'back' ? 0 : kind === 'fwd' ? k : Infinity, inside(g, rs()));
            if (kind === 'upper') {
              drawUpperProgress(k, k >= n);
              costLabels('upper', k);
              setPathRight(k >= n);
            } else {
              upperHot.innerHTML = '';
              setPathRight(false);
              if (k >= n) costLabels(kind);
              else labels([]);
            }
            renderPhaseStats(kind, k);
          },
        },
        { autoplay },
      );
    }

    function renderPhaseStats(kind: 'back' | 'fwd' | 'upper', k: number): void {
      // 前の段階は完了済み、今の段階は k まで、後の段階はまだ 0
      const idx = ['back', 'fwd', 'upper'].indexOf(kind);
      const cur = (n: number, order: number) => (order < idx ? n : order === idx ? Math.min(k, n) : 0);
      host.stats.innerHTML = `
        <div class="stat"><div class="k">① 目的地側の逆探索</div><div class="v">${cur(nBack(), 0)}</div></div>
        <div class="stat"><div class="k">② 出発側の探索</div><div class="v">${cur(nFwd(), 1)}</div></div>
        <div class="stat"><div class="k">③ 上位ネットワーク</div><div class="v">${cur(nUp(), 2)}</div></div>
        <div class="stat"><div class="k">確定ノード数の合計</div><div class="v">${cur(nBack(), 0) + cur(nFwd(), 1) + cur(nUp(), 2)}</div></div>`;
      const notes = {
        back: `目的地のある<b>${REGION_NAMES[rt()]}</b>の中だけを、目的地から<b>逆向き</b>に探索。上位ノードから目的地までのコストがわかります。`,
        fwd: `出発地点のある<b>${REGION_NAMES[rs()]}</b>の中だけを探索。出発地点から上位ノードまでのコストがわかります。`,
        upper: `上位ネットワークだけを探索（ノードは ${h.boundary.flat().length} 個）。目的地側の上位ノードからは、①のコストで目的地へつなぎます。`,
      };
      host.setNote(notes[kind]);
    }

    /** 左右を同時に「確定ノード数」で進める（同じ時刻に同じ数だけ確定させて、総量を比べる） */
    function race(autoplay = true): void {
      const nh = nBack() + nFwd() + nUp();
      const np = plain.order.length;
      const n = Math.max(nh, np);
      host.player.load(
        {
          duration: n,
          stops: [nh, np].sort((a, b) => a - b),
          rate: n / 7,
          render(time) {
            const k = Math.floor(time + 1e-9);
            paint(pPlain, g, plain, k);
            setPathLeft(k >= np);
            paint(pBack, h.rg, q.back, k, inside(h.rg, rt()));
            paint(pFwd, g, q.fwd, k - nBack(), inside(g, rs()));
            drawUpperProgress(k - nBack() - nFwd(), k >= nh);
            setPathRight(k >= nh);
            labels([]);
            renderRaceStats(k);
          },
        },
        { autoplay },
      );
    }

    let timing: { plainMs: number; hierMs: number; avgPlain: number; avgHier: number } | null = null;
    function measure(): NonNullable<typeof timing> {
      // 実測。小さな街なので差は小さく、階層探索のほうが遅いこともある。結果はそのまま表示する
      const reps = 300;
      let a = performance.now();
      for (let i = 0; i < reps; i++) dijkstra(g, { sources: s, targets: [t] });
      const plainMs = (performance.now() - a) / reps;
      a = performance.now();
      for (let i = 0; i < reps; i++) hierQuery(h, s, t);
      const hierMs = (performance.now() - a) / reps;
      let sp = 0;
      let sh = 0;
      let n = 0;
      for (let u = 0; u < g.n; u += 9) {
        for (let v = 5; v < g.n; v += 13) {
          sp += dijkstra(g, { sources: u, targets: [v] }).order.length;
          sh += hierQuery(h, u, v).settled;
          n++;
        }
      }
      return { plainMs, hierMs, avgPlain: sp / n, avgHier: sh / n };
    }

    function renderRaceStats(k: number): void {
      const nh = nBack() + nFwd() + nUp();
      const np = plain.order.length;
      const same = Math.abs(q.cost - plain.dist[t]) < 1e-9;
      const tm = timing!;
      const html = `
        <div class="stat wide compare"><div class="k">1回の検索（この出発地点・目的地）</div><table>
          <thead><tr><th></th><th>通常</th><th>階層</th></tr></thead><tbody>
          <tr><td>確定ノード数</td><td>${Math.min(k, np)}${k >= np ? '' : '…'}</td><td>${Math.min(k, nh)}${k >= nh ? '' : '…'}</td></tr>
          <tr><td>調べたエッジ数</td><td>${plain.edgesScanned}</td><td>${q.scanned}</td></tr>
          <tr class="hl"><td>最短コスト</td><td>${plain.dist[t].toFixed(2)}分</td><td>${q.cost.toFixed(2)}分 ${same ? '✓一致' : '✗不一致'}</td></tr>
          <tr><td>実測時間（300回平均）</td><td>${tm.plainMs.toFixed(3)}ms</td><td>${tm.hierMs.toFixed(3)}ms</td></tr>
        </tbody></table></div>
        <div class="stat wide compare"><div class="k">前処理（最初に1回だけ）</div><table><tbody>
          <tr><td>領域内の探索</td><td>${h.pre.searches} 回・確定 ${h.pre.settled} ノード</td></tr>
          <tr><td>ショートカット</td><td>${h.pre.shortcuts} 本（＋領域間のエッジ ${h.pre.crossEdges} 本）</td></tr>
          <tr><td>実測時間</td><td>${preMs.toFixed(2)} ms</td></tr>
        </tbody></table></div>
        <div class="stat wide compare"><div class="k">多数の組み合わせの平均確定ノード数</div><table><tbody>
          <tr><td>通常</td><td>${tm.avgPlain.toFixed(1)}</td></tr>
          <tr><td>階層</td><td>${tm.avgHier.toFixed(1)}</td></tr>
        </tbody></table></div>`;
      if (host.stats.dataset.html !== html) {
        host.stats.innerHTML = html;
        host.stats.dataset.html = html;
      }
      host.setNote(
        `同じペースで1ノードずつ確定させています。階層探索は <b>${nh}</b> ノード、通常のダイクストラ法は <b>${np}</b> ノードで最短コストが確定。`,
      );
    }

    function setup(o: { split?: boolean; upper?: boolean; boundary?: boolean } = {}): void {
      dual.classList.toggle('single', !o.split);
      show.upper = o.upper ?? false;
      show.boundary = o.boundary ?? true;
      drawUpper();
      drawBoundary();
      labels([]);
      upperHot.innerHTML = '';
      for (const p of [pPlain, pBack, pFwd]) paint(p, g, null, 0);
      setPathLeft(false);
      setPathRight(false);
      host.stats.dataset.html = '';
    }

    function resetPair(): void {
      s = net.poi.west;
      t = nearestNode(net, 2150, 1350);
      compute();
    }

    // ---- 自由操作 ----
    const roleSeg = segmented<'start' | 'goal'>(
      [
        { value: 'start', label: '出発地点' },
        { value: 'goal', label: '目的地' },
      ],
      clickRole,
      (v) => (clickRole = v),
    );
    host.controls.append(row('クリックで', roleSeg.el), hint('交差点をクリックして出発地点・目的地を変えると、左右を並べて比較し直します（普通車・時間最短）。'));
    const onClick = (v: number) => {
      if (clickRole === 'start' && v !== t) s = v;
      else if (clickRole === 'goal' && v !== s) t = v;
      else return;
      compute();
      timing = measure();
      setup({ split: true, upper: true });
      race();
    };
    left.onNodeClick = onClick;
    right.onNodeClick = onClick;

    renderLegend(host.legend, [
      { swatch: '<rect x="7" y="3" width="12" height="12" transform="rotate(45 13 9)" fill="#ffd166" stroke="#0b0f17"/>', label: '上位ノード（境界）' },
      { swatch: '<path d="M2,14 Q13,0 24,14" fill="none" stroke="#c6a2ff" stroke-width="2.5"/>', label: 'ショートカット（前処理）' },
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#c6a2ff" stroke-width="5"/>', label: '領域をまたぐ道路' },
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#ff9e7a" stroke-width="5"/>', label: '① 目的地側の逆探索' },
      { swatch: '<line x1="2" y1="9" x2="24" y2="9" stroke="#4da3ff" stroke-width="5"/>', label: '② 出発側の探索／通常の探索' },
      { swatch: SW.path, label: '最短経路' },
    ]);

    resetPair();
    timing = measure();

    return {
      beats: [
        {
          title: '領域に分けて、出入口を決める',
          caption: `<p>街を川と線路で <strong>4つの領域</strong>に分けます。</p>
            <p>ほかの領域へつながる道の端（橋のたもと・踏切・高速の IC）を<strong>上位ノード</strong>とします。領域から出入りするには、必ずどれかの上位ノードを通ります。</p>`,
          enter() {
            resetPair();
            setup();
            host.player.unload();
            host.stats.innerHTML = `<div class="stat"><div class="k">領域</div><div class="v">${part.count}</div></div>
              <div class="stat"><div class="k">上位ノード</div><div class="v">${h.boundary.flat().length} / ${g.n}</div></div>
              <div class="stat wide"><div class="k">領域ごとの上位ノード数</div><div class="v" style="font-size:15px">${h.boundary.map((b, i) => `${REGION_NAMES[i]} ${b.length}`).join('　')}</div></div>`;
            host.setNote('普通車・時間最短の探索グラフを使います。');
          },
        },
        {
          title: '前処理：上位ノード間のコスト',
          caption: `<p>各領域の中で、上位ノードから上位ノードへの最短コストを<strong>あらかじめ</strong>計算しておきます（領域の外は通らない）。</p>
            <p>これを<strong>ショートカット</strong>（曲線）にして、領域をまたぐ道路（直線）と合わせたものが<strong>上位ネットワーク</strong>です。</p>
            <p class="muted">前処理は道路網が変わらない限り1回だけ。検索のたびには行いません。</p>`,
          enter() {
            resetPair();
            setup({ upper: true });
            host.player.unload();
            host.stats.innerHTML = `<div class="stat"><div class="k">領域内の探索（前処理）</div><div class="v">${h.pre.searches} 回</div></div>
              <div class="stat"><div class="k">確定ノード（前処理の合計）</div><div class="v">${h.pre.settled}</div></div>
              <div class="stat"><div class="k">ショートカット</div><div class="v">${h.pre.shortcuts}</div></div>
              <div class="stat"><div class="k">領域をまたぐエッジ</div><div class="v">${h.pre.crossEdges}</div></div>`;
            host.setNote(`上位ネットワークのノードは ${h.boundary.flat().length} 個だけ。`);
          },
        },
        {
          title: '① 目的地側を逆向きに探索',
          caption: `<p>まず<strong>目的地から逆向き</strong>に（エッジの向きを反転して）、目的地の領域の中だけを探索します。</p>
            <p>これで各上位ノードに「<strong>ここから目的地まで何分</strong>」が付きます。</p>
            <p class="muted">一方通行があるので、逆向きの探索には反転したグラフを使います。</p>`,
          enter() {
            resetPair();
            setup();
            phase('back');
          },
        },
        {
          title: '② 出発側を探索',
          caption: `<p>次に出発地点から、出発地点の領域の中だけを探索します。</p>
            <p>各上位ノードに「<strong>出発からここまで何分</strong>」が付きます。</p>`,
          enter() {
            resetPair();
            setup();
            phase('fwd');
          },
        },
        {
          title: '③ 上位ネットワークを探索',
          caption: `<p>上位ネットワークだけをダイクストラ法で探索します。始点は出発側の上位ノード（②のコスト付き）、終点は目的地側の上位ノード（①のコストを足す）。</p>
            <p>近そうな上位ノードを1つ選ぶのではなく、<strong>すべての候補を同時に</strong>比べるので、最短経路は失われません。</p>
            <p class="muted">出発地点と目的地が同じ領域なら、②で目的地に直接届く経路とも比べます。</p>`,
          enter() {
            resetPair();
            setup({ upper: true });
            phase('upper');
          },
        },
        {
          title: '展開して、通常の探索と比べる',
          caption: `<p>上位ネットワークの経路を、前処理で覚えておいた元の道路の並びに<strong>展開</strong>すると、実際の最短経路になります。最短コストは通常のダイクストラ法と<strong>一致</strong>します（テストで多数の組み合わせを確認）。</p>
            <p>探索するノードは減りますが、<strong>前処理のコスト</strong>が別にかかります。この小さな街では実測の速さはほとんど変わらず、逆転することもあります。大きな道路網ほど効果が出る仕組みです。</p>`,
          enter() {
            resetPair();
            setup({ split: true, upper: true });
            race();
          },
        },
      ],
      dispose() {
        left.destroy();
        right.destroy();
        dual.remove();
      },
    };
  },
};

/** 4つの領域を薄く色分けする */
function drawRegions(layer: SVGGElement): void {
  const ys: number[] = [];
  for (let y = -40; y <= WORLD.h + 40; y += 20) ys.push(y);
  const pts = (y0: number, y1: number, west: boolean) => {
    const yy = ys.filter((y) => y >= y0 && y <= y1);
    const river = yy.map((y) => `${riverX(y)},${y}`);
    const edge = west ? -30 : WORLD.w + 30;
    return [`${edge},${y0}`, ...river, `${edge},${y1}`].join(' ');
  };
  const regions = [pts(-40, RAIL_Y, true), pts(-40, RAIL_Y, false), pts(RAIL_Y, WORLD.h + 40, true), pts(RAIL_Y, WORLD.h + 40, false)];
  regions.forEach((p, i) => el('polygon', { points: p, fill: REGION_COLORS[i], class: 'region' }, layer));
  // 領域名
  const names: Array<[number, number]> = [
    [120, 40],
    [2280, 40],
    [120, 1480],
    [2280, 1480],
  ];
  names.forEach(([x, y], i) => {
    el('text', { x, y, class: 'region-name', 'text-anchor': i % 2 ? 'end' : 'start', fill: REGION_COLORS[i] }, layer).textContent = `${REGION_NAMES[i]}の領域`;
  });
}
