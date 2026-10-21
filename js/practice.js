// Practice engine: song clock, Wait / Free play judging, A-B loop, accompaniment.
// Times are song seconds; speed is the tempo fraction (0.25..1).
const GROUP = 0.03;    // notes starting within 30 ms form one chord
const EARLY = 0.15;    // real seconds a note may be played before it arrives
const LATE = 0.3;      // Free play: real seconds after a note before it is a miss
const LEAD_IN = 2;     // song seconds before the first note
const REARM_DB = 6;    // a repeated pitch counts again after a rise this large

export function createPractice() {
  let notes = [], groups = [], gi = 0, playIdx = 0, duration = 0, startT = -LEAD_IN;
  let player = null, lastMidi = -1, armed = true, floorDb = 0;

  const p = {
    t: 0, playing: false, done: false, wait: true, speed: 1, hands: 'both',
    loop: { a: null, b: null, on: false },
    get notes() { return notes; },
    get start() { return startT; },
    get end() { return duration; },

    load(song) {
      notes = song.notes.filter((n) => n.hand)
        .map((n) => ({ pitch: n.pitch, start: n.start, dur: n.dur, hand: n.hand, on: true, s: null }))
        .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
      duration = notes.length ? Math.max(...notes.map((n) => n.start + n.dur)) : 0;
      p.wait = song.settings.wait;
      p.speed = Math.min(1, song.settings.tempo / 100);
      p.loop = { a: null, b: null, on: false };
      p.playing = false;
      p.setHands(song.settings.hands);
      p.restart();
    },

    setHands(h) {
      p.hands = h;
      groups = [];
      for (const n of notes) {
        n.on = h === 'both' || n.hand === h;
        if (!n.on) continue;
        const last = groups[groups.length - 1];
        if (last && n.start - last.time < GROUP) { last.notes.push(n); last.pitch = Math.max(last.pitch, n.pitch); }
        else groups.push({ time: n.start, pitch: n.pitch, notes: [n], s: null });
      }
      startT = (groups.length ? groups[0].time : 0) - LEAD_IN;
      p.seek(p.t);
    },

    // Jump to song time x; everything from x on is unjudged again.
    seek(x) {
      p.t = Math.max(startT, Math.min(x, duration));
      p.done = false;
      gi = groups.findIndex((g) => g.time >= p.t - 1e-3);
      if (gi < 0) gi = groups.length;
      for (let i = gi; i < groups.length; i++) mark(groups[i], null);
      playIdx = notes.findIndex((n) => n.start >= p.t);
      if (playIdx < 0) playIdx = notes.length;
    },

    restart() { p.seek(p.loop.on ? p.loop.a : startT); },
    play() { if (p.done) p.restart(); p.playing = true; },
    pause() { p.playing = false; },
    setPlayer(fn) { player = fn; },

    stats() {
      let hits = 0, misses = 0;
      for (const g of groups) { if (g.s === 'hit') hits++; else if (g.s === 'miss') misses++; }
      return { hits, misses, total: groups.length };
    },

    // Call every frame. dt: real seconds; note/db: from detect.js read().
    update(dt, note, db) {
      if (!note || note.midi !== lastMidi || db > floorDb + REARM_DB) armed = true;
      floorDb = Math.min(floorDb, db);
      if (!p.playing) return;
      const fresh = note && armed ? note.midi : -1;
      let nt = p.t + dt * p.speed;

      if (p.wait) {
        const g = groups[gi];
        if (g && fresh === g.pitch && nt >= g.time - EARLY * p.speed) { hit(g, db); gi++; }
        else if (g && nt >= g.time) nt = Math.max(p.t, g.time); // hold until it is played
        p.t = nt;
      } else {
        p.t = nt;
        while (gi < groups.length && (groups[gi].s || groups[gi].time < p.t - LATE * p.speed)) {
          if (!groups[gi].s) mark(groups[gi], 'miss');
          gi++;
        }
        if (fresh >= 0) {
          for (let j = gi; j < groups.length && groups[j].time <= p.t + EARLY * p.speed; j++) {
            if (!groups[j].s && groups[j].pitch === fresh) { hit(groups[j], db); break; }
          }
        }
      }

      // Accompaniment: the hand not being practiced.
      while (playIdx < notes.length && notes[playIdx].start <= p.t) {
        const n = notes[playIdx++];
        if (!n.on && player) player(n.pitch, n.dur / p.speed);
      }

      const { a, b, on } = p.loop;
      if (on && p.t >= b) p.seek(a);
      else if (p.t >= duration + 0.5) { p.playing = false; p.done = true; }
    },
  };

  function mark(g, s) { g.s = s; for (const n of g.notes) n.s = s; }
  function hit(g, db) { mark(g, 'hit'); lastMidi = g.pitch; armed = false; floorDb = db; }

  return p;
}
