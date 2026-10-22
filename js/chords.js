// Chord verification. The app knows which notes to expect, so instead of
// transcribing it checks the spectrum at each expected fundamental and its
// first harmonics, and looks for a fresh attack on each note.
import { midiToName } from './detect.js';

export const FFT = 16384;  // ~2.9 Hz bins at 48 kHz; 8192 let E4 leak into F4
const ON_DB = 12;          // strongest harmonic must stand this far above nearby bands
const FULL_DB = 24;        // confidence 1.0 at this margin
const RISE_DB = 6;         // attack: rise above the note's level just before
const ATTACK_S = 0.3;      // every chord note must start within this window
const HISTORY_S = 0.3;     // "just before" = the loudest level 0.3..0.08 s ago.
const GAP_S = 0.08;        // Comparing with the recent max (not min) ignores beating partials.
// From C3 up only the fundamental counts: harmonics collide inside chords
// (C4's 3rd = G4's 2nd). Below C3, fundamentals are weak and crowded, so 2nd/3rd count too.
const LOW_MIDI = 48;

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

export function createChordVerifier(analyser, sampleRate) {
  const spec = new Float32Array(analyser.frequencyBinCount);
  const scratch = new Float32Array(analyser.frequencyBinCount);
  const binHz = sampleRate / analyser.fftSize;
  const notes = new Map(); // midi -> { hist: [[t, peak]], margin, onset }
  let shown = [];

  // Peak dB within a quarter tone of f, and its margin over the median of +-half an octave.
  function probe(f) {
    const last = spec.length - 1;
    const a = Math.max(1, Math.floor((f * 2 ** (-1 / 24)) / binHz));
    const b = Math.min(last, Math.max(a + 1, Math.ceil((f * 2 ** (1 / 24)) / binHz)));
    let peak = -Infinity;
    for (let i = a; i <= b; i++) if (spec[i] > peak) peak = spec[i];
    const lo = Math.max(1, Math.floor(f / Math.SQRT2 / binHz)), hi = Math.min(last, Math.ceil((f * Math.SQRT2) / binHz));
    const step = Math.max(1, Math.floor((hi - lo) / 64)); // sample at most ~64 bins
    let n = 0;
    for (let i = lo; i <= hi; i += step) scratch[n++] = spec[i];
    const floor = scratch.subarray(0, n).sort()[n >> 1];
    return { peak, margin: peak - floor };
  }

  function measure(m) {
    let best = { peak: -Infinity, margin: -Infinity };
    for (const h of m < LOW_MIDI ? [1, 2, 3] : [1]) {
      const r = probe(hz(m) * h);
      if (r.margin > best.margin) best = r;
    }
    return best;
  }

  return {
    // Read the spectrum and update every midi in `want` (others are forgotten).
    update(want, now = performance.now() / 1000) {
      analyser.getFloatFrequencyData(spec);
      for (const m of notes.keys()) if (!want.has(m)) notes.delete(m);
      for (const m of want) {
        let s = notes.get(m);
        if (!s) notes.set(m, (s = { hist: [], margin: -Infinity, onset: -Infinity }));
        const { peak, margin } = measure(m);
        while (s.hist.length && s.hist[0][0] < now - HISTORY_S) s.hist.shift();
        let before = -Infinity, known = false;
        for (const [t, p] of s.hist) if (t <= now - GAP_S) { known = true; if (p > before) before = p; }
        // Fresh attack only: a note still ringing from the last chord just decays.
        if (known && margin >= ON_DB && peak - before >= RISE_DB) s.onset = now;
        s.hist.push([now, peak]);
        s.margin = margin;
      }
      this.now = now;
    },

    // True when enough notes of `pitches` started within ATTACK_S. relaxed: 3+ note chords may miss one.
    match(pitches, relaxed) {
      const need = relaxed && pitches.length >= 3 ? pitches.length - 1 : pitches.length;
      let got = 0;
      for (const m of pitches) {
        const s = notes.get(m);
        if (s && this.now - s.onset <= ATTACK_S) got++;
      }
      return got >= need;
    },

    // After a match, those attacks are used up (a held note can't satisfy the next chord).
    consume(pitches) {
      for (const m of pitches) { const s = notes.get(m); if (s) s.onset = -Infinity; }
    },

    show(pitches) { shown = pitches; },

    // Debug rows for the overlay: { name, conf 0..1, fresh }.
    debug() {
      return shown.map((m) => {
        const s = notes.get(m);
        return {
          name: midiToName(m),
          conf: (s && Math.max(0, Math.min(1, s.margin / FULL_DB))) || 0, // NaN in silence
          fresh: !!s && this.now - s.onset <= ATTACK_S,
        };
      });
    },
  };
}
