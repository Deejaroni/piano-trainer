// Practice engine: song clock, Wait / Free play judging, Listen (song plays itself),
// repeat section (loop a..b), accompaniment.
// Times are song seconds; speed is the tempo fraction (0.1..1).
const GROUP = 0.03;    // notes starting within 30 ms form one chord
const EARLY = 0.15;    // real seconds a note may be played before it arrives
const LATE = 0.3;      // Free play: real seconds after a note before it is a miss
const LEAD_IN = 2;     // song seconds before the first note
const REARM_DB = 6;    // a repeated pitch counts again after a rise this large

export function createPractice() {
  let notes = [], groups = [], gi = 0, playIdx = 0, duration = 0, startT = -LEAD_IN;
  let player = null, lastMidi = -1, armed = true, floorDb = 0;
  let beats = [], bi = 0, fromStart = false;

  const p = {
    t: 0, playing: false, done: false, wait: true, listen: false, speed: 1, hands: 'both', relaxed: true,
    loop: { a: null, b: null, on: false },
    beat: { n: 0, down: false }, // n counts beats passed while playing (metronome)
    onRun: null, // ({ loop, hits, misses, total }) after a full run from the start or a loop pass
    get notes() { return notes; },
    get start() { return startT; },
    get end() { return duration; },

    load(song) {
      notes = song.notes.filter((n) => n.hand)
        .map((n) => ({ pitch: n.pitch, start: n.start, dur: n.dur, hand: n.hand, on: true, s: null }))
        .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
      duration = notes.length ? Math.max(...notes.map((n) => n.start + n.dur)) : 0;
      p.wait = song.settings.wait;
      p.listen = !!song.settings.listen;
      p.speed = Math.min(1, song.settings.tempo / 100);
      beats = [];
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
        if (last && n.start - last.time < GROUP) {
          last.notes.push(n);
          if (!last.pitches.includes(n.pitch)) last.pitches.push(n.pitch);
        } else groups.push({ time: n.start, pitches: [n.pitch], notes: [n], s: null });
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
      bi = beats.findIndex((b) => b.t >= p.t);
      if (bi < 0) bi = beats.length;
      fromStart = gi === 0;
    },

    setBeats(b) { beats = b; bi = beats.findIndex((x) => x.t >= p.t); if (bi < 0) bi = beats.length; },

    restart() { p.seek(p.loop.on ? p.loop.a : startT); },
    play() { if (p.done) p.restart(); p.playing = true; },
    pause() { p.playing = false; },
    setPlayer(fn) { player = fn; },

    stats() {
      let hits = 0, misses = 0;
      for (const g of groups) { if (g.s === 'hit') hits++; else if (g.s === 'miss') misses++; }
      return { hits, misses, total: groups.length };
    },

    // Call every frame. dt: real seconds; note/db: from detect.js read(); chord: chords.js verifier or null.
    update(dt, note, db, chord) {
      if (!note || note.midi !== lastMidi || db > floorDb + REARM_DB) armed = true;
      floorDb = Math.min(floorDb, db);
      const fresh = note && armed ? note.midi : -1;
      // Single notes use pitchy; chords are verified against the spectrum.
      const ok = (g) => (g.pitches.length > 1 ? !!chord && chord.match(g.pitches, p.relaxed) : fresh === g.pitches[0]);

      if (chord) { // track the coming groups (also while paused, for the debug overlay)
        const want = new Set();
        const until = p.t + (EARLY + 0.5) * p.speed;
        for (let j = gi; j < groups.length && (j < gi + 2 || groups[j].time <= until); j++) {
          for (const m of groups[j].pitches) want.add(m);
        }
        chord.update(want);
        chord.show(groups[gi] ? groups[gi].pitches : []);
      }
      if (!p.playing) return;
      let nt = p.t + dt * p.speed;

      if (p.listen) p.t = nt; // nothing is judged
      else if (p.wait) {
        const g = groups[gi];
        if (g && nt >= g.time - EARLY * p.speed && ok(g)) { hit(g, db, chord); gi++; }
        else if (g && nt >= g.time) nt = Math.max(p.t, g.time); // hold until it is played
        p.t = nt;
      } else {
        p.t = nt;
        while (gi < groups.length && (groups[gi].s || groups[gi].time < p.t - LATE * p.speed)) {
          if (!groups[gi].s) mark(groups[gi], 'miss');
          gi++;
        }
        for (let j = gi; j < groups.length && groups[j].time <= p.t + EARLY * p.speed; j++) {
          if (!groups[j].s && ok(groups[j])) { hit(groups[j], db, chord); break; }
        }
      }

      // Accompaniment: the hand not being practiced (Listen: every note).
      const stop = p.loop.on ? p.loop.b : Infinity; // a note right at the section end belongs after it
      while (playIdx < notes.length && notes[playIdx].start <= p.t && notes[playIdx].start < stop) {
        const n = notes[playIdx++];
        if ((p.listen || !n.on) && player) player(n.pitch, n.dur / p.speed);
      }
      while (bi < beats.length && beats[bi].t <= p.t) p.beat = { n: p.beat.n + 1, down: beats[bi++].down };

      const { a, b, on } = p.loop;
      if (on && p.t >= b) { pass(true); p.seek(a); }
      else if (p.t >= duration + 0.5) { p.playing = false; p.done = true; pass(false); }
    },
  };

  function pass(loop) {
    if (!p.onRun || p.listen || (!loop && !fromStart)) return;
    const gs = loop ? groups.filter((g) => g.time >= p.loop.a && g.time < p.loop.b) : groups;
    let hits = 0, misses = 0;
    for (const g of gs) { if (g.s === 'hit') hits++; else if (g.s === 'miss') misses++; }
    p.onRun({ loop, hits, misses, total: gs.length });
  }

  function mark(g, s) { g.s = s; for (const n of g.notes) n.s = s; }
  function hit(g, db, chord) {
    mark(g, 'hit');
    if (g.pitches.length > 1) { if (chord) chord.consume(g.pitches); return; }
    lastMidi = g.pitches[0]; armed = false; floorDb = db;
  }

  return p;
}
