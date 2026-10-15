import type { Player } from '../app/player';

/** 発表の区切り 1 つ分。→キーで次のビートへ進む。 */
export interface Beat {
  title: string;
  /** サイドパネルに出す短い説明（HTML） */
  caption: string;
  /** ビートに入ったときの演出。戻る・ジャンプでも同じ状態を再現できるように、状態は毎回作り直す。 */
  enter(): void;
}

export interface ChapterHandle {
  beats: Beat[];
  dispose(): void;
}

/** シェルが章に貸し出す画面領域。章はここにだけ描画する（局所性を保つため）。 */
export interface Host {
  stage: HTMLElement;
  /** 自由操作用の設定パネル */
  controls: HTMLElement;
  /** 数値表示 */
  stats: HTMLElement;
  legend: HTMLElement;
  player: Player;
  /** 「いま何をしているか」の一行説明 */
  setNote(html: string): void;
}

export interface ChapterDef {
  no: number;
  title: string;
  /** 章の中心となるメンタルモデル */
  model: string;
  create(host: Host): ChapterHandle;
}
