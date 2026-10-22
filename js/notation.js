// Sheet music view: OpenSheetMusicDisplay renders the score; the cursor follows the song clock.
// OSMD positions are in whole notes; songs.js scoreOf() maps quarters to song seconds.
import { scoreOf } from './songs.js';

let lib = null;
function loadOSMD() { // UMD bundle (~1.4 MB), loaded the first time a sheet is shown
  lib = lib || new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/opensheetmusicdisplay.min.js';
    s.onload = () => res(self.opensheetmusicdisplay);
    s.onerror = () => { lib = null; rej(new Error('Could not load the notation library')); };
    document.head.appendChild(s);
  });
  return lib;
}

export function createNotation(box) {
  let L = null, osmd = null, steps = [], cur = -1, sec = null, songId = null, ready = false;

  async function setSong(song) {
    if (song.id === songId) return;
    songId = song.id; ready = false; steps = []; cur = -1;
    const [lib, score] = await Promise.all([loadOSMD(), scoreOf(song)]);
    if (songId !== song.id) return;
    L = lib;
    osmd = osmd || new L.OpenSheetMusicDisplay(box, {
      backend: 'svg', autoResize: true, drawTitle: true, drawComposer: false, drawPartNames: false,
      followCursor: false, cursorsOptions: [{ type: 0, color: '#22c55e', alpha: 0.45, follow: false }],
    });
    await osmd.load(score.xml);
    if (songId !== song.id) return;
    osmd.render();
    sec = score.sec;
    osmd.cursor.show();
    // One step per new score position. Repeats are ignored (as in songs.js): skip back-jumps.
    const it = osmd.cursor.iterator.clone();
    let last = -1;
    while (!it.EndReached) {
      const q = it.currentTimeStamp.RealValue * 4;
      if (q > last && it.CurrentVoiceEntries && it.CurrentVoiceEntries.length) {
        steps.push({ q, t: sec(q), ts: it.currentTimeStamp.clone() });
        last = q;
      }
      it.moveToNext();
    }
    cur = 0;
    ready = true;
  }

  function goTo(i) {
    const c = osmd.cursor;
    if (i === cur + 1) c.next();
    if (i !== cur + 1 || Math.abs(c.iterator.currentTimeStamp.RealValue * 4 - steps[i].q) > 1e-6) {
      c.iterator = new L.MusicPartManagerIterator(osmd.Sheet, steps[i].ts);
      c.update();
    }
    cur = i;
    // Keep the cursor in view: scroll so it sits in the upper third.
    const el = c.cursorElement;
    if (!el) return;
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - b.height / 3;
  }

  // t: song seconds. Shows the last score position at or before t.
  function update(t) {
    if (!ready || !steps.length) return;
    let a = 0, z = steps.length - 1;
    while (a < z) { const m = (a + z + 1) >> 1; if (steps[m].t <= t + 1e-3) a = m; else z = m - 1; }
    if (a !== cur) goTo(a);
  }

  // Song seconds of the note nearest a tap, or null.
  function timeAt(clientX, clientY) {
    if (!ready) return null;
    const gs = osmd.GraphicSheet;
    const ge = gs.GetNearestStaffEntry(gs.svgToOsmd(gs.domToSvg({ x: clientX, y: clientY })));
    return ge ? sec(ge.getAbsoluteTimestamp().RealValue * 4) : null;
  }

  return { setSong, update, timeAt, get ready() { return ready; } };
}
