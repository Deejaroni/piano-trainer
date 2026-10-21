import { createDetector, WINDOW } from './js/detect.js';
import { listSongs, putSong, deleteSong, exportAll, importAll } from './js/storage.js';
import { importFile, applyHands } from './js/songs.js';
import { loadAppSettings, saveAppSettings } from './js/settings.js';

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

// ---------- Tabs ----------
for (const name of ['library', 'listen']) {
  $('tab-' + name).addEventListener('click', () => {
    for (const n of ['library', 'listen']) {
      $(n).hidden = n !== name;
      $('tab-' + n).classList.toggle('on', n === name);
    }
  });
}

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
  $('sd-tempo').value = st.tempo;
  $('sd-tempo-val').textContent = st.tempo + '%';
  seg($('sd-hands'), [['both', 'Both'], ['R', 'Right'], ['L', 'Left']], st.hands, (v) => { st.hands = v; });
  seg($('sd-wait'), [[true, 'On'], [false, 'Off']], st.wait, (v) => { st.wait = v; });
  $('sd-tracks').replaceChildren(...song.tracks.map((t) => {
    const s = el('span', { className: 'seg' });
    seg(s, [['R', 'Right'], ['L', 'Left'], ['X', 'Ignore']], editing.hands[t.index] || 'X', (v) => { editing.hands[t.index] = v; });
    return el('div', { className: 'row' }, el('span', { className: 'label' }, t.name, el('div', { className: 'muted', textContent: `${t.count} notes` })), s);
  }));
  $('song-dialog').showModal();
}

$('sd-tempo').addEventListener('input', (e) => {
  editing.settings.tempo = +e.target.value;
  $('sd-tempo-val').textContent = e.target.value + '%';
});
$('sd-cancel').addEventListener('click', () => $('song-dialog').close());
$('sd-save').addEventListener('click', async () => {
  const { song, settings, hands } = editing;
  song.settings = settings;
  song.trackHands = hands;
  applyHands(song);
  await putSong(song);
  $('song-dialog').close();
  renderLibrary();
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
}
$('headphones').addEventListener('click', async () => {
  appSettings.headphones = !appSettings.headphones;
  await saveAppSettings(appSettings);
  initSettings();
});

initSettings();
renderLibrary();
