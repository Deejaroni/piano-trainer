import { createDetector, WINDOW } from './js/detect.js';

const $ = (id) => document.getElementById(id);

if ('serviceWorker' in navigator) {
  // When an updated worker takes over, reload once so the new version shows.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
}

// Version label is read from sw.js so VERSION lives in one place.
fetch('sw.js')
  .then((r) => r.text())
  .then((t) => { $('version').textContent = 'v' + (t.match(/VERSION = '([^']+)'/) || [, '?'])[1]; })
  .catch(() => {});

let ctx;

async function start() {
  $('start').disabled = true;
  try {
    // Created/resumed inside the tap handler (iOS requirement).
    ctx = ctx || new AudioContext();
    if (ctx.state !== 'running') await ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = WINDOW;
    ctx.createMediaStreamSource(stream).connect(analyser); // not connected to speakers
    const detector = createDetector(analyser, ctx.sampleRate);
    $('status').textContent = `Listening (${ctx.sampleRate} Hz)`;
    $('start').textContent = 'Listening';

    const tick = () => {
      const { db, note } = detector.read();
      // With AGC off the raw iPad mic is quiet; normal playing sits around -60..-30 dB.
      const pct = Math.max(0, Math.min(100, ((db + 80) / 60) * 100)); // -80 dB .. -20 dB
      $('level').style.width = pct + '%';
      $('status').textContent = `Listening (${ctx.sampleRate} Hz) · ${db.toFixed(0)} dB`;
      $('note').textContent = note ? note.name : '–';
      $('detail').textContent = note
        ? `${note.freq.toFixed(1)} Hz · ${note.cents >= 0 ? '+' : ''}${note.cents}¢ · clarity ${note.clarity.toFixed(2)}`
        : '';
      requestAnimationFrame(tick);
    };
    tick();
  } catch (err) {
    $('status').textContent = 'Mic error: ' + err.message;
    $('start').disabled = false;
  }
}

$('start').addEventListener('click', start);
