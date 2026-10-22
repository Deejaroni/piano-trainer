// Falling-notes canvas. Keyboard spans the song's range; notes fall toward it.
// Notes need { pitch, start, dur, hand, on (hand being practiced), s: null|'hit'|'miss' }.
const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (m) => BLACK.has(m % 12);
// Each hand's hue sweeps back and forth every CYCLE song seconds: left cyan <-> violet, right magenta <-> amber.
const HUES = { L: [185, 285], R: [310, 405] };
const CYCLE = 12;
const MISS = '#5b5b66';
const hsl = (h, l, a = 1) => `hsla(${h % 360}, 95%, ${l}%, ${a})`;

// Smoke: soft puffs rise and curl from keys that are sounding. One cached sprite per 10 degrees of hue.
const MAX_PUFFS = 1200;
const sprites = new Map();
function puffSprite(hue) {
  const key = Math.round(hue / 10) % 36;
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const sg = c.getContext('2d'), gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, hsl(key * 10, 72, 0.9));
    gr.addColorStop(0.4, hsl(key * 10, 62, 0.35));
    gr.addColorStop(1, hsl(key * 10, 50, 0));
    sg.fillStyle = gr;
    sg.fillRect(0, 0, 64, 64);
    sprites.set(key, c);
  }
  return c;
}

