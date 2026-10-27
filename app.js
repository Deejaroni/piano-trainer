import { startMic, startAudio, audioContext, spectrumAnalyser, suspendAudio, loadSynth, click } from './js/audio.js';
import { createChordVerifier } from './js/chords.js';
import { createFalling } from './js/falling.js';
import { createPractice } from './js/practice.js';
import { createNotation } from './js/notation.js';
import { createDrills } from './js/drills.js';
import { listSongs, putSong, deleteSong, exportAll, importAll } from './js/storage.js';
import { importFile, applyHands, beatsOf } from './js/songs.js';
import { loadAppSettings, saveAppSettings } from './js/settings.js';
import { loadStats, reloadStats, flushStats, addTime, sessionTime, recordRun, recordDrill, dayKey } from './js/stats.js';

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

let listenTick = null, listenRaf = 0;

async function start() {
  $('start').disabled = true;
  try {
    const detector = await startMic(); // creates/resumes the AudioContext inside this tap
    const ctx = audioContext();
    $('status').textContent = `Listening (${ctx.sampleRate} Hz)`;
    $('start').textContent = 'Listening';

    listenTick = () => {
      // Only one screen reads the detector at a time.
      if ($('listen').hidden || document.hidden) { listenRaf = 0; return; }
      const { db, gate, floor, note } = detector.read();
      // With AGC off the raw iPad mic is quiet; normal playing sits around -60..-30 dB.
      const pct = Math.max(0, Math.min(100, ((db + 80) / 60) * 100)); // -80 dB .. -20 dB
      $('level').style.width = pct + '%';
      $('status').textContent = `Listening (${ctx.sampleRate} Hz) · ${db.toFixed(0)} dB · floor ${floor.toFixed(0)} · gate ${gate.toFixed(0)}`;
      $('note').textContent = note ? note.name : '–';
      $('detail').textContent = note
        ? `${note.freq.toFixed(1)} Hz · ${note.cents >= 0 ? '+' : ''}${note.cents}¢ · clarity ${note.clarity.toFixed(2)}`
        : '';
      listenRaf = requestAnimationFrame(listenTick);
    };
    listenTick();
  } catch (err) {
    $('status').textContent = 'Mic error: ' + err.message;
    $('start').disabled = false;
  }
}

$('start').addEventListener('click', start);

// ---------- Tabs ----------
const TABS = ['library', 'practice', 'drills', 'stats', 'listen'];
function showTab(name) {
  for (const n of TABS) {
    $(n).hidden = n !== name;
    $('tab-' + n).classList.toggle('on', n === name);
  }
  if (name === 'practice') startLoop();
  else { prac.pause(); stopLoop(); }
  if (name === 'drills') openDrills();
  else stopDrills();
  if (name === 'stats') renderStats();
  if (name === 'listen' && listenTick && !listenRaf) listenTick();
}
for (const name of TABS) $('tab-' + name).addEventListener('click', () => showTab(name));

// ---------- Library ----------
const msg = (t) => { $('msg').textContent = t; };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

async function renderLibrary() {
  const songs = (await listSongs()).sort((a, b) => a.title.localeCompare(b.title));
  const list = $('songs');
  list.replaceChildren();
  if (!songs.length) list.append(el('div', { className: 'muted', textContent: 'No songs yet. Tap Import song to add a .mid, .musicxml or .mxl file.' }));
  for (const s of songs) {
    const played = s.notes.filter((n) => n.hand).length;
    list.append(el('div', { className: 'song' },
      el('div', { className: 'info' },
        el('div', { className: 'title', textContent: s.title }),
        el('div', { className: 'muted', textContent: `${s.kind === 'midi' ? 'MIDI' : 'MusicXML'} · ${fmtTime(s.duration)} · ${played} notes` })),
      el('button', { className: 'small on', textContent: 'Practice', onclick: () => openPractice(s) }),
      el('button', { className: 'small', textContent: 'Rename', onclick: () => renameSong(s) }),
      el('button', { className: 'small', textContent: 'Settings', onclick: () => openSongDialog(s) }),
      el('button', { className: 'small danger', textContent: 'Delete', onclick: () => removeSong(s) })));
  }
}

$('import').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    try {
      msg(`Importing ${f.name}…`);
      const song = await importFile(f);
      await putSong(song);
      msg(`Imported ${song.title} (${song.notes.length} notes).`);
      await renderLibrary();
      if (song.kind === 'midi' && song.tracks.length > 1) openSongDialog(song); // let the user check the hand split
    } catch (err) {
      msg(`Could not import ${f.name}: ${err.message}`);
    }
  }
});

