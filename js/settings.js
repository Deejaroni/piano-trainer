// App settings (kv store) and per-song setting defaults.
import { getKV, setKV } from './storage.js';

// chords: 'strict' (every note) | 'relaxed' (3+ note chords may miss one).
// view: 'falling' | 'sheet' | 'both'. guide: falling-notes opacity in percent.
// drill: clef 'treble' | 'bass' | 'both', range 'staff' | 'ledger', acc (sharps/flats), kind 'notes' | 'chords',
// names (always show the note name). metro: metronome on. ramp: step the speed up after a clean run.
const APP_DEFAULTS = { headphones: false, chords: 'relaxed', view: 'both', guide: 100, metro: false, ramp: false,
  drill: { clef: 'treble', range: 'staff', acc: false, kind: 'notes', names: false } };

// tempo: % of written speed. hands: 'both' | 'R' | 'L'. wait: pause until the right note is heard.
export const defaultSongSettings = () => ({ tempo: 100, hands: 'both', wait: true });

export async function loadAppSettings() {
  return { ...APP_DEFAULTS, ...((await getKV('appSettings')) || {}) };
}

export async function saveAppSettings(s) {
  await setKV('appSettings', s);
}
