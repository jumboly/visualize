import { mergeIntervals, reachableSegments, type ReachSegment } from '../algo/isochrone';
import { buildMesh, meshOutline, type Mesh } from '../algo/mesh';
import { hint, renderLegend, row, segmented } from '../app/ui';
import { roadNetwork } from '../graph/roadNetwork';
import { buildSearchGraph, reverseGraph, SPEED_KMH, type SearchGraph } from '../graph/searchGraph';
import { CITY_VIEWBOX, drawCity, drawOneways } from '../viz/cityDecor';
import { NetworkView } from '../viz/networkView';
import { el, fmt } from '../viz/svg';
import { makeRun, stateAt, type Run } from './common';
import type { ChapterDef } from './types';

type IsoMode = 'walk' | 'car';
type Dir = 'out' | 'in';

/** 経過時間の区切り（上限に対する割合）。10分なら 3・5・7・10分 */
const BAND_RATIOS = [0.3, 0.5, 0.7, 1];
const BAND_COLORS = ['#a9d6ff', '#69b0f2', '#3f86d6', '#2c5fae'];
const LIMITS: Record<IsoMode, number[]> = { walk: [5, 10, 15], car: [1, 2, 3] };
/** 直線距離の円に使う速さ [m/分]（一般道の速さ） */
const CIRCLE_SPEED: Record<IsoMode, number> = {
  walk: (SPEED_KMH.walk.local! * 1000) / 60,
  car: (SPEED_KMH.car.local! * 1000) / 60,
};
const MODE_LABEL: Record<IsoMode, string> = { walk: '徒歩', car: '車' };
/** メッシュの原点。道路（x, y = 50 + 100i）がセルの境界線にちょうど重なると片側のセルしか塗られないので、少しずらす */
const MESH_ORIGIN = -7;
/** 2つの条件の差を色分けする（両方・こちらだけ・比較対象だけ） */
const DIFF_COLORS = { both: '#4a78b8', cur: '#ffb547', ghost: '#5fd3e6' };