async function renameSong(s) {
  const t = prompt('Song name', s.title);
  if (!t || !t.trim()) return;
  s.title = t.trim();
  await putSong(s);
  renderLibrary();
}

async function removeSong(s) {
  if (!confirm(`Delete "${s.title}"?`)) return;
  await deleteSong(s.id);
  msg(`Deleted ${s.title}.`);
  renderLibrary();
}

// Segmented control: options = [[value, label], ...].
function seg(container, options, value, onChange) {
  container.replaceChildren(...options.map(([v, label]) => el('button', {
    className: 'small' + (v === value ? ' on' : ''), textContent: label,
    onclick: () => { onChange(v); seg(container, options, v, onChange); },
  })));
}

let editing = null;
function openSongDialog(song) {
  editing = { song, settings: { ...song.settings }, hands: { ...song.trackHands } };
  const st = editing.settings;
  $('sd-title').textContent = song.title;
  st.tempo = snapTempo(st.tempo);
  seg($('sd-speed'), SPEEDS.map((v) => [v, v / 100 + '×']), st.tempo, (v) => { st.tempo = v; });
  seg($('sd-hands'), [['both', 'Both'], ['R', 'Right'], ['L', 'Left']], st.hands, (v) => { st.hands = v; });
  seg($('sd-wait'), [[true, 'On'], [false, 'Off']], st.wait, (v) => { st.wait = v; });
  $('sd-tracks').replaceChildren(...song.tracks.map((t) => {
    const s = el('span', { className: 'seg' });
    seg(s, [['R', 'Right'], ['L', 'Left'], ['X', 'Ignore']], editing.hands[t.index] || 'X', (v) => { editing.hands[t.index] = v; });
    return el('div', { className: 'row' }, el('span', { className: 'label' }, t.name, el('div', { className: 'muted', textContent: `${t.count} notes` })), s);
  }));
  $('song-dialog').showModal();
}

$('sd-cancel').addEventListener('click', () => $('song-dialog').close());
$('sd-save').addEventListener('click', async () => {
  const { song, settings, hands } = editing;
  song.settings = settings;
  song.trackHands = hands;
  applyHands(song);
  await putSong(song);
  $('song-dialog').close();
  renderLibrary();
  if (pSong && pSong.id === song.id) loadPractice(song); // hand mapping may have changed
});

// ---------- Backup ----------
$('export').addEventListener('click', async () => {
  try {
    const data = await exportAll();
    const name = `piano-trainer-backup-${data.exported.slice(0, 10)}.json`;
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
    // Share sheet ("Save to Files") works in standalone mode; fall back to a download link.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); msg('Backup exported.'); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = el('a', { href: URL.createObjectURL(file), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    msg('Backup exported.');
  } catch (err) {
    msg('Export failed: ' + err.message);
  }
});

$('restore').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !confirm('Replace all songs and settings with this backup?')) return;
  try {
    const n = await importAll(JSON.parse(await f.text()));
    await reloadStats();
    msg(`Restored ${n} songs.`);
    await initSettings();
    renderLibrary();
  } catch (err) {
    msg('Restore failed: ' + err.message);
  }
});

// ---------- App settings ----------
let appSettings;
async function initSettings() {
  appSettings = await loadAppSettings();
  $('headphones').textContent = 'Headphones: ' + (appSettings.headphones ? 'on' : 'off');
  $('chords').textContent = 'Chords: ' + appSettings.chords;
  prac.relaxed = appSettings.chords === 'relaxed';
}
$('chords').addEventListener('click', async () => {
  appSettings.chords = appSettings.chords === 'strict' ? 'relaxed' : 'strict';
  await saveAppSettings(appSettings);
  initSettings();
});
$('headphones').addEventListener('click', async () => {
  appSettings.headphones = !appSettings.headphones;
  if (!appSettings.headphones) prac.setPlayer(null);
  await saveAppSettings(appSettings);
  initSettings();
});

// ---------- Practice ----------
const LOOK = 3; // real seconds of notes visible above the keyboard
const fall = createFalling($('fall'));
const prac = createPractice();
const sheet = createNotation($('sheet'));
let pSong = null, detector = null, chord = null, debug = false, raf = 0, lastTs = 0, shown = '', beatN = 0, micShown = '';
const SPEEDS = [10, 25, 50, 75, 100]; // percent of written tempo
const snapTempo = (t) => SPEEDS.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));

