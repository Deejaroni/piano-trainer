// App settings (kv store) and per-song setting defaults.
import { getKV, setKV } from './storage.js';

const APP_DEFAULTS = { headphones: false };

// tempo: % of written speed. hands: 'both' | 'R' | 'L'. wait: pause until the right note is heard.
export const defaultSongSettings = () => ({ tempo: 100, hands: 'both', wait: true });

export async function loadAppSettings() {
  return { ...APP_DEFAULTS, ...((await getKV('appSettings')) || {}) };
}

export async function saveAppSettings(s) {
  await setKV('appSettings', s);
}
