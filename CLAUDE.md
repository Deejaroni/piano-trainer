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
- Known issues: icons are placeholders. iPad mic input is very quiet.
- Next: chords.js (chord detection), then falling notes and Wait mode.