export function createFalling(canvas) {
  const g = canvas.getContext('2d');
  const keys = new Map(); // midi -> { x, w, black }
  let notes = [], maxDur = 0, lo = 48, hi = 72, W = 0, H = 0;
  let puffs = [], lastNow = 0, prevLit = new Map();

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    keys.clear();
    let whites = 0;
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites++;
    const ww = W / whites;
    let x = 0;
    for (let m = lo; m <= hi; m++) {
      if (isBlack(m)) keys.set(m, { x: x - ww * 0.3, w: ww * 0.6, black: true });
      else { keys.set(m, { x, w: ww, black: false }); x += ww; }
    }
  }
  new ResizeObserver(layout).observe(canvas);

  const kbHeight = () => Math.min(150, H * 0.24);
  const pxPerSec = (look) => (H - kbHeight()) / look;

  // First note index with start >= t (notes are sorted by start).
  function firstAt(t) {
    let a = 0, b = notes.length;
    while (a < b) { const m = (a + b) >> 1; if (notes[m].start < t) a = m + 1; else b = m; }
    return a;
  }

  function setSong(ns) {
    notes = ns;
    maxDur = Math.max(0, ...ns.map((n) => n.dur));
    const t0 = ns.length ? ns[0].start : 0;
    for (const n of ns) {
      const [a, b] = HUES[n.hand] || HUES.R;
      const ph = ((n.start - t0) / CYCLE) % 1; // 0..1, then a triangle wave so it loops smoothly
      n.hue = a + (b - a) * (ph < 0.5 ? ph * 2 : 2 - ph * 2);
    }
    const ps = ns.map((n) => n.pitch);
    lo = Math.max(21, Math.min(...ps, 60) - 2);
    hi = Math.min(108, Math.max(...ps, 60) + 2);
    while (hi - lo < 24) { if (lo > 21) lo--; if (hi < 108) hi++; } // at least two octaves
    while (isBlack(lo)) lo--;
    while (isBlack(hi)) hi++;
    layout();
  }

  // t: song time at the keyboard line; look: song seconds visible; heard: detected midi or null.
  // guide: 0..1 opacity of the notes and lit keys (the keyboard and heard dot stay visible).
  function draw(t, look, heard, guide = 1) {
    if (!W) return;
    const kbH = kbHeight(), top = H - kbH, pps = top / look;
    g.fillStyle = '#050508';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#15151d';
    for (const [m, k] of keys) if (m % 12 === 0) g.fillRect(k.x, 0, 1, top); // C guide lines

    smoke(prevLit, top, guide); // behind the blocks; last frame's lit keys are close enough
    const lit = new Map();
    for (let i = firstAt(t - maxDur); i < notes.length && notes[i].start < t + look; i++) {
      const n = notes[i], k = keys.get(n.pitch);
      const end = n.start + n.dur;
      if (!k || end < t) continue;
      const y0 = Math.max(0, top - (end - t) * pps), y1 = Math.min(top, top - (n.start - t) * pps);
      if (n.start <= t && n.on) lit.set(n.pitch, n);
      if (y1 - y0 < 1 || !guide) continue;
      // Solid block with a bright edge.
      const miss = n.s === 'miss';
      g.globalAlpha = (n.on ? 1 : 0.3) * guide;
      g.fillStyle = miss ? MISS : hsl(n.hue, n.s === 'hit' ? 68 : 55);
      g.beginPath();
      g.roundRect(k.x + 1.5, y0, k.w - 3, y1 - y0, 4);
      g.fill();
      g.strokeStyle = miss ? '#7a7a85' : n.s === 'hit' ? '#ffffff' : hsl(n.hue, 78);
      g.lineWidth = n.s === 'hit' ? 2 : 1;
      g.stroke();
    }
    g.globalAlpha = 1;

    for (const black of [false, true]) {
      for (const [m, k] of keys) {
        if (k.black !== black) continue;
        const n = lit.get(m);
        const x = k.x + (black ? 0 : 0.5), w = k.w - (black ? 0 : 1), h = black ? kbH * 0.62 : kbH;
        g.fillStyle = black ? '#0c0c10' : '#c9c9d2';
        g.fillRect(x, top, w, h);
        if (n && guide) {
          g.globalAlpha = guide;
          g.fillStyle = n.s === 'miss' ? MISS : hsl(n.hue, 58);
          g.fillRect(x, top, w, h);
          g.globalAlpha = 1;
        }
      }
    }

    // Hit line in the hands' colours.
    const line = g.createLinearGradient(0, 0, W, 0);
    line.addColorStop(0, hsl(HUES.L[0], 65));
    line.addColorStop(0.5, hsl(300, 65));
    line.addColorStop(1, hsl(HUES.R[1], 65));
    g.fillStyle = line;
    g.fillRect(0, top - 3, W, 3);
    prevLit = lit;
    const hk = heard != null && keys.get(heard);
    if (hk) { // what the mic hears
      g.fillStyle = '#f59e0b';
      g.beginPath();
      g.arc(hk.x + hk.w / 2, top + (hk.black ? kbH * 0.5 : kbH * 0.85), Math.min(10, hk.w * 0.3), 0, 7);
      g.fill();
    }
  }

  // Emit puffs from each lit key, then drift, curl, grow and fade them. Additive, so overlaps brighten.
  function smoke(lit, top, guide) {
    const now = performance.now() / 1000, dt = Math.min(0.1, now - (lastNow || now));
    lastNow = now;
    for (const [m, n] of lit) {
      if (n.s === 'miss' || !guide) continue;
      const k = keys.get(m);
      const rate = dt * 80; // puffs per key per second
      for (let c = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0); c > 0; c--) {
        if (puffs.length >= MAX_PUFFS) puffs.shift();
        puffs.push({ x: k.x + k.w * (0.25 + Math.random() * 0.5), y: top - 2, vx: (Math.random() - 0.5) * 30,
          vy: -100 - Math.random() * 70, r: k.w * 0.2, age: 0, life: 2.5 + Math.random() * 1.5, seed: Math.random() * 6.3,
          hue: n.hue + (Math.random() - 0.5) * 16 });
      }
    }
    g.globalCompositeOperation = 'lighter';
    let j = 0;
    for (const p of puffs) {
      p.age += dt;
      if (p.age >= p.life) continue;
      // Curl from a shared flow field, so neighbouring puffs move together into wisps.
      p.vx += (Math.sin(p.y * 0.025 + now * 1.5 + p.seed * 0.5) * 110 - p.vx * 0.8) * dt;
      p.vy *= 1 - 0.25 * dt; // slow as it rises
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += 10 * dt;
      g.globalAlpha = 0.42 * guide * (1 - p.age / p.life) ** 1.3;
      g.drawImage(puffSprite(p.hue), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      puffs[j++] = p;
    }
    puffs.length = j;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // Debug overlay: per expected note, name + confidence bar; amber = fresh attack seen.
  function drawDebug(rows) {
    const x = 12, w = 200, rh = 26;
    g.fillStyle = 'rgba(0,0,0,.7)';
    g.fillRect(x - 6, 6, w + 12, rows.length * rh + 12);
    g.font = '600 16px -apple-system, system-ui, sans-serif';
    g.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const y = 12 + i * rh;
      g.fillStyle = r.fresh ? '#f59e0b' : '#f2f2f5';
      g.fillText(r.name, x, y + rh / 2 - 2);
      g.fillStyle = '#2c2c38';
      g.fillRect(x + 50, y + 4, w - 50, rh - 12);
      g.fillStyle = r.conf >= 0.5 ? '#4ade80' : '#8a8a99'; // 0.5 = presence threshold
      g.fillRect(x + 50, y + 4, (w - 50) * r.conf, rh - 12);
    });
  }

  return { setSong, draw, drawDebug, pxPerSec };
}
