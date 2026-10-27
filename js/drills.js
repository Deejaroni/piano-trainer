// Sight-reading drills: one random note or chord on a staff (VexFlow), answered on the piano.
// Per-target stats (kv 'drillStats') weight the picks toward slow or missed targets.
import { getKV, setKV } from './storage.js';

let lib = null;
function loadVexFlow() { // UMD bundle, loaded the first time the Drills tab opens
  lib = lib || new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/vexflow.js';
    s.onload = () => res(self.VexFlow);
    s.onerror = () => { lib = null; rej(new Error('Could not load the notation library')); };
    document.head.appendChild(s);
  }).then(async (VF) => {
    await document.fonts.load('30px Bravura').catch(() => {}); // glyphs draw as text
    return VF;
  });
  return lib;
}

// In the lines and spaces, or out to two ledger lines.
const RANGES = {
  staff: { treble: [62, 79], bass: [41, 59] },  // D4..G5, F2..B3
  ledger: { treble: [57, 84], bass: [36, 64] }, // A3..C6, C2..E4
};
// Intervals above the bottom note: 2-note shapes, then major/minor triads and inversions.
const SHAPES = [[0, 3], [0, 4], [0, 5], [0, 7], [0, 8], [0, 9], [0, 12],
  [0, 4, 7], [0, 3, 7], [0, 3, 8], [0, 4, 9], [0, 5, 9], [0, 5, 8]];
const SHARP = ['c', 'c', 'd', 'd', 'e', 'f', 'f', 'g', 'g', 'a', 'a', 'b'];
const FLAT = ['c', 'd', 'd', 'e', 'e', 'f', 'g', 'g', 'a', 'a', 'b', 'b'];
const GREEN = '#16a34a', RED = '#dc2626';
const NEXT_S = 0.4;     // pause on a correct answer before the next target
const RELEASE_FRAMES = 10; // the last answer must stop or change this long before it can count as wrong

const isWhite = (m) => [0, 2, 4, 5, 7, 9, 11].includes(m % 12);
const oct = (m) => Math.floor(m / 12) - 1;
const vfKey = (m, flat) => `${(flat ? FLAT : SHARP)[m % 12]}${isWhite(m) ? '' : flat ? 'b' : '#'}/${oct(m)}`;
const label = (m, flat) => (flat ? FLAT : SHARP)[m % 12].toUpperCase() + (isWhite(m) ? '' : flat ? '♭' : '♯') + oct(m);
const labelOf = (t) => t.pitches.map((m) => label(m, t.flat)).join(' ');

function pool(o) {
  const out = [];
  for (const clef of o.clef === 'both' ? ['treble', 'bass'] : [o.clef]) {
    const [lo, hi] = RANGES[o.range][clef];
    const shapes = o.kind === 'chords' ? SHAPES : [[0]];
    for (const sh of shapes) {
      for (let r = lo; r + sh[sh.length - 1] <= hi; r++) {
        const pitches = sh.map((i) => r + i);
        if (o.acc || pitches.every(isWhite)) out.push({ id: `${clef[0]}:${pitches.join('-')}`, clef, pitches });
      }
    }
  }
  return out;
}

