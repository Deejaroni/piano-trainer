// Shared AudioContext, mic detector and optional Tone.js synth.
// startMic() and loadSynth() must be called from a tap handler (iOS).
import { createDetector, WINDOW } from './detect.js';
import { FFT } from './chords.js';

let ctx = null, detector = null, pending = null, spectrum = null, analyser = null, src = null, stream = null;

export const audioContext = () => ctx;
export const spectrumAnalyser = () => spectrum; // set once startMic() resolves

// iOS ends or mutes the mic track when the app is covered (Files picker, background).
// The old stream then reads silence, so every tap checks it and reconnects if needed.
const micLive = () => !!stream && stream.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted);

// iOS audio session (Safari 16.4+): 'playback' plays at full volume even in silent mode;
// with the mic open the session is 'play-and-record', which turns the speaker way down.
function session(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) { /* older iOS */ }
}

// Listen mode: release the mic and play through the speaker. Call from a tap.
// The next startMic() re-acquires the mic (the stopped track no longer counts as live).
export function startPlayback() {
  if (stream) for (const t of stream.getTracks()) t.stop();
  session('playback');
  return startAudio();
}

// Creates/resumes the context synchronously so iOS counts the tap.
function startAudio() {
  ctx = ctx || new AudioContext();
  // An 'interrupted' iOS context may never settle resume(), so don't wait on it forever.
  return ctx.state === 'running' ? Promise.resolve()
    : Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))]);
}

export function startMic() {
  session('play-and-record');
  const resumed = startAudio();
  if (detector && micLive()) return resumed.then(() => detector);
  pending = pending || resumed
    .then(() => navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    }))
    .then((s) => {
      if (src) src.disconnect();
      if (stream) for (const t of stream.getTracks()) t.stop();
      stream = s;
      if (!analyser) { // analysers live as long as the context, so detectors survive a reconnect
        analyser = ctx.createAnalyser();
        analyser.fftSize = WINDOW;
        spectrum = ctx.createAnalyser(); // finer bins for chord checks
        spectrum.fftSize = FFT;
        spectrum.smoothingTimeConstant = 0;
        detector = createDetector(analyser, ctx.sampleRate);
      }
      src = ctx.createMediaStreamSource(s);
      src.connect(analyser); // not connected to speakers
      src.connect(spectrum);
      return detector;
    })
    .finally(() => { pending = null; });
  return pending;
}

export function suspendAudio() {
  if (synth) synth.releaseAll();
  if (ctx && ctx.state === 'running') ctx.suspend();
}

// ---------- Playback (Headphones setting only) ----------
// Metronome tick: a short blip, higher on the downbeat.
export function click(down) {
  if (!ctx || ctx.state !== 'running') return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.frequency.value = down ? 1760 : 1320;
  g.gain.setValueAtTime(down ? 0.35 : 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.06);
}

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
