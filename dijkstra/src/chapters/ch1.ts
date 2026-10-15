import { dijkstra, pathEdges, type DijkstraResult } from '../algo/dijkstra';
import { button, hint, renderLegend, renderStats, row, segmented, SW } from '../app/ui';
import { buildSearchGraph } from '../graph/searchGraph';
import { nodeId, SIMPLE_RIVER, SIMPLE_VIEWBOX, simpleGraph } from '../graph/simpleGraph';
import { NetworkView, type Marker } from '../viz/networkView';
import { buildTimeline, easeInOut, frameAt, SearchReplay, type Frame, type SearchState, type Timeline } from '../viz/replay';
import { el, fmt } from '../viz/svg';
import type { ChapterDef } from './types';

type Display = 'step' | 'wave';

const ALGO_STEPS = [
  '出発地点のコストを 0 にする',
  'ほかのノードは未到達（∞）にする',
  '未確定のノードから、暫定コスト最小のものを選ぶ',
  'そのノードの最短コストを確定する',
  '隣のノードの暫定コストを、必要なら更新する',
  '3〜5 を繰り返す',
];

export const ch1: ChapterDef = {
  no: 1,
  title: '最短経路探索はゴールを目指さない',
  model: '波紋のように、累積コストの小さい順に探索が広がる',
  create(host) {
    const net = simpleGraph();
    const g = buildSearchGraph(net, { mode: 'car', metric: 'distance' });
    const A = nodeId(net, 'A');
    const B = nodeId(net, 'B');
    const F = nodeId(net, 'F');
    const K = nodeId(net, 'K');
    const label = (v: number) => net.nodes[v].label ?? String(v);

    const view = new NetworkView(host.stage, net, 'graph', SIMPLE_VIEWBOX);
    view.setGraph(g);
    drawRiver(view);
    const overlay = document.createElement('div');
    overlay.className = 'stage-overlay';
    host.stage.appendChild(overlay);

    // ---- 章の状態（ビートに入るたびに作り直す） ----
    let start = A;
    let goal: number | null = B;
    let display: Display = 'step';
    let clickRole: 'start' | 'goal' = 'start';
    const fx = { algo: false, straight: false, focusF: false, whyMin: false, question: false };

    let res!: DijkstraResult;
    let replay!: SearchReplay;
    let tl!: Timeline;

    function compute(): void {
      res = dijkstra(g, { sources: start, targets: goal === null ? undefined : [goal], record: true });
      replay = new SearchReplay(g.n, g.edges.length, res.events);
      tl = buildTimeline(res.events, display);
      const markers: Marker[] = [{ node: start, kind: 'start', label: '出発' }];
      if (goal !== null) markers.push({ node: goal, kind: 'goal', label: '目的地' });
      view.setMarkers(markers);
    }

    /** 条件に合う最初のイベントの番号 */
    const findEvent = (pred: (i: number) => boolean) => res.events.findIndex((_, i) => pred(i));
    const settleIndex = (v: number) => findEvent((i) => res.events[i].type === 'settle' && (res.events[i] as { node: number }).node === v);
    /** v を確定して隣を調べ終えた直後の時刻 */
    function afterSettleOf(v: number): number {
      const i = settleIndex(v);
      const next = res.events.findIndex((e, j) => j > i && e.type !== 'relax');
      return tl.starts[next];
    }

    // ---- 描画 ----
    function render(t: number): void {
      const fr = frameAt(tl, res.events, t);
      const st = replay.at(fr.k);
      view.render(st, fr.radius);
      drawPath(st);
      drawOverlay(st, fr);
      host.setNote(noteFor(st, fr));
      renderStats(host.stats, [
        { k: '現在の確定コスト（波紋の半径）', v: fmt(st.settledCount ? st.frontierCost : 0), wide: true },
        { k: '確定ノード数', v: `${st.settledCount} / ${g.n}` },
        { k: '調べたエッジ数', v: String(st.examinedCount), title: '確定したノードから出る道路を調べた回数（向き別）' },
        { k: '最短経路の総コスト', v: goal !== null && st.settled[goal] ? fmt(st.dist[goal]) : '—', wide: true },
      ]);
      renderAlgoCard(st, fr);
    }

    function drawPath(st: SearchState): void {
      if (goal !== null && st.settled[goal]) {
        view.setPaths([{ edges: pathEdges(g, st, goal) ?? [] }]);
        view.layer('markers').querySelector('.m-goal')?.classList.add('reached');
      } else view.setPaths([]);
    }

    function drawOverlay(st: SearchState, fr: Frame): void {
      const over = view.layer('over');
      over.innerHTML = '';
      // 直線距離（「目的地はすぐそこ」という先入観を見せる）
      if (fx.straight && goal !== null) {
        const a = view.pos(start);
        const b = view.pos(goal);
        el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'straight' }, over);
        el('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 30, 'text-anchor': 'middle', class: 'straight-label' }, over).textContent = '直線ならすぐそこ';
      }
      // 暫定コストの履歴（12 → 9 → 7 のように、改善の跡を残す）
      const hist = new Map<number, number[]>();
      for (let i = 0; i < fr.k; i++) {
        const e = res.events[i];
        if (e.type === 'relax' && e.improved) hist.set(e.to, [...(hist.get(e.to) ?? []), e.cand]);
      }
      for (const [v, h] of hist) {
        if (fx.focusF && v === F) {
          // 注目ノードの履歴は吹き出しで大きく見せる
          const p = view.pos(F);
          const txt = h.map(fmt).join(' → ');
          const g = el('g', { class: 'note-callout accent', transform: `translate(${p.x - 90},${p.y + 52})` }, over);
          const w = txt.length * 10 + 22;
          el('rect', { x: -w / 2, y: -16, width: w, height: 32, rx: 9 }, g);
          el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', style: 'font-size:19px;font-family:var(--mono)' }, g).textContent = txt;
          continue;
        }
        if (h.length < 2) continue;
        const p = view.pos(v);
        const txt = el('text', { x: p.x, y: p.y + 42, 'text-anchor': 'middle', class: 'hist' }, over);
        h.forEach((c, i) => {
          if (i) el('tspan', { class: 'arrow' }, txt).textContent = ' → ';
          el('tspan', { class: i < h.length - 1 ? 'old' : '' }, txt).textContent = fmt(c);
        });
      }
      if (fx.focusF) {
        const p = view.pos(F);
        el('circle', { cx: p.x, cy: p.y, r: 32, class: 'focus-ring' }, over);
      }
      if (fx.whyMin) drawWhyMin(st, over);
      if (display === 'step' && fr.active >= 0) drawActive(fr, over);
      overlay.innerHTML = fx.question
        ? `<div class="question">なぜ目的地と反対方向まで探索するのでしょう？<small>B は東にあるのに、西の端の K まで確定しています</small></div>`
        : '';
    }

    /** 進行中のイベント（選ぶ・確定・エッジを調べる）を動きで見せる */
    function drawActive(fr: Frame, over: SVGGElement): void {
      const e = res.events[fr.active];
      if (e.type === 'settle') {
        const p = view.pos(e.node);
        const r = 44 - 14 * easeInOut(Math.min(1, fr.u * 1.6));
        el('circle', { cx: p.x, cy: p.y, r, class: 'pick-ring' }, over);
      } else if (e.type === 'relax') {
        const a = view.pos(e.from);
        const b = view.pos(e.to);
        const p = easeInOut(Math.min(1, fr.u / 0.65));
        const x = a.x + (b.x - a.x) * p;
        const y = a.y + (b.y - a.y) * p;
        el('line', { x1: a.x, y1: a.y, x2: x, y2: y, class: 'probe-line' }, over);
        const w = g.edges[e.edge].cost;
        let text = `${fmt(res.dist[e.from])}+${fmt(w)}=${fmt(e.cand)}`;
        let cls = '';
        if (fr.u > 0.65) {
          if (e.toSettled) {
            text = `${label(e.to)} は確定済み`;
            cls = 'bad';
          } else if (e.improved) {
            text += ` < ${fmt(e.old)}`;
            cls = 'good';
          } else {
            text += ` ≥ ${fmt(e.old)}`;
            cls = 'bad';
          }
        }
        const badge = el('g', { class: `probe-badge ${cls}`, transform: `translate(${x},${y - 34})` }, over);
        const wpx = text.length * 9.6 + 18;
        el('rect', { x: -wpx / 2, y: -14, width: wpx, height: 28, rx: 8 }, badge);
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, badge).textContent = text;
      }
    }

    /** 「なぜ最小から確定してよいか」：他の未確定ノードを経由する寄り道は、必ずそれ以上のコストになる */
    function drawWhyMin(st: SearchState, over: SVGGElement): void {
      const frontier = tentatives(st).filter((v) => v !== F);
      const pf = view.pos(F);
      for (const v of frontier) {
        const p = view.pos(v);
        // F に向かう仮想の寄り道（実在の道ではないので曲線で描く）
        const mx = (p.x + pf.x) / 2 + (p.y - pf.y) * 0.25;
        const my = (p.y + pf.y) / 2 - (p.x - pf.x) * 0.25;
        el('path', { d: `M${p.x},${p.y} Q${mx},${my} ${pf.x},${pf.y}`, class: 'detour' }, over);
      }
      // 吹き出しは曲線を描き終えてから重ねる（線の下に隠れないように）
      for (const v of frontier) {
        const p = view.pos(v);
        callout(over, p.x, p.y - 44, `${fmt(st.dist[v])} + (0以上)`, '');
      }
      el('circle', { cx: pf.x, cy: pf.y, r: 32, class: 'focus-ring' }, over);
      callout(over, pf.x - 40, pf.y - 56, `最小 ${fmt(st.dist[F])} → 確定してよい`, 'accent');
    }

    function callout(parent: SVGGElement, x: number, y: number, text: string, cls: string): void {
      const g = el('g', { class: `note-callout ${cls}`, transform: `translate(${x},${y})` }, parent);
      const w = [...text].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? 15 : 8.6), 0) + 18;
      el('rect', { x: -w / 2, y: -14, width: w, height: 28, rx: 8 }, g);
      el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g).textContent = text;
    }

    function tentatives(st: SearchState): number[] {
      const out: number[] = [];
      for (let v = 0; v < g.n; v++) if (!st.settled[v] && Number.isFinite(st.dist[v])) out.push(v);
      return out.sort((a, b) => st.dist[a] - st.dist[b] || a - b);
    }

    function noteFor(st: SearchState, fr: Frame): string {
      const e = fr.active >= 0 ? res.events[fr.active] : res.events[fr.k - 1];
      if (!e || (e.type === 'init' && fr.active < 0)) {
        return `出発地点 <b>${label(start)}</b> のコストを 0、ほかを ∞（未到達）にして開始します。`;
      }
      switch (e.type) {
        case 'settle': {
          const cands = tentatives(st)
            .slice(0, 4)
            .map((v) => `${label(v)}(${fmt(st.dist[v])})`)
            .join(', ');
          if (fr.active >= 0 && fr.u < 0.5) return `未確定の中で暫定コストが最小のノードを選ぶ：${cands}${cands ? ' …' : ''}`;
          return `<b>${label(e.node)}</b> の最短コストを <b>${fmt(e.cost)}</b> に確定。これより短い道はもう見つからない。`;
        }
        case 'relax': {
          const w = g.edges[e.edge].cost;
          const head = `${label(e.from)} → ${label(e.to)}：${fmt(res.dist[e.from])} + ${fmt(w)} = ${fmt(e.cand)}`;
          if (e.toSettled) return `${head}。${label(e.to)} は確定済みなので更新しない。`;
          if (e.improved) return `${head} &lt; ${fmt(e.old)} → ${label(e.to)} の暫定コストを <b>${fmt(e.cand)}</b> に更新。`;
          return `${head} ≥ ${fmt(e.old)} → 今の暫定コストのほうが良いので更新しない。`;
        }
        case 'done':
          if (e.reason === 'targets' && goal !== null) return `目的地 <b>${label(goal)}</b> が確定した時点で終了。最短コストは <b>${fmt(st.dist[goal])}</b>。`;
          return `到達できるノードがすべて確定して終了。`;
        default:
          return '';
      }
    }

    const algoCard = document.createElement('div');
    algoCard.className = 'algo-card';
    algoCard.innerHTML = `<h3>ダイクストラ法の手順</h3><ol>${ALGO_STEPS.map((s) => `<li>${s}</li>`).join('')}</ol>`;

    function renderAlgoCard(st: SearchState, fr: Frame): void {
      if (!fx.algo) {
        algoCard.remove();
        return;
      }
      overlay.appendChild(algoCard);
      const e = fr.active >= 0 ? res.events[fr.active] : res.events[fr.k - 1];
      let on: number[] = [];
      if (!e || e.type === 'init') on = [0, 1];
      else if (e.type === 'settle') on = fr.active >= 0 && fr.u < 0.5 ? [2] : [3];
      else if (e.type === 'relax') on = [4];
      if (st.done) on = [];
      algoCard.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', on.includes(i)));
    }

    // ---- 再生 ----
    function load(opts: { at?: number; autoplay?: boolean; pauseAt?: number; onPause?: () => void } = {}): void {
      host.player.load(
        {
          duration: tl.duration,
          stops: tl.stops,
          rate: display === 'step' ? 2.4 : 2.6,
          render,
          pauses: opts.pauseAt !== undefined ? [opts.pauseAt] : undefined,
          onPause: opts.onPause,
        },
        { at: opts.at, autoplay: opts.autoplay },
      );
    }

    function rerun(autoplay = true): void {
      Object.assign(fx, { question: false, whyMin: false, focusF: false, straight: false });
      compute();
      load({ autoplay });
    }

    function reset(d: Display = 'step'): void {
      start = A;
      goal = B;
      display = d;
      Object.assign(fx, { algo: false, straight: false, focusF: false, whyMin: false, question: false });
      dispSeg.set(display);
      compute();
    }

    // ---- 自由操作 ----
    const dispSeg = segmented<Display>(
      [
        { value: 'step', label: '1手ずつ', title: '選ぶ・確定・更新を1つずつ見る' },
        { value: 'wave', label: '波紋', title: '累積コストを時間として連続的に見る' },
      ],
      display,
      (v) => {
        display = v;
        rerun();
      },
    );
    const roleSeg = segmented<'start' | 'goal'>(
      [
        { value: 'start', label: '出発地点' },
        { value: 'goal', label: '目的地' },
      ],
      clickRole,
      (v) => (clickRole = v),
    );
    host.controls.append(
      row('表示', dispSeg.el),
      row('クリックで', roleSeg.el),
      row(
        '',
        button('目的地なし（全点）', () => {
          goal = null;
          rerun();
        }),
        button('初期状態に戻す', () => {
          reset(display);
          load({ autoplay: false });
        }),
      ),
      hint('ノードをクリックすると、出発地点／目的地を変えて再探索します。'),
    );
    view.onNodeClick = (v) => {
      if (clickRole === 'start') {
        start = v;
        if (goal === v) goal = null;
      } else if (v !== start) goal = v;
      rerun();
    };

    renderLegend(host.legend, [
      { swatch: SW.unreached, label: '未到達（∞）' },
      { swatch: SW.tentative, label: '暫定コストあり' },
      { swatch: SW.settled, label: '確定済み' },
      { swatch: SW.current, label: '現在処理中' },
      { swatch: SW.road, label: '未探索の道路' },
      { swatch: SW.examined, label: '調べた道路' },
      { swatch: SW.wave, label: '波紋（確定コスト以内）' },
      { swatch: SW.path, label: '最短経路' },
    ]);

    reset();

    /** F を確定する直前の状態から説明文を組み立てる（グラフを変えても文と図がずれないように） */
    function whyMinCaption(): string {
      const st = replay.at(frameAt(tl, res.events, tl.starts[settleIndex(F)]).k);
      const all = tentatives(st);
      const lo = Math.min(...all.filter((v) => v !== F).map((v) => st.dist[v]));
      const f = fmt(st.dist[F]);
      return `<p>未確定のノードは ${all.map((v) => `${label(v)}(${fmt(st.dist[v])})`).join('、')}。最小は <strong>F(${f})</strong> です。</p>
        <p>もし F へもっと短い道があるなら、それは<strong>ほかの未確定ノードを経由する</strong>はず。でもそこまでで既に ${fmt(lo)} 以上かかり、道のコストは 0 以上なので、<strong>${f} より短くはなれません</strong>。</p>
        <p>だから最小のノードは、その時点で確定してよいのです。</p>
        <p class="muted">この理屈は「コストが負の道路がない」ことに依存しています。</p>`;
    }

    return {
      beats: [
        {
          title: 'A から B へ',
          caption: `<p>出発地点 <strong>A</strong> から、目的地 <strong>B</strong> までの最短経路を探索します。</p>
            <p>B は川の向こう。直線ならすぐそこですが、橋は北と南にしかありません。</p>
            <p class="muted">道路の数字は、そこを通るコスト（たとえば所要時間）です。</p>`,
          enter() {
            reset();
            fx.straight = true;
            load();
            host.setNote('▶（Space）で探索を開始します。');
          },
        },
        {
          title: '探索開始',
          caption: `<p>探索がどの方向に広がっていくかに注目してください。</p>
            <p class="muted">青く塗られていくのが「確定したコスト以内で届く道路」です。</p>`,
          enter() {
            reset();
            fx.straight = true;
            load({
              autoplay: true,
              pauseAt: afterSettleOf(K),
              onPause: () => {
                fx.question = true;
                render(host.player.time);
              },
            });
          },
        },
        {
          title: '答え：B の場所は見ていない',
          caption: `<p>ダイクストラ法は、B がどの方向にあるかを<strong>見ていません</strong>。</p>
            <p>見ているのは <strong>「A からの累積コスト」だけ</strong>。コストの小さいノードから順に確定するので、川を渡るより近い西側が先に確定します。</p>
            <p>B が確定した瞬間に、B への最短コストと経路が決まります。直線で近づくことと、最短経路を進むことは別物です。</p>`,
          enter() {
            reset();
            fx.straight = true;
            load({ at: afterSettleOf(K), autoplay: true });
          },
        },
        {
          title: 'やっていることはこれだけ',
          caption: `<p>左上の手順のうち、いま実行している行が光ります。</p>
            <p><strong>選ぶ → 確定する → 隣を更新する</strong> の繰り返しです。</p>
            <p class="muted">「.」キーや |▶ ボタンで1手ずつ進められます。</p>`,
          enter() {
            reset();
            fx.algo = true;
            load({ autoplay: true });
          },
        },
        {
          title: '暫定コストは書き換わる',
          caption: `<p><strong>F</strong> の暫定コストに注目してください。</p>
            <p>A から直接行くと <strong>12</strong>。J 経由の道が見つかると <strong>9</strong>、G 経由で <strong>7</strong> に改善されます。</p>
            <p>暫定コストは「今のところの最良」。確定するまでは、もっと良い道が見つかれば書き換わります。</p>`,
          enter() {
            reset();
            fx.focusF = true;
            const i = settleIndex(F);
            load({ autoplay: true, pauseAt: tl.ends[i] });
          },
        },
        {
          title: 'なぜ最小から確定してよいのか',
          caption: whyMinCaption(),
          enter() {
            reset();
            fx.whyMin = true;
            load({ at: tl.starts[settleIndex(F)] });
          },
        },
        {
          title: '波紋のように広がる',
          caption: `<p>累積コストを「時間」として連続的に再生すると、探索は<strong>波紋のように全方位へ</strong>広がります。</p>
            <p>ただし比喩です。広がる基準は直線距離ではなく、<strong>道路に沿った累積コスト</strong>。遅い A–F の道はゆっくり塗られます。</p>
            <p>目的地の方向に関係なく、<strong>コストの小さい順に確定していく</strong>。これがダイクストラ法のメンタルモデルです。</p>`,
          enter() {
            reset('wave');
            load({ autoplay: true });
          },
        },
      ],
      dispose() {
        view.destroy();
        overlay.remove();
      },
    };
  },
};

function drawRiver(view: NetworkView): void {
  const left = SIMPLE_RIVER.map(([y, x]) => `${x},${y}`);
  const right = [...SIMPLE_RIVER].reverse().map(([y, , x]) => `${x},${y}`);
  const under = view.layer('under');
  el('polygon', { points: [...left, ...right].join(' '), class: 'river' }, under);
  el('text', { x: 628, y: 250, class: 'river-label', 'writing-mode': 'tb', 'text-anchor': 'middle' }, under).textContent = '川';
}
