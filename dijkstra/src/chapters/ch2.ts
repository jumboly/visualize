import { pathEdges } from '../algo/dijkstra';
import { button, hint, renderLegend, renderStats, row, segmented, SW } from '../app/ui';
import { buildSearchGraph } from '../graph/searchGraph';
import { nodeId, SIMPLE_VIEWBOX, simpleGraph } from '../graph/simpleGraph';
import { NetworkView, type Marker } from '../viz/networkView';
import type { SearchState } from '../viz/replay';
import { fmt } from '../viz/svg';
import { drawSimpleRiver, makeRun, playRun, type Run } from './common';
import type { ChapterDef } from './types';

type Kind = 'one' | 'many' | 'all';

const KIND_LABEL: Record<Kind, string> = { one: '1対1', many: '1対N', all: '1対全点' };

export const ch2: ChapterDef = {
  no: 2,
  title: '1対1も1対Nも同じ',
  model: '目的地は探索の方向を決めない。決めるのは「いつ止めるか」だけ',
  create(host) {
    const net = simpleGraph();
    const g = buildSearchGraph(net, { mode: 'car', metric: 'distance' });
    const id = (l: string) => nodeId(net, l);
    const label = (v: number) => net.nodes[v].label ?? String(v);
    const DEFAULT_MANY = ['C', 'K', 'X', 'U', 'B'].map(id);

    host.stage.classList.add('col');
    const view = new NetworkView(host.stage, net, 'graph', SIMPLE_VIEWBOX);
    drawSimpleRiver(view);
    const strip = document.createElement('div');
    strip.className = 'order-strip';
    host.stage.appendChild(strip);

    let start = id('A');
    let kind: Kind = 'one';
    let one = id('B');
    let many = [...DEFAULT_MANY];
    let clickRole: 'target' | 'start' = 'target';
    /** 帯に出す「ここで止まる」印 */
    let stopMarks: Array<{ label: string; count: number }> = [];
    let showCompare = false;
    let run!: Run;
    let full!: Run;
    let lastMarkerKey = '';
    let cmpCache: ReturnType<typeof computeComparison> | null = null;

    const targets = (): number[] | undefined => (kind === 'one' ? [one] : kind === 'many' ? many : undefined);

    function compute(): void {
      run = makeRun(g, { sources: start, targets: targets() });
      full = makeRun(g, { sources: start });
      lastMarkerKey = '';
      cmpCache = null;
    }

    function comparison() {
      return (cmpCache ??= computeComparison());
    }

    /** 目的地ごとの1対1、1対N、1対全点の探索量を比べる */
    function computeComparison() {
      const each = many.map((t) => ({ t, r: makeRun(g, { sources: start, targets: [t] }).res }));
      const n = makeRun(g, { sources: start, targets: many }).res;
      return {
        each,
        sumSettled: each.reduce((s, x) => s + x.r.order.length, 0),
        sumEdges: each.reduce((s, x) => s + x.r.edgesScanned, 0),
        n,
        all: full.res,
      };
    }

    function render(st: SearchState): void {
      const ts = targets() ?? [];
      const reached = ts.filter((t) => st.settled[t]);
      // マーカーは到達状況が変わったときだけ作り直す（毎フレーム作るとアニメーションが再始動するため）
      const key = `${start}|${ts.join(',')}|${reached.join(',')}`;
      if (key !== lastMarkerKey) {
        lastMarkerKey = key;
        const ms: Marker[] = [{ node: start, kind: 'start', label: '出発' }];
        ts.forEach((t, i) => ms.push({ node: t, kind: kind === 'one' ? 'goal' : 'target', label: `${st.settled[t] ? '✓ ' : ''}${kind === 'one' ? '目的地' : `目的地${i + 1}`}` }));
        view.setMarkers(ms);
        ts.forEach((t, i) => {
          if (st.settled[t]) view.layer('markers').children[i + 1]?.classList.add('reached');
        });
      }
      view.setPaths(reached.map((t) => ({ edges: pathEdges(g, st, t) ?? [] })));
      renderStrip(st);

      const stopText = kind === 'all' ? '到達できるノードがなくなるまで' : kind === 'one' ? `${label(one)} が確定したら` : `${ts.length} か所すべて確定したら`;
      const stats = [
        { k: '探索の種類', v: KIND_LABEL[kind] },
        { k: '確定した目的地', v: kind === 'all' ? '—' : `${reached.length} / ${ts.length}` },
        { k: '確定ノード数', v: `${st.settledCount} / ${g.n}` },
        { k: '調べたエッジ数', v: String(st.examinedCount) },
        { k: '終了条件', v: stopText, wide: true },
      ];
      renderStats(host.stats, stats);
      if (showCompare) host.stats.insertAdjacentHTML('beforeend', compareHtml());
      host.stats.dataset.html = ''; // 比較表を足したので、次回は必ず描き直す

      if (st.done) {
        host.setNote(
          kind === 'all'
            ? `到達できる <b>${st.settledCount}</b> ノードすべての最短コストが求まりました。`
            : `${reached.map((t) => `${label(t)}=${fmt(st.dist[t])}`).join('、')} が確定 → <b>終了</b>（確定ノード ${st.settledCount}）`,
        );
      } else if (kind !== 'all' && reached.length) {
        host.setNote(`確定した目的地：${reached.map((t) => `<b>${label(t)}</b>(${fmt(st.dist[t])})`).join('、')}　残り ${ts.length - reached.length}`);
      } else host.setNote(`波紋の半径（現在の確定コスト）: <b>${fmt(st.settledCount ? st.frontierCost : 0)}</b>`);
    }

    /** 確定した順のノードを1列に並べ、止まる位置に印をつける */
    function renderStrip(st: SearchState): void {
      const order = full.res.order;
      const ts = new Set(targets() ?? []);
      const chips = order
        .map((v, i) => {
          // 右端に近い印は左向きに出す（帯の外にはみ出して読めなくなるのを防ぐ）
          const nearEnd = i >= order.length - 4;
          const cls = ['chip', i < st.settledCount ? 'on' : '', ts.has(v) ? 'tgt' : '', i === st.settledCount - 1 ? 'cur' : '', nearEnd ? 'near-end' : ''].join(' ');
          const marks = stopMarks
            .filter((m) => m.count === i + 1)
            .map((m) => `<span class="stop">${m.label}</span>`)
            .join('');
          return `<div class="${cls}"><b>${label(v)}</b><small>${fmt(full.res.dist[v])}</small>${marks ? `<div class="stops">${marks}</div>` : ''}</div>`;
        })
        .join('');
      const html = `<div class="strip-head">確定した順番（すべての探索で共通）</div><div class="chips">${chips}</div>`;
      if (strip.dataset.html !== html) {
        strip.innerHTML = html;
        strip.dataset.html = html;
      }
    }

    function compareHtml(): string {
      const c = comparison();
      const rows = c.each.map((x) => `<tr><td>1対1（→${label(x.t)}）</td><td>${x.r.order.length}</td><td>${x.r.edgesScanned}</td></tr>`).join('');
      return `<div class="stat wide compare"><div class="k">探索量の比較（出発 ${label(start)}）</div>
        <table><thead><tr><th></th><th>確定ノード</th><th>調べたエッジ</th></tr></thead><tbody>
        ${rows}
        <tr class="sum"><td>1対1 を ${c.each.length} 回の合計</td><td>${c.sumSettled}</td><td>${c.sumEdges}</td></tr>
        <tr class="hl"><td>1対N（1回）</td><td>${c.n.order.length}</td><td>${c.n.edgesScanned}</td></tr>
        <tr><td>1対全点（1回）</td><td>${c.all.order.length}</td><td>${c.all.edgesScanned}</td></tr>
        </tbody></table></div>`;
    }

    function load(autoplay: boolean, at?: number): void {
      playRun(host.player, run, view, (st) => render(st), { autoplay, at, rate: 2.2 });
    }

    function setup(k: Kind, opts: { one?: string; marks?: Array<{ label: string; count: number }>; compare?: boolean } = {}): void {
      start = id('A');
      kind = k;
      one = id(opts.one ?? 'B');
      many = [...DEFAULT_MANY];
      showCompare = opts.compare ?? false;
      kindSeg.set(kind);
      compute();
      stopMarks = opts.marks ?? defaultMarks();
    }

    function defaultMarks(): Array<{ label: string; count: number }> {
      return [{ label: `${KIND_LABEL[kind]} 停止`, count: run.res.order.length }];
    }

    function rerun(): void {
      compute();
      stopMarks = defaultMarks();
      load(true);
    }

    // ---- 自由操作 ----
    const kindSeg = segmented<Kind>(
      [
        { value: 'one', label: '1対1' },
        { value: 'many', label: '1対N' },
        { value: 'all', label: '1対全点' },
      ],
      kind,
      (v) => {
        kind = v;
        rerun();
      },
    );
    const roleSeg = segmented<'target' | 'start'>(
      [
        { value: 'target', label: '目的地の追加・削除' },
        { value: 'start', label: '出発地点' },
      ],
      clickRole,
      (v) => (clickRole = v),
    );
    const compareBtn = button('探索量を比較', () => {
      showCompare = !showCompare;
      host.player.seek(host.player.time);
    });
    host.controls.append(
      row('探索', kindSeg.el),
      row('クリックで', roleSeg.el),
      row('', compareBtn, button('初期状態に戻す', () => {
        setup(kind);
        load(false);
      })),
      hint('1対1 では、クリックしたノードが目的地になります。1対N では目的地を追加・削除できます。'),
    );
    view.onNodeClick = (v) => {
      if (clickRole === 'start') {
        start = v;
        many = many.filter((t) => t !== v);
      } else if (v !== start) {
        if (kind === 'one') one = v;
        else {
          if (kind === 'all') kind = 'many';
          kindSeg.set(kind);
          many = many.includes(v) ? many.filter((t) => t !== v) : [...many, v];
        }
      }
      rerun();
    };

    renderLegend(host.legend, [
      { swatch: SW.start, label: '出発地点' },
      { swatch: SW.goal, label: '目的地' },
      { swatch: SW.settled, label: '確定済み' },
      { swatch: SW.tentative, label: '暫定コストあり' },
      { swatch: SW.wave, label: '波紋（確定コスト以内）' },
      { swatch: SW.path, label: '確定した目的地への最短経路' },
    ]);

    setup('one');
    const cmp = comparison();
    const countTo = (l: string) => makeRun(g, { sources: id('A'), targets: [id(l)] }).res.order.length;
    const allCount = full.res.order.length;

    return {
      beats: [
        {
          title: '1対1：目的地が確定したら終わり',
          caption: `<p>第1章と同じ探索です。目的地 B が<strong>確定した瞬間</strong>に止めます。</p>
            <p>B より遠いノード（T など）は、確定しないまま終わります。</p>
            <p class="muted">下の帯は、ノードが確定した順番です。</p>`,
          enter() {
            setup('one');
            load(true);
          },
        },
        {
          title: '目的地を変えると…',
          caption: `<p>目的地を <strong>C</strong> に変えます。</p>
            <p>波紋の広がり方は B のときと<strong>まったく同じ</strong>。C のほうが近いので、早く止まるだけです。</p>
            <p class="muted">目的地は、探索の方向を変えません。</p>`,
          enter() {
            setup('one', {
              one: 'C',
              marks: [
                { label: '1対1(C) 停止', count: countTo('C') },
                { label: '1対1(B) 停止', count: countTo('B') },
              ],
            });
            load(true);
          },
        },
        {
          title: '1対N：5か所まとめて',
          caption: `<p>目的地を5か所にします。探索そのものは同じです。</p>
            <p>波紋が広がる途中で、目的地が<strong>次々と確定</strong>していきます。5か所すべて確定したら終了です。</p>`,
          enter() {
            setup('many');
            load(true);
          },
        },
        {
          title: '1対全点：止めない',
          caption: `<p>終了条件を外すと、到達できる<strong>すべてのノード</strong>の最短コストが求まります。</p>
            <p>これも同じ探索を、最後まで続けただけです。</p>`,
          enter() {
            setup('all');
            load(true);
          },
        },
        {
          title: '違うのは終了条件だけ',
          caption: `<p>確定の順番はどれも同じ。違うのは<strong>どこで止めるか</strong>だけです。</p>
            <p>5か所それぞれに1対1をすると、確定ノードは合計 <strong>${cmp.sumSettled}</strong>。1対N なら<strong>1回の探索で ${cmp.n.order.length}</strong>。</p>
            <p class="muted">ただし探索量は目的地の配置で変わります。いちばん遠い目的地のコストまでは、波紋を広げる必要があります（ここでは B）。</p>`,
          enter() {
            setup('many', {
              compare: true,
              marks: [
                { label: '1対1(C)', count: countTo('C') },
                { label: '1対1(B) / 1対N', count: countTo('B') },
                { label: '全点', count: allCount },
              ],
            });
            load(false, run.tl.duration);
          },
        },
        {
          title: '自由に試す',
          caption: `<p>ノードをクリックして目的地を追加・削除してみてください。</p>
            <p>近い目的地だけなら早く止まり、遠い目的地が1つでもあると、そこまで波紋が広がります。</p>`,
          enter() {
            setup('many', { compare: true });
            load(false);
            host.setNote('「操作して試す」から、探索の種類や目的地を変えられます。');
          },
        },
      ],
      dispose() {
        view.destroy();
        strip.remove();
      },
    };
  },
};