// Full run or loop pass: record it, and with Ramp on step up after a clean one.
prac.onRun = ({ loop, hits, misses, total }) => {
  if (!pSong || !total) return;
  if (!loop) recordRun(pSong.id, { pct: hits / total, full: !prac.wait && hits === total, speed: prac.speed, wait: prac.wait });
  const clean = prac.wait ? true : misses === 0 && hits === total;
  const i = SPEEDS.indexOf(pSong.settings.tempo);
  if (appSettings.ramp && clean && i >= 0 && i < SPEEDS.length - 1) {
    pSong.settings.tempo = SPEEDS[i + 1];
    prac.speed = pSong.settings.tempo / 100;
    saveSong();
    syncControls();
  }
};

function loadPractice(song) {
  pSong = song;
  song.settings.tempo = snapTempo(song.settings.tempo); // old songs saved slider values
  prac.load(song);
  beatsOf(song).then((b) => { if (pSong === song) prac.setBeats(b); }).catch(() => {});
  fall.setSong(prac.notes);
  $('p-title').textContent = song.title;
  $('p-play').disabled = false;
  syncControls();
}

function openPractice(song) {
  loadPractice(song);
  showTab('practice');
}

function saveSong() { if (pSong) putSong(pSong); }

function syncControls() {
  // Listen: the song plays itself through the speaker; the mic isn't used, so no Headphones needed.
  seg($('p-mode'), [['wait', 'Wait'], ['free', 'Free play'], ['listen', 'Listen']], prac.listen ? 'listen' : prac.wait ? 'wait' : 'free', (v) => {
    prac.pause(); prac.setPlayer(null); // the next Play tap picks the right sound
    prac.listen = pSong.settings.listen = v === 'listen';
    if (v !== 'listen') prac.wait = pSong.settings.wait = v === 'wait';
    prac.restart(); saveSong();
  });
  seg($('p-hands'), [['R', 'Right'], ['L', 'Left'], ['both', 'Both']], prac.hands, (v) => {
    prac.setHands(v); pSong.settings.hands = v; saveSong();
  });
  seg($('p-view'), [['falling', 'Falling'], ['sheet', 'Sheet'], ['both', 'Both']], appSettings.view, (v) => {
    appSettings.view = v; saveAppSettings(appSettings); syncView();
  });
  seg($('p-guide'), [100, 60, 30, 0].map((v) => [v, v + '%']), appSettings.guide, (v) => {
    appSettings.guide = v; saveAppSettings(appSettings);
  });
  seg($('p-speed'), SPEEDS.map((v) => [v, v / 100 + '×']), pSong.settings.tempo, (v) => {
    prac.speed = v / 100; pSong.settings.tempo = v; saveSong();
  });
  $('p-ramp').classList.toggle('on', appSettings.ramp);
  $('p-metro').classList.toggle('on', appSettings.metro);
  syncLoop();
  syncView();
}

// MIDI has no notation, so those songs only get falling notes.
function syncView() {
  const midi = pSong.kind !== 'musicxml';
  const v = midi ? 'falling' : appSettings.view;
  $('p-view').style.display = midi ? 'none' : '';
  $('p-viewnote').textContent = midi ? '· Falling notes only: MIDI files have no sheet music (import MusicXML for that).' : '';
  $('fall').hidden = v === 'sheet';
  $('sheet').hidden = v === 'falling';
  if (v !== 'falling') sheet.setSong(pSong).catch((err) => { $('p-viewnote').textContent = '· Sheet music failed: ' + err.message; });
}

function syncLoop() {
  const { a, b, on } = prac.loop;
  $('p-a').textContent = a == null ? 'Section start' : 'Start ' + fmtTime(Math.max(0, a));
  $('p-b').textContent = b == null ? 'Section end' : 'End ' + fmtTime(Math.max(0, b));
  $('p-loop').classList.toggle('on', on);
  $('p-loop').disabled = a == null || b == null;
  $('p-clear').disabled = a == null && b == null;
}

$('p-ramp').addEventListener('click', () => {
  appSettings.ramp = !appSettings.ramp; saveAppSettings(appSettings);
  $('p-ramp').classList.toggle('on', appSettings.ramp);
});
// Metronome: the beat dot pulses; the click sounds only with Headphones on (the mic would hear it).
$('p-metro').addEventListener('click', () => {
  appSettings.metro = !appSettings.metro; saveAppSettings(appSettings);
  $('p-metro').classList.toggle('on', appSettings.metro);
});

