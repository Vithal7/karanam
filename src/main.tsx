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
// Load the file readers while you look at the page, so a site update can't leave this page without them.
const warm = () => import('./extract/text').then((m) => m.warmReaders()).catch(() => undefined);
if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 4000 });
else setTimeout(warm, 2000);
