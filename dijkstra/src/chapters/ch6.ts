import { odMatrix, type OdMatrix } from '../algo/od';
import { bestTour, enumerateTours, factorial, heldKarp, type Tour } from '../algo/tsp';
import { hint, renderLegend, row, SW } from '../app/ui';
import { nearestNode, roadNetwork } from '../graph/roadNetwork';
import { buildSearchGraph } from '../graph/searchGraph';
import { CITY_VIEWBOX, drawCity } from '../viz/cityDecor';
import { NetworkView, type Marker } from '../viz/networkView';
import { buildTimeline, frameAt, SearchReplay, type Timeline } from '../viz/replay';
import { el } from '../viz/svg';
import type { ChapterDef } from './types';

const LETTERS = 'ABCDEFGH';
const MAX_POINTS = 7;
/** 発表用の初期配置：A は配送センター。一方通行で行列が非対称になる位置を選んでいる */
const DEFAULT_POINTS: Array<[number, number]> = [
  [650, 950],
  [850, 450],
  [1950, 450],
  [1850, 1250],
  [1350, 650],
];
const STAGES = ['道路ネットワーク', 'ODマトリックス', '巡回順序の最適化', '道路上の巡回ルート'];

export const ch6: ChapterDef = {
  no: 6,
  title: '巡回セールスマン問題',
  model: 'ダイクストラ法の結果を、別の最適化問題の入力にする',
  create(host) {
    const net = roadNetwork();
    const g = buildSearchGraph(net, { mode: 'car', metric: 'time' });

    host.stage.innerHTML = `<div class="od-layout"><div class="od-map"></div><div class="od-side"><div class="flow"></div><div class="matrix"></div><div class="tours"></div></div></div>`;
    const layout = host.stage.querySelector('.od-layout') as HTMLElement;
    const view = new NetworkView(host.stage.querySelector('.od-map') as HTMLElement, net, 'road', CITY_VIEWBOX);
    view.svg.classList.add('od');
    drawCity(view.layer('under'), view.layer('over-roads'), net);
    const flowEl = host.stage.querySelector('.flow') as HTMLElement;
    const matrixEl = host.stage.querySelector('.matrix') as HTMLElement;
    const toursEl = host.stage.querySelector('.tours') as HTMLElement;
    const abstractLayer = el('g', { class: 'abstract-g' }, view.layer('over'));
    const orderLayer = el('g', {}, view.layer('over'));
    const defs = el('defs', {}, view.svg);
    defs.innerHTML = `
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8b97ab"/></marker>
      <marker id="arr-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#ffd166"/></marker>`;

    let pts: number[] = [];
    let od!: OdMatrix;
    let tours: Tour[] = [];
    // compute() の中で代入するので、初期値の null に型が絞り込まれないようにする
    let best = null as Tour | null;
    let replays: SearchReplay[] = [];
    let tls: Timeline[] = [];
    let offsets: number[] = [];

    function compute(points: number[]): void {
      pts = points;
      od = odMatrix(g, pts, true);
      replays = od.runs.map((r) => new SearchReplay(g.n, g.edges.length, r.events));
      tls = od.runs.map((r) => buildTimeline(r.events, 'wave'));
      // 行ごとの探索を順に再生する。行の間に少し間を置く
      const gap = 0.6;
      offsets = [];
      let acc = 0;
      for (const tl of tls) {
        offsets.push(acc);
        acc += tl.duration + gap;
      }
      offsets.push(acc);
      tours = enumerateTours(od.matrix);
      best = bestTour(tours);
      setMarkers();
      fitView();
    }

    /** 訪問地点と巡回ルートが収まる範囲に拡大する（街全体だと小さくて数字が読めないため） */
    function fitView(): void {
      const vs = [...pts, ...(best ? tourRoute(best).map((id) => g.edges[id].to) : [])].map((v) => net.nodes[v]);
      const m = 220;
      const x0 = Math.max(CITY_VIEWBOX.x, Math.min(...vs.map((p) => p.x)) - m);
      const y0 = Math.max(CITY_VIEWBOX.y, Math.min(...vs.map((p) => p.y)) - m);
      const x1 = Math.min(CITY_VIEWBOX.x + CITY_VIEWBOX.w, Math.max(...vs.map((p) => p.x)) + m);
      const y1 = Math.min(CITY_VIEWBOX.y + CITY_VIEWBOX.h, Math.max(...vs.map((p) => p.y)) + m);
      view.setViewBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }

    const label = (i: number) => LETTERS[i];
    function setMarkers(): void {
      const ms: Marker[] = pts.map((v, i) => ({ node: v, kind: i === 0 ? 'start' : 'visit', label: i === 0 ? `${label(i)} センター` : label(i) }));
      view.setMarkers(ms);
    }

    // ---- 右側：流れ・行列・巡回の一覧 ----
    function renderFlow(active: number): void {
      flowEl.innerHTML = STAGES.map((s, i) => `<span class="${i === active ? 'on' : i < active ? 'done' : ''}">${s}</span>`).join('<i>→</i>');
    }

    interface MatrixOpts {
      filled: (i: number, j: number) => boolean;
      activeRow?: number;
      hot?: Set<string>;
      asym?: boolean;
    }
    function renderMatrix(o: MatrixOpts): void {
      const n = pts.length;
      const m = od.matrix;
      let h = `<table class="odm"><thead><tr><th class="corner">出発＼到着</th>${pts.map((_, j) => `<th>${label(j)}</th>`).join('')}</tr></thead><tbody>`;
      for (let i = 0; i < n; i++) {
        h += `<tr class="${o.activeRow === i ? 'active' : ''}"><th>${label(i)}</th>`;
        for (let j = 0; j < n; j++) {
          const key = `${i},${j}`;
          const cls: string[] = [];
          let txt = '';
          if (i === j) {
            txt = '—';
            cls.push('diag');
          } else if (!o.filled(i, j)) {
            txt = '?';
            cls.push('empty');
          } else if (!Number.isFinite(m[i][j])) {
            txt = '到達不能';
            cls.push('unreach');
          } else {
            txt = m[i][j].toFixed(2);
            if (o.asym && Math.abs(m[i][j] - m[j][i]) > 0.005) cls.push('asym');
          }
          if (o.hot?.has(key)) cls.push('hot');
          h += `<td class="${cls.join(' ')}">${txt}</td>`;
        }
        h += '</tr>';
      }
      h += `</tbody></table><div class="odm-note">単位：分（普通車・時間最短）。行が出発、列が到着。</div>`;
      if (matrixEl.dataset.html !== h) {
        matrixEl.innerHTML = h;
        matrixEl.dataset.html = h;
      }
    }

    const fmtTour = (t: Tour) => [...t.order, t.order[0]].map(label).join('→');
    /** 先頭 k+1 件の候補を表示し、cur 番目を強調する */
    function renderTours(k: number, cur = k): void {
      if (k < 0) {
        toursEl.innerHTML = '';
        return;
      }
      const n = Math.min(k + 1, tours.length);
      let bi = -1;
      for (let i = 0; i < n; i++) if (Number.isFinite(tours[i].cost) && (bi < 0 || tours[i].cost < tours[bi].cost)) bi = i;
      const rows = tours
        .slice(0, n)
        .map((t, i) => `<li class="${i === cur ? 'cur' : ''} ${i === bi ? 'best' : ''}"><span>${i === bi ? '★ ' : ''}${fmtTour(t)}</span><b>${Number.isFinite(t.cost) ? t.cost.toFixed(2) + '分' : '巡回不可'}</b></li>`)
        .join('');
      toursEl.innerHTML = `<div class="tours-head">訪問順序の候補 ${n} / ${tours.length} 通り</div><ol>${rows}</ol>`;
      toursEl.querySelector('li.cur')?.scrollIntoView({ block: 'nearest' });
    }

    // ---- 左側：抽象化したグラフ ----
    function curve(i: number, j: number): { d: string; lx: number; ly: number } {
      const a = net.nodes[pts[i]];
      const b = net.nodes[pts[j]];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      // 進行方向の右側へ膨らませ、i→j と j→i が別の曲線になるようにする
      const off = Math.min(140, len * 0.16);
      const cx = (a.x + b.x) / 2 - (dy / len) * off;
      const cy = (a.y + b.y) / 2 + (dx / len) * off;
      // 端点はマーカーの外側で止める
      const sh = 26 / len;
      const sx = a.x + dx * sh;
      const sy = a.y + dy * sh;
      const ex = b.x - dx * sh;
      const ey = b.y - dy * sh;
      return { d: `M${sx},${sy}Q${cx},${cy} ${ex},${ey}`, lx: 0.25 * sx + 0.5 * cx + 0.25 * ex, ly: 0.25 * sy + 0.5 * cy + 0.25 * ey };
    }
    function drawAbstract(o: { labels: boolean; hot?: Tour | null }): void {
      abstractLayer.innerHTML = '';
      const n = pts.length;
      const hotSet = new Set<string>();
      if (o.hot) o.hot.order.forEach((v, k) => hotSet.add(`${v},${o.hot!.order[(k + 1) % n]}`));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j || !Number.isFinite(od.matrix[i][j])) continue;
          const c = curve(i, j);
          const hot = hotSet.has(`${i},${j}`);
          el('path', { d: c.d, class: `ab-edge ${hot ? 'hot' : ''}`, 'marker-end': hot ? 'url(#arr-hot)' : 'url(#arr)' }, abstractLayer);
          if (o.labels || hot) {
            const g2 = el('g', { class: `ab-label ${hot ? 'hot' : ''}`, transform: `translate(${c.lx},${c.ly})` }, abstractLayer);
            el('rect', { x: -52, y: -26, width: 104, height: 52, rx: 12 }, g2);
            el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g2).textContent = od.matrix[i][j].toFixed(2);
          }
        }
      }
    }

    function setAbstract(on: boolean): void {
      view.svg.classList.toggle('abstract', on);
      if (!on) abstractLayer.innerHTML = '';
    }

    function drawOrderNumbers(t: Tour | null): void {
      orderLayer.innerHTML = '';
      if (!t) return;
      t.order.forEach((i, k) => {
        const p = net.nodes[pts[i]];
        if (k === 0) return;
        const g2 = el('g', { class: 'order-no', transform: `translate(${p.x + 38},${p.y + 38})` }, orderLayer);
        el('circle', { r: 28 }, g2);
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g2).textContent = String(k);
      });
    }

    function tourRoute(t: Tour): number[] {
      return t.order.flatMap((i, k) => od.paths[i][t.order[(k + 1) % t.order.length]] ?? []);
    }

    // ---- 再生 ----
    function clearMap(): void {
      view.render(null, -1);
      view.setPaths([]);
      drawOrderNumbers(null);
    }

    function showPoints(): void {
      setAbstract(false);
      clearMap();
      renderFlow(0);
      renderMatrix({ filled: () => false });
      renderTours(-1);
      host.player.unload();
    }

    /** 各地点から 1対N 探索を順に行い、行列の行を埋めていく */
    function playOd(autoplay = true): void {
      setAbstract(false);
      drawOrderNumbers(null);
      renderFlow(1);
      renderTours(-1);
      view.setGraph(g);
      const total = offsets[offsets.length - 1];
      host.player.load(
        {
          duration: total,
          // 各行の探索が終わった位置で止まれるようにする
          stops: [...tls.map((tl, i) => offsets[i] + tl.duration), total],
          rate: total / (pts.length * 2.6),
          render(T) {
            let r = offsets.findIndex((o, i) => T >= o && T < offsets[i + 1]);
            if (r < 0) r = pts.length - 1;
            const local = Math.min(T - offsets[r], tls[r].duration);
            const fr = frameAt(tls[r], od.runs[r].events, local);
            const st = replays[r].at(fr.k);
            const done = T >= total - 1e-9;
            view.render(done ? null : st, fr.radius);
            const settledNow = (j: number) => st.settled[pts[j]] === 1;
            view.setPaths(done ? [] : pts.map((_, j) => (j !== r && settledNow(j) ? { edges: od.paths[r][j] ?? [] } : { edges: [] })));
            renderMatrix({ filled: (i, j) => done || i < r || (i === r && settledNow(j)), activeRow: done ? undefined : r });
            host.setNote(
              done
                ? `${pts.length} 回の 1対N 探索で、${pts.length * (pts.length - 1)} 個のセルがすべて埋まりました。`
                : `<b>${label(r)}</b> から 1対N 探索。波紋が他の地点に届くたびに、<b>${label(r)} 行</b>のセルが確定します。`,
            );
            renderStatsOd(done ? pts.length : r);
          },
        },
        { autoplay },
      );
    }

    function renderStatsOd(rowsDone: number): void {
      host.stats.innerHTML = `<div class="stat"><div class="k">1対N 探索の回数</div><div class="v">${rowsDone} / ${pts.length}</div></div>
        <div class="stat"><div class="k">訪問地点</div><div class="v">${pts.length}</div></div>`;
    }

    function showMatrix(o: { asym?: boolean; abstract?: boolean; labels?: boolean }): void {
      host.player.unload();
      clearMap();
      setAbstract(o.abstract ?? false);
      if (o.abstract) drawAbstract({ labels: o.labels ?? true });
      renderFlow(1);
      renderMatrix({ filled: () => true, asym: o.asym });
      renderTours(-1);
    }

    /** 最も非対称な組み合わせ（行と列を入れ替えた値の差が最大） */
    function mostAsym(): [number, number] | null {
      let bestPair: [number, number] | null = null;
      let diff = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let j = 0; j < pts.length; j++) {
          const d = od.matrix[j][i] - od.matrix[i][j];
          if (Number.isFinite(d) && d > diff) {
            diff = d;
            bestPair = [i, j];
          }
        }
      }
      return bestPair;
    }

    /** 全列挙：1つずつ巡回コストを計算し、最小を更新していく */
    function playTsp(autoplay = true): void {
      setAbstract(true);
      clearMap();
      renderFlow(2);
      const n = tours.length;
      host.player.load(
        {
          duration: n,
          stops: [...Array(n).keys()].map((i) => i + 1),
          rate: Math.max(3, n / 10),
          render(t) {
            const k = Math.min(n - 1, Math.floor(t));
            const done = t >= n;
            const cur = done ? best : tours[k];
            drawAbstract({ labels: false, hot: cur });
            const hot = new Set<string>();
            if (cur) cur.order.forEach((v, idx) => hot.add(`${v},${cur.order[(idx + 1) % cur.order.length]}`));
            renderMatrix({ filled: () => true, hot });
            renderTours(done ? n - 1 : k, done && best ? tours.indexOf(best) : k);
            if (done) {
              const finite = tours.filter((x) => Number.isFinite(x.cost)).map((x) => x.cost);
              host.setNote(
                best
                  ? `${n} 通りを比べて、最小は <b>${fmtTour(best)}</b>（${best.cost.toFixed(2)}分）。最大は ${Math.max(...finite).toFixed(2)}分。`
                  : '到達できない区間があるため、巡回できません。',
              );
            } else host.setNote(`候補 ${k + 1}：${fmtTour(tours[k])} = 行列の ${pts.length} セルの和 = <b>${Number.isFinite(tours[k].cost) ? tours[k].cost.toFixed(2) + '分' : '巡回不可'}</b>`);
            renderStatsTsp(Math.min(n, k + 1));
          },
        },
        { autoplay },
      );
    }

    function renderStatsTsp(checked: number): void {
      const hk = heldKarp(od.matrix);
      host.stats.innerHTML = `<div class="stat"><div class="k">比べた訪問順序</div><div class="v">${checked} / ${tours.length}</div></div>
        <div class="stat"><div class="k">最小の巡回コスト</div><div class="v">${best ? best.cost.toFixed(2) + '分' : '—'}</div></div>
        <div class="stat wide compare"><div class="k">組み合わせの爆発（出発地点を固定した訪問順序の数）</div><table><tbody>
          ${[5, 8, 11, 16, 21].map((m) => `<tr class="${m === pts.length ? 'hl' : ''}"><td>${m} 地点</td><td>${factorial(m - 1).toLocaleString('ja-JP')} 通り</td></tr>`).join('')}
        </tbody></table></div>
        <div class="stat wide"><div class="k">検算（動的計画法 Held-Karp による厳密解）</div><div class="v" style="font-size:14px">${hk ? `${fmtTour(hk)} ${hk.cost.toFixed(2)}分` : '巡回不可'}</div></div>`;
    }

    /** 道路ネットワークに戻して、巡回ルートを描く */
    function playRoute(autoplay = true): void {
      setAbstract(false);
      renderFlow(3);
      renderMatrix({ filled: () => true });
      renderTours(tours.length - 1, best ? tours.indexOf(best) : -1);
      view.render(null, -1);
      const route = best ? tourRoute(best) : [];
      drawOrderNumbers(best);
      host.player.load(
        {
          duration: 1,
          stops: [1],
          rate: 0.2,
          render(p) {
            view.setPaths(route.length ? [{ edges: route, progress: p }] : [], g);
            host.setNote(
              best
                ? `OD マトリックスを作ったときの区間ごとの最短経路をつなげると、道路上の巡回ルートになります（${best.cost.toFixed(2)}分）。`
                : '巡回できる順序がありません。',
            );
          },
        },
        { autoplay },
      );
      host.stats.innerHTML = best
        ? `<div class="stat wide"><div class="k">巡回ルート</div><div class="v" style="font-size:16px">${fmtTour(best)}</div></div>
           <div class="stat"><div class="k">巡回コスト</div><div class="v">${best.cost.toFixed(2)}分</div></div>
           <div class="stat"><div class="k">ダイクストラ法の実行回数</div><div class="v">${pts.length}</div></div>`
        : '';
    }

    function defaultPoints(): number[] {
      return DEFAULT_POINTS.map(([x, y]) => nearestNode(net, x, y));
    }

    // ---- 自由操作 ----
    host.controls.append(
      row('', hint(`交差点をクリックすると訪問地点を追加・削除します（${MAX_POINTS} 地点まで。A は配送センターで固定）。追加すると OD マトリックスを作り直し、巡回順序を全列挙します。`)),
    );
    view.onNodeClick = (v) => {
      const i = pts.indexOf(v);
      let next = pts;
      if (i > 0) next = pts.filter((x) => x !== v);
      else if (i < 0 && pts.length < MAX_POINTS) next = [...pts, v];
      else return;
      compute(next);
      showMatrix({ abstract: false });
      playRoute(true);
    };

    renderLegend(host.legend, [
      { swatch: SW.start, label: '配送センター（A）' },
      { swatch: '<circle cx="13" cy="9" r="7" fill="none" stroke="#f0a5ff" stroke-width="3"/>', label: '訪問先' },
      { swatch: SW.wave, label: '1対N 探索の波紋' },
      { swatch: SW.path, label: '最短経路／巡回ルート' },
      { swatch: '<path d="M2,14 Q13,2 24,12" fill="none" stroke="#8b97ab" stroke-width="2"/>', label: '地点間のコスト（抽象化）' },
      { swatch: '<rect x="3" y="3" width="20" height="12" fill="#4a3a1a" stroke="#ffb547"/>', label: '非対称なセル' },
    ]);

    compute(defaultPoints());
    const asymPair = mostAsym();
    const revOfBest = best ? tours.find((x) => x.order.join() === [0, ...best!.order.slice(1).reverse()].join()) : undefined;

    return {
      beats: [
        {
          title: '配送センターと訪問先',
          caption: `<p>配送センター <strong>A</strong> を出て、B・C・D・E をすべて回り、A へ戻ります。<strong>どの順番で回ると最も早いか？</strong></p>
            <p>これは<strong>巡回セールスマン問題</strong>（TSP）です。ダイクストラ法とは別の問題ですが、ダイクストラ法の結果を使って解きます。</p>`,
          enter() {
            compute(defaultPoints());
            showPoints();
            host.stats.innerHTML = '';
            host.setNote('車で回ります（普通車・時間最短）。');
          },
        },
        {
          title: 'OD マトリックスを作る',
          caption: `<p>各地点を出発地点に <strong>1対N のダイクストラ法</strong>を実行します（第2章）。</p>
            <p>A から探索すると A→B, A→C, A→D, A→E が一度に確定し、<strong>A の行</strong>が埋まります。次は B から……と、地点の数だけ探索すれば表が完成します。</p>`,
          enter() {
            compute(defaultPoints());
            playOd();
          },
        },
        {
          title: '行列は対称ではない',
          caption: asymPair
            ? `<p>一方通行があるので、<strong>${label(asymPair[0])}→${label(asymPair[1])}</strong> は ${od.matrix[asymPair[0]][asymPair[1]].toFixed(2)}分、<strong>${label(asymPair[1])}→${label(asymPair[0])}</strong> は ${od.matrix[asymPair[1]][asymPair[0]].toFixed(2)}分。</p>
              <p>行列を勝手に対称と見なしてはいけません（<span style="color:#ffb547">橙のセル</span>が非対称）。行が出発、列が到着です。</p>`
            : '<p>この配置では行列はほぼ対称です。</p>',
          enter() {
            compute(defaultPoints());
            showMatrix({ asym: true });
            if (asymPair) {
              const [i, j] = asymPair;
              view.setPaths([{ edges: od.paths[i][j] ?? [] }, { edges: od.paths[j][i] ?? [], cls: 'alt' }], g);
              host.setNote(`黄色が ${label(i)}→${label(j)}、<span style="color:var(--cyan)">水色の破線</span>が ${label(j)}→${label(i)}。道が違います。`);
            }
            host.stats.innerHTML = '';
          },
        },
        {
          title: '道路網を、地点間のコストに集約する',
          caption: `<p>表ができたら、もう道路網は要りません。</p>
            <p>複雑な道路ネットワークを、<strong>訪問地点どうしを結ぶコストだけの小さなグラフ</strong>に置き換えました。矢印ごとに向きのあるコストです。</p>
            <p class="muted">ダイクストラ法の役目はここまで。ここから先は別の問題です。</p>`,
          enter() {
            compute(defaultPoints());
            showMatrix({ abstract: true });
            host.stats.innerHTML = '';
            host.setNote(`${pts.length} 地点・${pts.length * (pts.length - 1)} 本の有向エッジ`);
          },
        },
        {
          title: '訪問順序を全部比べる',
          caption: `<p>A を出発点に固定すると、訪問順序は ${pts.length - 1}! = <strong>${factorial(pts.length - 1)} 通り</strong>。小さな問題なので<strong>全部比べて</strong>最小を選びます（厳密解）。</p>
            <p>各候補のコストは、行列の ${pts.length} つのセルの和です。</p>
            ${revOfBest && best ? `<p class="muted">非対称なので、最良の順序を逆回りすると ${revOfBest.cost.toFixed(2)}分（最良は ${best.cost.toFixed(2)}分）。</p>` : ''}
            <p class="muted">地点が増えると候補は爆発的に増えます（右の表）。実務では動的計画法・分枝限定法・近似解法などを使います。</p>`,
          enter() {
            compute(defaultPoints());
            renderMatrix({ filled: () => true });
            playTsp();
          },
        },
        {
          title: '道路上の巡回ルートに戻す',
          caption: `<p>決まった順序で、OD マトリックスを作ったときの<strong>区間ごとの最短経路</strong>をつなげると、道路上の巡回ルートになります。</p>
            <p><strong>道路ネットワーク → OD マトリックス → 巡回順序 → 道路上のルート</strong>。ダイクストラ法は地点間の最短コストを、TSP は訪問順序を求める。<strong>別々の問題に分けて</strong>解いています。</p>`,
          enter() {
            compute(defaultPoints());
            playRoute();
          },
        },
        {
          title: '自由に試す',
          caption: `<p>交差点をクリックして訪問先を追加・削除してみてください。</p>
            <p>地点が 7 つなら候補は 720 通り。到達できない地点（公園の中など）を選ぶと、表に「到達不能」が出て巡回できなくなります。</p>`,
          enter() {
            compute(defaultPoints());
            playRoute(false);
            host.player.seek(1);
          },
        },
      ],
      dispose() {
        view.destroy();
        layout.remove();
      },
    };
  },
};