function setMark(k) {
  const L = prac.loop;
  L[k] = prac.t;
  if (L.a != null && L.b != null && L.b < L.a) [L.a, L.b] = [L.b, L.a];
  if (L.a === L.b) L.on = false;
  syncLoop();
}
$('p-a').addEventListener('click', () => setMark('a'));
$('p-b').addEventListener('click', () => setMark('b'));
$('p-loop').addEventListener('click', () => {
  prac.loop.on = !prac.loop.on;
  if (prac.loop.on) prac.seek(prac.loop.a);
  syncLoop();
});
$('p-clear').addEventListener('click', () => { prac.loop = { a: null, b: null, on: false }; syncLoop(); });
$('p-restart').addEventListener('click', () => prac.restart());
$('p-debug').addEventListener('click', () => { debug = !debug; $('p-debug').classList.toggle('on', debug); });

$('p-play').addEventListener('click', async () => {
  if (prac.playing) { prac.pause(); return; }
  try {
    if (prac.listen) {
      await startAudio(); // inside the tap: creates/resumes audio
      prac.setPlayer(await loadSynth());
      prac.play();
      return;
    }
    detector = await startMic(); // inside the tap: creates/resumes audio
    chord = chord || createChordVerifier(spectrumAnalyser(), audioContext().sampleRate);
    prac.setPlayer(appSettings.headphones ? await loadSynth() : null);
    prac.play();
  } catch (err) {
    $('p-score').textContent = 'Audio error: ' + err.message;
  }
});

// Drag the notes while paused to move through the song.
let dragY = null;
$('fall').addEventListener('pointerdown', (e) => { if (!prac.playing && pSong) dragY = e.clientY; });
$('fall').addEventListener('pointermove', (e) => {
  if (dragY == null) return;
  prac.seek(prac.t + (e.clientY - dragY) / fall.pxPerSec(LOOK * prac.speed));
  dragY = e.clientY;
});
for (const ev of ['pointerup', 'pointercancel']) $('fall').addEventListener(ev, () => { dragY = null; });
// Tap a note on the sheet while paused to jump there.
$('sheet').addEventListener('click', (e) => {
  if (prac.playing) return;
  const t = sheet.timeAt(e.clientX, e.clientY);
  if (t != null) prac.seek(t);
});

function frame(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  const { db, note } = detector ? detector.read() : { db: -100, note: null };
  prac.update(dt, note, db, chord);
  if (prac.playing) addTime(dt);
  // Mic level, -80..-20 dB, so it's visible whether the mic is live.
  const lvl = Math.round(Math.max(0, Math.min(1, (db + 80) / 60)) * 20) * 5 + '%';
  if (lvl !== micShown) $('p-mic').style.width = micShown = lvl;
  if (prac.beat.n !== beatN) {
    beatN = prac.beat.n;
    if (appSettings.metro) {
      const dot = $('p-beat');
      dot.className = 'beat ' + (prac.beat.down ? 'down' : 'on');
      setTimeout(() => { dot.className = 'beat'; }, 110);
      if (appSettings.headphones) click(prac.beat.down);
    }
  }
  if (!$('fall').hidden) fall.draw(prac.t, LOOK * prac.speed, note ? note.midi : null, appSettings.guide / 100);
  if (!$('sheet').hidden) sheet.update(prac.t);
  if (debug && chord) fall.drawDebug(chord.debug());

  // Touch the DOM only when the text changes.
  const { hits, misses, total } = prac.stats();
  const txt = (prac.playing ? 'Pause' : 'Play') + '|' + (pSong
    ? `${fmtTime(Math.max(0, prac.t))} / ${fmtTime(prac.end)} · ` + (prac.listen ? 'Listening'
      : `${hits}/${total} hit` + (prac.wait ? '' : ` · ${misses} missed`)) + (prac.done ? ' · Done' : '')
    : 'Pick a song in the Library.');
  if (txt !== shown) {
    shown = txt;
    const [btn, score] = txt.split('|');
    $('p-play').textContent = btn;
    $('p-score').textContent = score;
  }
  raf = requestAnimationFrame(frame);
}
function startLoop() {
  if (raf || document.hidden) return;
  lastTs = performance.now();
  raf = requestAnimationFrame(frame);
}
function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

// ---------- Drills ----------
const drill = createDrills($('staff'), $('d-hint'), recordDrill);
let drillReady = null, drillRaf = 0, dShown = '', drillTs = 0;

function openDrills() {
  const o = appSettings.drill;
  const set = (k) => (v) => { o[k] = v; saveAppSettings(appSettings); drill.setOptions(o); };
  seg($('d-clef'), [['treble', 'Treble'], ['bass', 'Bass'], ['both', 'Both']], o.clef, set('clef'));
  seg($('d-range'), [['staff', 'Staff'], ['ledger', 'Ledger lines']], o.range, set('range'));
  seg($('d-acc'), [[false, 'Off'], [true, 'On']], o.acc, set('acc'));
  seg($('d-kind'), [['notes', 'Notes'], ['chords', 'Chords']], o.kind, set('kind'));
  seg($('d-names'), [[false, 'Off'], [true, 'On']], !!o.names, set('names'));
  drillReady = drillReady || drill.init(o).catch((err) => { drillReady = null; $('d-msg').textContent = err.message; });
  drill.redraw();
}

