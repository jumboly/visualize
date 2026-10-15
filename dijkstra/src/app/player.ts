/**
 * 再生コントローラ。
 *
 * 計算はあらかじめ済ませてあり、ここが扱うのは「時刻 t」だけ。章は t を受け取って
 * その時点の状態を描く関数（render）を渡す。t を巻き戻せば前の状態がそのまま描けるので、
 * 一時停止・巻き戻し・スクラブを同じ仕組みで扱える。
 */
export interface TimelineSpec {
  /** 終端時刻（単位は章が決める。イベント番号やコストなど） */
  duration: number;
  /** 1ステップ進む／戻るで止まる時刻（昇順） */
  stops: number[];
  /** 再生速度 1x のときに 1 秒で進む時間量 */
  rate: number;
  render(t: number): void;
  /** 自動再生中にここへ到達したら一時停止する（問いかけなどの演出用） */
  pauses?: number[];
  onPause?(t: number): void;
  onEnd?(): void;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

export class Player {
  readonly el: HTMLElement;
  private spec: TimelineSpec | null = null;
  private t = 0;
  private playing = false;
  private speed = 1;
  private raf = 0;
  private last = 0;
  private btnPlay!: HTMLButtonElement;
  private scrub!: HTMLInputElement;
  private label!: HTMLElement;
  private speedSel!: HTMLSelectElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'playbar';
    this.el.innerHTML = `
      <button data-a="restart" title="最初から再生 (Home)">⏮</button>
      <button data-a="back" title="1ステップ戻る (,)">◀︎|</button>
      <button data-a="play" class="play" title="再生／一時停止 (Space)">▶</button>
      <button data-a="fwd" title="1ステップ進む (.)">|▶︎</button>
      <input type="range" class="scrub" min="0" max="1000" value="0" aria-label="再生位置">
      <span class="tlabel"></span>
      <label class="speed">速度
        <select>${SPEEDS.map((s) => `<option value="${s}" ${s === 1 ? 'selected' : ''}>${s}x</option>`).join('')}</select>
      </label>`;
    this.btnPlay = this.el.querySelector('[data-a=play]')!;
    this.scrub = this.el.querySelector('.scrub')!;
    this.label = this.el.querySelector('.tlabel')!;
    this.speedSel = this.el.querySelector('select')!;
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'restart') this.restart();
      else if (a === 'back') this.stepBack();
      else if (a === 'play') this.toggle();
      else if (a === 'fwd') this.stepForward();
    });
    this.scrub.addEventListener('input', () => {
      if (!this.spec) return;
      this.pause();
      this.seek((Number(this.scrub.value) / 1000) * this.spec.duration);
    });
    this.speedSel.addEventListener('change', () => (this.speed = Number(this.speedSel.value)));
    this.sync();
  }

  get time(): number {
    return this.t;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get loaded(): boolean {
    return this.spec !== null;
  }

  /** 新しいタイムラインに差し替える。at を省略すると先頭から。 */
  load(spec: TimelineSpec, opts: { at?: number; autoplay?: boolean } = {}): void {
    this.pause();
    this.spec = spec;
    this.el.classList.remove('hidden');
    this.seek(opts.at ?? 0);
    if (opts.autoplay) this.play();
  }

  unload(): void {
    this.pause();
    this.spec = null;
    this.el.classList.add('hidden');
  }

  seek(t: number): void {
    if (!this.spec) return;
    this.t = Math.max(0, Math.min(this.spec.duration, t));
    this.spec.render(this.t);
    this.sync();
  }

  play(): void {
    if (!this.spec || this.playing) return;
    // 終端で再生ボタンを押したら頭から再生し直す（発表中に戻す手間を省く）
    if (this.t >= this.spec.duration) this.seek(0);
    this.playing = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.sync();
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.sync();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  restart(): void {
    this.pause();
    this.seek(0);
    this.play();
  }

  stepForward(): void {
    if (!this.spec) return;
    this.pause();
    const next = this.spec.stops.find((s) => s > this.t + 1e-9);
    this.seek(next ?? this.spec.duration);
  }

  stepBack(): void {
    if (!this.spec) return;
    this.pause();
    let prev = 0;
    for (const s of this.spec.stops) {
      if (s < this.t - 1e-9) prev = s;
      else break;
    }
    this.seek(prev);
  }

  private tick = (now: number): void => {
    if (!this.playing || !this.spec) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); // タブ復帰時の大ジャンプを防ぐ
    this.last = now;
    const from = this.t;
    let to = from + dt * this.spec.rate * this.speed;
    const pauseAt = this.spec.pauses?.find((p) => p > from + 1e-9 && p <= to);
    if (pauseAt !== undefined) to = pauseAt;
    this.seek(to);
    if (pauseAt !== undefined) {
      this.pause();
      this.spec.onPause?.(pauseAt);
      return;
    }
    if (this.t >= this.spec.duration) {
      this.pause();
      this.spec.onEnd?.();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private sync(): void {
    this.btnPlay.textContent = this.playing ? '⏸' : '▶';
    const d = this.spec?.duration ?? 0;
    this.scrub.value = String(d > 0 ? Math.round((this.t / d) * 1000) : 0);
    if (this.spec) {
      const i = this.spec.stops.filter((s) => s <= this.t + 1e-9).length;
      this.label.textContent = `${i} / ${this.spec.stops.length}`;
    } else this.label.textContent = '';
  }
}
