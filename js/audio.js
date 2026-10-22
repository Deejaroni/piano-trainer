// Shared AudioContext, mic detector and optional Tone.js synth.
// startMic() and loadSynth() must be called from a tap handler (iOS).
import { createDetector, WINDOW } from './detect.js';
import { FFT } from './chords.js';

let ctx = null, detector = null, pending = null, spectrum = null;

export const audioContext = () => ctx;
export const spectrumAnalyser = () => spectrum; // set once startMic() resolves

export function startMic() {
  // Create/resume synchronously, before any await, so iOS counts it as the tap.
  ctx = ctx || new AudioContext();
  const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  if (detector) return resumed.then(() => detector);
  pending = pending || resumed
    .then(() => navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    }))
    .then((stream) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = WINDOW;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser); // not connected to speakers
      spectrum = ctx.createAnalyser(); // finer bins for chord checks
      spectrum.fftSize = FFT;
      spectrum.smoothingTimeConstant = 0;
      src.connect(spectrum);
      return (detector = createDetector(analyser, ctx.sampleRate));
    })
    .finally(() => { pending = null; });
  return pending;
}

export function suspendAudio() {
  if (synth) synth.releaseAll();
  if (ctx && ctx.state === 'running') ctx.suspend();
}

// ---------- Playback (Headphones setting only) ----------
let tonePromise = null, synth = null;

const play = (midi, dur) =>
  synth.triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), Math.max(0.05, dur));

// Loads vendor/tone.js on first use; resolves to play(midi, durSeconds).
export function loadSynth() {
  tonePromise = tonePromise || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/tone.js';
    s.onload = resolve;
    s.onerror = () => { tonePromise = null; reject(new Error('Tone.js failed to load')); };
    document.head.append(s);
  }).then(() => {
    Tone.setContext(ctx);
    Tone.getContext().lookAhead = 0; // play on the frame the note arrives
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.8 },
    }).toDestination();
    synth.volume.value = -8;
    return play;
  });
  return tonePromise;
}
