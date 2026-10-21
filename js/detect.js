import { PitchDetector } from '../vendor/pitchy.js';

// Tuning knobs. Measured iPad input: about -80 dB quiet, -20 dB loud.
export const WINDOW = 4096;      // samples; ~85 ms at 48 kHz, tracks down to ~A1
export const MIN_DB = -55;       // ignore frames quieter than this
export const MIN_CLARITY = 0.9;  // pitchy clarity, 0..1
export const STABLE_FRAMES = 3;  // same MIDI note this many frames in a row
const MIN_HZ = 27.5;             // A0
const MAX_HZ = 4200;             // ~C8

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const midiToName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

// analyser.fftSize must equal WINDOW. read() returns { db, note }, where note is
// { midi, name, freq, cents, clarity } once stable, otherwise null.
export function createDetector(analyser, sampleRate) {
  const pitchy = PitchDetector.forFloat32Array(WINDOW);
  const buf = new Float32Array(WINDOW);
  let lastMidi = -1;
  let count = 0;

  return {
    read() {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-8);

      let midi = -1, freq = 0, clarity = 0;
      if (db >= MIN_DB) {
        [freq, clarity] = pitchy.findPitch(buf, sampleRate);
        if (clarity >= MIN_CLARITY && freq >= MIN_HZ && freq <= MAX_HZ) {
          midi = Math.round(69 + 12 * Math.log2(freq / 440));
        }
      }

      count = midi === lastMidi ? count + 1 : 1;
      lastMidi = midi;
      if (midi < 0 || count < STABLE_FRAMES) return { db, note: null };

      const cents = Math.round(1200 * Math.log2(freq / (440 * 2 ** ((midi - 69) / 12))));
      return { db, note: { midi, name: midiToName(midi), freq, cents, clarity } };
    },
  };
}
