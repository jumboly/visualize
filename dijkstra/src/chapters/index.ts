import { ch1 } from './ch1';
import { ch2 } from './ch2';
import { ch3 } from './ch3';
import type { ChapterDef } from './types';

/** まだ実装していない章の仮置き。Phase ごとに本物へ差し替える。 */
function placeholder(no: number, title: string, model: string): ChapterDef {
  return {
    no,
    title,
    model,
    create(host) {
      return {
        beats: [
          {
            title: '準備中',
            caption: '<p class="muted">この章は準備中です。</p>',
            enter: () => (host.stage.innerHTML = ''),
          },
        ],
        dispose() {},
      };
    },
  };
}

export const chapters: ChapterDef[] = [
  ch1,
  ch2,
  ch3,
  placeholder(4, '波紋から商圏を作る', '最短コストの探索結果を、面の情報に変換する'),
  placeholder(5, '階層探索で高速化する', 'アルゴリズムだけでなく、探索する対象の構造を工夫する'),
  placeholder(6, '巡回セールスマン問題', 'ダイクストラ法の結果を、別の最適化問題の入力にする'),
];
