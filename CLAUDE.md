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
- Known issues: icons are placeholders. Not yet tested on the iPad.
- Next: Phase 1, pitch detection (detect.js) with a note readout.