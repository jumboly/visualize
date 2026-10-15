import type { ChapterDef, ChapterHandle, Host } from '../chapters/types';
import { Player } from './player';

/**
 * 画面の枠組み（章の切り替え・ビート進行・キーボード操作・発表モード）。
 * 章の中身には関与せず、Host を貸して beats を進めるだけにする。
 */
export function startApp(root: HTMLElement, chapters: ChapterDef[]): void {
  root.innerHTML = `
    <header class="top">
      <a class="brand" href="#/">ダイクストラ法を可視化して<b>腹に落とす</b></a>
      <nav class="tabs">${chapters
        .map((c) => `<a href="#/${c.no}" data-no="${c.no}" title="${c.title}"><span>${c.no}</span><em>${c.title}</em></a>`)
        .join('')}</nav>
      <div class="tools">
        <button class="ghost" data-a="present" title="発表モード (P)">発表モード</button>
        <button class="ghost" data-a="fs" title="フルスクリーン (F)">⛶</button>
      </div>
    </header>
    <main class="layout">
      <section class="stage-wrap">
        <div class="stage"></div>
      </section>
      <aside class="side">
        <div class="chap-head"><div class="chap-no"></div><h1></h1><p class="model"></p></div>
        <div class="beatnav">
          <button class="ghost" data-a="prev" title="前の区切り (←)">‹</button>
          <div class="dots"></div>
          <button class="ghost" data-a="next" title="次の区切り (→)">›</button>
        </div>
        <h2 class="beat-title"></h2>
        <div class="caption"></div>
        <div class="note" aria-live="polite"></div>
        <div class="stats"></div>
        <details class="controls-box" open><summary>操作して試す</summary><div class="controls"></div></details>
        <div class="legend"></div>
      </aside>
    </main>
    <section class="home"></section>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const stageWrap = $('.stage-wrap');
  const stage = $('.stage');
  const player = new Player();
  stageWrap.appendChild(player.el);
  const home = $('.home');

  let current: { def: ChapterDef; handle: ChapterHandle; beat: number } | null = null;

  const host: Host = {
    stage,
    controls: $('.controls'),
    stats: $('.stats'),
    legend: $('.legend'),
    player,
    setNote: (html) => ($('.note').innerHTML = html),
  };

  function clearHost(): void {
    player.unload();
    stage.innerHTML = '';
    stage.className = 'stage';
    host.controls.innerHTML = '';
    host.stats.innerHTML = '';
    host.legend.innerHTML = '';
    host.setNote('');
  }

  function openChapter(no: number, beat: number): void {
    const def = chapters.find((c) => c.no === no);
    if (!def) return showHome();
    if (!current || current.def !== def) {
      current?.handle.dispose();
      clearHost();
      root.classList.remove('at-home');
      $('.chap-no').textContent = `第${def.no}章`;
      $('h1').textContent = def.title;
      $('.model').textContent = def.model;
      root.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', (a as HTMLElement).dataset.no === String(no)));
      current = { def, handle: def.create(host), beat: -1 };
      document.title = `第${def.no}章 ${def.title} | ダイクストラ法を可視化して腹に落とす`;
    }
    const beats = current.handle.beats;
    const b = Math.max(0, Math.min(beats.length - 1, beat));
    current.beat = b;
    $('.dots').innerHTML = beats
      .map((x, i) => `<button class="dot ${i === b ? 'on' : i < b ? 'done' : ''}" data-i="${i}" title="${i + 1}. ${x.title}"></button>`)
      .join('');
    $('.beat-title').textContent = `${b + 1}. ${beats[b].title}`;
    $('.caption').innerHTML = beats[b].caption;
    host.setNote('');
    beats[b].enter();
  }

  function showHome(): void {
    current?.handle.dispose();
    current = null;
    clearHost();
    root.classList.add('at-home');
    root.querySelectorAll('.tabs a').forEach((a) => a.classList.remove('on'));
    document.title = 'ダイクストラ法を可視化して腹に落とす';
    home.innerHTML = `
      <div class="home-inner">
        <p class="kicker">ゆるトーク · 6章 · 約30分</p>
        <h1>ダイクストラ法を可視化して<br><b>腹に落とす</b></h1>
        <p class="lead">最短経路探索は、ゴールを目指して道を探す……のではありません。<br>
        出発地点から<strong>累積コストの小さい順</strong>に、波紋のように最短コストを確定させていきます。</p>
        <ol class="chapters">${chapters
          .map((c) => `<li><a href="#/${c.no}"><span class="n">${c.no}</span><span><b>${c.title}</b><small>${c.model}</small></span></a></li>`)
          .join('')}</ol>
        <p class="keys">→ / ← : 区切りを進む・戻る　Space : 再生／一時停止　. / , : 1ステップ　P : 発表モード　F : フルスクリーン　1〜6 : 章へ移動</p>
      </div>`;
  }

  /** URL ハッシュ (#/章/ビート) を唯一の状態にして、リロードや共有で同じ場面を再現できるようにする */
  function route(): void {
    const m = location.hash.match(/^#\/(\d+)(?:\/(\d+))?/);
    if (!m) return showHome();
    openChapter(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0);
  }

  function go(no: number, beat: number): void {
    const h = `#/${no}/${beat + 1}`;
    if (location.hash === h) route();
    else location.hash = h;
  }

  function nextBeat(dir: 1 | -1): void {
    if (!current) {
      if (dir === 1) go(chapters[0].no, 0);
      return;
    }
    const n = current.beat + dir;
    const idx = chapters.indexOf(current.def);
    if (n >= current.handle.beats.length) {
      // 章末で進むと次の章へ（発表を止めずに流せるように）
      if (idx + 1 < chapters.length) go(chapters[idx + 1].no, 0);
    } else if (n < 0) {
      if (idx > 0) {
        location.hash = `#/${chapters[idx - 1].no}/99`;
      } else location.hash = '#/';
    } else go(current.def.no, n);
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest('button');
    if (!btn) return;
    const a = btn.dataset.a;
    if (a === 'prev') nextBeat(-1);
    else if (a === 'next') nextBeat(1);
    else if (a === 'present') togglePresent();
    else if (a === 'fs') toggleFullscreen();
    else if (btn.classList.contains('dot') && current) go(current.def.no, Number(btn.dataset.i));
  });

  function togglePresent(): void {
    root.classList.toggle('present');
    try {
      localStorage.setItem('dijkstra-present', root.classList.contains('present') ? '1' : '0');
    } catch {
      /* ストレージが使えない環境でも表示切替だけは効かせる */
    }
  }
  try {
    if (localStorage.getItem('dijkstra-present') === '1') root.classList.add('present');
  } catch {
    /* 同上 */
  }

  function toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    // フォーム操作中のキー入力は奪わない（数値入力やセレクトの矢印キーを壊さないため）
    if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        nextBeat(1);
        break;
      case 'ArrowLeft':
      case 'PageUp':
        nextBeat(-1);
        break;
      case ' ':
        player.toggle();
        break;
      case '.':
        player.stepForward();
        break;
      case ',':
        player.stepBack();
        break;
      case 'Home':
        player.restart();
        break;
      case 'p':
      case 'P':
        togglePresent();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case '0':
        location.hash = '#/';
        break;
      default:
        if (/^[1-9]$/.test(e.key) && chapters.some((c) => c.no === Number(e.key))) go(Number(e.key), 0);
        else handled = false;
    }
    if (handled) {
      e.preventDefault();
      // ボタンにフォーカスが残ると Space で二重に発火するので外す
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  });

  window.addEventListener('hashchange', route);
  route();
}
