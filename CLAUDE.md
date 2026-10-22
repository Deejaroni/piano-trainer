# Piano Trainer: project brief

## What it is
Personal-use piano teaching app for one user on an iPad. Notes fall toward an
on-screen keyboard (Guitar Hero style). In Wait mode the song pauses until the
correct note or chord is heard through the iPad microphone. It also teaches
reading sheet music. No accounts, no backend, no distribution.

## Hard constraints
- Input is the microphone only (acoustic piano or keyboard speaker). No MIDI
  keyboard, no Web MIDI.
- Target: iPad Safari, installed to Home Screen (standalone PWA). Landscape
  first, touch only, large tap targets.
- Plain HTML/CSS/JS with ES modules. No build step, no framework. Libraries are
  vendored as prebuilt files in /vendor.
- Hosted on GitHub Pages (main branch, root). Must work offline after first
  load via a service worker.
- No API keys, paid services, analytics, or runtime network calls.
- Songs (.mid, .musicxml, .mxl) are imported from the iPad Files app and
  stored in IndexedDB. Never commit song files; the repo is public.

## iPad audio rules
- getUserMedia with echoCancellation, noiseSuppression and autoGainControl
  all set to false.
- Create or resume the AudioContext only from a user tap.
- Don't play sound through the speaker while listening unless the
  Headphones setting is on.

## Libraries (/vendor)
pitchy, @tonejs/midi, opensheetmusicdisplay, vexflow, tone (playback only).
Ask before adding any other library.

## Structure
index.html, app.js, /js (audio, detect, chords, songs, falling, notation,
drills, storage, settings), sw.js, manifest.webmanifest, /icons, /vendor,
/tools (computer-only scripts, excluded from the service worker cache).

## Deploy routine
1. Bump VERSION in sw.js.
2. Update the Status section below (done, known issues, next).
3. Commit with a short message and push to main.

## Working style (saves usage)
- Be terse. End each task with a changelog of 3 lines or fewer.
- Don't re-read files already read this session unless they changed.
- Make the smallest change that solves the task. No unrelated refactors.
- For work touching more than one module, propose a plan of 10 lines or
  fewer and wait for "go".
- No tests or docs unless asked.

## Status
- Done (v0.0.1, Phase 0): skeleton, manifest, placeholder icons, offline sw.js,
  vendored libs, Start button + live mic level meter, version label.
- Vendor notes: pitchy imports ./fft.js (fft.js 4.0.4 wrapped as ESM). vexflow
  is the 5.0.0 Bravura-only build. tonejs-midi.js, vexflow.js, tone.js and
  opensheetmusicdisplay.min.js are UMD (load with classic script tags).
- v0.0.2: meter range is now -80..-20 dB with a live dB readout. The raw iPad mic
  (AGC off) is quiet, so the old -60..0 dB range only showed very loud sounds.
- v0.0.3: SW install fetches with cache:'reload' (GitHub Pages max-age=600 was
  serving stale files into new caches); page reloads once on controllerchange.
- Measured on iPad (v0.0.3): input runs from about -80 dB (quiet) to -20 dB
  (loud). Use this range when setting the note-onset threshold in detect.js.
- v0.1.0 (Phase 1): js/detect.js wraps pitchy (4096 window, gate -55 dB,
  clarity 0.9, 3 stable frames, A0..C8). Big note readout + Hz, cents, clarity.
- v0.1.1: gate lowered to -70 dB, clarity 0.85. On iPad, loud held singing
  only reached ~-60 dB, so -55 blocked nearly everything. Chords show no name
  by design until chords.js.
- v0.1.1 confirmed on iPad with the piano: single notes read correctly.
- v0.2.0 (Phase 2): song library. js/storage.js (IndexedDB: songs + kv, JSON
  backup export/restore), js/songs.js (MIDI via @tonejs/midi; MusicXML/.mxl via
  own reader, staff 1 = R, staff 2 = L, ties/chords/tempo, repeats ignored),
  js/settings.js. Library tab: import, rename, delete, per-song tempo/hands/wait
  and track-to-hand mapping. Notes: {pitch, start s, dur s, track, hand R|L|null}.
- v0.3.0 (Phase 3): Practice tab. js/audio.js (shared ctx + detector, lazy
  Tone.js synth), js/falling.js (canvas, keyboard sized to song range, R green /
  L blue), js/practice.js (clock, Wait mode on chord top note, Free play hit
  window -0.15/+0.3 s real time, A-B loop, other-hand accompaniment when
  Headphones on). Same pitch re-counts only after silence or a +6 dB rise.
  Drag canvas while paused to scrub. Auto-pauses and suspends audio in background.
- v0.4.0 (Phase 4): js/chords.js verifies expected chords on a second analyser
  (fftSize 16384, ~2.9 Hz bins; 8192 let E4 leak into F4). Presence = peak 12 dB
  over the median of +-half an octave; fundamental only from C3 up (harmonics
  collide in chords), h1-h3 below C3. Attack = rise of 6 dB over the loudest
  level 0.3..0.08 s earlier (a min-based rule fired on beating partials). All
  notes must attack within 0.3 s. Single notes still use pitchy. App setting
  Chords: strict | relaxed (3+ note chords may miss one). Practice Debug button
  shows per-note confidence (amber = fresh attack).
- v0.5.0 (Phase 5): js/notation.js renders MusicXML with OSMD (loaded lazily),
  cursor follows the practice clock (OSMD whole notes -> seconds via the songs.js
  tempo map, repeats skipped); tap a note while paused to seek. App settings
  View: falling | sheet | both, Guide fade 100/60/30/0 % (notes + lit keys).
  MIDI songs are locked to falling notes with a note saying why.
- v0.5.1: falling notes restyled: black field, solid glowing blocks (shadowBlur),
  hue drifts over the song per hand (L 205->275 blue-violet, R 325->395
  pink-orange), misses grey, glowing hit line with flares over lit keys.
- v0.5.2: glow replaced by smoke: additive puff particles (cached sprite per 10
  degrees of hue, max 700) rise and curl from sounding keys behind the blocks.
- v0.5.3: denser, brighter smoke (80 puffs/s per key, max 1200, shared flow-field
  curl for wisps). Hue now ping-pongs every 12 song s (L 185<->285, R 310<->405).
- Known issues: icons are placeholders. iPad mic input is very quiet. .mxl needs
  DecompressionStream (iOS 16.4+). Export uses the share sheet; untested on iPad.
  Phases 3-5 tested only on desktop with simulated input; thresholds and OSMD
  speed on long scores untested on iPad. Sheet does not colour hits/misses.
- Next: test Practice + chords + sheet view on iPad with the Debug overlay; tune
  ON_DB, RISE_DB and Free play window.