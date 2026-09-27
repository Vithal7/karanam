import { bundledRules, newerVersion, validateRules, type Rules } from './index';

const KEY = 'karanam:rules';
const CHECKED = 'karanam:rules-checked';
const DAY = 24 * 60 * 60 * 1000;

function saved(): Rules | null {
  try {
    const raw = localStorage.getItem(KEY);
    const r = raw ? JSON.parse(raw) : null;
    return validateRules(r) ? r : null;
  } catch {
    return null;
  }
}

/** The newest valid rules available offline: downloaded ones if newer than the bundled copy. */
export function activeRules(): Rules {
  const s = saved();
  return s && newerVersion(s.version, bundledRules.version) ? s : bundledRules;
}

/**
 * Fetches rules.json from the app's own host. Returns the new rules only when they are valid
 * and newer than what is active; any failure keeps the current rules.
 */
export async function refreshRules(fetcher: typeof fetch = fetch, url = `${import.meta.env.BASE_URL}rules.json`): Promise<Rules | null> {
  try {
    const res = await fetcher(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const r = await res.json();
    try {
      localStorage.setItem(CHECKED, String(Date.now()));
    } catch {
      /* ignore */
    }
    if (!validateRules(r) || !newerVersion(r.version, activeRules().version)) return null;
    try {
      localStorage.setItem(KEY, JSON.stringify(r));
    } catch {
      /* private mode: still use it for this session */
    }
    return r;
  } catch {
    return null;
  }
}

/** Checks on start, when the device comes online, and daily while open. */
export function watchRules(onUpdate: (r: Rules) => void): () => void {
  const check = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    refreshRules().then((r) => r && onUpdate(r));
  };
  check();
  window.addEventListener('online', check);
  const t = setInterval(check, DAY);
  return () => {
    window.removeEventListener('online', check);
    clearInterval(t);
  };
}
