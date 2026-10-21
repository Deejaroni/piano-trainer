// Song import: .mid via @tonejs/midi (global Midi), .musicxml/.mxl via a small reader.
// Normalized note: { pitch (MIDI number), start (s), dur (s), track, hand: 'R'|'L'|null }.
// Every source becomes "tracks" (MIDI tracks, or MusicXML part+staff) mapped to R / L / X (ignored).
import { defaultSongSettings } from './settings.js';

export const ACCEPT = '.mid,.midi,.musicxml,.xml,.mxl';

export async function importFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const buf = await file.arrayBuffer();
  let parsed;
  if (ext === 'mid' || ext === 'midi') parsed = parseMidi(buf);
  else if (ext === 'mxl') parsed = parseMusicXML(await unzipMxl(buf));
  else if (ext === 'musicxml' || ext === 'xml') parsed = parseMusicXML(new TextDecoder().decode(buf));
  else throw new Error('Unsupported file type: .' + ext);
  if (!parsed.notes.length) throw new Error('No notes found');

  const trackHands = {};
  for (const t of parsed.tracks) trackHands[t.index] = t.guess;
  const song = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    title: parsed.title || file.name.replace(/\.[^.]+$/, ''),
    fileName: file.name,
    kind: ext === 'mid' || ext === 'midi' ? 'midi' : 'musicxml',
    file: new Blob([buf], { type: file.type || '' }),
    added: Date.now(),
    tracks: parsed.tracks.map(({ guess, ...t }) => t),
    trackHands,
    notes: parsed.notes,
    duration: Math.max(...parsed.notes.map((n) => n.start + n.dur)),
    settings: defaultSongSettings(),
  };
  applyHands(song);
  return song;
}

// Re-tag each note's hand from song.trackHands (call after the user changes the mapping).
export function applyHands(song) {
  for (const n of song.notes) {
    const h = song.trackHands[n.track];
    n.hand = h === 'R' || h === 'L' ? h : null;
  }
  return song;
}

const avgPitch = (notes) => notes.reduce((a, n) => a + n.pitch, 0) / notes.length;
const byTime = (a, b) => a.start - b.start || a.pitch - b.pitch;

// ---------- MIDI ----------
function parseMidi(buf) {
  if (!self.Midi) throw new Error('MIDI library not loaded');
  const midi = new self.Midi(buf);
  const notes = [];
  const tracks = [];
  midi.tracks.forEach((t, i) => {
    if (!t.notes.length) return;
    const tn = t.notes.map((n) => ({ pitch: n.midi, start: n.time, dur: n.duration, track: i, hand: null }));
    notes.push(...tn);
    const drums = t.channel === 9 || (t.instrument && t.instrument.percussion);
    tracks.push({ index: i, name: t.name || (t.instrument && t.instrument.name) || `Track ${i + 1}`,
      count: tn.length, avg: avgPitch(tn), guess: drums ? 'X' : null });
  });
  guessHands(tracks);
  notes.sort(byTime);
  return { title: midi.header.name || '', tracks, notes };
}

// One pitched track: right hand. Otherwise split by average pitch around middle C.
function guessHands(tracks) {
  const open = tracks.filter((t) => t.guess === null);
  if (open.length === 1) open[0].guess = 'R';
  else for (const t of open) t.guess = t.avg >= 60 ? 'R' : 'L';
}

// ---------- MusicXML ----------
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const kid = (el, name) => { for (const c of el.children) if (c.localName === name) return c; return null; };
const kids = (el, name) => [...el.children].filter((c) => c.localName === name);
const num = (el, name, def = 0) => { const c = el && kid(el, name); return c ? parseFloat(c.textContent) : def; };

function parseMusicXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid MusicXML');
  const root = doc.documentElement;
  if (root.localName !== 'score-partwise') throw new Error('Only partwise MusicXML is supported');

  const title = (doc.querySelector('work > work-title') || doc.querySelector('movement-title') || {}).textContent || '';
  const partNames = {};
  for (const sp of doc.querySelectorAll('part-list > score-part')) {
    partNames[sp.getAttribute('id')] = (kid(sp, 'part-name') || {}).textContent || sp.getAttribute('id');
  }

  const tempos = []; // { q: quarter position, bpm }
  const raw = []; // notes in quarters: { pitch, q, len, part, staff }
  const parts = kids(root, 'part');
  const staffCount = [];

  parts.forEach((part, pi) => {
    let divisions = 1;
    let mStart = 0; // measure start, quarters
    let staves = 1;
    const open = new Map(); // tie key -> note awaiting continuation
    for (const m of kids(part, 'measure')) {
      let pos = 0; // divisions from measure start
      let maxPos = 0;
      let lastStart = 0;
      const q = (d) => mStart + d / divisions;
      for (const el of m.children) {
        switch (el.localName) {
          case 'attributes':
            divisions = num(el, 'divisions', divisions) || divisions;
            staves = Math.max(staves, num(el, 'staves', 1));
            break;
          case 'backup': pos -= num(el, 'duration'); break;
          case 'forward': pos += num(el, 'duration'); break;
          case 'sound': if (el.hasAttribute('tempo')) tempos.push({ q: q(pos), bpm: +el.getAttribute('tempo') }); break;
          case 'direction': {
            const s = kid(el, 'sound');
            if (s && s.hasAttribute('tempo')) tempos.push({ q: q(pos), bpm: +s.getAttribute('tempo') });
            break;
          }
          case 'note': {
            if (kid(el, 'grace') || kid(el, 'cue')) break;
            const dur = num(el, 'duration');
            const isChord = !!kid(el, 'chord');
            const start = isChord ? lastStart : pos;
            if (!isChord) { lastStart = pos; pos += dur; }
            const p = kid(el, 'pitch');
            if (p) {
              const pitch = (num(p, 'octave') + 1) * 12 + STEP[kid(p, 'step').textContent.trim()] + Math.round(num(p, 'alter'));
              const staff = num(el, 'staff', 1);
              const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
              const key = `${staff}:${pitch}`;
              const prev = open.get(key);
              if (ties.includes('stop') && prev) {
                prev.len += dur / divisions;
              } else {
                const n = { pitch, q: q(start), len: dur / divisions, part: pi, staff };
                raw.push(n);
                if (ties.includes('start')) open.set(key, n);
              }
              if (!ties.includes('start')) open.delete(key);
            }
            break;
          }
        }
        maxPos = Math.max(maxPos, pos);
      }
      mStart += maxPos / divisions;
    }
    staffCount[pi] = staves;
  });

  // Quarters -> seconds through the tempo map (default 120 bpm).
  tempos.sort((a, b) => a.q - b.q);
  const map = [{ q: 0, bpm: tempos.length && tempos[0].q === 0 ? tempos[0].bpm : 120, sec: 0 }];
  for (const t of tempos) {
    const last = map[map.length - 1];
    if (t.q === last.q) { last.bpm = t.bpm; continue; }
    map.push({ q: t.q, bpm: t.bpm, sec: last.sec + ((t.q - last.q) * 60) / last.bpm });
  }
  const sec = (qq) => {
    let i = map.length - 1;
    while (i > 0 && map[i].q > qq) i--;
    return map[i].sec + ((qq - map[i].q) * 60) / map[i].bpm;
  };

  // Track per part+staff. Staff 1 = right hand, staff 2 = left hand.
  const tracks = [];
  const trackOf = {};
  const notes = raw.map((n) => {
    const k = n.part * 10 + n.staff;
    if (!(k in trackOf)) {
      trackOf[k] = tracks.length;
      const multi = staffCount[n.part] > 1;
      tracks.push({ index: k, name: (partNames[parts[n.part].getAttribute('id')] || `Part ${n.part + 1}`) + (multi ? ` · staff ${n.staff}` : ''),
        count: 0, avg: 0, guess: multi ? (n.staff === 1 ? 'R' : n.staff === 2 ? 'L' : null) : null });
    }
    const t = tracks[trackOf[k]];
    t.count++;
    t.avg += n.pitch;
    const start = sec(n.q);
    return { pitch: n.pitch, start, dur: sec(n.q + n.len) - start, track: k, hand: null };
  });
  for (const t of tracks) t.avg /= t.count;
  // Single-staff parts (e.g. two separate parts for the hands): split by pitch.
  const open = tracks.filter((t) => t.guess === null);
  if (open.length === tracks.length) guessHands(tracks);
  else for (const t of open) t.guess = t.avg >= 60 ? 'R' : 'L';
  tracks.sort((a, b) => a.index - b.index);
  notes.sort(byTime);
  return { title: title.trim(), tracks, notes };
}

// ---------- .mxl (zip) ----------
// Minimal zip reader: central directory + DecompressionStream('deflate-raw') (Safari 16.4+).
async function unzipMxl(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .mxl file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const entries = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const elen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    entries[name] = { method, csize, local };
    p += 46 + nlen + elen + clen;
  }
  const read = async (name) => {
    const e = entries[name];
    if (!e) throw new Error('Missing ' + name + ' in .mxl');
    const off = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    const data = new Uint8Array(buf, off, e.csize);
    if (e.method === 0) return dec.decode(data);
    if (e.method !== 8) throw new Error('Unsupported .mxl compression');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
  let rootPath = null;
  if (entries['META-INF/container.xml']) {
    const c = new DOMParser().parseFromString(await read('META-INF/container.xml'), 'application/xml');
    const rf = c.querySelector('rootfile');
    rootPath = rf && rf.getAttribute('full-path');
  }
  rootPath = rootPath || Object.keys(entries).find((n) => !n.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(n));
  if (!rootPath) throw new Error('No score inside .mxl');
  return read(rootPath);
}