// Stopping ends the round; the summary stays on screen.
function stopDrills() {
  cancelAnimationFrame(drillRaf); drillRaf = 0;
  if (drill.running) drill.stop();
  $('d-start').textContent = 'Start';
  $('d-msg').textContent = '';
  dShown = '';
}

function drillFrame(ts) {
  addTime(Math.min(0.1, (ts - drillTs) / 1000));
  drillTs = ts;
  const { note } = detector.read();
  drill.update(note, chord, appSettings.chords === 'relaxed');
  const txt = drill.status() + '|' + drill.summary();
  if (txt !== dShown) {
    dShown = txt;
    const [m, sum] = txt.split('|');
    $('d-msg').textContent = m;
    if (sum) $('d-sum').textContent = sum;
  }
  drillRaf = requestAnimationFrame(drillFrame);
}

$('d-start').addEventListener('click', async () => {
  if (drill.running) { stopDrills(); return; }
  try {
    detector = await startMic(); // inside the tap: creates/resumes audio
    chord = chord || createChordVerifier(spectrumAnalyser(), audioContext().sampleRate);
    await drillReady;
    $('d-sum').textContent = '';
    drill.start();
    $('d-start').textContent = 'Stop';
    drillTs = performance.now();
    drillRaf = requestAnimationFrame(drillFrame);
  } catch (err) {
    $('d-msg').textContent = 'Audio error: ' + err.message;
  }
});
window.addEventListener('resize', () => { if (!$('drills').hidden) drill.redraw(); });

// ---------- Stats ----------
const fmtDur = (sec) => {
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

async function renderStats() {
  const st = await loadStats();
  const days = st.days;
  const all = Object.values(days).reduce((a, b) => a + b, 0);
  // Streak: consecutive days with practice, ending today (or yesterday if not yet today).
  const d = new Date();
  if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days[dayKey(d)]) { streak++; d.setDate(d.getDate() - 1); }
  const card = (label, value) => el('div', { className: 'card' }, el('b', { textContent: value }), el('span', { className: 'muted', textContent: label }));
  $('s-cards').replaceChildren(
    card('This session', fmtDur(sessionTime())),
    card('Today', fmtDur(days[dayKey()] || 0)),
    card('All time', fmtDur(all)),
    card('Day streak', String(streak)));

  const last = [];
  for (let i = 13; i >= 0; i--) { const x = new Date(); x.setDate(x.getDate() - i); last.push(x); }
  const max = Math.max(60, ...last.map((x) => days[dayKey(x)] || 0));
  $('s-chart').replaceChildren(...last.map((x) => {
    const sec = days[dayKey(x)] || 0;
    const bar = el('i');
    bar.style.height = (sec / max) * 100 + '%';
    return el('div', { title: fmtDur(sec) }, el('span', { textContent: sec >= 60 ? Math.round(sec / 60) : '' }), bar,
      el('span', { textContent: x.toLocaleDateString(undefined, { weekday: 'narrow' }) }));
  }));

  const dr = st.drill;
  $('s-drill').textContent = dr.n
    ? `${dr.n} answered · ${Math.round((100 * dr.first) / dr.n)}% first try · avg ${(dr.ms / dr.n / 1000).toFixed(1)} s`
    : 'No drills yet.';

  const songs = (await listSongs()).sort((a, b) => a.title.localeCompare(b.title));
  const head = el('tr', {}, ...['Song', 'Runs', 'Best', '100 %', 'Fastest 100 %'].map((t) => el('th', { textContent: t })));
  $('s-songs').replaceChildren(head, ...songs.map((s) => {
    const r = st.songs[s.id] || { runs: 0, full: 0, best: 0, bestSpeed: 0 };
    return el('tr', {}, ...[s.title, r.runs, r.runs ? Math.round(r.best * 100) + ' %' : '–',
      r.full ? '★ ' + r.full : '–', r.bestSpeed ? r.bestSpeed + '×' : '–'].map((t) => el('td', { textContent: t })));
  }));
}

// Background: pause cleanly; the user taps Play (or Start) to continue.
function toBackground() { prac.pause(); stopLoop(); stopDrills(); suspendAudio(); flushStats(); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) toBackground();
  else if (!$('practice').hidden) startLoop();
});
window.addEventListener('pagehide', toBackground);

initSettings();
loadStats();
renderLibrary();
