import { PitchDetector } from '../vendor/pitchy.js';

// Tuning knobs. Measured iPad input: about -80 dB quiet, -20 dB loud.
export const WINDOW = 4096;      // samples; ~85 ms at 48 kHz, tracks down to ~A1
// The gate follows the room: GATE_DB above the measured noise floor, never below MIN_DB.
// A fixed -70 dB gate missed a piano a few metres from the iPad.
export const MIN_DB = -90;
export const GATE_DB = 8;
export const MIN_CLARITY = 0.8;  // pitchy clarity, 0..1 (a distant piano in a live room reads lower)
export const STABLE_FRAMES = 3;  // same MIDI note this many frames in a row
const MIN_HZ = 27.5;             // A0
const MAX_HZ = 4200;             // ~C8

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const midiToName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

// analyser.fftSize must equal WINDOW. read() returns { db, gate, floor, note }, where note is
// { midi, name, freq, cents, clarity } once stable, otherwise null.
export function createDetector(analyser, sampleRate) {
  const pitchy = PitchDetector.forFloat32Array(WINDOW);
  const buf = new Float32Array(WINDOW);
  let lastMidi = -1;
  let count = 0;
  let floor = -80; // dB, measured quiet level on the iPad

  return {
    read() {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-8);

      const gate = Math.max(MIN_DB, floor + GATE_DB);
      let midi = -1, freq = 0, clarity = 0;
      if (db >= gate) {
        [freq, clarity] = pitchy.findPitch(buf, sampleRate);
        if (clarity >= MIN_CLARITY && freq >= MIN_HZ && freq <= MAX_HZ) {
          midi = Math.round(69 + 12 * Math.log2(freq / 440));
        }
      }
      // Noise floor: drops fast on quieter frames, rises (~2 s) only on unpitched ones,
      // so a held note doesn't raise it. Digital silence (start-up zeros) is skipped.
      if (db < -120) { /* no signal yet */ }
      else if (db < floor) floor += (db - floor) * 0.1;
      else if (midi < 0) floor = Math.min(-40, floor + (db - floor) * 0.01);

      count = midi === lastMidi ? count + 1 : 1;
      lastMidi = midi;
      if (midi < 0 || count < STABLE_FRAMES) return { db, gate, floor, note: null };

      const cents = Math.round(1200 * Math.log2(freq / (440 * 2 ** ((midi - 69) / 12))));
      return { db, gate, floor, note: { midi, name: midiToName(midi), freq, cents, clarity } };
    },
  };
}
