import './style.css';
import { startApp } from './app/shell';
import { chapters } from './chapters';

// 開発用 index.html の「直接開いたとき用」の案内。アプリが起動できたので不要になる
document.getElementById('dev-hint')?.remove();
startApp(document.getElementById('app')!, chapters);