export const ch4: ChapterDef = {
  no: 4,
  title: '波紋から商圏を作る',
  model: '最短コストの探索結果を、面の情報に変換する',
  create(host) {
    const net = roadNetwork();
    const view = new NetworkView(host.stage, net, 'road', CITY_VIEWBOX);
    view.svg.classList.add('iso');
    drawCity(view.layer('under'), view.layer('over-roads'), net);
    drawOneways(view.layer('over-roads'), net);
    const meshLayer = el('g', { class: 'mesh' }, view.layer('under'));
    const bandPaths = BAND_COLORS.map((c) => el('path', { class: 'band', stroke: c }, view.layer('wave')));
    const tickLayer = el('g', {}, view.layer('over'));
    const outlineLayer = el('g', {}, view.layer('over'));
    const ghostLayer = el('g', {}, view.layer('over'));
    const noteLayer = el('g', {}, view.layer('over'));
    const circle = el('circle', { class: 'reach-circle' }, view.layer('over-roads'));

    let store = net.poi.store;
    let mode: IsoMode = 'walk';
    let limit = 10;
    let dir: Dir = 'out';
    let cell = 50;
    const show = { roads: true, mesh: false, outline: false, circle: false };
    /** 比較用に重ねる別条件の輪郭 */
    let ghost: { mesh: Mesh; label?: string; cls: 'yellow' | 'cyan'; diff?: boolean } | null = null;
    /** メッシュの大きさごとの面積 [km²]（毎フレーム計算しないようにキャッシュ） */
    let areas: Record<number, number> = {};
    let zoomEdge: ReachSegment | null = null;

    let g!: SearchGraph;
    let run!: Run;
    let segs: ReachSegment[] = [];
    let mesh!: Mesh;
    let cellEls: Array<{ el: SVGRectElement; cost: number; on: boolean }> = [];

    function compute(): void {
      const base = buildSearchGraph(net, { mode, metric: 'time' });
      // 「店舗へ」は各地点から店舗までのコスト。向きを反転したグラフで店舗から探索すれば1回で求まる
      g = dir === 'out' ? base : reverseGraph(base);
      run = makeRun(g, { sources: store, maxCost: limit });
      segs = reachableSegments(g, run.res.dist, run.res.settled, limit);
      areas = {};
      for (const sz of [25, 50, 100]) {
        const m = meshFor(sz);
        areas[sz] = (m.cells.size * sz * sz) / 1e6;
        if (sz === cell) mesh = m;
      }
      buildCells();
      drawGhost();
      view.setGraph(g);
      view.setMarkers([{ node: store, kind: 'start', label: '店舗' }]);
      const p = net.nodes[store];
      circle.setAttribute('cx', String(p.x));
      circle.setAttribute('cy', String(p.y));
      circle.setAttribute('r', String(CIRCLE_SPEED[mode] * limit));
    }

    function meshFor(size: number): Mesh {
      return buildMesh(
        segs.map((s) => {
          const a = net.nodes[s.from];
          const b = net.nodes[s.to];
          return { x0: a.x, y0: a.y, x1: a.x + (b.x - a.x) * s.reach, y1: a.y + (b.y - a.y) * s.reach, c0: s.c0, c1: s.c0 + s.w * s.reach };
        }),
        size,
        MESH_ORIGIN,
        MESH_ORIGIN,
      );
    }

    function buildCells(): void {
      meshLayer.innerHTML = '';
      // 差分表示では、比較対象にしかないセルも描く
      const keys = new Set([...mesh.cells.keys(), ...(ghost?.diff ? ghost.mesh.cells.keys() : [])]);
      cellEls = [...keys].map((k) => {
        const [ix, iy] = k.split(',').map(Number);
        const mine = mesh.cells.get(k);
        const other = ghost?.diff ? ghost.mesh.cells.get(k) : undefined;
        const cost = Math.min(mine ?? Infinity, other ?? Infinity);
        const fill = !ghost?.diff ? BAND_COLORS[band(cost)] : mine !== undefined && other !== undefined ? DIFF_COLORS.both : mine !== undefined ? DIFF_COLORS.cur : DIFF_COLORS.ghost;
        const r = el('rect', { x: mesh.ox + ix * cell, y: mesh.oy + iy * cell, width: cell, height: cell, fill, class: 'cell', visibility: 'hidden' }, meshLayer);
        return { el: r, cost, on: false };
      });
      outlineLayer.innerHTML = '';
      el('path', { d: outlinePath(mesh), class: 'mesh-outline' }, outlineLayer);
    }

    function drawGhost(): void {
      ghostLayer.innerHTML = '';
      if (ghost && !ghost.diff) el('path', { d: outlinePath(ghost.mesh), class: `mesh-outline ghost ${ghost.cls}` }, ghostLayer);
    }

    const band = (c: number) => BAND_RATIOS.findIndex((r) => c <= r * limit + 1e-9);

    /** roadR まで道路を塗り、meshR までのセルを表示する */
    function draw(roadR: number, meshR: number): void {
      const { st } = stateAt(run, Math.min(roadR, run.tl.duration));
      view.render(st, -1);
      // 経過時間の帯ごとに1本の path にまとめる（数千本の線を毎フレーム更新しないため）
      const ds = BAND_COLORS.map(() => [] as string[]);
      if (show.roads) {
        for (const u of st.order) {
          const c0 = st.dist[u];
          for (const eid of g.out[u]) {
            const e = g.edges[eid];
            const end = Math.min(roadR, c0 + e.cost);
            if (end <= c0 && e.cost > 0) continue;
            const a = net.nodes[e.from];
            const b = net.nodes[e.to];
            let from = c0;
            for (let k = 0; k < BAND_RATIOS.length && from < end; k++) {
              const to = Math.min(end, BAND_RATIOS[k] * limit);
              if (to <= from) continue;
              const f0 = e.cost ? (from - c0) / e.cost : 0;
              const f1 = e.cost ? (to - c0) / e.cost : 1;
              ds[k].push(`M${a.x + (b.x - a.x) * f0},${a.y + (b.y - a.y) * f0}L${a.x + (b.x - a.x) * f1},${a.y + (b.y - a.y) * f1}`);
              from = to;
            }
          }
        }
      }
      bandPaths.forEach((p, k) => p.setAttribute('d', ds[k].join('')));

      // 道路の途中の到達限界（上限まで広がりきったときだけ）
      tickLayer.innerHTML = '';
      if (show.roads && roadR >= limit - 1e-9) {
        for (const s of segs) {
          if (s.reach >= 1) continue;
          const a = net.nodes[s.from];
          const b = net.nodes[s.to];
          const x = a.x + (b.x - a.x) * s.reach;
          const y = a.y + (b.y - a.y) * s.reach;
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const nx = (-(b.y - a.y) / len) * 13;
          const ny = ((b.x - a.x) / len) * 13;
          el('line', { x1: x - nx, y1: y - ny, x2: x + nx, y2: y + ny, class: 'limit-tick' }, tickLayer);
        }
      }

      for (const c of cellEls) {
        const on = show.mesh && c.cost <= meshR;
        if (on !== c.on) {
          c.el.setAttribute('visibility', on ? 'visible' : 'hidden');
          c.on = on;
        }
      }
      outlineLayer.style.display = show.outline && meshR >= limit - 1e-9 ? '' : 'none';
      circle.style.display = show.circle ? '' : 'none';
      view.svg.classList.toggle('mesh-on', show.mesh && meshR > 0);
      drawZoomNotes();
      renderStats(roadR, meshR);
    }

    function renderStats(roadR: number, meshR: number): void {
      const reachLen = reachableLength();
      const area = (m: Mesh) => (m.cells.size * m.size * m.size) / 1e6;
      const circleArea = (Math.PI * (CIRCLE_SPEED[mode] * limit) ** 2) / 1e6;
      const r = Math.min(roadR, limit);
      const html = `
        <div class="stat"><div class="k">条件</div><div class="v" style="font-size:15px">${MODE_LABEL[mode]} ${fmt(limit)}分・${dir === 'out' ? '店舗から' : '店舗へ'}</div></div>
        <div class="stat"><div class="k">経過時間（波紋の半径）</div><div class="v">${r.toFixed(1)} 分</div></div>
        <div class="stat"><div class="k">到達できる道路の長さ</div><div class="v">${(reachLen / 1000).toFixed(2)} km</div></div>
        <div class="stat"><div class="k">メッシュ ${cell}m の数</div><div class="v">${mesh.cells.size}</div></div>
        <div class="stat wide compare"><div class="k">面積の比較</div><table><tbody>
          <tr><td>直線距離の円（半径 ${Math.round(CIRCLE_SPEED[mode] * limit)} m）</td><td>${circleArea.toFixed(2)} km²</td></tr>
          ${[25, 50, 100].map((s) => `<tr class="${s === cell ? 'hl' : ''}"><td>メッシュ商圏 ${s}m</td><td>${areas[s].toFixed(2)} km²</td></tr>`).join('')}
          ${ghost?.label ? `<tr class="pin"><td>${ghost.label}</td><td>${area(ghost.mesh).toFixed(2)} km²</td></tr>` : ''}
        </tbody></table></div>`;
      if (host.stats.dataset.html !== html) {
        host.stats.innerHTML = html;
        host.stats.dataset.html = html;
      }
      const settled = run.res.order.length;
      if (meshR > 0 && show.mesh) host.setNote(`到達できる道路と交差する <b>${cell}m メッシュ</b>を、到達時間の早い順に塗っています。`);
      else if (roadR >= limit) host.setNote(`${fmt(limit)}分で届く交差点は <b>${settled}</b> か所。道路の途中の白い線が<b>到達限界</b>です。`);
      else host.setNote(`店舗から道路に沿って、経過時間 <b>${r.toFixed(1)}分</b> まで広がっています。`);
    }

    /** 物理的な道路ごとに、往復のエッジで届く区間をまとめた長さ */
    function reachableLength(): number {
      const byRoad = new Map<number, Array<[number, number]>>();
      for (const s of segs) {
        const e = g.edges[s.edge];
        // 道路の a→b を 0..1 とする座標に直す（反転グラフでも元の道路の向きで考える）
        const fromIsA = net.roads[e.road].a === s.from;
        const iv: [number, number] = fromIsA ? [0, s.reach] : [1 - s.reach, 1];
        byRoad.set(e.road, [...(byRoad.get(e.road) ?? []), iv]);
      }
      let sum = 0;
      for (const [road, ivs] of byRoad) for (const [a, b] of mergeIntervals(ivs)) sum += (b - a) * net.roads[road].length;
      return sum;
    }

    function outlinePath(m: Mesh): string {
      return meshOutline(m)
        .map(([x0, y0, x1, y1]) => `M${x0},${y0}L${x1},${y1}`)
        .join('');
    }

    /** 道路の途中で止まる例を、拡大して注釈する */
    function drawZoomNotes(): void {
      noteLayer.innerHTML = '';
      if (!zoomEdge) return;
      const s = zoomEdge;
      const a = net.nodes[s.from];
      const b = net.nodes[s.to];
      const x = a.x + (b.x - a.x) * s.reach;
      const y = a.y + (b.y - a.y) * s.reach;
      // 拡大率に合わせて文字の大きさと吹き出しの距離を決める
      const vbw = Number(view.svg.getAttribute('viewBox')!.split(' ')[2]);
      const fs = vbw / 42;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      // 道路に垂直な向き。吹き出しを道路の両側に振り分けて重ならないようにする
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const k = fs * 2.6;
      const callout = (cx: number, cy: number, text: string, cls = '') => {
        const g2 = el('g', { class: `note-callout ${cls}`, transform: `translate(${cx},${cy})` }, noteLayer);
        const w = [...text].reduce((t, ch) => t + (ch.charCodeAt(0) > 255 ? fs : fs * 0.6), 0) + fs;
        el('rect', { x: -w / 2, y: -fs * 0.95, width: w, height: fs * 1.9, rx: fs * 0.4 }, g2);
        // CSS の font-size より優先させるため style で指定する（拡大率に合わせた大きさにしたい）
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', style: `font-size:${fs}px` }, g2).textContent = text;
      };
      callout(a.x + nx * k, a.y + ny * k, `ここまで ${s.c0.toFixed(1)}分`);
      callout(b.x + nx * k, b.y + ny * k, `通り抜けに ${s.w.toFixed(1)}分`);
      callout(x - nx * k, y - ny * k, `${fmt(limit)}分の到達限界`, 'accent');
      el('circle', { cx: x, cy: y, r: fs * 0.6, class: 'focus-ring' }, noteLayer);
    }

    /** 拡大して見せるのに向いた「途中で止まる」エッジを選ぶ（先が届かず、途中で止まっているもの） */
    function pickZoomEdge(): ReachSegment | null {
      const cands = segs.filter((s) => s.reach > 0.3 && s.reach < 0.7 && !run.res.settled[s.to] && s.c0 > 0.6 * limit);
      cands.sort((p, q) => q.w - p.w || p.edge - q.edge);
      return cands[0] ?? null;
    }

    function zoomTo(s: ReachSegment | null): void {
      zoomEdge = s;
      if (!s) {
        view.setViewBox(CITY_VIEWBOX);
        return;
      }
      const a = net.nodes[s.from];
      const b = net.nodes[s.to];
      const w = Math.max(380, Math.hypot(b.x - a.x, b.y - a.y) * 3.4);
      const h = w * 0.62;
      view.setViewBox({ x: (a.x + b.x) / 2 - w / 2, y: (a.y + b.y) / 2 - h / 2, w, h });
    }

    // ---- 再生 ----
    /** 道路の波紋を 0 → 上限まで広げる */
    function playRoads(autoplay = true): void {
      host.player.load(
        { duration: limit, stops: BAND_RATIOS.map((r) => r * limit), rate: limit / 6, render: (t) => draw(t, -1) },
        { autoplay },
      );
    }
    /** 道路は上限まで塗った状態で、メッシュを到達時間の順に表示する */
    function playMesh(autoplay = true): void {
      host.player.load(
        { duration: limit, stops: BAND_RATIOS.map((r) => r * limit), rate: limit / 5, render: (t) => draw(limit, t) },
        { autoplay },
      );
    }
    function showFinal(): void {
      host.player.load({ duration: limit, stops: [limit], rate: limit / 5, render: () => draw(limit, limit) }, { at: limit });
    }

    function setup(o: Partial<{ store: number; mode: IsoMode; limit: number; dir: Dir; cell: number }> & { show?: Partial<typeof show> } = {}): void {
      store = o.store ?? net.poi.store;
      mode = o.mode ?? 'walk';
      limit = o.limit ?? (mode === 'walk' ? 10 : 2);
      dir = o.dir ?? 'out';
      cell = o.cell ?? 50;
      Object.assign(show, { roads: true, mesh: false, outline: false, circle: false }, o.show ?? {});
      ghost = null;
      zoomEdge = null;
      view.setViewBox(CITY_VIEWBOX);
      compute();
      syncControls();
    }

    function rerun(): void {
      ghost = null;
      zoomTo(null);
      compute();
      if (show.mesh) playMesh();
      else playRoads();
    }

    // ---- 自由操作 ----
    const modeSeg = segmented<IsoMode>(
      [
        { value: 'walk', label: '徒歩' },
        { value: 'car', label: '車' },
      ],
      mode,
      (v) => {
        mode = v;
        limit = LIMITS[mode][1];
        renderLimitSeg();
        rerun();
      },
    );
    const limitBox = document.createElement('span');
    let limitSeg = segmented<number>([], limit, () => {});
    function renderLimitSeg(): void {
      limitSeg = segmented<number>(
        LIMITS[mode].map((l) => ({ value: l, label: `${l}分` })),
        limit,
        (v) => {
          limit = v;
          rerun();
        },
      );
      limitBox.replaceChildren(limitSeg.el);
    }
    const dirSeg = segmented<Dir>(
      [
        { value: 'out', label: '店舗から' },
        { value: 'in', label: '店舗へ' },
      ],
      dir,
      (v) => {
        dir = v;
        rerun();
      },
    );
    const cellSeg = segmented<number>(
      [25, 50, 100].map((s) => ({ value: s, label: `${s}m` })),
      cell,
      (v) => {
        cell = v;
        mesh = meshFor(cell);
        buildCells();
        host.stats.dataset.html = '';
        host.player.seek(host.player.time);
      },
    );
    const layerBox = document.createElement('div');
    layerBox.className = 'row';
    const toggles: Array<[keyof typeof show, string]> = [
      ['roads', '道路到達圏'],
      ['mesh', 'メッシュ'],
      ['outline', '輪郭'],
      ['circle', '直線の円'],
    ];
    function renderToggles(): void {
      layerBox.innerHTML = '<span class="lbl">表示</span>';
      for (const [k, label] of toggles) {
        const l = document.createElement('label');
        l.className = 'chk';
        l.innerHTML = `<input type="checkbox" ${show[k] ? 'checked' : ''}> ${label}`;
        l.querySelector('input')!.addEventListener('change', (ev) => {
          show[k] = (ev.target as HTMLInputElement).checked;
          // メッシュや輪郭は上限まで広がった結果から作るので、表示を切り替えたら完成形を見せる
          showFinal();
        });
        layerBox.appendChild(l);
      }
    }
    function syncControls(): void {
      modeSeg.set(mode);
      renderLimitSeg();
      dirSeg.set(dir);
      cellSeg.set(cell);
      renderToggles();
    }
    host.controls.append(
      row('移動手段', modeSeg.el),
      row('時間', limitBox),
      row('向き', dirSeg.el),
      row('メッシュ', cellSeg.el),
      layerBox,
      hint('交差点をクリックすると店舗をそこへ移します。車は街が小さいため 1〜3 分にしています。'),
    );
    view.onNodeClick = (v) => {
      store = v;
      rerun();
    };

    renderLegend(host.legend, [
      ...BAND_COLORS.map((c, k) => ({
        swatch: `<line x1="2" y1="9" x2="24" y2="9" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
        label: `上限の ${Math.round((BAND_RATIOS[k - 1] ?? 0) * 100)}〜${Math.round(BAND_RATIOS[k] * 100)}%`,
      })),
      { swatch: '<line x1="13" y1="2" x2="13" y2="16" stroke="#fff" stroke-width="3"/>', label: '道路途中の到達限界' },
      { swatch: '<rect x="4" y="2" width="18" height="14" fill="#3f86d6" fill-opacity=".55"/>', label: 'メッシュ（道路と交差）' },
      { swatch: '<rect x="4" y="2" width="18" height="14" fill="none" stroke="#ffd166" stroke-width="2"/>', label: 'メッシュを統合した輪郭' },
      { swatch: '<circle cx="13" cy="9" r="7" fill="none" stroke="#ff9e7a" stroke-width="2" stroke-dasharray="3 2"/>', label: '直線距離の円' },
      // 「店舗から／店舗へ」を重ねたときの色。キャプションだけだと読み返さないと色の意味がわからないため
      ...([
        ['cur', '比較：表示中の向きだけ'],
        ['ghost', '比較：逆の向きだけ'],
        ['both', '比較：両方で届く'],
      ] as const).map(([k, label]) => ({
        swatch: `<rect x="4" y="2" width="18" height="14" fill="${DIFF_COLORS[k]}"/>`,
        label,
      })),
    ]);

    setup();
    const zoomEx = pickZoomEdge();

    return {
      beats: [
        {
          title: '店舗から徒歩10分',
          caption: `<p>店舗からダイクストラ法を実行し、累積の移動時間が<strong>10分以内</strong>の道路を探索します。</p>
            <p>色は経過時間（3分・5分・7分・10分）。波紋は<strong>道路に沿って</strong>広がり、川は橋のあるところでしか越えられません。</p>`,
          enter() {
            setup();
            playRoads();
          },
        },
        {
          title: '道路の途中で止まる',
          caption: `<p>到達圏はノードだけでは決まりません。</p>
            <p>${zoomEx ? `たとえば交差点まで ${zoomEx.c0.toFixed(1)} 分かかり、その先の道を通り抜けるのに ${zoomEx.w.toFixed(1)} 分かかるなら` : '交差点まで 9 分、その先の道が 3 分なら'}、10分の限界は<strong>道路の途中</strong>に来ます。</p>
            <p>エッジごとに「始点の最短コスト ＋ 進んだぶんのコスト」で、上限に達する位置を求めています。</p>`,
          enter() {
            setup();
            zoomTo(pickZoomEdge());
            showFinal();
          },
        },
        {
          title: '線から面へ：メッシュ化',
          caption: `<p>到達できる道路区間と交差する <strong>50m メッシュ</strong>を塗ると、線の到達圏が<strong>面</strong>になります。</p>
            <p>メッシュを統合した輪郭が、商圏のポリゴンです。</p>
            <p class="muted">これは「道路が通るセル」を塗る近似です。道路のない場所（川・公園の中）や、セルの大きさで結果が変わります。</p>`,
          enter() {
            setup({ show: { mesh: true, outline: true } });
            playMesh();
          },
        },
        {
          title: 'メッシュの大きさで結果が変わる',
          caption: `<p>同じ到達圏でも、<strong>100m メッシュ</strong>では粗く広めに、<strong>25m</strong> では道路の形に近くなります（黄色の線が 25m の輪郭）。</p>
            <p>面積も変わります。用途に合わせて解像度を選ぶ必要があります。</p>`,
          enter() {
            setup({ cell: 100, show: { roads: false, mesh: true } });
            ghost = { mesh: meshFor(25), label: 'メッシュ商圏 25m（黄色の線）', cls: 'yellow' };
            drawGhost();
            showFinal();
          },
        },
        {
          title: '円・道路・メッシュを比べる',
          caption: `<p>点線の円は「直線距離で 10 分（800m）」の範囲です。</p>
            <p>実際には、川の向こうは<strong>橋の近くしか</strong>届かず、線路も踏切でしか渡れません。円は商圏を大きく見積もってしまいます。</p>
            <p>道路ネットワーク上の到達圏から作った商圏は、<strong>地形と道路の形</strong>を反映します。</p>`,
          enter() {
            setup({ show: { roads: true, mesh: true, outline: true, circle: true } });
            showFinal();
          },
        },
        {
          title: '車：店舗から と 店舗へ',
          caption: `<p>車で 2 分。店舗は旧橋（<strong>東向きの一方通行</strong>）の東のたもとにあります。</p>
            <p><span style="color:#ffb547">橙</span>は「<strong>店舗へ来られる</strong>が、店舗からは行けない」、<span class="c-alt">水色</span>はその逆、青は両方。</p>
            <p>西岸からは旧橋を渡って店舗へ来られますが、店舗から西岸へは旧橋を使えず、北大橋へ回る必要があります。</p>
            <p class="muted">「店舗へ」は、エッジの向きを反転したグラフで店舗から探索して求めています。</p>`,
          enter() {
            setup({ store: net.poi.carStore, mode: 'car', limit: 2, dir: 'out' });
            ghost = { mesh, cls: 'cyan', diff: true };
            dir = 'in';
            show.mesh = true;
            show.roads = false;
            compute();
            syncControls();
            playMesh();
          },
        },
        {
          title: '自由に試す',
          caption: `<p>交差点をクリックして店舗を動かしたり、徒歩／車、時間、メッシュの大きさを変えてみてください。</p>
            <p>川や線路の近くに店舗を置くと、円との違いがよくわかります。</p>`,
          enter() {
            setup({ show: { roads: true, mesh: true, outline: true, circle: true } });
            playRoads(false);
            showFinal();
          },
        },
      ],
      dispose() {
        view.destroy();
      },
    };
  },
};
