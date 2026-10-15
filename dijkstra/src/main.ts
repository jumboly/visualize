import './style.css';
import { startApp } from './app/shell';
import { chapters } from './chapters';

startApp(document.getElementById('app')!, chapters);
