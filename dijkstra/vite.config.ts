import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * ビルド成果物の JS/CSS を index.html に埋め込む。
 * Why: リポジトリ内の他のスライドと同じく、ビルド後の HTML を file:// で直接開けるようにしたい。
 * 外部ファイルの module script は file:// だと CORS で読めないため、1ファイルにまとめる。
 */
function inlineAssets(): Plugin {
  return {
    name: 'inline-assets',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') return;
      let source = String(html.source);
      // 開発用 index.html を直接開いたとき用の案内は、ビルド成果物には不要なので取り除く
      source = source.replace(/<!-- dev-only -->[\s\S]*?<!-- \/dev-only -->\n?/, '');
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && name.endsWith('.js')) {
          const re = new RegExp(`<script[^>]*src="[^"]*${escapeRe(name)}"[^>]*></script>`);
          // </script> を含む文字列がコード中にあっても HTML が壊れないようにエスケープする
          const code = chunk.code.replace(/<\/script/gi, '<\\/script');
          source = source.replace(re, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (chunk.type === 'asset' && name.endsWith('.css')) {
          const re = new RegExp(`<link[^>]*href="[^"]*${escapeRe(name)}"[^>]*>`);
          source = source.replace(re, () => `<style>${String(chunk.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = source;
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig({
  base: './',
  plugins: [inlineAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 1ファイルに収めるため、アセットもすべてインライン化する
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
