// Practice statistics in the kv store ('stats'), so backups include them.
// days: { 'YYYY-MM-DD': seconds }  songs: { id: { runs, full, best, bestSpeed, last } }
// drill: { n, first, ms }  (answers, right first try, total answer time)
import { getKV, setKV } from './storage.js';

const FLUSH_MS = 10000;
let s = null, session = 0, timer = 0;

export const dayKey = (d = new Date()) => d.toLocaleDateString('en-CA'); // local YYYY-MM-DD

export async function loadStats() {
  if (!s) {
    const v = (await getKV('stats')) || {};
    s = { days: {}, songs: {}, drill: { n: 0, first: 0, ms: 0 }, ...v };
  }
  return s;
}

export function reloadStats() { s = null; return loadStats(); } // after a backup restore

export function flushStats() {
  clearTimeout(timer); timer = 0;
  if (s) setKV('stats', s).catch(() => {});
}
const later = () => { if (!timer) timer = setTimeout(flushStats, FLUSH_MS); };

// Seconds of real practice (Practice playing or a drill running).
export function addTime(sec) {
  if (!s || !(sec > 0)) return;
  const k = dayKey();
  s.days[k] = (s.days[k] || 0) + sec;
  session += sec;
  later();
}
export const sessionTime = () => session;

// A full run from the start. pct: hits / total; full: Free play with every note hit.
export function recordRun(id, { pct, full, speed, wait }) {
  if (!s) return;
  const r = s.songs[id] || (s.songs[id] = { runs: 0, full: 0, best: 0, bestSpeed: 0, last: 0 });
  r.runs++;
  r.last = Date.now();
  if (!wait) r.best = Math.max(r.best, pct);
  if (full) { r.full++; r.bestSpeed = Math.max(r.bestSpeed, speed); }
  flushStats();
}

export function recordDrill(ms, first) {
  if (!s) return;
  s.drill.n++;
  if (first) s.drill.first++;
  s.drill.ms += ms;
  later();
}
