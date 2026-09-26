import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import './styles.css';

// Service workers are unavailable in some embedded views; the app works without one.
try {
  if ('serviceWorker' in navigator) registerSW({ immediate: true });
} catch {
  /* ignore */
}
render(<App />, document.getElementById('app')!);