// box: element the staff is drawn into.
export function createDrills(box) {
  let VF = null, opts = null, stats = {}, cands = [], cur = null, prevId = null;
  let running = false, shownAt = 0, doneAt = 0, missed = false, wrong = null, held = -1, away = 0, session = [], msg = '';

  // Unseen targets and slow or often-missed ones come up more.
  function weight(c) {
    const s = stats[c.id];
    return s ? 1 + 4 * s.err + Math.min(3, s.ms / 1500) : 2;
  }

  function next() {
    // No shared pitch with the last target, so a still-ringing answer can't count.
    const fresh = cands.filter((c) => c.id !== prevId && !(cur && c.pitches.some((m) => cur.pitches.includes(m))));
    const list = fresh.length ? fresh : cands;
    let r = Math.random() * list.reduce((a, c) => a + weight(c), 0);
    const pick = list.find((c) => (r -= weight(c)) <= 0) || list[list.length - 1];
    cur = { ...pick, flat: opts.acc && Math.random() < 0.5 };
    prevId = cur.id;
    missed = false; wrong = null; doneAt = 0;
    msg = cur.pitches.length > 1 ? 'Play this chord' : 'Play this note';
    draw();
    shownAt = performance.now() / 1000;
  }

  function correct(now) {
    const ms = (now - shownAt) * 1000;
    const s = stats[cur.id] || (stats[cur.id] = { n: 0, err: 0, ms });
    s.n++;
    s.err = s.err * 0.7 + (missed ? 0.3 : 0);
    s.ms = s.ms * 0.7 + ms * 0.3;
    setKV('drillStats', stats).catch(() => {});
    session.push({ label: labelOf(cur), ms, missed });
    held = cur.pitches.length === 1 ? cur.pitches[0] : -1;
    away = 0;
    wrong = null;
    doneAt = now + NEXT_S;
    msg = `${labelOf(cur)} ✓ ${(ms / 1000).toFixed(1)} s`;
    draw();
  }

  function makeNote(it) {
    const { StaveNote, Accidental } = VF;
    const n = new StaveNote({ keys: it.pitches.map((m) => vfKey(m, it.flat)), duration: 'w', clef: it.clef });
    it.pitches.forEach((m, i) => { if (!isWhite(m)) n.addModifier(new Accidental(it.flat ? 'b' : '#'), i); });
    if (it.color) {
      const st = { fillStyle: it.color, strokeStyle: it.color };
      n.setStyle(st);
      n.setLedgerLineStyle(st);
      for (const md of n.getModifiers()) md.setStyle(st);
    }
    return n;
  }

  function draw() {
    if (!VF || !opts || !box.clientWidth) return;
    const { Renderer, Stave, StaveConnector, GhostNote, Formatter } = VF;
    box.replaceChildren();
    const both = opts.clef === 'both';
    const W = 300, H = both ? 260 : 145, x = both ? 24 : 10; // room for two ledger lines each side
    const s = Math.min(box.clientWidth / W, box.clientHeight / H) * 0.92;
    const r = new Renderer(box, Renderer.Backends.SVG);
    r.resize(W * s, H * s);
    const ctx = r.getContext();
    ctx.scale(s, s);
    const staves = {};
    for (const [clef, y] of both ? [['treble', 15], ['bass', 125]] : [[opts.clef, 15]]) {
      staves[clef] = new Stave(x, y, W - x - 10).addClef(clef).setContext(ctx);
      staves[clef].draw(); // draw() returns nothing in VexFlow 5
    }
    if (both) {
      new StaveConnector(staves.treble, staves.bass).setType('brace').setContext(ctx).draw();
      new StaveConnector(staves.treble, staves.bass).setType('singleLeft').setContext(ctx).draw();
    }
    if (!cur) return;
    const items = [{ ...cur, color: doneAt ? GREEN : null }];
    if (wrong != null) items.push({ clef: both ? (wrong >= 60 ? 'treble' : 'bass') : opts.clef, pitches: [wrong], flat: false, color: RED });
    for (const [clef, stave] of Object.entries(staves)) {
      if (!items.some((it) => it.clef === clef)) continue;
      // Ghost notes keep the target and the wrong note in the same columns on both staves.
      const notes = items.map((it) => (it.clef === clef ? makeNote(it) : new GhostNote({ duration: 'w' })));
      Formatter.FormatAndDraw(ctx, stave, notes);
    }
  }

  return {
    get running() { return running; },

    async init(o) {
      opts = o;
      [VF, stats] = await Promise.all([loadVexFlow(), getKV('drillStats').then((v) => v || {})]);
      draw();
    },

    setOptions(o) {
      opts = o;
      cands = pool(o);
      if (running) next(); else draw();
    },

    start() {
      cands = pool(opts);
      running = true; session = []; prevId = null; cur = null;
      next();
    },

    stop() {
      running = false; cur = null; wrong = null;
      msg = '';
      draw();
    },

    redraw: draw,

    // Call every frame while running. note: detector reading; chord: chord verifier.
    update(note, chord, relaxed) {
      if (!running || !cur) return;
      const now = performance.now() / 1000;
      if (doneAt) { if (now >= doneAt) next(); return; }
      const m = note ? note.midi : -1;
      if (held >= 0) {
        away = m === held ? 0 : away + 1;
        if (away >= RELEASE_FRAMES) held = -1;
      }
      chord.update(new Set(cur.pitches), now);
      if (cur.pitches.length > 1) {
        if (chord.match(cur.pitches, relaxed)) { chord.consume(cur.pitches); correct(now); }
        return;
      }
      if (m === cur.pitches[0]) return correct(now);
      // Quiet notes: a fresh spectral attack on the target counts too, unless pitchy
      // hears a different note (an octave below would light the target as its 2nd harmonic).
      if ((m < 0 || m === held) && chord.match(cur.pitches, false)) { chord.consume(cur.pitches); return correct(now); }
      if (m < 0 || m === held) return;
      if (m !== wrong) {
        wrong = m; missed = true;
        msg = `You played ${label(m, false)}, try again`;
        draw();
      }
    },

    status() { return msg; },

    summary() {
      const n = session.length;
      if (!n) return '';
      const first = session.filter((s) => !s.missed).length;
      const by = new Map();
      for (const s of session) by.set(s.label, [...(by.get(s.label) || []), s.ms]);
      const slow = [...by].map(([l, a]) => [l, a.reduce((x, y) => x + y) / a.length])
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l, t]) => `${l} ${(t / 1000).toFixed(1)} s`);
      const avg = session.reduce((a, s) => a + s.ms, 0) / n / 1000;
      return `${n} done · ${Math.round((100 * first) / n)}% first try · avg ${avg.toFixed(1)} s · slowest: ${slow.join(', ')}`;
    },
  };
}
