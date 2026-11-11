/*!
 * THE RIVER FISHER — a hand-painted anime river scene you can fish in.
 * Everything is drawn in code (Canvas 2D). No external assets.
 * API:  RiverFisher.init(canvas, {quality:'high'|'low', interactive:true|false, hideCursor:true|false})
 *       RiverFisher.pause() / resume() / destroy()
 * Game: the cursor is the bob. Click the water to cast; when a fish pulls the float
 *       under it hooks itself; hold mouse/Space to keep the fish in the green zone.
 *       Elements matching a, button, input, label… or [data-rf-ignore] are left alone.
 *       Fish on: a bite hooks itself; from then until the fish is landed or lost, a "!" pops over his head, action lines rush in from
 *       the screen edges, <html> gets class rf-focus (style it to hide page text/buttons) and scrolling is held.
 *       interactive:false (or prefers-reduced-motion) gives the passive 60 s loop. hint:false hides the how-to bubble.
 * Sound: synthesised with Web Audio (reel ratchet, splashes, a shimmer on every catch). Starts after the first click/key;
 *        options { sound: false } disables it, { muted: true } starts muted; RiverFisher.mute(true|false) toggles it.
 * Reel:  RiverFisher.reelUp(buttonEl, { to }): he hooks the button, struggles, and hauls the content below up into view
 *        (`to` = scroll position or element; defaults to the bottom of the hero).
 * Extra catches from images: catchImages: { overwatch: { src: 'catches/overwatch.svg', label: 'an Overwatch emblem', size: 36 } }
 *       (pair each with facts.<kind>). A catch only joins the pool once its image loads.
 * Facts: every catch shows a fun-fact card. Pass your own:
 *       RiverFisher.init(canvas, { facts: { fish: ['…', '…'], jjajangmyeon: ['…'], bottle: ['…'], viola: ['…'] },
 *                                  onCatch: (c) => console.log(c.kind, c.fact) })
 */
(function (root) {
'use strict';

/* ------------------------------------------------------------------ */
/*  Constants & small maths                                            */
/* ------------------------------------------------------------------ */
const LOOP = 60, TAU = Math.PI * 2, W0 = 1920, H0 = 1080;
const KEY_T = 4.5;                       // the "key art" frame
const SUN = { x: 1470, y: 172 };         // afternoon sun, behind the leaning tree
const LX = 0.62, LY = -0.78;             // light direction (towards the sun)
const FISH_X = 1390, FISH_Y = 842, FS = 1.15; // fisher origin (waterline) & scale

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let R = mulberry32(1);
const reseed = (s) => { R = mulberry32(s * 9973 + 17); };
const rnd = (a = 1, b) => (b === undefined ? R() * a : a + (b - a) * R());
const pick = (arr) => arr[(R() * arr.length) | 0];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const frac = (x) => x - Math.floor(x);

function h2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, y, s, o) {
  o = o || 4; let a = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < o; i++) { a += amp * vnoise(x * f, y * f, s + i * 31); n += amp; f *= 2.03; amp *= 0.5; }
  return a / n;
}

/* --- periodic (loop-safe) time helpers: every cycle divides 60 s ---- */
const osc = (k, t, p) => Math.sin(TAU * k * t / LOOP + (p || 0));
function wrapd(d) { d %= LOOP; if (d < -LOOP / 2) d += LOOP; else if (d >= LOOP / 2) d -= LOOP; return d; }
function bump(t, t0, w) { const d = wrapd(t - t0) / w; return Math.exp(-d * d); }
/** smooth periodic noise built from integer harmonics */
function pn(t, s, k0) {
  k0 = k0 || 2; let v = 0;
  v += Math.sin(TAU * k0 * t / LOOP + h2(s, 1, 9) * TAU);
  v += 0.6 * Math.sin(TAU * (k0 * 2 + 1) * t / LOOP + h2(s, 2, 9) * TAU);
  v += 0.35 * Math.sin(TAU * (k0 * 4 + 3) * t / LOOP + h2(s, 3, 9) * TAU);
  return v / 1.95;
}

/** Periodic monotone cubic track. keys: [[t,v],...] first t=0, last t=60 (same value). */
function track(keys) {
  const n = keys.length;
  const T = [keys[n - 2][0] - LOOP], V = [keys[n - 2][1]];
  for (const k of keys) { T.push(k[0]); V.push(k[1]); }
  T.push(keys[1][0] + LOOP); V.push(keys[1][1]);
  const m = T.length, d = [], M = new Array(m).fill(0);
  for (let i = 0; i < m - 1; i++) d.push((V[i + 1] - V[i]) / Math.max(1e-6, T[i + 1] - T[i]));
  for (let i = 1; i < m - 1; i++) {
    const a = d[i - 1], b = d[i];
    if (a * b <= 0) M[i] = 0;
    else { let s = (a + b) / 2; const lim = 3 * Math.min(Math.abs(a), Math.abs(b)); if (Math.abs(s) > lim) s = Math.sign(s) * lim; M[i] = s; }
  }
  return function (t) {
    t = ((t % LOOP) + LOOP) % LOOP;
    let i = 1; while (i < m - 2 && T[i + 1] <= t) i++;
    const h = T[i + 1] - T[i]; if (h <= 1e-6) return V[i + 1];
    const s = (t - T[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * V[i] + (s3 - 2 * s2 + s) * h * M[i] + (-2 * s3 + 3 * s2) * V[i + 1] + (s3 - s2) * h * M[i + 1];
  };
}

/* --- colour ---------------------------------------------------------- */
function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : +a.toFixed(3)) + ')';
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const jit = (c, a) => [clamp(c[0] + rnd(-a, a), 0, 255), clamp(c[1] + rnd(-a, a), 0, 255), clamp(c[2] + rnd(-a * 0.8, a * 0.8), 0, 255)];

/* --- canvas helpers -------------------------------------------------- */
function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
/** painted layer covering a scene rect at resolution S (px per scene unit) */
function mkLayer(x, y, w, h, S, paint) {
  const cv = mkCanvas(w * S, h * S), c = cv.getContext('2d');
  c.setTransform(S, 0, 0, S, -x * S, -y * S);
  c.lineCap = 'round'; c.lineJoin = 'round';
  paint(c);
  return { cv, x, y, w, h };
}
/** Catmull-Rom spline through points into a path (closed by default) */
function spline(p, pts, closed, dx, dy) {
  dx = dx || 0; dy = dy || 0; const n = pts.length;
  if (closed === undefined) closed = true;
  p.moveTo(pts[0][0] + dx, pts[0][1] + dy);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], p1 = pts[i];
    const p2 = pts[closed ? (i + 1) % n : i + 1], p3 = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
    p.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6 + dx, p1[1] + (p2[1] - p0[1]) / 6 + dy,
      p2[0] - (p3[0] - p1[0]) / 6 + dx, p2[1] - (p3[1] - p1[1]) / 6 + dy,
      p2[0] + dx, p2[1] + dy);
  }
  if (closed) p.closePath();
}
const rot = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
function ellipsePath(c, x, y, rx, ry, a) {
  c.moveTo(x + rx * Math.cos(a), y + rx * Math.sin(a));
  c.ellipse(x, y, rx, ry, a, 0, TAU);
}

/* ------------------------------------------------------------------ */
/*  Palettes                                                           */
/* ------------------------------------------------------------------ */
const PALETTES = {
  day: {
    skyTop: '#4e86c8', skyMid: '#8fbfe2', skyLow: '#e0ebe6', skyWarm: '#f4efd6', sunCore: '#ffffff',
    cloudHi: '#ffffff', cloudLit: '#fbf6ec', cloudMid: '#dfe0e6', cloudShade: '#aab7d0', cloudBelly: '#93a2c2',
    hillFar: '#97b2cc', hillNear: '#7495ae', hillLit: '#d6dccb', haze: '#d6e0de',
    tDark: '#1b3a36', tShade: '#2a5747', tMid: '#467c40', tLit: '#8bb546', tHi: '#d5e27a',
    gLit: '#a9bd53', gMid: '#69903c', gShade: '#335a49', soil: '#8a6e4c', soilDark: '#45392e',
    rock: '#8c8c84', rockLit: '#e3dccb', rockShade: '#4e585d', moss: '#6b8f3c',
    bark: '#6a5c4e', barkShade: '#343130', barkRim: '#f1d8a8',
    wDeep: '#264a4f', wMid: '#3a6c6e', wShallow: '#8c9265', wHi: '#f4f8f4', wHiWarm: '#ffffff', wDark: '#20414a',
    rim: '#fff3cf', glow: '#fff0c8', grain: 0.06,
  },
};
function compilePalette(name) {
  const src = PALETTES.day, P = {};
  for (const k in src) P[k] = typeof src[k] === 'string' ? hex(src[k]) : src[k];
  return P;
}

/* ------------------------------------------------------------------ */
/*  Scene geometry (scene units, 1920 x 1080 reference)                */
/* ------------------------------------------------------------------ */
const farWater = (x) => 612 - 13 * Math.exp(-Math.pow((x - 1095) / 85, 2)) + 3 * (vnoise(x / 70, 0, 5) - 0.5);
const BANK = [[1185, 598], [1232, 617], [1300, 642], [1380, 668], [1452, 698], [1520, 736], [1572, 788],
  [1606, 850], [1640, 922], [1680, 1000], [1712, 1080], [1730, 1150]];
function bankX(y) {
  if (y <= BANK[0][1]) return BANK[0][0];
  for (let i = 0; i < BANK.length - 1; i++) {
    const a = BANK[i], b = BANK[i + 1];
    if (y <= b[1]) return lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1]));
  }
  return BANK[BANK.length - 1][0];
}
const inWater = (x, y, m) => { m = m || 0; return y > farWater(x) + 1 + m * 0.3 && x < bankX(y) - m; };
const persp = (y) => clamp((y - 596) / 484, 0, 1.2);            // 0 at far water, 1 at frame bottom
const flowVel = (x, y) => {                                      // screen-space river current
  const p = persp(y);
  const cx = lerp(1105, 760, p), hw = lerp(70, 760, p);
  const f = 0.22 + 0.78 * clamp(1 - Math.pow((x - cx) / hw, 2), 0, 1);
  const bank = clamp((bankX(y) - x) / 160, 0.25, 1);
  const sp = (3 + 23 * p) * f * bank;
  const dx = lerp(-0.35, -1, sstep(0.05, 0.55, p)), dy = lerp(0.9, 0.06, sstep(0.05, 0.55, p));
  const l = Math.hypot(dx, dy);
  return [dx / l * sp, dy / l * sp];
};
function waterPath() {
  const p = new Path2D();
  p.moveTo(-80, farWater(-80));
  for (let x = -80; x <= 1186; x += 8) p.lineTo(x, farWater(x));
  for (const b of BANK) p.lineTo(b[0], b[1]);
  p.lineTo(-80, 1160); p.closePath();
  return p;
}

/* ------------------------------------------------------------------ */
/*  Brushes                                                            */
/* ------------------------------------------------------------------ */
function noisyDisc(c, cx, cy, r, s, rough, sq) {
  rough = rough === undefined ? 0.2 : rough; sq = sq || 0.9;
  const n = Math.max(12, Math.min(40, (r / 3) | 0));
  c.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = i / n * TAU;
    const rr = r * (1 - rough + rough * 2 * vnoise(Math.cos(a) * 1.7 + s, Math.sin(a) * 1.7 + s * 1.3, 3));
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * sq;
    if (i) c.lineTo(x, y); else c.moveTo(x, y);
  }
  c.closePath();
}
/** One leafy mass, painted dark-to-light like a gouache background tree. */
function foliageBlob(c, cx, cy, r, P, o) {
  const leaf = o.leaf || 6, haze = o.haze || 0, hz = o.hazeCol || P.haze;
  const sq = o.sq || 0.88, glow = o.glow || 0, nt = o.tones || 5, bias = o.bias || 0;
  const cols = [P.tDark, P.tShade, P.tMid, P.tLit, P.tHi].map((col, k) => {
    if (glow && k >= 2) col = mixc(col, P.rim, glow * (k - 1) * 0.16);
    if (haze) col = mixc(col, hz, haze * (1 - k * 0.06));
    return col;
  });
  const s0 = rnd(100), si = (s0 * 7) | 0;
  // dark silhouette of the mass
  c.fillStyle = rgba(jit(cols[0], 4));
  noisyDisc(c, cx, cy, r * 0.84, s0, 0.26, sq); c.fill();
  // leaf clusters: tone chosen by facing-the-light + painterly noise, painted dark -> light
  const cs = leaf * 1.7, n = Math.ceil(r * r / (cs * cs) * 2.4), B = [[], [], [], [], []];
  for (let i = 0; i < n; i++) {
    const a = rnd(TAU), d = r * Math.sqrt(rnd());
    const nr = 0.8 + 0.3 * vnoise(Math.cos(a) * 1.7 + s0, Math.sin(a) * 1.7 + s0 * 1.3, 3);
    if (d > r * nr) continue;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * sq, dx = (x - cx) / r, dy = (y - cy) / (r * sq);
    const v = 0.4 + bias + 0.66 * (dx * LX + dy * LY) + 0.75 * (fbm(x / (leaf * 4.5), y / (leaf * 4.5), si, 2) - 0.5) + 0.1 * (1 - Math.hypot(dx, dy));
    const k = v < 0.1 ? 0 : v < 0.36 ? 1 : v < 0.6 ? 2 : v < 0.84 ? 3 : 4;
    B[Math.min(k, nt - 1)].push([x, y]);
  }
  const ox = -LX * leaf * 0.55, oy = -LY * leaf * 0.55;
  for (let k = 0; k < nt; k++) {
    const pts = B[k]; if (!pts.length) continue;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 0 && k === 0) continue;
      for (let v = 0; v < 2; v++) {
        c.fillStyle = rgba(jit(pass === 0 ? mixc(cols[k - 1], cols[k], 0.25) : cols[k], 7), 0.96);
        c.beginPath();
        for (let i = v; i < pts.length; i += 2) {
          const p = pts[i], m = 3 + (h2(i, k, si) * 2 | 0);
          for (let j = 0; j < m; j++) {
            const aa = h2(i, j, si + k) * TAU, dd = cs * 0.55 * h2(j, i, si + 1);
            const s = leaf * (0.65 + 0.55 * h2(i + j, k, si + 2)) * (pass ? 1 : 1.1);
            ellipsePath(c, p[0] + Math.cos(aa) * dd + (pass ? 0 : ox), p[1] + Math.sin(aa) * dd * sq + (pass ? 0 : oy), s, s * 0.62, aa * 1.7);
          }
        }
        c.fill();
      }
    }
  }
}
/** a mound made of several leafy masses (bush / tree crown) */
function foliageMass(c, blobs, P, o) {
  blobs.sort((a, b) => a[1] - b[1]);
  for (const b of blobs) foliageBlob(c, b[0], b[1], b[2], P, o);
}
function makeBlobs(cx, cy, w, h, n, rmin, rmax) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = rnd(-1, 1), top = Math.sqrt(Math.max(0, 1 - u * u));
    const r = rnd(rmin, rmax) * (0.75 + 0.35 * top);
    out.push([cx + u * (w / 2 - r * 0.5), cy - rnd(0.1, 1) * top * (h - r) - r * 0.2, r]);
  }
  return out;
}
function bladePath(c, x, y, h, lean, w) {
  const tx = x + lean * h, ty = y - h;
  c.moveTo(x - w / 2, y);
  c.quadraticCurveTo(x + lean * h * 0.35 - w * 0.2, y - h * 0.6, tx, ty);
  c.quadraticCurveTo(x + lean * h * 0.35 + w * 0.35, y - h * 0.55, x + w / 2, y);
}
function strokes(c, n, area, colFn, lenFn, wFn, alpha) {
  const bins = {};
  for (let i = 0; i < n; i++) {
    const pt = area(); if (!pt) continue;
    const col = colFn(pt[0], pt[1]); const key = (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0);
    (bins[key] = bins[key] || { col, items: [] }).items.push(pt);
  }
  for (const k in bins) {
    const b = bins[k];
    c.strokeStyle = rgba(b.col, alpha);
    c.beginPath();
    for (const pt of b.items) {
      const l = lenFn(pt[0], pt[1]), a = pt[2] || 0;
      c.moveTo(pt[0], pt[1]);
      c.quadraticCurveTo(pt[0] + Math.cos(a) * l * 0.5, pt[1] + Math.sin(a) * l * 0.5 + l * 0.08, pt[0] + Math.cos(a) * l, pt[1] + Math.sin(a) * l);
    }
    c.lineWidth = wFn(b.items[0][0], b.items[0][1]);
    c.stroke();
  }
}
const quant = (c, q) => [Math.round(c[0] / q) * q, Math.round(c[1] / q) * q, Math.round(c[2] / q) * q];
/** fine paper/pigment texture, baked into a painted layer */
function paperTexture(c, x, y, w, h, amt) {
  const tile = mkCanvas(128, 128), tc = tile.getContext('2d'), id = tc.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const px = i % 128, py = (i / 128) | 0;
    const v = 128 + (h2(px, py, 77) - 0.5) * 70 + (vnoise(px / 9, py / 9, 78) - 0.5) * 60;
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
  }
  tc.putImageData(id, 0, 0);
  c.save();
  c.globalCompositeOperation = 'overlay';   // only used on opaque layers
  c.globalAlpha = amt;
  const pat = c.createPattern(tile, 'repeat');
  c.fillStyle = pat; c.fillRect(x, y, w, h);
  c.restore();
}

/* ------------------------------------------------------------------ */
/*  Sky                                                                */
/* ------------------------------------------------------------------ */
function skyCol(P, x, y) {
  const t = clamp((y + 60) / 700, 0, 1);
  let c = t < 0.5 ? mixc(P.skyTop, P.skyMid, t / 0.5) : mixc(P.skyMid, P.skyLow, (t - 0.5) / 0.5);
  const d = Math.hypot(x - SUN.x, (y - SUN.y) * 1.3);
  c = mixc(c, P.skyWarm, clamp(1 - d / 950, 0, 1) * 0.8);
  return c;
}
function paintSky(c, P) {
  for (let y = -60; y < 680; y += 6) {
    const g = c.createLinearGradient(-60, 0, 1980, 0);
    for (let i = 0; i <= 8; i++) { const x = -60 + i * 255; g.addColorStop(i / 8, rgba(skyCol(P, x, y))); }
    c.fillStyle = g; c.fillRect(-60, y, 2040, 7);
  }
  // sun glow
  let g = c.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, 420);
  g.addColorStop(0, rgba(P.sunCore, 0.95)); g.addColorStop(0.08, rgba(P.sunCore, 0.75));
  g.addColorStop(0.3, rgba(P.skyWarm, 0.35)); g.addColorStop(1, rgba(P.skyWarm, 0));
  c.fillStyle = g; c.fillRect(SUN.x - 420, SUN.y - 420, 840, 840);
  // broad gouache strokes
  reseed(101);
  for (let i = 0; i < 340; i++) {
    const x = rnd(-60, 1980), y = rnd(-60, 650), l = rnd(120, 420);
    c.strokeStyle = rgba(jit(skyCol(P, x, y), 12), rnd(0.05, 0.12));
    c.lineWidth = rnd(8, 26);
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + l * 0.5, y + rnd(-8, 8), x + l, y + rnd(-6, 6)); c.stroke();
  }
  // faint cirrus combing in the high sky (left kept very soft)
  for (let i = 0; i < 70; i++) {
    const x = rnd(-40, 1300), y = rnd(40, 200) + x * 0.03, l = rnd(60, 220);
    c.strokeStyle = rgba(P.cloudHi, rnd(0.04, 0.11) * (x < 860 ? 0.7 : 1));
    c.lineWidth = rnd(1.5, 4);
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + l * 0.5, y - rnd(2, 8), x + l, y - rnd(0, 6)); c.stroke();
  }
}

/* ------------------------------------------------------------------ */
/*  Cumulus sprite: warm sunlit tops, cool bellies, sculpted puffs     */
/* ------------------------------------------------------------------ */
function makeCloud(P, S, d) {
  reseed(d.seed);
  const w = d.w, h = d.h, pad = Math.round(0.2 * w + 24), padY = Math.round(0.28 * h + 40);
  const cv = mkCanvas((w + pad * 2) * S, (h + padY * 2) * S), c = cv.getContext('2d');
  c.setTransform(S, 0, 0, S, (w / 2 + pad) * S, (h + padY) * S);
  const puffs = [], n = d.n || 46;
  for (let i = 0; i < n; i++) {
    const u = rnd(-0.95, 0.95);
    const top = -h * Math.pow(Math.max(0, 1 - u * u), d.flat ? 1.4 : 0.55) * (0.7 + 0.45 * fbm(u * 3 + d.seed, 1, 4, 3));
    const r = w * rnd(0.06, 0.15) * (d.flat ? 0.7 : 1);
    const y = lerp(Math.min(top + r, -r * 0.3), -r * 0.35, Math.pow(rnd(), 1.6));
    puffs.push([u * w / 2, y, r]);
  }
  puffs.sort((a, b) => a[1] - b[1]);
  // silhouette (crisp, like a painted cel of cloud)
  const sil = new Path2D();
  for (const p of puffs) { sil.moveTo(p[0] + p[2], p[1]); sil.arc(p[0], p[1], p[2], 0, TAU); }
  c.fillStyle = rgba(mixc(P.cloudShade, P.cloudBelly, 0.3)); c.fill(sil);
  c.save(); c.clip(sil);
  // soft sculpted volumes: each puff glows on its sun side
  for (const p of puffs) {
    const hf = clamp(-p[1] / h, 0, 1), side = clamp(0.5 + p[0] / w, 0, 1);
    const lx = p[0] + p[2] * 0.34, ly = p[1] - p[2] * 0.4;
    const g = c.createRadialGradient(lx, ly, 0, lx, ly, p[2] * 1.15);
    const lit = mixc(P.cloudMid, P.cloudLit, clamp(hf * 0.85 + side * 0.35, 0, 1));
    g.addColorStop(0, rgba(mixc(lit, P.cloudHi, hf * 0.6), 0.95));
    g.addColorStop(0.45, rgba(lit, 0.75)); g.addColorStop(0.8, rgba(P.cloudMid, 0.25)); g.addColorStop(1, rgba(P.cloudShade, 0));
    c.fillStyle = g; c.beginPath(); c.arc(p[0], p[1], p[2] * 1.15, 0, TAU); c.fill();
  }
  // shaded undersides between the billows
  for (const p of puffs) {
    const g = c.createRadialGradient(p[0] - p[2] * 0.5, p[1] + p[2] * 0.6, 0, p[0] - p[2] * 0.5, p[1] + p[2] * 0.6, p[2] * 0.7);
    g.addColorStop(0, rgba(P.cloudShade, 0.35)); g.addColorStop(1, rgba(P.cloudShade, 0));
    c.fillStyle = g; c.fillRect(p[0] - p[2] * 1.3, p[1] - p[2] * 0.2, p[2] * 1.6, p[2] * 1.6);
  }
  c.restore();
  // gouache dabs for texture
  c.save(); c.clip(sil);
  for (let i = 0; i < n * 10; i++) {
    const p = pick(puffs), a = rnd(TAU), rr = p[2] * Math.sqrt(rnd()) * 0.9;
    const x = p[0] + Math.cos(a) * rr, y = p[1] + Math.sin(a) * rr;
    const hf = clamp(-y / h, 0, 1);
    c.fillStyle = rgba(mixc(P.cloudShade, P.cloudLit, clamp(hf + (Math.cos(a) * 0.3 - Math.sin(a) * 0.3), 0, 1)), 0.12);
    c.beginPath(); c.ellipse(x, y, rnd(4, 10), rnd(3, 6), rnd(TAU), 0, TAU); c.fill();
  }
  c.restore();
  // cool belly & soft base
  c.globalCompositeOperation = 'source-atop';
  let g = c.createLinearGradient(0, -h * 0.45, 0, 0);
  g.addColorStop(0, rgba(P.cloudBelly, 0)); g.addColorStop(1, rgba(P.cloudBelly, 0.55));
  c.fillStyle = g; c.fillRect(-w, -h - padY, w * 2, h + padY * 2);
  c.globalCompositeOperation = 'destination-out';
  g = c.createLinearGradient(0, -h * 0.12, 0, padY * 0.3);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g; c.fillRect(-w, -h * 0.12, w * 2, h);
  c.globalCompositeOperation = 'source-over';
  return { cv, x: d.x - w / 2 - pad, y: d.y - h - padY, w: w + pad * 2, h: h + padY * 2, d };
}

/* ------------------------------------------------------------------ */
/*  Far landscape: hills, hazy tree line, the mid-ground right bank    */
/* ------------------------------------------------------------------ */
const ridgeA = (x) => 478 + 44 * (fbm(x / 430, 0.5, 11, 4) - 0.5) * 2 + 42 * (1 - sstep(80, 760, x)) - 46 * Math.exp(-Math.pow((x - 870) / 240, 2)) - 40 * sstep(1250, 1800, x);
const ridgeB = (x) => 530 + 18 * (fbm(x / 260, 1.5, 12, 4) - 0.5) * 2 + 24 * (1 - sstep(0, 640, x)) - 30 * Math.exp(-Math.pow((x - 1250) / 190, 2)) - 18 * Math.exp(-Math.pow((x - 520) / 130, 2));
function paintFar(c, P) {
  reseed(202);
  // ridge A (farthest, nearly sky-coloured)
  c.beginPath(); c.moveTo(-60, 760);
  for (let x = -60; x <= 1980; x += 10) c.lineTo(x, ridgeA(x));
  c.lineTo(1980, 760); c.closePath();
  const farTop = mixc(skyCol(P, 700, 470), [92, 132, 182], 0.34), farBot = mixc(farTop, skyCol(P, 700, 600), 0.45);
  let g = c.createLinearGradient(0, 420, 0, 600);
  g.addColorStop(0, rgba(farTop)); g.addColorStop(1, rgba(farBot));
  c.fillStyle = g; c.fill();
  // a soft lighter rim where the ridge meets the sky (no hard line)
  g = c.createLinearGradient(0, 430, 0, 520);
  c.save(); c.clip();
  for (let x = -60; x <= 1980; x += 40) {
    const y = ridgeA(x);
    const gg = c.createLinearGradient(0, y, 0, y + 14);
    gg.addColorStop(0, rgba(mixc(farTop, skyCol(P, x, y), 0.6), 0.6)); gg.addColorStop(1, rgba(farTop, 0));
    c.fillStyle = gg; c.fillRect(x, y - 2, 41, 16);
  }
  c.restore();
  for (let i = 0; i < 900; i++) {
    const x = rnd(-60, 1980), y = ridgeA(x) + rnd(10, 70);
    c.fillStyle = rgba(jit(mixc(farTop, P.hillNear, 0.3), 6), 0.1);
    c.beginPath(); c.ellipse(x, y, rnd(3, 8), rnd(2, 4), 0, 0, TAU); c.fill();
  }
  // ridge B: forested blue hills
  c.beginPath(); c.moveTo(-60, 760);
  for (let x = -60; x <= 1980; x += 8) c.lineTo(x, ridgeB(x));
  c.lineTo(1980, 760); c.closePath();
  g = c.createLinearGradient(0, 480, 0, 620);
  g.addColorStop(0, rgba(P.hillNear)); g.addColorStop(1, rgba(mixc(P.hillNear, P.haze, 0.45)));
  c.fillStyle = g; c.fill();
  for (let i = 0; i < 2600; i++) {
    const x = rnd(-60, 1980), y = ridgeB(x) + rnd(-2, 70);
    const lit = rnd() < 0.45;
    c.fillStyle = rgba(jit(lit ? mixc(P.hillNear, P.hillLit, 0.35) : mixc(P.hillNear, P.tShade, 0.25), 6), lit ? 0.35 : 0.3);
    c.beginPath(); c.ellipse(x, y, rnd(2.5, 5.5), rnd(2, 4), 0, 0, TAU); c.fill();
  }
  c.strokeStyle = rgba(P.hillLit, 0.35); c.lineWidth = 1.6;
  c.beginPath(); for (let x = 600; x <= 1980; x += 8) { const y = ridgeB(x) + 1; if (x === 600) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke();

  // right mid-ground: trees on the near bank, behind the leaning tree
  const midBlobs = [];
  const mids = [[1215, 585, 30], [1262, 560, 46], [1335, 532, 62], [1440, 512, 72], [1560, 492, 80], [1690, 486, 88],
    [1820, 478, 92], [1950, 488, 90], [1300, 600, 38], [1395, 610, 44], [1505, 618, 50], [1630, 628, 56], [1760, 632, 60], [1900, 640, 66]];
  c.fillStyle = rgba(mixc(P.tDark, P.haze, 0.12));
  c.beginPath(); c.moveTo(1185, 602); c.lineTo(1240, 570); c.lineTo(1400, 540); c.lineTo(1980, 520); c.lineTo(1980, 740); c.lineTo(1185, 740); c.closePath(); c.fill();
  for (const m of mids) for (const b of makeBlobs(m[0], m[1] + m[2] * 0.6, m[2] * 2.1, m[2] * 1.8, 5, m[2] * 0.35, m[2] * 0.6)) midBlobs.push(b);
  foliageMass(c, midBlobs, P, { leaf: 5, haze: 0.18, lb: 1.1 });

  // far tree line along the opposite bank
  const crowns = [];
  for (let x = -70; x < 1240;) {
    const near = sstep(700, 1150, x), left = 1 - sstep(0, 700, x);
    const r = lerp(14, 26, near) * rnd(0.75, 1.3);
    const base = farWater(x) - 3;
    const ht = lerp(lerp(18, 30, 1 - left), 62, near) * rnd(0.7, 1.25);
    const tall = rnd() < 0.12;
    crowns.push([x, base - ht * (tall ? 1.5 : 1), r * (tall ? 0.8 : 1), base, lerp(0.55, 0.32, near) + left * 0.05]);
    x += r * rnd(0.9, 1.5);
  }
  // understory fill
  c.beginPath(); c.moveTo(-70, farWater(-70));
  for (const cr of crowns) c.lineTo(cr[0], cr[1] + cr[2] * 0.6);
  c.lineTo(1240, farWater(1240)); c.closePath();
  c.fillStyle = rgba(mixc(P.tShade, P.haze, 0.45)); c.fill();
  crowns.sort((a, b) => a[1] - b[1]);
  for (const cr of crowns) {
    const n = 3 + (rnd() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const rr = cr[2] * rnd(0.55, 0.85);
      foliageBlob(c, cr[0] + rnd(-cr[2], cr[2]) * 0.6, lerp(cr[1], cr[3] - rr, i / n * 0.7) + rnd(-4, 4), rr, P,
        { leaf: lerp(3, 4.2, 1 - cr[4]), haze: cr[4], tones: 4 });
    }
  }
  // sunlit strip of grass / sand at the far water's edge
  c.lineWidth = 2.2; c.strokeStyle = rgba(mixc(P.gLit, P.haze, 0.45), 0.85);
  c.beginPath(); for (let x = -60; x <= 1190; x += 6) { const y = farWater(x) - 1.5; if (x === -60) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke();
  // sand bar for the heron
  c.fillStyle = rgba(mixc(P.rockLit, P.haze, 0.25));
  c.beginPath(); c.ellipse(1010, farWater(1010) + 0.5, 42, 3.6, 0, 0, TAU); c.fill();
  // haze over the left — keeps the text side calm
  c.globalCompositeOperation = 'source-atop';
  g = c.createLinearGradient(-60, 0, 1300, 0);
  g.addColorStop(0, rgba(P.haze, 0.42)); g.addColorStop(0.55, rgba(P.haze, 0.18)); g.addColorStop(1, rgba(P.haze, 0));
  c.fillStyle = g; c.fillRect(-60, 360, 2040, 400);
  g = c.createLinearGradient(0, 430, 0, 620);
  g.addColorStop(0, rgba(P.skyLow, 0.12)); g.addColorStop(1, rgba(P.skyLow, 0));
  c.fillStyle = g; c.fillRect(-60, 360, 2040, 400);
  c.globalCompositeOperation = 'source-over';
}

/* ------------------------------------------------------------------ */
/*  Water: painted tint over animated reflections                      */
/* ------------------------------------------------------------------ */
function paintWaterTint(c, P, wpath) {
  reseed(303);
  c.save(); c.clip(wpath);
  let g = c.createLinearGradient(0, 600, 0, 1100);
  g.addColorStop(0, rgba(P.skyLow, 0.12)); g.addColorStop(0.18, rgba(P.wMid, 0.2));
  g.addColorStop(0.55, rgba(P.wMid, 0.4)); g.addColorStop(1, rgba(P.wDeep, 0.62));
  c.fillStyle = g; c.fillRect(-80, 580, 2100, 600);
  // open sky over still water on the left
  g = c.createLinearGradient(0, 0, 1000, 0);
  g.addColorStop(0, rgba(P.skyMid, 0.16)); g.addColorStop(1, rgba(P.skyMid, 0));
  c.fillStyle = g; c.fillRect(-80, 600, 1100, 560);
  // shallows: riverbed showing through near the right bank and the fisher
  for (let y = 640; y < 1160; y += 4) {
    const bx = bankX(y), wdt = lerp(60, 330, persp(y));
    g = c.createLinearGradient(bx - wdt, 0, bx, 0);
    g.addColorStop(0, rgba(P.wShallow, 0)); g.addColorStop(0.7, rgba(P.wShallow, 0.3)); g.addColorStop(1, rgba(P.wShallow, 0.55));
    c.fillStyle = g; c.fillRect(bx - wdt, y, wdt + 4, 4.5);
  }
  for (let i = 0; i < 700; i++) {
    const y = rnd(700, 1150), bx = bankX(y), x = bx - Math.pow(rnd(), 1.6) * lerp(60, 340, persp(y));
    const p = persp(y), r = lerp(1.5, 7, p) * rnd(0.6, 1.4);
    c.fillStyle = rgba(jit(rnd() < 0.5 ? P.rock : P.soil, 14), 0.12 + 0.12 * (1 - (bx - x) / 340));
    c.beginPath(); c.ellipse(x, y, r, r * 0.45, 0, 0, TAU); c.fill();
  }
  // canopy shadow lying on the water around the fisher
  g = c.createRadialGradient(1380, 760, 20, 1380, 760, 330);
  g.addColorStop(0, rgba(P.wDark, 0.22)); g.addColorStop(1, rgba(P.wDark, 0));
  c.fillStyle = g; c.beginPath(); c.ellipse(1380, 760, 360, 140, 0, 0, TAU); c.fill();
  // horizontal gouache strokes
  for (let i = 0; i < 900; i++) {
    const y = rnd(612, 1150), x = rnd(-80, 1750);
    if (!inWater(x, y)) continue;
    const p = persp(y), lt = rnd() < 0.5, left = x < 860 ? 0.6 : 1;
    c.strokeStyle = rgba(jit(lt ? mixc(P.wMid, P.skyMid, 0.6) : P.wDeep, 8), rnd(0.04, 0.1) * left);
    c.lineWidth = lerp(0.6, 4.5, p) * rnd(0.6, 1.3);
    const l = lerp(14, 150, p) * rnd(0.5, 1.4);
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + l / 2, y + rnd(-1, 1) * p * 3, x + l, y); c.stroke();
  }
  // bright line where the water meets the far bank
  c.strokeStyle = rgba(P.skyLow, 0.55); c.lineWidth = 1.4;
  c.beginPath(); for (let x = -80; x <= 1186; x += 6) { const y = farWater(x) + 1.6; if (x === -80) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke();
  c.restore();
}
function paintReflection(c, P, L) {
  c.save();
  c.translate(0, 1226); c.scale(1, -1);
  const blur = 'filter' in c;
  if (blur) c.filter = 'blur(1.6px)';
  c.drawImage(L.sky.cv, L.sky.x, L.sky.y, L.sky.w, L.sky.h);
  c.drawImage(L.far.cv, L.far.x, L.far.y, L.far.w, L.far.h);
  if (blur) c.filter = 'none';
  c.restore();
  // the dark green of the near bank & leaning tree mirrored along the right shore
  for (let y = 600; y < 1150; y += 4) {
    const bx = bankX(y), wd = lerp(30, 150, persp(y));
    const g = c.createLinearGradient(bx - wd, 0, bx, 0);
    g.addColorStop(0, rgba(P.tShade, 0)); g.addColorStop(1, rgba(P.tDark, 0.75));
    c.fillStyle = g; c.fillRect(bx - wd, y, wd + 3, 4.5);
  }
  // reflections are darker and greener than the things they mirror
  c.globalCompositeOperation = 'multiply';
  const g = c.createLinearGradient(0, 600, 0, 1100);
  g.addColorStop(0, rgba(mixc([255, 255, 255], P.wMid, 0.25))); g.addColorStop(1, rgba(mixc([255, 255, 255], P.wMid, 0.55)));
  c.fillStyle = g; c.fillRect(-80, 580, 2100, 600);
  c.globalCompositeOperation = 'source-over';
}

/* ------------------------------------------------------------------ */
/*  Near bank: ground, soil edge, rocks, flowers                       */
/* ------------------------------------------------------------------ */
const ROCKS = [
  { x: 1236, y: 906, w: 46, h: 22, water: 1 }, { x: 1168, y: 762, w: 22, h: 9, water: 1 },
  { x: 1486, y: 1000, w: 74, h: 34, water: 1 }, { x: 1592, y: 872, w: 100, h: 30, water: 0 },
  { x: 1048, y: 1072, w: 36, h: 14, water: 1 },
];
function paintRock(c, P, r) {
  const s = rnd(100), pts = [];
  for (let i = 0; i < 14; i++) {
    const a = Math.PI + i / 13 * Math.PI;
    const rr = 1 + 0.12 * (vnoise(Math.cos(a) * 2 + s, Math.sin(a) * 2, 7) - 0.5) * 2;
    pts.push([r.x + Math.cos(a) * r.w / 2 * rr, r.y + Math.sin(a) * r.h * rr]);
  }
  pts.push([r.x + r.w / 2, r.y + r.h * 0.12], [r.x - r.w / 2, r.y + r.h * 0.12]);
  c.fillStyle = rgba(P.rockShade); c.beginPath(); spline(c, pts, true); c.fill();
  c.save(); c.clip();
  c.fillStyle = rgba(P.rock);
  c.beginPath(); spline(c, pts, true, r.w * 0.08, -r.h * 0.28); c.fill();
  c.fillStyle = rgba(P.rockLit, 0.9);
  c.beginPath(); spline(c, pts, true, r.w * 0.16, -r.h * 0.62); c.fill();
  for (let i = 0; i < r.w * 0.8; i++) {
    c.fillStyle = rgba(jit(rnd() < 0.5 ? P.moss : P.rockShade, 12), 0.35);
    c.beginPath(); c.ellipse(r.x + rnd(-r.w / 2, r.w / 2), r.y - r.h * rnd(0.1, 0.9), rnd(1, 3.5), rnd(0.8, 2), 0, 0, TAU); c.fill();
  }
  c.restore();
  // wet band at the waterline + bright edge
  c.fillStyle = rgba(P.wDark, 0.6);
  c.beginPath(); c.ellipse(r.x, r.y + r.h * 0.1, r.w * 0.52, r.h * 0.16, 0, 0, TAU); c.fill();
  c.strokeStyle = rgba(P.wHi, 0.55); c.lineWidth = 1.2;
  c.beginPath(); c.ellipse(r.x, r.y + r.h * 0.14, r.w * 0.56, r.h * 0.2, 0, 0.1, Math.PI - 0.1); c.stroke();
}
function paintBank(c, P) {
  reseed(404);
  const top = [[1185, 598], [1232, 611], [1300, 628], [1380, 646], [1450, 664], [1530, 684], [1640, 694], [1760, 700], [1990, 696]];
  const poly = new Path2D();
  poly.moveTo(BANK[0][0], BANK[0][1]);
  for (const b of BANK) poly.lineTo(b[0], b[1]);
  poly.lineTo(1990, 1160); poly.lineTo(1990, 680);
  for (let i = top.length - 1; i >= 0; i--) poly.lineTo(top[i][0], top[i][1]);
  poly.closePath();
  let g = c.createLinearGradient(0, 600, 0, 1100);
  g.addColorStop(0, rgba(mixc(P.gLit, P.haze, 0.1))); g.addColorStop(0.35, rgba(P.gMid)); g.addColorStop(1, rgba(P.gShade));
  c.fillStyle = g; c.fill(poly);
  // soil edge along the waterline
  const outer = BANK.map((b) => [b[0], b[1]]), inner = BANK.map((b) => [b[0] + lerp(5, 26, persp(b[1])) * rnd(0.6, 1.4), b[1] - lerp(2, 9, persp(b[1])) * rnd(0.5, 1.3)]);
  c.fillStyle = rgba(P.soil);
  c.beginPath(); c.moveTo(outer[0][0], outer[0][1]);
  for (const p of outer) c.lineTo(p[0], p[1]);
  for (let i = inner.length - 1; i >= 0; i--) c.lineTo(inner[i][0], inner[i][1]);
  c.closePath(); c.fill();
  c.strokeStyle = rgba(P.soilDark, 0.8); c.lineWidth = 2.2;
  c.beginPath(); for (let i = 0; i < outer.length; i++) { const p = outer[i]; if (i) c.lineTo(p[0] + 1, p[1]); else c.moveTo(p[0] + 1, p[1]); } c.stroke();
  for (let i = 0; i < 160; i++) {
    const y = rnd(610, 1150), x = bankX(y) + rnd(-3, lerp(6, 24, persp(y))), p = persp(y);
    c.fillStyle = rgba(jit(rnd() < 0.5 ? P.rockLit : P.rock, 15), 0.85);
    c.beginPath(); c.ellipse(x, y, lerp(1, 4, p) * rnd(0.6, 1.4), lerp(0.6, 2.4, p), 0, 0, TAU); c.fill();
  }
  c.save(); c.clip(poly);
  // shade under the tree + sun patches
  g = c.createRadialGradient(1800, 880, 30, 1800, 880, 330);
  g.addColorStop(0, rgba(P.tDark, 0.55)); g.addColorStop(1, rgba(P.tDark, 0));
  c.fillStyle = g; c.fillRect(1400, 600, 600, 560);
  const light = (x, y) => clamp(fbm(x / 140, y / 90, 41, 3) * 1.6 - 0.45 - (y - 650) / 900 - Math.max(0, 1 - Math.hypot(x - 1800, y - 880) / 300) * 0.6, 0, 1);
  strokes(c, 5200, () => { const x = rnd(1180, 1990), y = rnd(596, 1160); return y > 596 && x > bankX(y) - 4 ? [x, y, -Math.PI / 2 + rnd(-0.5, 0.35)] : null; },
    (x, y) => quant(jit(mixc(mixc(P.gShade, P.gMid, clamp(1 - (y - 680) / 420, 0, 1)), P.gLit, light(x, y)), 8), 12),
    (x, y) => lerp(3, 16, persp(y)) * rnd(0.6, 1.3), (x, y) => lerp(0.8, 2.2, persp(y)), 0.75);
  // sunlit patches on top
  for (let i = 0; i < 160; i++) {
    const x = rnd(1200, 1980), y = rnd(610, 820);
    if (x < bankX(y) || light(x, y) < 0.4) continue;
    c.fillStyle = rgba(jit(P.gLit, 10), 0.35);
    c.beginPath(); c.ellipse(x, y, rnd(8, 24), rnd(2, 5), 0, 0, TAU); c.fill();
  }
  // wildflowers
  const fl = [[255, 252, 240], [250, 222, 110], [232, 170, 190], [190, 170, 230]];
  for (let i = 0; i < 70; i++) {
    const cx = rnd(1250, 1960), cy = rnd(640, 1100);
    if (cx < bankX(cy) + 10) continue;
    const col = pick(fl), p = persp(cy);
    for (let j = 0; j < 6; j++) {
      const x = cx + rnd(-14, 14) * (0.4 + p), y = cy + rnd(-4, 4) * (0.4 + p), r = lerp(0.8, 2.6, p) * rnd(0.7, 1.2);
      c.fillStyle = rgba(col, 0.9); c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
      c.fillStyle = rgba(P.rim, 0.6); c.beginPath(); c.arc(x + r * 0.3, y - r * 0.3, r * 0.45, 0, TAU); c.fill();
    }
  }
  c.restore();
  for (const r of ROCKS) paintRock(c, P, r);
  // foreground mound in the bottom-left corner (soft, low contrast)
  c.fillStyle = rgba(mixc(P.gShade, P.wDeep, 0.3));
  c.beginPath(); c.moveTo(-70, 1160); c.lineTo(-70, 1076);
  c.bezierCurveTo(40, 1062, 160, 1072, 250, 1100); c.bezierCurveTo(300, 1115, 330, 1140, 340, 1160); c.closePath(); c.fill();
  strokes(c, 500, () => { const x = rnd(-70, 330), y = rnd(1070, 1160); return [x, y, -Math.PI / 2 + rnd(-0.4, 0.4)]; },
    (x, y) => quant(jit(mixc(P.gShade, P.gMid, rnd(0.6)), 8), 12), () => rnd(6, 18), () => 2.2, 0.6);
}

/* ------------------------------------------------------------------ */
/*  The old leaning tree: trunk, limbs, roots                          */
/* ------------------------------------------------------------------ */
const LIMBS = [
  { p: [[1792, 880], [1782, 700], [1702, 520], [1612, 392]], w: [84, 46] },          // trunk
  { p: [[1626, 400], [1500, 326], [1352, 292], [1168, 258]], w: [32, 7] },           // long limb over water
  { p: [[1612, 392], [1606, 250], [1584, 110], [1560, -70]], w: [36, 14] },          // up
  { p: [[1640, 384], [1726, 300], [1830, 236], [1990, 170]], w: [28, 10] },          // right
  { p: [[1420, 300], [1360, 330], [1318, 372], [1300, 408]], w: [9, 3] },            // drooping twig
  { p: [[1560, 330], [1540, 300], [1520, 272], [1500, 250]], w: [12, 6] },
  { p: [[1600, 180], [1680, 120], [1760, 70], [1850, 30]], w: [12, 4] },
  { p: [[1350, 290], [1290, 230], [1240, 200], [1200, 160]], w: [8, 3] },
  { p: [[1794, 860], [1740, 868], [1700, 890], [1660, 902]], w: [26, 4] },           // roots
  { p: [[1800, 860], [1846, 880], [1890, 900], [1940, 920]], w: [26, 5] },
];
const bez = (p, t) => { const u = 1 - t; return [u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0], u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1]]; };
function limbOutline(l) {
  const L = [], Rr = [], N = 18;
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = bez(l.p, t), b = bez(l.p, Math.min(1, t + 0.01)), a0 = bez(l.p, Math.max(0, t - 0.01));
    let dx = b[0] - a0[0], dy = b[1] - a0[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const w = lerp(l.w[0], l.w[1], Math.pow(t, 0.8)) / 2 * (1 + 0.08 * Math.sin(t * 19 + l.w[0]));
    L.push([a[0] - dy * w, a[1] + dx * w]); Rr.push([a[0] + dy * w, a[1] - dx * w]);
  }
  return L.concat(Rr.reverse());
}
function paintTrunk(c, P) {
  reseed(505);
  for (const l of LIMBS) {
    const pts = limbOutline(l);
    const path = new Path2D(); spline(path, pts, true);
    c.fillStyle = rgba(P.barkShade); c.fill(path);
    c.save(); c.clip(path);
    const s = l.w[0] * 0.18 + 1.5;
    const lit = new Path2D(); spline(lit, pts, true, s * 1.1, -s * 0.9);
    c.fillStyle = rgba(P.bark); c.fill(lit);
    // bark strokes along the limb
    for (let i = 0; i < l.w[0] * 9; i++) {
      const t = rnd(), a = bez(l.p, t), w = lerp(l.w[0], l.w[1], t) / 2;
      const b = bez(l.p, Math.min(1, t + 0.03));
      const o = rnd(-w, w);
      c.strokeStyle = rgba(jit(rnd() < 0.6 ? P.barkShade : mixc(P.bark, P.rockLit, 0.3), 10), rnd(0.25, 0.6));
      c.lineWidth = rnd(0.8, 2.4);
      c.beginPath(); c.moveTo(a[0] + o * 0.9, a[1]); c.lineTo(b[0] + o, b[1] + rnd(-1, 1)); c.stroke();
    }
    // moss on the upper sides
    for (let i = 0; i < l.w[0] * 3; i++) {
      const t = rnd(0, 0.9), a = bez(l.p, t), w = lerp(l.w[0], l.w[1], t) / 2;
      c.fillStyle = rgba(jit(rnd() < 0.5 ? P.moss : P.tLit, 10), 0.5);
      c.beginPath(); c.ellipse(a[0] + rnd(-w, w) * 0.6 + w * 0.3, a[1] - w * rnd(0.3, 0.9), rnd(1.5, 5), rnd(1, 3), 0, 0, TAU); c.fill();
    }
    // warm rim where the low sun grazes the bark
    const rim = new Path2D(); spline(rim, pts, true); spline(rim, pts, true, -2.2, 1.8);
    c.fillStyle = rgba(P.barkRim, 0.85); c.fill(rim, 'evenodd');
    c.restore();
  }
  // knots
  for (const k of [[1752, 640, 7], [1680, 470, 5], [1770, 760, 6]]) {
    c.fillStyle = rgba(P.barkShade, 0.9); c.beginPath(); c.ellipse(k[0], k[1], k[2], k[2] * 1.5, 0.4, 0, TAU); c.fill();
    c.strokeStyle = rgba(P.bark, 0.8); c.lineWidth = 1.5; c.beginPath(); c.ellipse(k[0] + 1, k[1] - 1, k[2] * 1.4, k[2] * 1.9, 0.4, 3.6, 6); c.stroke();
  }
}

/* ------------------------------------------------------------------ */
/*  Sprites: canopy clumps, bushes, grass tufts, ferns                 */
/* ------------------------------------------------------------------ */
function sprite(w, h, ax, ay, S, fn) {
  const pad = 6, cv = mkCanvas((w + pad * 2) * S, (h + pad * 2) * S), c = cv.getContext('2d');
  c.setTransform(S, 0, 0, S, (ax + pad) * S, (ay + pad) * S);
  c.lineCap = 'round'; c.lineJoin = 'round';
  fn(c);
  return { cv, ox: -(ax + pad), oy: -(ay + pad), w: w + pad * 2, h: h + pad * 2 };
}
function makeClump(P, S, d) {
  reseed(d.seed);
  const r = d.r;
  return sprite(r * 2.6, r * 2.4, r * 1.3, r * 1.2, S, (c) => {
    const bl = makeBlobs(0, r * 0.75, r * 2.2, r * 2, d.n || 7, r * 0.32, r * 0.55);
    const glow = clamp(1 - Math.hypot(d.x - SUN.x, d.y - SUN.y) / 420, 0, 1);
    foliageMass(c, bl, P, { leaf: d.leaf || 6.5, glow, lb: 1 });
  });
}
function makeBush(P, S, d) {
  reseed(d.seed);
  return sprite(d.w + 20, d.h + 20, d.w / 2 + 10, d.h + 6, S, (c) => {
    const bl = makeBlobs(0, -2, d.w, d.h, d.n || 8, d.h * 0.22, d.h * 0.38);
    foliageMass(c, bl, P, { leaf: d.leaf || 5, haze: d.haze || 0, lb: 1 });
    if (d.flowers) {
      for (let i = 0; i < d.flowers; i++) {
        const x = rnd(-d.w / 2, d.w / 2) * 0.8, y = -rnd(0.2, 0.85) * d.h;
        c.fillStyle = rgba(pick([[255, 250, 238], [248, 226, 120]]), 0.95);
        c.beginPath(); c.arc(x, y, rnd(1.4, 2.6), 0, TAU); c.fill();
      }
    }
  });
}
function makeTuft(P, S, d) {
  reseed(d.seed);
  return sprite(d.w + 90, d.h * 1.75 + 12, d.w / 2 + 45, d.h * 1.5 + 6, S, (c) => {
    const n = d.n || 40;
    // blades root at slightly different depths so the clump has no hard straight base
    const root = (x, pass) => d.h * (0.04 + 0.16 * Math.pow(rnd(), 1.5)) * (1 - Math.abs(x) / d.w) * (pass === 0 ? 1 : 0.7);
    for (let pass = 0; pass < 3; pass++) {
      const base = pass === 0 ? mixc(P.gShade, P.gMid, 0.35) : pass === 1 ? P.gMid : P.gLit;
      for (let v = 0; v < 3; v++) {
        c.fillStyle = rgba(jit(mixc(base, d.dark ? P.wDeep : base, d.dark ? 0.45 : 0), 10), 0.95);
        c.beginPath();
        for (let i = 0; i < n / 9; i++) {
          const x = rnd(-d.w / 2, d.w / 2), h = d.h * rnd(0.35, 1) * (1 - Math.abs(x) / d.w * 0.8) * (pass === 2 ? 0.8 : 1);
          const r0 = root(x, pass);
          bladePath(c, x, r0, h + r0 * 0.6, rnd(-0.35, 0.35) + x / d.w * 0.4, rnd(1.6, 3.6) * (d.h / 90 + 0.4));
        }
        c.fill();
      }
    }
    if (d.seedHeads) {
      c.strokeStyle = rgba(P.rim, 0.75); c.lineWidth = 1;
      for (let i = 0; i < d.seedHeads; i++) {
        const x = rnd(-d.w / 2, d.w / 2) * 0.7, h = d.h * rnd(0.9, 1.25), tx = x + rnd(-6, 6);
        c.beginPath(); c.moveTo(x, 0); c.quadraticCurveTo(x, -h * 0.6, tx, -h); c.stroke();
        c.fillStyle = rgba(mixc(P.gLit, P.rim, 0.5), 0.95);
        c.beginPath(); c.ellipse(tx, -h, 1.8, 5, rnd(-0.3, 0.3), 0, TAU); c.fill();
      }
    }
  });
}
function makeFern(P, S, d) {
  reseed(d.seed);
  return sprite(d.s * 2.4, d.s * 1.3, d.s * 1.2, d.s * 1.2, S, (c) => {
    for (let f = 0; f < 7; f++) {
      const ang = lerp(-2.6, -0.5, f / 6) + rnd(-0.12, 0.12), len = d.s * rnd(0.75, 1.1);
      const col = f % 2 ? P.tMid : mixc(P.tMid, P.tLit, 0.6);
      c.strokeStyle = rgba(P.tShade); c.lineWidth = 1.2;
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14, a = ang + t * 0.9 * (ang < -1.57 ? -0.6 : 0.6) + t * t * 0.9;
        pts.push([Math.cos(ang) * len * t * 0.9 + Math.cos(a) * 2, Math.sin(ang) * len * t + t * t * len * 0.55]);
      }
      c.beginPath(); c.moveTo(0, 0); for (const p of pts) c.lineTo(p[0], p[1]); c.stroke();
      c.fillStyle = rgba(jit(col, 8));
      c.beginPath();
      for (let i = 1; i < 14; i++) {
        const p = pts[i], q = pts[i + 1], t = i / 14, l = len * 0.16 * Math.sin(t * Math.PI) + 2;
        const dx = q[0] - p[0], dy = q[1] - p[1], dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
        ellipsePath(c, p[0] + nx * l * 0.5, p[1] + ny * l * 0.5 + 1, l * 0.55, 1.8, Math.atan2(ny, nx) + 0.5);
        ellipsePath(c, p[0] - nx * l * 0.5, p[1] - ny * l * 0.5 + 1, l * 0.55, 1.8, Math.atan2(-ny, -nx) - 0.5);
      }
      c.fill();
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Light: god rays, soft spot, fish shadow, film grain                */
/* ------------------------------------------------------------------ */
function makeRays(P, S, seedN) {
  reseed(seedN);
  const s = S * 0.5, x = 700, y = 100, w = 1280, h = 1000;
  return mkLayer(x, y, w, h, s, (c) => {
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const a = rnd(1.95, 2.55), spread = rnd(0.012, 0.035), len = rnd(650, 950), al = rnd(0.05, 0.1);
      for (let k = 0; k < 6; k++) {
        const sp = spread * (0.5 + k * 0.3);
        const g = c.createLinearGradient(SUN.x, SUN.y, SUN.x + Math.cos(a) * len, SUN.y + Math.sin(a) * len);
        g.addColorStop(0, rgba(P.glow, 0)); g.addColorStop(0.15, rgba(P.glow, al / (1 + k * 0.5)));
        g.addColorStop(1, rgba(P.glow, 0));
        c.fillStyle = g;
        c.beginPath(); c.moveTo(SUN.x, SUN.y);
        c.lineTo(SUN.x + Math.cos(a - sp) * len, SUN.y + Math.sin(a - sp) * len);
        c.lineTo(SUN.x + Math.cos(a + sp) * len, SUN.y + Math.sin(a + sp) * len);
        c.closePath(); c.fill();
      }
    }
  });
}
function softSpot(col, size) {
  const cv = mkCanvas(size, size), c = cv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba(col, 1)); g.addColorStop(0.45, rgba(col, 0.55)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  return cv;
}
function fishShadowSprite(P) {
  const cv = mkCanvas(96, 40), c = cv.getContext('2d');
  if ('filter' in c) c.filter = 'blur(3px)';
  c.fillStyle = rgba(P.wDark, 1);
  c.beginPath(); c.ellipse(46, 20, 26, 7, 0, 0, TAU); c.fill();
  c.beginPath(); c.moveTo(70, 20); c.lineTo(88, 12); c.lineTo(86, 28); c.closePath(); c.fill();
  return cv;
}
function grainTiles(n) {
  const out = [];
  reseed(909);
  for (let k = 0; k < n; k++) {
    const cv = mkCanvas(160, 160), c = cv.getContext('2d'), id = c.createImageData(160, 160);
    for (let i = 0; i < 160 * 160; i++) {
      const v = 128 + (R() + R() + R() - 1.5) * 120;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    c.putImageData(id, 0, 0); out.push(cv);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Wind: coherent gusts rolling across the frame, left -> right       */
/* ------------------------------------------------------------------ */
// [time, strength]: four proper gusts plus light breezes in between, all rolling left → right
const GUSTS = [[5, 0.95], [10.5, 0.42], [16, 0.95], [22.5, 0.38], [28, 0.45], [33.5, 0.4], [39.5, 0.95], [46, 0.42], [53, 0.95], [57.8, 0.36]];
const gustShape = (d) => { if (d <= 0 || d >= 22) return 0; const q = d / 0.8; return (q * q / (1 + q * q)) * Math.exp(-d / 2.6); };
function wind(x, t) {
  const tt = t - (x + 120) / 330;
  let g = 0;
  for (const G of GUSTS) g += G[1] * gustShape(wrapd(tt - G[0]));
  return 0.28 + 0.12 * pn(tt, 3, 2) + g;
}

/* ------------------------------------------------------------------ */
/*  Layout: everything that moves, seeded once                         */
/* ------------------------------------------------------------------ */
function buildLayout() {
  const Y = {};
  Y.clouds = [
    { x: 960, y: 498, w: 660, h: 300, seed: 11, n: 60, amp: 9, ph: 0.3, v: 3.2 },
    { x: 1330, y: 468, w: 400, h: 210, seed: 12, n: 40, amp: 7, ph: 2.1, v: 4.2 },
    { x: 300, y: 372, w: 320, h: 64, flat: 1, seed: 13, n: 30, amp: 11, ph: 4.0, alpha: 0.7, v: 7.5 },
    { x: 640, y: 262, w: 230, h: 42, flat: 1, seed: 14, n: 22, amp: 8, ph: 1.0, alpha: 0.55, v: 9.5 },
    { x: 110, y: 486, w: 380, h: 92, flat: 1, seed: 15, n: 34, amp: 6, ph: 5.0, alpha: 0.85, v: 5.5 },
  ];
  Y.clumps = [
    [1185, 262, 58], [1250, 212, 70], [1300, 300, 62], [1255, 338, 44], [1330, 372, 46], [1370, 232, 74], [1440, 300, 58],
    [1150, 190, 42], [1250, 118, 52], [1340, 128, 64], [1420, 56, 78], [1530, 36, 90], [1600, 150, 72], [1560, 282, 56],
    [1680, 252, 80], [1700, 88, 95], [1820, 38, 100], [1800, 190, 95], [1930, 108, 100], [1820, 330, 70], [1900, 292, 92],
    [1960, 430, 84], [1930, 530, 62],
  ].map((c, i) => ({ x: c[0], y: c[1], r: c[2] * 1.22, seed: 300 + i, k: 5 + (i % 4), ph: i * 1.7, lag: (c[0] - 1100) / 900 }));
  Y.bushes = [
    { x: 1222, y: 620, w: 96, h: 36, seed: 40, haze: 0.1 }, { x: 1300, y: 650, w: 92, h: 42, seed: 41, haze: 0.08 }, { x: 1420, y: 672, w: 118, h: 54, seed: 47 }, { x: 1528, y: 676, w: 124, h: 70, seed: 42 },
    { x: 1652, y: 694, w: 176, h: 96, seed: 43 }, { x: 1890, y: 708, w: 210, h: 116, seed: 44 },
    { x: 1700, y: 1018, w: 236, h: 118, seed: 45, flowers: 12 }, { x: 1936, y: 940, w: 170, h: 124, seed: 46, flowers: 6 },
  ];
  Y.ferns = [{ x: 1712, y: 902, s: 58, seed: 51 }, { x: 1868, y: 968, s: 72, seed: 52 }, { x: 1622, y: 796, s: 40, seed: 53 }];
  Y.tufts = [
    { x: 1650, y: 786, w: 90, h: 46, seed: 61 }, { x: 1676, y: 846, w: 104, h: 54, seed: 62 }, { x: 1694, y: 958, w: 100, h: 66, seed: 63 },
    { x: 1530, y: 1112, w: 170, h: 96, seed: 64, seedHeads: 4 }, { x: 1690, y: 1124, w: 210, h: 126, seed: 65, seedHeads: 5 },
    { x: 1860, y: 1128, w: 230, h: 148, seed: 66, seedHeads: 6 }, { x: 1990, y: 1110, w: 150, h: 116, seed: 67 },
    { x: 30, y: 1124, w: 190, h: 104, seed: 68, dark: 1, seedHeads: 3 }, { x: 170, y: 1134, w: 150, h: 72, seed: 69, dark: 1 },
  ];
  reseed(1002);
  // reeds & cattails
  Y.reeds = [];
  for (let i = 0; i < 54; i++) {
    const y = rnd(690, 1070), x = bankX(y) + rnd(-30, 14), p = persp(y);
    Y.reeds.push({ x, y, h: lerp(46, 170, p) * rnd(0.7, 1.2), w: lerp(1.6, 4.2, p), lean: rnd(-0.08, 0.14), tone: (rnd() * 3) | 0, cat: rnd() < 0.24, ph: rnd(TAU), stiff: rnd(0.7, 1.3) });
  }
  for (let i = 0; i < 16; i++) {
    const x = rnd(-30, 230), y = rnd(1090, 1125);
    Y.reeds.push({ x, y, h: rnd(90, 210), w: rnd(3, 5), lean: rnd(-0.05, 0.16), tone: 3, cat: rnd() < 0.2, ph: rnd(TAU), stiff: rnd(0.8, 1.2) });
  }
  for (let i = 0; i < 6; i++) {
    const x = rnd(1240, 1330), y = rnd(1095, 1125);
    Y.reeds.push({ x, y, h: rnd(80, 150), w: rnd(3, 4.5), lean: rnd(-0.05, 0.1), tone: (rnd() * 2) | 0, cat: i === 2, ph: rnd(TAU), stiff: 1 });
  }
  Y.reeds.sort((a, b) => a.y - b.y);
  // water highlights carried by the current
  Y.hl = [];
  const nh = 240;
  for (let i = 0; i < nh * 3 && Y.hl.length < nh; i++) {
    const y = 606 + Math.pow(rnd(), 0.85) * 520, x = rnd(-60, 1700);
    if (!inWater(x, y, 6)) continue;
    const p = persp(y), sunCol = Math.exp(-Math.pow((x - 1440) / 230, 2)) * sstep(640, 760, y);
    const dark = rnd() < 0.3;
    Y.hl.push({ x, y, k: pick([3, 4, 5, 6]), ph: rnd(), len: lerp(5, 48, p) * rnd(0.6, 1.4), th: rnd(0.08, 0.16), dark, warm: sunCol, a: dark ? rnd(0.18, 0.3) : rnd(0.35, 0.75), wv: rnd(TAU) });
  }
  // sun glitter under the gap in the canopy
  Y.gl = [];
  for (let i = 0; i < 400 && Y.gl.length < 90; i++) {
    const y = rnd(640, 1060), x = 1450 + (rnd() + rnd() + rnd() - 1.5) * 260 * (0.5 + persp(y));
    if (!inWater(x, y, 6)) continue;
    Y.gl.push({ x, y, k: 7 + ((rnd() * 18) | 0), ph: rnd(), s: lerp(1.6, 6, persp(y)) * rnd(0.6, 1.3), star: rnd() < 0.18 });
  }
  // foam lines trailing from rocks and the fisher's legs
  Y.foam = [];
  const srcs = [[1214, 912, 3], [1158, 765, 2], [1450, 1012, 3], [1368, 846, 3], [1036, 1076, 2], [980, 700, 2], [760, 820, 1], [1100, 640, 1]];
  for (const s of srcs) for (let j = 0; j < s[2]; j++) Y.foam.push({ x: s[0] + rnd(-8, 8), y: s[1] + rnd(-6, 8), k: pick([4, 5, 6]), ph: rnd(), n: 4 + ((rnd() * 4) | 0) });
  Y.rises = [{ t: 11.0, x: 1020, y: 694 }, { t: 33.5, x: 1210, y: 1000 }, { t: 41.2, x: 760, y: 905 }];
  Y.fish = [
    { cx: 1150, cy: 960, rx: 130, ry: 26, kx: 1, ky: 2, ph: 0.4, a: 0.22 },
    { cx: 980, cy: 870, rx: 90, ry: 20, kx: 2, ky: 3, ph: 2.2, a: 0.16 },
  ];
  Y.dapples = [];
  for (let i = 0; i < 26; i++) {
    const onWater = i < 10;
    const x = onWater ? rnd(1230, 1560) : rnd(1560, 1960), y = onWater ? rnd(760, 930) : rnd(760, 1010);
    if (!onWater && x < bankX(y) + 10) continue;
    Y.dapples.push({ x, y, r: rnd(8, 26) * (0.6 + persp(y) * 0.5), k: 3 + ((rnd() * 6) | 0), ph: rnd(TAU), water: onWater });
  }
  Y.fluff = [];
  for (let i = 0; i < 7; i++) Y.fluff.push({ x: rnd(-100, 1700), y: rnd(380, 900), k: pick([2, 3]), ph: rnd(), dx: rnd(160, 320), wy: rnd(10, 40), s: rnd(1.4, 2.6) });
  Y.leaves = [];
  for (let i = 0; i < 4; i++) Y.leaves.push({ x: rnd(1180, 1620), y: rnd(330, 420), k: pick([3, 4, 5]), ph: rnd(), drift: rnd(-120, 40), land: rnd(760, 980), s: rnd(4, 6), hue: rnd() });
  Y.flies = [
    { pts: [[0, 1520, 700], [4.2, 1590, 660], [9.5, 1470, 720], [14, 1560, 760], [21, 1640, 690], [27.5, 1500, 650], [33, 1600, 730], [40, 1690, 700], [46, 1545, 680], [52.5, 1610, 740], [60, 1520, 700]] },
    { pts: [[0, 1230, 770], [6.5, 1300, 735], [12, 1180, 790], [19.5, 1260, 720], [30.5, 1150, 760], [38, 1250, 800], [44.5, 1310, 740], [51, 1200, 745], [60, 1230, 770]] },
  ];
  return Y;
}

/* ------------------------------------------------------------------ */
/*  Per-frame drawing: sky & clouds                                    */
/* ------------------------------------------------------------------ */
/** clouds drift slowly left → right with the breeze, wrapping around off-screen (on a free-running clock) */
function cloudPos(cl, ct) {
  const d = cl.d, span = 2300 + cl.w, x0 = cl.x + 260 + cl.w;   // from fully off the left edge to fully off the right
  const x = ((x0 + (d.v || 0) * ct) % span + span) % span - 260 - cl.w;
  return [x + d.amp * 0.4 * Math.sin(ct * 0.05 + d.ph), cl.y + 0.8 * Math.sin(ct * 0.09 + d.ph)];
}
function drawClouds(c, E) {
  const ct = E.cloudT || 0;
  for (const cl of E.L.clouds) {
    const q = cloudPos(cl, ct);
    c.globalAlpha = cl.d.alpha || 1;
    c.drawImage(cl.cv, q[0], q[1], cl.w, cl.h);
  }
  c.globalAlpha = 1;
}
/** their reflections move with them, broken up by the same ripples as the rest of the water.
 *  Drawn into a small world-space layer and masked with a soft-edged shape (all of the open water up to the right
 *  bank's own reflection), so there's no hard edge and no seams between the ripple slices. */
const CR_X = -80, CR_Y = 580, CR_W = 2080, CR_H = 580;
function cloudReflMask(E, s) {
  const cv = document.createElement('canvas'); cv.width = Math.ceil(CR_W * s); cv.height = Math.ceil(CR_H * s);
  const m = cv.getContext('2d'); m.setTransform(s, 0, 0, s, -CR_X * s, -CR_Y * s);
  if ('filter' in m) m.filter = 'blur(' + Math.max(1, 26 * s).toFixed(1) + 'px)';
  m.beginPath(); m.moveTo(CR_X - 60, 1226 - ridgeA(CR_X) + 6);
  for (let x = CR_X; x <= 1700; x += 20) m.lineTo(x, 1226 - ridgeA(x) + 6);
  for (let y = 1226 - ridgeA(1700) + 6; y <= 1200; y += 10) m.lineTo(Math.min(1700, bankX(y) - lerp(30, 150, persp(y)) * 0.7), y);
  m.lineTo(CR_X - 60, 1220); m.closePath(); m.fillStyle = '#fff'; m.fill();
  return cv;
}
function drawCloudReflections(c, E, tw) {
  const ct = E.cloudT || 0, v = E.view;
  const s = Math.min(1, Math.max(0.3, v.m * (E.q ? 0.6 : 0.45)));
  if (!E.cr || E.cr.s !== s) {
    const cv = document.createElement('canvas'); cv.width = Math.ceil(CR_W * s); cv.height = Math.ceil(CR_H * s);
    E.cr = { s, cv, cx: cv.getContext('2d'), mask: cloudReflMask(E, s) };
  }
  const L = E.cr, o = L.cx, n = 12;
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1; o.clearRect(0, 0, L.cv.width, L.cv.height);
  let any = false;
  for (const cl of E.L.clouds) {
    const q = cloudPos(cl, ct); if (q[0] > 1800 || q[0] + cl.w < -80) continue;
    const S = cl.cv.height / cl.h, bh = cl.h / n;
    o.globalAlpha = cl.d.alpha || 1;
    for (let k = 0; k < n; k++) {
      const ym = 1226 - (q[1] + (k + 0.5) * bh), p = persp(ym), z = 2400 / Math.max(10, ym - 586);
      const off = (0.35 + 5.2 * p * p) * (0.62 * Math.sin(z * 0.95 - TAU * 31 * tw / LOOP + 0.3) + 0.38 * Math.sin(z * 2.35 + TAU * 47 * tw / LOOP));
      // mirrored slice k lands between world y0..y1; snap to whole layer pixels so neighbouring slices meet exactly
      const wy0 = 1226 - (q[1] + (k + 1) * bh), wy1 = 1226 - (q[1] + k * bh);
      const py0 = Math.round((wy0 - CR_Y) * s), py1 = Math.round((wy1 - CR_Y) * s);
      if (py1 <= 0 || py0 >= L.cv.height || py1 <= py0) continue;
      o.save(); o.translate(0, py1); o.scale(1, -1);   // flip: the slice's top goes to the bottom
      o.drawImage(cl.cv, 0, k * bh * S, cl.cv.width, bh * S, (q[0] + off - CR_X) * s, 0, cl.w * s, py1 - py0);
      o.restore(); any = true;
    }
  }
  if (!any) return;
  o.globalAlpha = 1; o.globalCompositeOperation = 'destination-in'; o.drawImage(L.mask, 0, 0);
  o.globalCompositeOperation = 'source-over';
  c.globalAlpha = 0.42; c.drawImage(L.cv, CR_X, CR_Y, CR_W, CR_H); c.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/*  Water                                                              */
/* ------------------------------------------------------------------ */
function lens(c, x, y, len, th, wob) {
  const h = len / 2;
  c.moveTo(x - h, y);
  c.bezierCurveTo(x - h * 0.4, y - th + wob, x + h * 0.4, y - th - wob, x + h, y);
  c.bezierCurveTo(x + h * 0.3, y + th * 0.55, x - h * 0.3, y + th * 0.55, x - h, y);
}
function ring(c, x, y, r, sq) { c.moveTo(x + r, y); c.ellipse(x, y, r, r * sq, 0, 0, TAU); }

/** cat's-paw ripples: a texture of tiny wavelets that the breezes sweep across the river */
function drawReflection(c, E, tw) {
  const R = E.L.refl, S = R.cv.width / R.w, step = E.q ? 1 : 1.7;
  let y = 597;
  while (y < 1152) {
    const p = persp(y), h = lerp(1.4, 6.5, p) * step;
    const z = 2400 / (y - 586);
    const amp = 0.35 + 5.2 * p * p;
    const off = amp * (0.62 * Math.sin(z * 0.95 - TAU * 31 * tw / LOOP + 0.3) + 0.38 * Math.sin(z * 2.35 + TAU * 47 * tw / LOOP));
    const dy = p * 1.4 * Math.sin(z * 1.7 - TAU * 23 * tw / LOOP);
    const sy = (y - R.y + dy) * S;
    if (sy >= 0 && sy + h * S <= R.cv.height) c.drawImage(R.cv, 0, sy, R.cv.width, h * S + 0.5, R.x + off, y, R.w, h + 0.4);
    y += h;
  }
}
function drawFisherReflection(c, E, tw) {
  for (const F of [E.fsBack, E.fs]) if (F) reflectSprite(c, F, tw);
}
function reflectSprite(c, F, tw) {
  const S = F.cv.width / F.w;
  c.globalAlpha = 0.34;
  // the sprite's bottom edge is the waterline; mirror it downward in rippled strips
  for (let i = 0; i < 26; i++) {
    const yy = i * 7, y = FISH_Y + yy;
    const off = (1.2 + yy * 0.05) * Math.sin(yy * 0.35 - TAU * 37 * tw / LOOP) + 0.8 * Math.sin(yy * 0.9 + TAU * 19 * tw / LOOP);
    const srcY = F.h - yy - 7;
    if (srcY < 0) break;
    c.drawImage(F.cv, 0, srcY * S, F.cv.width, 7 * S, F.x + off, y, F.w, 7.3);
  }
  c.globalAlpha = 1;
}
function drawFishShadows(c, E, t, tw) {
  const spr = E.fishShadow;
  for (const f of E.Y.fish) {
    const a = TAU * f.kx * tw / LOOP + f.ph, b = TAU * f.ky * tw / LOOP + f.ph * 1.3;
    const x = f.cx + f.rx * Math.sin(a), y = f.cy + f.ry * Math.sin(b);
    const vx = f.rx * f.kx * Math.cos(a), vy = f.ry * f.ky * Math.cos(b) * 2;
    const p = persp(y), sc = lerp(0.4, 0.9, p);
    c.save(); c.translate(x, y); c.rotate(Math.atan2(vy, vx) + Math.PI); c.scale(sc, sc * 0.6);
    c.globalAlpha = f.a; c.drawImage(spr, -46, -20); c.restore();
  }
  c.globalAlpha = 1;
}
function drawShins(c, E, R) {
  // the fisher's legs seen through clear water, broken by refraction
  c.fillStyle = rgba(mixc(E.P.wDeep, [40, 40, 60], 0.4), 0.35);
  for (const k of [R.kneeN, R.kneeF]) {
    const x = FISH_X + k[0] * FS, y = FISH_Y;
    c.beginPath();
    c.moveTo(x - 7, y + 2); c.lineTo(x + 7, y + 2); c.lineTo(x + 5 + 2, y + 34); c.lineTo(x - 5 + 2, y + 34); c.closePath(); c.fill();
  }
}
function drawWaterHighlights(c, E, t, tw) {
  const P = E.P, Y = E.Y;
  const lightCol = P.wHi, warmCol = P.wHiWarm, darkCol = P.wDark;
  const nh = E.q ? Y.hl.length : (Y.hl.length * 0.55) | 0;
  for (let i = 0; i < nh; i++) {
    const h = Y.hl[i];
    const a = frac(tw * h.k / LOOP + h.ph), T = LOOP / h.k, age = (a - 0.5) * T;
    const v = flowVel(h.x, h.y), x = h.x + v[0] * age, y = h.y + v[1] * age;
    if (!inWater(x, y, 4)) continue;
    const env = Math.pow(Math.sin(Math.PI * a), 1.3);
    const calm = x < 860 ? 0.5 : 1;
    const len = h.len * (0.85 + 0.15 * Math.sin(TAU * 3 * a + h.wv));
    c.globalAlpha = h.a * env * calm;
    c.fillStyle = h.dark ? rgba(darkCol) : rgba(mixc(lightCol, warmCol, h.warm));
    c.beginPath(); lens(c, x, y, len, Math.max(0.6, len * h.th), len * 0.05 * Math.sin(TAU * 2 * a + h.wv)); c.fill();
  }
  // drifting foam lines
  c.fillStyle = rgba(P.wHi);
  for (const f of Y.foam) {
    const a = frac(tw * f.k / LOOP + f.ph), T = LOOP / f.k, age = a * T;
    const v = flowVel(f.x, f.y), sp = Math.hypot(v[0], v[1]) || 1, ux = v[0] / sp, uy = v[1] / sp;
    const env = Math.sin(Math.PI * a);
    for (let j = 0; j < f.n; j++) {
      const p = persp(f.y), d = j * lerp(5, 16, p);
      const x = f.x + v[0] * age + ux * d + Math.sin(j * 1.3 + TAU * 2 * a) * 2 * p, y = f.y + v[1] * age + uy * d + Math.sin(j * 2.1 + f.ph * 9) * 1.5 * p;
      if (!inWater(x, y, 4)) continue;
      c.globalAlpha = 0.42 * env * (1 - j / (f.n + 1)) * (x < 860 ? 0.6 : 1);
      c.beginPath(); lens(c, x, y, lerp(3, 11, p), lerp(0.5, 1.6, p), 0); c.fill();
    }
  }
  // sun glitter: cel-painted sparkles twinkling on the current
  const gw = E.q ? Y.gl.length : (Y.gl.length * 0.6) | 0;
  c.fillStyle = rgba(warmCol);
  for (let i = 0; i < gw; i++) {
    const g = Y.gl[i];
    const tw1 = Math.sin(TAU * (g.k * tw / LOOP + g.ph));
    if (tw1 <= 0.2) continue;
    const a = Math.pow((tw1 - 0.2) / 0.8, 3);
    const v = flowVel(g.x, g.y), x = g.x + v[0] * 0.25 * Math.sin(TAU * (g.k * tw / LOOP + g.ph) / 2), y = g.y;
    c.globalAlpha = a * 0.95;
    c.beginPath(); lens(c, x, y, g.s * 2.4, g.s * 0.32, 0); c.fill();
    if (g.star && a > 0.55) {
      c.globalAlpha = (a - 0.55) * 1.6;
      c.beginPath(); c.moveTo(x, y - g.s * 1.6); c.lineTo(x + g.s * 0.22, y); c.lineTo(x, y + g.s * 1.6); c.lineTo(x - g.s * 0.22, y); c.closePath(); c.fill();
    }
  }
  c.globalAlpha = 1;
  // eddies curling behind rocks
  c.strokeStyle = rgba(P.wHi); c.lineWidth = 1.1;
  for (const r of ROCKS) {
    if (!r.water) continue;
    for (let j = 0; j < 2; j++) {
      const a0 = TAU * 4 * tw / LOOP + j * Math.PI + r.x;
      c.globalAlpha = 0.32;
      c.beginPath(); c.ellipse(r.x - r.w * 0.55, r.y + r.h * 0.18, r.w * 0.36, r.h * 0.22, 0, a0, a0 + 1.4); c.stroke();
    }
    c.globalAlpha = 0.45 + 0.15 * Math.sin(TAU * 6 * tw / LOOP + r.y);
    c.beginPath(); c.ellipse(r.x + r.w * 0.05, r.y + r.h * 0.16, r.w * 0.6, r.h * 0.26, 0, -0.2, Math.PI * 0.55); c.stroke();
  }
  c.globalAlpha = 1;
}
function drawRings(c, E, t, rings) {
  c.strokeStyle = rgba(E.P.wHi);
  for (const R of rings) {
    for (let j = 0; j < 3; j++) {
      const age = wrapd(t - R.t - j * 0.28);
      if (age < 0 || age > R.life) continue;
      const u = age / R.life, p = persp(R.y);
      const r = (R.r0 || 2) + (R.size || 28) * lerp(0.5, 1.4, p) * Math.pow(u, 0.6);
      c.globalAlpha = (R.a || 0.6) * (1 - u) * (1 - u) * (j === 0 ? 1 : 0.6) * (R.x < 860 ? 0.6 : 1);
      c.lineWidth = lerp(0.6, 1.6, p) * (1 - u * 0.5);
      c.beginPath(); ring(c, R.x, R.y, r, lerp(0.16, 0.32, p)); c.stroke();
    }
  }
  c.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/*  Vegetation, light & life                                           */
/* ------------------------------------------------------------------ */
function drawSwaySprite(c, s, x, y, shx, sc) {
  c.save(); c.translate(x, y); c.transform(1, 0, shx, 1, 0, 0);
  if (sc) c.scale(sc, sc);
  c.drawImage(s.cv, s.ox, s.oy, s.w, s.h); c.restore();
}
function bushSway(b, t) { return -(0.012 + 0.03 * wind(b.x, t - 0.15)) + 0.005 * osc(9, t, b.x); }
function drawBushes(c, E, t, front) {
  for (let i = 0; i < E.Y.bushes.length; i++) {
    const b = E.Y.bushes[i]; if ((b.y > 860) !== front) continue;
    drawSwaySprite(c, E.sp.bushes[i], b.x, b.y, bushSway(b, t));
  }
  if (front) for (let i = 0; i < E.Y.ferns.length; i++) {
    const f = E.Y.ferns[i];
    drawSwaySprite(c, E.sp.ferns[i], f.x, f.y, -(0.02 + 0.06 * wind(f.x, t - 0.1)) + 0.01 * osc(13, t, f.x));
  }
}
function drawCanopy(c, E, t) {
  const Y = E.Y;
  for (let i = 0; i < Y.clumps.length; i++) {
    const d = Y.clumps[i], s = E.sp.clumps[i];
    const w = wind(d.x, t - 0.25 - d.lag * 0.2);
    const dx = 4.2 * w * (0.6 + d.r / 160) + 1.1 * osc(d.k, t, d.ph), dy = 1.6 * w - 0.8 + 0.7 * osc(d.k + 2, t, d.ph * 1.3);
    c.save(); c.translate(d.x + dx, d.y + dy); c.rotate(0.012 * w + 0.004 * osc(d.k + 1, t, d.ph));
    c.drawImage(s.cv, s.ox, s.oy, s.w, s.h); c.restore();
  }
}
function canopySway(t) { return 3.5 * wind(1450, t - 0.3) + 1.2 * osc(6, t, 1.1); }
function drawRays(c, E, t) {
  const a1 = 0.75 + 0.25 * osc(4, t, 0.2) - 0.12 * wind(1450, t - 0.3), a2 = 0.5 + 0.35 * osc(3, t, 2.3);
  c.save(); c.globalCompositeOperation = 'screen';
  const sw = canopySway(t) * 0.002;
  c.translate(SUN.x, SUN.y); c.rotate(sw); c.translate(-SUN.x, -SUN.y);
  const A = E.L.raysA, B = E.L.raysB;
  c.globalAlpha = clamp(a1, 0, 1); c.drawImage(A.cv, A.x, A.y, A.w, A.h);
  if (B) { c.globalAlpha = clamp(a2, 0, 1) * 0.8; c.drawImage(B.cv, B.x, B.y, B.w, B.h); }
  c.restore();
}
function drawDapples(c, E, t, water) {
  const sw = canopySway(t);
  c.save(); c.globalCompositeOperation = 'screen';
  for (const d of E.Y.dapples) {
    if (d.water !== water) continue;
    const f = 0.55 + 0.45 * osc(d.k, t, d.ph);
    const x = d.x + sw * (1.8 + d.r * 0.04), y = d.y + sw * 0.25;
    c.globalAlpha = 0.5 * f * (water ? 0.7 : 1);
    const r = d.r * (0.85 + 0.15 * f);
    c.drawImage(E.spot, x - r, y - r * 0.38, r * 2, r * 0.76);
  }
  c.restore();
}
function reedSway(r, t) {
  return (r.lean + (0.05 + 0.15 * wind(r.x, t - 0.05)) / r.stiff + 0.018 * Math.sin(TAU * 41 * t / LOOP + r.ph + r.x * 0.02));
}
function drawReeds(c, E, t, group) {
  const P = E.P;
  const tones = [P.gShade, P.gMid, mixc(P.gMid, P.gLit, 0.6), mixc(P.gShade, P.wDeep, 0.35)];
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], cats = new Path2D(), lit = new Path2D();
  for (const r of E.Y.reeds) {
    const isLeft = r.x < 600;
    if (group === 0 && isLeft) continue;
    if (group === 1 && !isLeft) continue;
    const s = reedSway(r, t), tx = r.x + s * r.h, ty = r.y - r.h * (1 - s * s * 0.5);
    const cx = r.x + s * r.h * 0.25, cy = r.y - r.h * 0.55;
    const p = paths[r.tone];
    p.moveTo(r.x - r.w / 2, r.y);
    p.quadraticCurveTo(cx - r.w * 0.3, cy, tx, ty);
    p.quadraticCurveTo(cx + r.w * 0.4, cy, r.x + r.w / 2, r.y);
    if (r.tone !== 3) { lit.moveTo(r.x + r.w * 0.3, r.y - r.h * 0.2); lit.quadraticCurveTo(cx + r.w * 0.3, cy, tx, ty); }
    if (r.cat) {
      const u = 0.78, hx = lerp(r.x, tx, u) + (cx - (r.x + tx) / 2) * 0.4, hy = lerp(r.y, ty, u);
      const ang = Math.atan2(ty - r.y, tx - r.x);
      ellipsePath(cats, hx, hy, r.h * 0.07, r.w * 1.05, ang);
    }
  }
  for (let i = 0; i < 4; i++) { c.fillStyle = rgba(tones[i]); c.fill(paths[i]); }
  c.strokeStyle = rgba(P.rim, 0.55); c.lineWidth = 0.9; c.stroke(lit);
  c.fillStyle = rgba(group === 1 ? mixc(P.soilDark, P.wDeep, 0.3) : P.soilDark); c.fill(cats);
}
function drawTufts(c, E, t, which) {   // which: 0 = behind the tree base, 1 = in front of it, 2 = foreground
  const Y = E.Y;
  for (let i = 0; i < Y.tufts.length; i++) {
    const d = Y.tufts[i], w = d.y > 1090 ? 2 : d.y < 880 ? 0 : 1;
    if (w !== which) continue;
    const sh = -(0.04 + 0.13 * wind(d.x, t - 0.08)) + 0.025 * Math.sin(TAU * 47 * t / LOOP + d.x * 0.03);
    drawSwaySprite(c, E.sp.tufts[i], d.x, d.y, sh);
  }
}
function drawHeron(c, E, t) {
  const P = E.P, x = 1010, y = farWater(1010) - 0.5;
  const look = sstep(38.5, 40, t) * (1 - sstep(45, 46.8, t)) + 0.5 * bump(t, 8, 1.2);
  const body = mixc(P.hillNear, [120, 130, 150], 0.4), lit = mixc(P.cloudLit, P.haze, 0.3);
  c.save(); c.translate(x, y); c.scale(0.78, 0.78);
  c.strokeStyle = rgba(mixc(P.tDark, P.haze, 0.3)); c.lineWidth = 0.9;
  c.beginPath(); c.moveTo(-1, -12); c.lineTo(-2, 0); c.moveTo(2, -12); c.lineTo(3, 0); c.stroke();
  c.fillStyle = rgba(body);
  c.beginPath(); c.ellipse(1, -17, 9, 5.2, -0.35, 0, TAU); c.fill();
  c.beginPath(); c.moveTo(8, -19); c.lineTo(15, -14); c.lineTo(9, -15); c.closePath(); c.fill();
  // neck & head
  const hx = -6 - look * 3, hy = -31 + look * 6;
  c.strokeStyle = rgba(lit); c.lineWidth = 2.6;
  c.beginPath(); c.moveTo(-4, -19); c.quadraticCurveTo(-8 + look * 2, -24, hx, hy); c.stroke();
  c.fillStyle = rgba(lit); c.beginPath(); c.ellipse(hx, hy, 2.6, 2, 0, 0, TAU); c.fill();
  c.strokeStyle = rgba([210, 170, 90]); c.lineWidth = 1.1;
  c.beginPath(); c.moveTo(hx - 2, hy); c.lineTo(hx - 8, hy + 1 + look * 3); c.stroke();
  c.fillStyle = rgba(P.rim, 0.6); c.beginPath(); c.ellipse(3, -19, 5, 2, -0.35, 0, TAU); c.fill();
  c.restore();
  // its tiny reflection
  c.globalAlpha = 0.25; c.fillStyle = rgba(body);
  c.beginPath(); c.ellipse(x + 1, y + 13, 7, 3.4, 0.3, 0, TAU); c.fill(); c.globalAlpha = 1;
}
function flyPos(f, t) {
  const pts = f.pts; let i = 0;
  while (i < pts.length - 2 && pts[i + 1][0] <= t) i++;
  const a = pts[i], b = pts[i + 1], dt = t - a[0], dart = 0.45;
  let x, y, dir;
  if (dt < dart) {
    const prev = i > 0 ? pts[i - 1] : pts[pts.length - 2];
    const u = sstep(0, 1, dt / dart);
    x = lerp(prev[1], a[1], u); y = lerp(prev[2], a[2], u) - Math.sin(u * Math.PI) * 10; dir = a[1] > prev[1] ? 1 : -1;
  } else {
    const prev = i > 0 ? pts[i - 1] : pts[pts.length - 2];
    x = a[1]; y = a[2]; dir = a[1] > prev[1] ? 1 : -1;
  }
  x += 3 * osc(53, t, x) + 1.5 * osc(97, t); y += 2.5 * osc(67, t, y) + 1.2 * osc(131, t);
  return [x, y, dir];
}
function drawFlies(c, E, t, frame2) {
  const P = E.P;
  for (const f of E.Y.flies) {
    const [x, y, dir] = flyPos(f, t);
    c.save(); c.translate(x, y); c.scale(dir, 1);
    c.fillStyle = rgba([235, 240, 245], frame2 ? 0.55 : 0.35);
    c.beginPath(); c.ellipse(-1, -3, 6, 1.4, -0.25 - (frame2 ? 0.2 : 0), 0, TAU); c.ellipse(1, -3, 6, 1.4, 0.25 + (frame2 ? 0.2 : 0), 0, TAU); c.fill();
    c.strokeStyle = rgba(mixc([170, 60, 40], P.rim, 0.15)); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-6, 0); c.lineTo(8, 0); c.stroke();
    c.fillStyle = rgba([60, 90, 80]); c.beginPath(); c.arc(-7, 0, 1.6, 0, TAU); c.fill();
    c.restore();
  }
}
function drawFluff(c, E, t) {
  for (const f of E.Y.fluff) {
    const a = frac(t * f.k / LOOP + f.ph), T = LOOP / f.k;
    const x = f.x + f.dx * a * T / 20 + 10 * Math.sin(TAU * a * 2 + f.ph * 7), y = f.y + f.wy * Math.sin(TAU * a + f.ph * 3) - 30 * a;
    const lit = clamp(1 - Math.abs(x - 1450) / 900, 0.25, 1) * (x < 860 ? 0.55 : 1);
    c.globalAlpha = Math.sin(Math.PI * a) * 0.85 * lit;
    const r = f.s * 3;
    c.drawImage(E.spotW, x - r, y - r, r * 2, r * 2);
  }
  c.globalAlpha = 1;
}
function drawLeaves(c, E, t) {
  const P = E.P;
  for (const l of E.Y.leaves) {
    const a = frac(t * l.k / LOOP + l.ph), T = LOOP / l.k, age = a * T;
    const fall = clamp(age / (T * 0.6), 0, 1);
    let x = l.x + l.drift * fall + 22 * Math.sin(age * 2.1 + l.ph * 9) * (1 - fall * 0.5), y = lerp(l.y, l.land, Math.pow(fall, 1.1));
    if (fall >= 1) { const v = flowVel(x, y); x += v[0] * (age - T * 0.6); y += v[1] * (age - T * 0.6); }
    const alpha = Math.min(1, age / 1.2) * Math.min(1, (T - age) / 2);
    const spin = Math.sin(age * 3.1 + l.ph * 5);
    c.save(); c.globalAlpha = alpha; c.translate(x, y); c.rotate(age * 1.7 + l.ph * 9);
    c.scale(1, fall >= 1 ? 0.45 : Math.max(0.2, Math.abs(spin)));
    c.fillStyle = rgba(spin > 0 ? mixc(P.tLit, P.rim, l.hue * 0.5) : P.tMid);
    c.beginPath(); c.moveTo(-l.s, 0); c.quadraticCurveTo(0, -l.s * 0.6, l.s, 0); c.quadraticCurveTo(0, l.s * 0.6, -l.s, 0); c.fill();
    c.restore();
  }
  c.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/*  THE FISHER — model sheet as code                                   */
/*  Local units: origin at the waterline between the knees, +x = back, */
/*  facing screen-left. Scaled by FS into the scene.                   */
/* ------------------------------------------------------------------ */
function ltrack(keys) {   // non-periodic monotone track, clamped at ends
  const T = keys.map((k) => k[0]), V = keys.map((k) => k[1]), m = T.length, d = [], M = new Array(m).fill(0);
  for (let i = 0; i < m - 1; i++) d.push((V[i + 1] - V[i]) / (T[i + 1] - T[i]));
  for (let i = 1; i < m - 1; i++) {
    const a = d[i - 1], b = d[i];
    if (a * b > 0) { let s = (a + b) / 2; const l = 3 * Math.min(Math.abs(a), Math.abs(b)); if (Math.abs(s) > l) s = Math.sign(s) * l; M[i] = s; }
  }
  return function (t) {
    if (t <= T[0]) return V[0]; if (t >= T[m - 1]) return V[m - 1];
    let i = 0; while (T[i + 1] < t) i++;
    const h = T[i + 1] - T[i], s = (t - T[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * V[i] + (s3 - 2 * s2 + s) * h * M[i] + (-2 * s3 + 3 * s2) * V[i + 1] + (s3 - s2) * h * M[i + 1];
  };
}
const TR = {
  lean: track([[0, 0.08], [3, 0.08], [4.4, 0.15], [6.6, 0.17], [7.8, 0.06], [9.6, 0.07], [11, 0], [12.2, 0.04], [13.6, 0.09], [18, 0.09], [19.4, 0.14], [21.8, 0.19], [23.1, 0.24], [23.55, 0.27], [24, -0.1], [24.6, 0.05], [25.2, 0.15], [25.5, 0.13], [25.85, -0.12], [26.4, -0.02], [27, -0.1], [27.4, 0], [28, 0.16], [28.6, -0.12], [29.3, -0.04], [29.75, 0.1], [30.2, -0.2], [30.6, -0.12], [31, -0.08], [31.5, 0.07], [32.4, 0.02], [33.2, -0.05], [36, -0.03], [38.2, -0.02], [38.6, 0.1], [40.4, 0.78], [41.9, 0.82], [43.2, 0.4], [44.6, 0.06], [45.6, 0], [46.4, 0.08], [48.2, 0.1], [49.4, -0.14], [50.1, -0.15], [50.8, 0.22], [51.6, 0.17], [53, 0.15], [54, 0.04], [55, 0.1], [57, 0.08], [60, 0.08]]),
  hy: track([[0, -80], [4.4, -79], [6.6, -78.5], [7.8, -80.5], [18, -80], [19.4, -78], [21.8, -75.5], [23.1, -73], [23.55, -71.5], [24, -79], [24.6, -75], [25.2, -72], [25.85, -76.5], [26.4, -74], [27, -76], [28, -72], [28.6, -76.5], [29.3, -74], [29.75, -72], [30.2, -81], [30.6, -81.5], [31, -85.5], [31.4, -76.5], [32.1, -80], [33.2, -82], [33.8, -80.5], [38.6, -79], [40.4, -52], [41.9, -50], [43.4, -72], [45, -80.5], [46, -80], [48.2, -78], [49.6, -82], [50.6, -76.5], [51.6, -78.5], [53, -79], [53.8, -82], [54.5, -79.5], [56, -80], [60, -80]]),
  hx: track([[0, 0], [3, 0], [4.4, -4], [6.6, -4.5], [8, 1.5], [10, 1], [14.5, 0], [18, 0], [21, -3], [23.55, -4], [24, 2], [24.6, -1], [25.2, -5.5], [25.85, -1], [26.4, -2], [27, 0], [28, -5.5], [28.6, -1], [29.3, -2], [29.75, -2], [30.2, 3], [30.6, 1], [31, -4], [31.6, -1], [33, 0], [38.6, 0], [40.4, -8], [41.9, -9], [43.6, -2], [47, 2], [49.6, 5], [50.9, -5], [53, -3.5], [57, 0], [60, 0]]),
  head: track([[0, 0.12], [3, 0.1], [4.4, 0.22], [6.6, 0.24], [7.8, 0.1], [9.6, 0.08], [10.8, -0.1], [12, -0.12], [13.2, 0.06], [18, 0.12], [19.4, 0.24], [21.8, 0.26], [23.5, 0.26], [24, 0.16], [25.2, 0.3], [25.85, 0.18], [27.2, 0.16], [28, 0.3], [29.3, 0.22], [29.75, 0.24], [30.2, 0], [30.6, -0.24], [31, -0.12], [31.5, 0.2], [32.4, 0.12], [33.2, -0.06], [35, -0.03], [36.6, -0.06], [37.8, 0.05], [38.6, 0.3], [40.4, 0.62], [41.9, 0.6], [43.2, 0.4], [44.6, 0.05], [45.6, -0.04], [46.6, 0.08], [48.8, 0], [49.8, -0.06], [51, 0.06], [52.8, 0.14], [53.8, 0.02], [55, 0.12], [60, 0.12]]),
  rodA: track([[0, 0.47], [18, 0.47], [19.4, 0.48], [21.8, 0.5], [23.1, 0.52], [23.55, 0.44], [24, 1.02], [24.6, 0.94], [25.2, 0.84], [25.85, 1.08], [26.4, 0.96], [27, 1.1], [27.4, 1], [28, 0.88], [28.6, 1.1], [29.3, 1], [29.75, 0.9], [30.2, 1.45], [30.6, 1.42], [31.2, 1.32], [33.6, 1.3], [38.6, 1.32], [40.4, 1.2], [41.9, 1.16], [43.4, 1.02], [45.3, 0.74], [47, 0.6], [48.2, 0.56], [49.6, 1.95], [50.1, 2], [50.85, 0.62], [52, 0.6], [53.5, 0.55], [56, 0.48], [60, 0.47]]),
  gx: track([[0, -22], [18, -22], [23.1, -23], [23.55, -25], [24, -16], [24.6, -18], [25.2, -21], [25.85, -12], [26.4, -16], [27, -14], [28, -22], [28.6, -12], [29.3, -16], [29.75, -19], [30.2, -8], [30.6, -8], [31.2, -12], [33.6, -12], [38.6, -12], [40.4, -56], [41.9, -58], [43.4, -30], [45.3, -20], [48.2, -24], [49.6, 6], [50.1, 8], [50.85, -26], [52, -24], [56, -22], [60, -22]]),
  gy: track([[0, -30], [18, -30], [23.1, -33], [23.55, -30], [24, -50], [24.6, -46], [25.2, -41], [25.85, -58], [26.4, -50], [27, -55], [28, -42], [28.6, -58], [29.3, -52], [29.75, -44], [30.2, -70], [30.6, -68], [31.2, -60], [33.6, -52], [38.6, -52], [40.4, -42], [41.9, -40], [43.4, -46], [45.3, -36], [48.2, -30], [49.6, -84], [50.1, -86], [50.85, -48], [52, -40], [56, -31], [60, -30]]),
  lh: track([[0, 1], [9.6, 1], [10.5, 0], [12.8, 0], [13.7, 1], [30.35, 1], [30.75, 0], [44.2, 0], [45.3, 1], [60, 1]]),
  joy: track([[0, 0.3], [18, 0.3], [19.2, 0.1], [23, 0], [24.2, 0], [29.7, 0], [30.3, 0.35], [30.8, 0.75], [31, 1], [33, 1], [37.8, 1], [38.6, 0.55], [40.4, 0.3], [42.2, 0.5], [44, 0.75], [46, 0.4], [49, 0.1], [52.6, 0.2], [53.6, 0.85], [55.5, 0.5], [60, 0.3]]),
  happy: track([[0, 0], [33.2, 0], [33.7, 1], [36.4, 1], [36.8, 0], [60, 0]]),
  strain: track([[0, 0], [23.6, 0], [24.6, 0.7], [25.4, 1], [26.6, 0.85], [27.2, 0.95], [28.4, 1], [29.7, 1], [30.2, 0.6], [30.8, 0.1], [31.4, 0], [60, 0]]),
  brow: track([[0, 0], [4.4, 0.5], [6.6, 0.4], [8, 0], [18, 0], [19.2, 0.8], [20.5, -0.6], [23, -0.8], [23.8, 0.6], [24.4, -1], [29.7, -1], [30.2, -0.4], [30.6, 1], [33.6, 0.7], [37.8, 0.6], [38.6, 0.3], [40.4, -0.2], [42.2, 0.4], [44, 0.5], [47, -0.3], [50.8, -0.6], [52.8, -0.2], [53.6, 0.8], [56, 0.2], [60, 0]]),
  lfx: track([[0, -80], [30.3, -52], [30.7, -70], [31, -80], [31.5, -66], [32.4, -60], [33.2, -64], [36, -63], [38.2, -64], [38.6, -60], [40.4, -98], [41.9, -100], [42.6, -90], [43.8, -64], [45.3, -62], [60, -80]]),
  lfy: track([[0, -150], [30.3, -120], [30.7, -170], [31, -182], [31.5, -150], [32.4, -170], [33.2, -196], [36, -192], [38.2, -194], [38.6, -180], [40.4, -22], [41.9, -18], [42.6, -36], [43.8, -96], [45.3, -118], [60, -150]]),
  bend: track([[0, 0.05], [18, 0.05], [19.2, 0.1], [19.5, 0.05], [21.6, 0.12], [21.9, 0.05], [23, 0.08], [23.3, 0.2], [23.55, 0.12], [24, 0.45], [24.6, 0.56], [25.2, 0.68], [25.85, 0.45], [26.4, 0.56], [27, 0.42], [27.4, 0.28], [28, 0.64], [28.6, 0.5], [29.3, 0.46], [29.75, 0.55], [30.1, 0.62], [30.4, 0.2], [31.2, 0.08], [33.6, 0.06], [38.6, 0.05], [39.4, 0], [48.2, 0], [53, 0.02], [55, 0.05], [60, 0.05]]),
  ox: track([[0, -22], [23.6, -22], [23.95, -2], [27.25, -2], [27.4, 12], [27.7, -2], [30.05, -2], [30.45, -10], [31, -6], [33.4, -8], [34.2, -12], [38.5, -12], [39.2, 0], [48.2, 0], [49.6, 30], [50.1, 10], [51.2, -40], [52.4, -30], [53, -22], [60, -22]]),
  oy: track([[0, 18], [23.6, 18], [23.95, 3], [27.25, 3], [27.4, 22], [27.7, 3], [30.05, 3], [30.45, 26], [31, 18], [33.4, 24], [34.2, 30], [38.5, 30], [39.2, 0], [48.2, 0], [49.6, -20], [50.1, -30], [51.2, -90], [52.4, -50], [53, 4], [54.5, 18], [60, 18]]),
};
const FLING_T0 = 30.05, CATCH_T = 31.0, FLING_G = 1400;
const REVEAL_T = 32.1;   // he brings the catch forward to show it off: "tada" rays + the reveal sound start here
let FLING = null, FEX = null;    // launch velocity solved so the fish lands exactly in his outstretched hand
function flingPos(t) {
  if (!FLING) {
    const hw = toW(rigAt(CATCH_T).hN), end = [hw[0] - 21, hw[1] + 1], T = CATCH_T - FLING_T0;
    if (!FEX) FEX = FEXIT;
    FLING = { vx: (end[0] - FEX[0]) / T, vy: (end[1] - FEX[1] - 0.5 * FLING_G * T * T) / T };
  }
  const k = clamp(t, FLING_T0, CATCH_T) - FLING_T0;
  const F0 = FEX; return [F0[0] + FLING.vx * k, F0[1] + FLING.vy * k + 0.5 * FLING_G * k * k, FLING.vx, FLING.vy + FLING_G * k];
}
// the tug of war: the fish runs left, cuts right, thrashes at the surface, dives, then tires
const FX = ltrack([[24, 915], [24.8, 862], [25.6, 795], [26.2, 768], [26.6, 788], [27.2, 752], [28.0, 706], [28.6, 690], [29.3, 752], [30, 820]]);
const FY = ltrack([[24, 806], [24.8, 809], [25.6, 806], [26.2, 810], [26.6, 812], [27.2, 806], [28.0, 808], [28.6, 812], [29.3, 816], [30, 818]]);
const THRASH = [27.05, 27.5];
function fightPos(t) {
  const env = sstep(24, 24.3, t) * (1 - sstep(29.7, 30, t));
  let x = FX(t) + env * (2.5 * Math.sin(t * 13) + 1.5 * Math.sin(t * 27)), y = FY(t) + env * 1.2 * Math.sin(t * 19);
  if (t > THRASH[0] && t < THRASH[1]) y -= 26 * Math.sin(Math.PI * (t - THRASH[0]) / (THRASH[1] - THRASH[0]));
  return [x, y];
}
const CASTP = ltrack([[50.1, 0], [50.6, 0.08], [51.6, 0.6], [52.5, 0.92], [53, 1]]);
const LC = ltrack([[48.2, 110], [49.6, 300], [50.1, 380]]);
const BACKANG = ltrack([[48.2, Math.PI / 2], [49.0, 1.0], [49.6, 0.2], [50.1, -0.1]]);
const PLANT_B = [-38, 8], PLANT_A = 1.36, LEG1 = 84, LEG2 = 50;   // where he sticks the rod in the riverbed
const CURSOR_SCALE = 2.2;   // the bob shown as the cursor is drawn larger than the real float
const ROD_L = 450, ARM1 = 42, ARM2 = 40;
const FLOAT0 = [895, 800], STRIKE = [915, 806], FEXIT = [820, 818], APEX = [1110, 450], C1 = [900, 540], C2 = [1290, 400], CASTC = [1180, -40];

const toW = (p) => [FISH_X + p[0] * FS, FISH_Y + p[1] * FS];
const qb = (a, c, b, u) => { const v = 1 - u; return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]]; };
function ik(s, tg, l1, l2, bend) {
  let dx = tg[0] - s[0], dy = tg[1] - s[1], d = Math.hypot(dx, dy);
  const md = l1 + l2 - 0.5; if (d > md) { dx *= md / d; dy *= md / d; d = md; } if (d < 4) d = 4;
  const a = Math.atan2(dy, dx), A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const ea = a + bend * A, e = [s[0] + Math.cos(ea) * l1, s[1] + Math.sin(ea) * l1];
  return { e, h: [s[0] + dx, s[1] + dy] };
}
const floatRest = (t) => [FLOAT0[0] + 1.0 * osc(7, t) + 0.6 * osc(11, t, 1),
  FLOAT0[1] + 1.1 * osc(15, t) + 0.5 * osc(23, t, 1)];
const floatDip = (t) => 5 * bump(t, 19.25, 0.18) + 7.5 * bump(t, 21.65, 0.22) + 9 * sstep(22.9, 23.25, t) * (1 - sstep(23.6, 24, t)) + 3.5 * bump(t, 53.25, 0.2);

/** Full pose at time t (pure function of t → identical every loop). */
function rigAt(t, tw, mod) {
  t = ((t % LOOP) + LOOP) % LOOP;
  const r = { t };
  mod = mod || {};
  const lean = TR.lean(t) + 0.008 * pn(t, 21, 1) + (mod.lean || 0);
  const br = Math.sin(TAU * 15 * t / LOOP);
  // an eager little bounce on the knees while he waits (fades out for the bite, back in after the cast)
  const eager = (1 - sstep(16.5, 18.5, t)) + sstep(55, 58.5, t);
  const P = [TR.hx(t) + 0.6 * pn(t, 22, 1) + (mod.hx || 0), TR.hy(t) + 0.4 * br + eager * 1.1 * Math.sin(TAU * 20 * t / LOOP) + (mod.hy || 0)];
  const up = [-Math.sin(lean), -Math.cos(lean)], rt = [Math.cos(lean), -Math.sin(lean)];
  // torso frame with a curved spine: the lower body leans less than the chest
  const T = (u, v) => { const q = rot(u, -v, -lean * (0.55 + 0.45 * clamp(v / 88, 0, 1.1))); return [P[0] + q[0], P[1] + q[1]]; };
  Object.assign(r, { P, lean, up, rt, T, br });
  const ch = 86 + br * 0.9;
  r.ch = ch;
  r.shN = T(-5, ch - 3); r.shF = T(9, ch - 1);
  r.neckBase = T(-6, ch - 1); r.neckTop = T(-8, ch + 9);
  const headRot = -TR.head(t) - (mod.head || 0);
  r.headRot = headRot;
  const na = rot(2, 13, headRot);
  r.headC = [r.neckTop[0] - na[0], r.neckTop[1] - na[1]];
  const lag = TR.head(t) - TR.head(t - 0.14);
  const w = wind(FISH_X, (tw === undefined ? t : tw) - 0.1);
  // hair follow-through: wind, body drag, head turns, the hand pushing it back
  r.hair = [2.2 * w - 0.6 + (TR.lean(t) - TR.lean(t - 0.15)) * 28 + (TR.hx(t) - TR.hx(t - 0.15)) * 0.6 + 3.5 * bump(t, 11.6, 0.5) + 0.5 * osc(31, t, 1) * w,
    -(TR.hy(t) - TR.hy(t - 0.12)) * 0.45 - eager * 0.35 * Math.cos(TAU * 20 * t / LOOP) + lag * 10];
  r.joy = clamp(TR.joy(t), 0, 1); r.brow = TR.brow(t); r.strain = clamp(TR.strain(t), 0, 1);
  if (mod.ew) {   // game reactions override the keyed expression
    const ew = clamp(mod.ew, 0, 1);
    if (mod.joy !== undefined) r.joy = lerp(r.joy, mod.joy, ew);
    if (mod.brow !== undefined) r.brow = lerp(r.brow, mod.brow, ew);
    if (mod.strain !== undefined) r.strain = lerp(r.strain, mod.strain, ew);
  }
  r.flush = Math.max(r.strain, clamp(mod.flush || 0, 0, 1));   // red in the face whenever he's hauling on the line
  const BL = [3.2, 8.7, 15.1, 22.9, 34.4, 37.8, 45.6, 48.9, 56.2];
  r.happy = mod.happy !== undefined ? mod.happy : clamp(TR.happy(t), 0, 1);
  r.blink = 0; for (const b of BL) r.blink = Math.max(r.blink, 1 - Math.abs(wrapd(t - b)) / 0.09);
  r.hem = (TR.lean(t - 0.22) - lean) * 34 + (TR.hx(t - 0.22) - P[0]) * 0.7 + 2.4 * w + 0.6 * osc(29, t);
  r.swing = (TR.hx(t - 0.3) - P[0]) * 0.035 + (TR.lean(t - 0.3) - lean) * 0.9 + 0.03 * osc(11, t, 2);
  r.hipN = T(-6, 2); r.hipF = T(7, 3);
  r.kneeN = [-20 + P[0] * 0.15, 6]; r.kneeF = [8 + P[0] * 0.15, 6];
  r.ankleN = [r.kneeN[0], 56]; r.ankleF = [r.kneeF[0] + 2, 56];
  const jw = clamp(mod.jump || 0, 0, 1);
  if (jw > 0) {   // a tucked hop: front knee comes up, back foot kicks out behind; knees always bend forward
    const fN = [lerp(r.ankleN[0], r.hipN[0] - 10, jw), lerp(r.ankleN[1], r.hipN[1] + 92, jw)];
    const fF = [lerp(r.ankleF[0], r.hipF[0] + 36, jw), lerp(r.ankleF[1], r.hipF[1] + 80, jw)];
    const lN = ik(r.hipN, fN, LEG1, LEG2, 1), lF = ik(r.hipF, fF, LEG1, LEG2, 1);
    r.kneeN = lN.e; r.ankleN = lN.h; r.kneeF = lF.e; r.ankleF = lF.h;
  }
  // rod
  const h = 0.06, plant = mod.plant || 0;
  let a = (mod.rodA !== undefined ? mod.rodA : TR.rodA(t)) + (mod.rodAdd || 0);
  if (plant) a = lerp(a, PLANT_A, plant);
  const acc = (a - 2 * TR.rodA(t - h) + TR.rodA(t - 2 * h)) / (h * h);
  const fightEnv = sstep(24, 24.4, t) * (1 - sstep(29.6, 30, t));
  let bend = TR.bend(t) + (mod.rodA !== undefined ? 0 : clamp(acc * 0.0032, -0.3, 0.3)) + 0.004 * osc(15, t) + fightEnv * (0.05 * Math.sin(t * 17) + 0.03 * Math.sin(t * 29));
  bend += mod.bendAdd || 0;
  if (plant) bend = lerp(bend, 0.02, plant);
  r.fightEnv = fightEnv;
  const d = [-Math.cos(a), -Math.sin(a)];
  let G = mod.g ? [P[0] + mod.g[0], P[1] + mod.g[1]] : [P[0] + TR.gx(t) + fightEnv * 0.8 * Math.sin(t * 23), P[1] + TR.gy(t) + fightEnv * 1.1 * Math.sin(t * 31)];
  let butt = null;
  if (plant) {   // the rod's butt is pushed into the riverbed; his hand slides up the rod and can let go
    const b0 = [G[0] - d[0] * 18, G[1] - d[1] * 18];
    butt = [lerp(b0[0], PLANT_B[0], plant), lerp(b0[1], PLANT_B[1], plant)];
    const sl = lerp(18, 70, plant); G = [butt[0] + d[0] * sl, butt[1] + d[1] * sl];
  }
  if (mod.rf && mod.rfw) G = [lerp(G[0], mod.rf[0], mod.rfw), lerp(G[1], mod.rf[1], mod.rfw)];
  r.rodA = a; r.bend = bend; r.rodD = d; r.plant = plant;
  r.butt = butt || [G[0] - d[0] * 18, G[1] - d[1] * 18];
  const db = [-Math.cos(a - bend * 0.55), -Math.sin(a - bend * 0.55)];
  r.tip = [r.butt[0] + db[0] * ROD_L, r.butt[1] + db[1] * ROD_L];
  r.rodC = [r.butt[0] + d[0] * ROD_L * 0.55, r.butt[1] + d[1] * ROD_L * 0.55];
  // pushing his hair back: the hand sweeps from the fringe over the crown
  const u = sstep(10.6, 12.2, t), hp = u < 0.5 ? [lerp(-22, -9, u * 2), lerp(-9, -22.5, u * 2)] : [lerp(-9, 8, u * 2 - 1), lerp(-22.5, -19, u * 2 - 1)];
  const hq = rot(hp[0] * 1.06, hp[1] * 1.06, headRot);
  r.hairHand = [r.headC[0] + hq[0], r.headC[1] + hq[1]];
  // arms
  const armF = ik(r.shF, G, ARM1, ARM2, -1);
  const onRod = [G[0] + d[0] * 46, G[1] + d[1] * 46];
  const free = mod.lf ? mod.lf : (t > 9 && t < 14.5) ? r.hairHand : [TR.lfx(t), TR.lfy(t)];
  const lh = mod.lh !== undefined ? mod.lh : clamp(TR.lh(t), 0, 1);
  const Lt = [lerp(free[0], onRod[0], lh), lerp(free[1], onRod[1], lh)];
  const armN = ik(r.shN, Lt, ARM1, ARM2, -1);
  r.elF = armF.e; r.hF = armF.h; r.elN = armN.e; r.hN = armN.h; r.lh = lh;
  return r;
}

/* ---------------------------- line & catch ---------------------------- */
function makeCatchCache() {
  const C = {};
  const r501 = rigAt(50.1), tipW = toW(r501.tip);
  C.Bk = [tipW[0] + LC(50.1) * Math.cos(BACKANG(50.1)), tipW[1] + LC(50.1) * Math.sin(BACKANG(50.1))];
  // droplets: splash, trail and release, precomputed so each frame is a pure function of t
  reseed(777);
  C.drops = [];
  // the hook set
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + rnd(-0.7, 0.9), sp = rnd(80, 200);
    C.drops.push({ t0: 23.98 + rnd(0, 0.05), x: STRIKE[0] + rnd(-4, 4), y: STRIKE[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: rnd(1, 2), wy: STRIKE[1] });
  }
  // spray off the line where it cuts the water during the fight
  for (let k = 0; k < 16; k++) {
    const t0 = 24.25 + k * 0.34, f = fightPos(t0), f2 = fightPos(t0 + 0.05);
    for (let i = 0; i < 3; i++) C.drops.push({ t0: t0 + rnd(0, 0.1), x: f[0] + rnd(-3, 3), y: f[1] - 1, vx: (f2[0] - f[0]) / 0.05 * 0.6 + rnd(-40, 40), vy: -rnd(70, 170), s: rnd(0.8, 1.6), wy: f[1] + 1 });
  }
  // thrashing at the surface
  for (let i = 0; i < 20; i++) {
    const t0 = THRASH[0] + rnd(0, 0.35), f = fightPos(t0), a = -Math.PI / 2 + rnd(-1.2, 1.2), sp = rnd(90, 300);
    C.drops.push({ t0, x: f[0] + rnd(-8, 8), y: f[1] + rnd(-4, 4), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: rnd(1, 2.6), wy: FY(t0) });
  }
  // the lift: a burst as it leaves the water, then a trail off the fish
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + rnd(-0.9, 1.1), sp = rnd(120, 420);
    C.drops.push({ t0: 30.0 + rnd(0, 0.08), x: FEXIT[0] + rnd(-6, 6), y: FEXIT[1], vx: Math.cos(a) * sp + 60, vy: Math.sin(a) * sp, s: rnd(1.2, 3.2), wy: FEXIT[1] });
  }
  for (let i = 0; i < 18; i++) {
    const t0 = 30.08 + i * 0.04, f = fishMouthFlight(t0), f2 = fishMouthFlight(t0 + 0.02);
    const vx = (f2[0] - f[0]) / 0.02, vy = (f2[1] - f[1]) / 0.02;
    C.drops.push({ t0, x: f[0] + rnd(-6, 6), y: f[1] + rnd(-4, 8), vx: vx * 0.35 + rnd(-60, 60), vy: vy * 0.35 + rnd(-80, 20), s: rnd(1, 2.6), wy: 840 });
  }
  { // a little spray shaken off as he snatches it
    const c = fishMouthFlight(CATCH_T);
    for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + rnd(-1.3, 1.3), sp = rnd(60, 180); C.drops.push({ t0: CATCH_T + rnd(0, 0.06), x: c[0] + rnd(-8, 12), y: c[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: rnd(0.9, 1.8), wy: 850 }); }
  }
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + rnd(-0.8, 0.8), sp = rnd(60, 160);
    C.drops.push({ t0: 42.1, x: 1278 + rnd(-6, 6), y: FISH_Y - 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: rnd(1, 2), wy: FISH_Y });
  }
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + rnd(-0.7, 0.7), sp = rnd(40, 110);
    C.drops.push({ t0: 53.0, x: FLOAT0[0] + rnd(-3, 3), y: FLOAT0[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: rnd(0.8, 1.6), wy: FLOAT0[1] + 1 });
  }
  return C;
}
function fishMouthFlight(t) { return flingPos(t); }
/** world-space state of line end, float and fish at time t */
function catchState(t, R, Cc) {
  const S = { t };
  const tip = toW(R.tip); S.tip = tip;
  const handW = toW(R.hN), mouthHand = [handW[0] - 21, handW[1] + 1];
  const fr = floatRest(t), dip = floatDip(t);
  S.waterY = fr[1];
  const fp = [fr[0], fr[1] + dip];
  let E;
  if (t < 23.6 || t >= 53) E = fp;
  else if (t < 24) { const s = sstep(23.6, 24, t); E = [lerp(fp[0], STRIKE[0], s), lerp(fp[1], STRIKE[1], s)]; }
  else if (t < 30) E = fightPos(t);
  else if (t < FLING_T0) E = FEXIT;
  else if (t < CATCH_T) E = flingPos(t);
  else if (t < 38.5) E = mouthHand;
  else if (t < 48.2) {
    const tp = toW(rigAt(t - 0.3).tip);
    const sw = clamp(-(tip[0] - tp[0]) * 0.012, -1, 1);
    const dg = [tip[0] - Math.sin(sw) * 110, tip[1] + Math.cos(sw) * 110];
    const b = sstep(38.5, 39.6, t);
    E = [lerp(mouthHand[0], dg[0], b), lerp(mouthHand[1], dg[1], b)];
    S.sw = sw;
  } else if (t < 50.1) {
    const tp = toW(rigAt(t - 0.3).tip);
    const sw = clamp(-(tip[0] - tp[0]) * 0.012, -1, 1);
    const ang = lerp(Math.PI / 2 + sw, BACKANG(t), sstep(48.2, 48.8, t)), L = LC(t);
    E = [tip[0] + Math.cos(ang) * L, tip[1] + Math.sin(ang) * L];
  } else E = qb(Cc.Bk, CASTC, fp, CASTP(t));
  S.E = E;
  const w = wind(900, t);
  S.ctrl = [(tip[0] + E[0]) / 2 + TR.ox(t) + w * 10, (tip[1] + E[1]) / 2 + TR.oy(t)];
  S.fOff = 24 * sstep(29.8, 30.2, t) * (1 - sstep(52.6, 53, t));
  S.floatA = 1 - sstep(23.3, 23.6, t) * (1 - sstep(29.95, 30.1, t));
  S.taut = sstep(23.7, 23.95, t) * (1 - sstep(30.15, 30.45, t)) * (1 - 0.7 * bump(t, 27.35, 0.12));
  if (t >= 24 && t < 30.05) {      // the fish under the surface, pulling
    const f2 = fightPos(t + 0.06), a = Math.atan2(f2[1] - E[1], f2[0] - E[0]);
    S.fight = { x: E[0], y: FY(t), ang: a, a: sstep(24, 24.25, t) * (1 - sstep(29.85, 30.05, t)) * (t > THRASH[0] && t < THRASH[1] ? 0.3 : 1), v: Math.hypot(f2[0] - E[0], f2[1] - E[1]) / 0.06 };
  }
  // fish
  if (t > THRASH[0] && t < THRASH[1]) {   // it breaks the surface once, twisting
    const u = (t - THRASH[0]) / (THRASH[1] - THRASH[0]);
    S.fish = { x: E[0], y: E[1], ang: -Math.PI / 2 + 1.1 * Math.sin(u * 7), bend: Math.sin(t * 34), a: Math.min(1, Math.sin(Math.PI * u) * 3) };
  }
  if (t >= 30 && t < 42.15) {
    let ang, bendF, pos = t < 38.5 ? E : mouthHand;
    if (t >= CATCH_T) pos = mouthHand;
    const lineDir = Math.atan2(pos[1] - tip[1], pos[0] - tip[0]);
    const handAng = 0.12;
    if (t < CATCH_T) {   // tumbling through the air, turning into his palm just as he snatches it
      const f = flingPos(t), fa = Math.atan2(f[3], f[2]) + Math.PI + 0.5 * Math.sin(t * 13);
      let d = ((handAng - fa) % TAU + TAU * 1.5) % TAU - Math.PI;
      ang = fa + d * sstep(CATCH_T - 0.32, CATCH_T, t); bendF = Math.sin(t * 24) * 1.1;
    }
    else if (t < 41.9) {
      const b = sstep(CATCH_T, CATCH_T + 0.45, t); ang = handAng;
      bendF = lerp(Math.sin(t * 24) * 1.1, 0.25 * Math.sin(t * 4.2) + 0.7 * bump(t, 36.4, 0.25) * Math.sin(t * 22), b);
    } else { ang = 0.5; bendF = Math.sin(t * 16) * 0.6; pos = [mouthHand[0], mouthHand[1] + (t - 41.9) * 120]; }
    S.fish = { x: pos[0], y: pos[1], ang, bend: bendF, a: t < 41.9 ? 1 : 1 - sstep(41.95, 42.15, t) };
  }
  if (t >= 42.0 && t < 45.5) {
    const u = (t - 42.0) / 3.5;
    S.under = { x: 1280 - u * 190, y: FISH_Y + 8 + u * 30, a: 0.4 * (1 - u) * sstep(42, 42.25, t) };
  }
  return S;
}
function catchRings() {
  return [
    { t: 2, x: FLOAT0[0], y: FLOAT0[1] + 1, life: 3, size: 12, a: 0.35 },
    { t: 9.5, x: FLOAT0[0], y: FLOAT0[1] + 1, life: 3, size: 12, a: 0.35 },
    { t: 15.5, x: FLOAT0[0], y: FLOAT0[1] + 1, life: 3, size: 12, a: 0.3 },
    { t: 19.3, x: FLOAT0[0], y: FLOAT0[1] + 1, life: 3.2, size: 24, a: 0.6 },
    { t: 21.7, x: FLOAT0[0], y: FLOAT0[1] + 1, life: 3.6, size: 30, a: 0.7 },
    { t: 23.2, x: FLOAT0[0], y: FLOAT0[1] + 1, life: 2.6, size: 26, a: 0.6 },
    { t: 24.0, x: STRIKE[0], y: STRIKE[1], life: 3.5, size: 40, a: 0.7 },
    { t: 25.6, x: 795, y: 806, life: 3, size: 30, a: 0.55 },
    { t: 26.6, x: 788, y: 812, life: 3, size: 26, a: 0.5 },
    { t: 27.3, x: 752, y: 806, life: 4, size: 56, a: 0.8 },
    { t: 28.6, x: 690, y: 812, life: 3, size: 28, a: 0.5 },
    { t: 30.0, x: FEXIT[0], y: FEXIT[1], life: 4, size: 52, a: 0.75 },
    { t: 42.1, x: 1278, y: FISH_Y + 2, life: 4, size: 36, a: 0.7 },
    { t: 53.05, x: FLOAT0[0], y: FLOAT0[1] + 1, life: 3.5, size: 30, a: 0.6 },
    { t: 57.5, x: FLOAT0[0], y: FLOAT0[1] + 1, life: 3, size: 12, a: 0.3 },
  ];
}

/* ------------------------------ drawing ------------------------------ */
const INK = 'rgba(52,34,28,0.95)';
function charMats(P) {
  const warm = P.rim;
  const m = (b, k, r) => ({ b: rgba(hex(b)), k: rgba(hex(k)), r: rgba(r ? hex(r) : mixc(hex(b), warm, 0.6)) });
  return {
    jacket: m('#556b93', '#33405f', null), jacketFar: m('#3e4d70', '#2b3550', '#6f6f86'),
    lining: m('#7f92b4', '#56638a', null), shirt: m('#efe4c6', '#c7aa8e', '#fff6dc'),
    trousers: m('#40434f', '#2a2a36', '#7c6e66'), skin: m('#ecbd93', '#c07f62', '#ffe2b8'), skinFar: m('#cf9a76', '#9e6650', '#f0c08f'),
    hair: m('#2f2b37', '#1a1824', '#d4a272'), mouth: rgba(hex('#7a3030')),
    straw: m('#e4c77e', '#b38d55', '#fff0bf'), strawUnder: m('#b08a52', '#8a6640', '#e8c886'), band: m('#5b3b2c', '#3b2620', '#a07050'),
    creel: m('#b78c50', '#7f5c32', '#f2cf8a'), bag: m('#cdb38c', '#97795c', '#f4dfb6'), strap: m('#6a4a34', '#47301f', '#b98c5c'),
    fishBack: rgba(hex('#5d7189')), fishBelly: rgba(hex('#e9eff0')), fishK: rgba(hex('#aeb9c2')),
  };
}
function capsule(a, b, wa, wb) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], wm = (wa + wb) / 4;
  return [[a[0] + nx * wa / 2, a[1] + ny * wa / 2], [m[0] + nx * wm, m[1] + ny * wm], [b[0] + nx * wb / 2, b[1] + ny * wb / 2],
    [b[0] + ux * wb * 0.42, b[1] + uy * wb * 0.42],
    [b[0] - nx * wb / 2, b[1] - ny * wb / 2], [m[0] - nx * wm, m[1] - ny * wm], [a[0] - nx * wa / 2, a[1] - ny * wa / 2],
    [a[0] - ux * wa * 0.42, a[1] - uy * wa * 0.42]];
}
const xf = (pts, o, a) => pts.map((p) => { const q = rot(p[0], p[1], a); return [o[0] + q[0], o[1] + q[1]]; });
function celPart(c, part, ink) {
  const pts = part.pts, m = part.m, ks = part.ks || 4, rw = part.rw === undefined ? 1.6 : part.rw;
  const p = new Path2D(); spline(p, pts, true);
  c.save(); c.clip(p);
  c.fillStyle = m.b; c.fill(p);
  const sh = new Path2D(); spline(sh, pts, true); spline(sh, pts, true, ks * LX, ks * LY);
  c.fillStyle = m.k; c.fill(sh, 'evenodd');
  if (rw > 0) { const rm = new Path2D(); spline(rm, pts, true); spline(rm, pts, true, -rw * LX, -rw * LY); c.fillStyle = m.r; c.fill(rm, 'evenodd'); }
  if (part.detail) part.detail(c);
  c.restore();
  if (ink) { c.strokeStyle = INK; c.lineWidth = part.iw || 0.9; c.stroke(p); }
  return p;
}
function spline_path(pts) { const p = new Path2D(); spline(p, pts, true); return p; }
function strokeLines(c, lines, w, col) {
  c.strokeStyle = col || INK; c.lineWidth = w; c.beginPath();
  for (const l of lines) { spline(c, l, false); }
  c.stroke();
}

/** Paint the fisher (body, no hands/rod) into his own sprite canvas. */
function paintFisher(c, R, M, P, t, which) {
  const T = R.T, parts = [];
  const hem = R.hem;
  // legs
  // shins: trousers rolled to mid-shin, bare calves (normally hidden under the water line)
  for (const [k, a, far] of [[R.kneeF, R.ankleF, 1], [R.kneeN, R.ankleN, 0]]) {
    if (!a) continue;
    const mid = [lerp(k[0], a[0], 0.45), lerp(k[1], a[1], 0.45)];
    parts.push({ pts: capsule(k, mid, 15.5, 14), m: M.trousers, ks: 4, back: far });
    parts.push({ pts: capsule([lerp(k[0], a[0], 0.4), lerp(k[1], a[1], 0.4)], [lerp(k[0], a[0], 0.52), lerp(k[1], a[1], 0.52)], 16, 15.5), m: M.lining, ks: 2, rw: 1, back: far });
    parts.push({ pts: capsule([lerp(k[0], a[0], 0.52), lerp(k[1], a[1], 0.52)], a, 10.5, 8.5), m: far ? M.skinFar : M.skin, ks: 2.5, rw: 1, back: far });
    const fd = rot(-12, 2, Math.atan2(a[1] - k[1], a[0] - k[0]) - Math.PI / 2);
    parts.push({ pts: capsule(a, [a[0] + fd[0], a[1] + fd[1]], 8.5, 7), m: far ? M.skinFar : M.skin, ks: 2, rw: 0.8, back: far });
  }
  parts.push({ pts: capsule(R.hipF, R.kneeF, 21, 15), m: M.trousers, ks: 5, back: 1 });
  // far upper arm (behind body)
  parts.push({ pts: capsule(R.shF, R.elF, 14, 12), m: M.jacketFar, ks: 4, rw: 0.8, back: 1 });
  // cloth bag at the back hip
  const bagA = T(17, 10);
  parts.push({ pts: xf([[-6, 0], [7, 0], [9.5, 13], [4.5, 20], [-5, 19], [-8.5, 12]], bagA, R.swing * 1.3), m: M.bag, ks: 3.5, back: 1,
    detail: (cc) => strokeLines(cc, [xf([[-5, 4], [0, 6], [6, 4]], bagA, R.swing * 1.3)], 0.7) });
  parts.push({ pts: capsule(R.hipN, R.kneeN, 23, 16), m: M.trousers, ks: 5 });
  // far forearm (tucked behind the body; the hand is drawn over the rod later)
  const fF = [lerp(R.elF[0], R.hF[0], 0.12), lerp(R.elF[1], R.hF[1], 0.12)];
  parts.push({ pts: capsule(R.elF, [lerp(R.elF[0], R.hF[0], 0.25), lerp(R.elF[1], R.hF[1], 0.25)], 13.5, 13), m: M.jacketFar, ks: 3, rw: 0.8, back: 1 });
  parts.push({ pts: capsule(fF, R.hF, 10, 8), m: M.skinFar, ks: 2.5, rw: 1, back: 1 });
  // jacket
  const sc = R.ch / 86;
  const J = [[-9, 92], [-19, 86.5], [-22, 70], [-19.5, 45], [-16.5, 22], [-19.5, -2], [-12, -13], [8, -15], [18, -9], [18, 14], [18.5, 44], [19.5, 72], [13.5, 88], [2, 93.5]];
  const jp = J.map((q) => { const wgt = clamp(-q[1] / 16 + 0.35, 0, 1); return T(q[0] + hem * wgt * (q[0] > -15 ? 1 : 0.5), q[1] > 40 ? 40 + (q[1] - 40) * sc : q[1] - Math.abs(hem) * wgt * 0.15); });
  parts.push({ pts: jp, m: M.jacket, ks: 7, rw: 2,
    detail: (cc) => {
      strokeLines(cc, [[T(-14, 57), T(-16.5, 30), T(-18, 4)], [T(-9, 22), T(3, 21)], [T(12, 60), T(15, 40)]], 0.8);
      // faded patches of indigo
      cc.fillStyle = 'rgba(160,180,210,0.12)'; cc.beginPath(); cc.ellipse(T(4, 50)[0], T(4, 50)[1], 9, 16, R.lean, 0, TAU); cc.fill();
    } });
  parts.push({ pts: [T(-9, 92 * sc), T(-14.5, 87 * sc), T(-18, 74 * sc), T(-18.6, 58), T(-14, 58), T(-11, 74 * sc), T(-6, 89 * sc)], m: M.shirt, ks: 2.5, rw: 0.8 });
  // strap across the chest & the creel
  parts.push({ pts: capsule(T(7, 90 * sc), T(-9, 12), 4.2, 4.2), m: M.strap, ks: 1.4, rw: 0.6 });
  const cA = T(-5, 8), cs = R.swing - R.lean * 0.95;
  const creel = [[-12.5, 0], [12.5, 0], [13.5, 19], [9.5, 25], [-9.5, 25], [-13.5, 19]];
  parts.push({ pts: xf(creel, cA, cs), m: M.creel, ks: 4,
    detail: (cc) => {
      const L = [];
      for (let y = 7; y < 25; y += 4.5) L.push(xf([[-14, y], [0, y + 1.2], [14, y]], cA, cs));
      for (let x = -9; x <= 9; x += 4.5) L.push(xf([[x, 4], [x * 1.05, 14], [x * 0.9, 25]], cA, cs));
      strokeLines(cc, L, 0.55, 'rgba(90,60,30,0.55)');
      strokeLines(cc, [xf([[-13, 4], [0, 5.5], [13, 4]], cA, cs)], 0.9);
    } });
  // neck & head
  parts.push({ pts: capsule(R.neckBase, R.neckTop, 10, 9), m: M.skin, ks: 3.5 });
  // a young face: smooth jaw, small nose
  const HP = [[-2, -16], [-11, -12.5], [-15, -6], [-16, 0], [-15.6, 2.6], [-18.3, 6.6], [-15.6, 8.4], [-15.8, 10.6], [-14.1, 13.8], [-9.5, 16], [-1, 13.6], [5, 8], [9, 2], [10, -6], [6, -13]];
  const hr = R.headRot, hc = R.headC, HS = 1.06;
  const hl = (pts) => xf(pts.map((q) => [q[0] * HS, q[1] * HS]), hc, hr);
  const H = hl(HP), joy = R.joy, brow = R.brow, strain = R.strain, flush = R.flush || strain;
  parts.push({ pts: H, m: M.skin, ks: 4, rw: 1.4,
    detail: (cc) => {
      // hair casts a soft cel shadow on the forehead
      cc.fillStyle = 'rgba(150,80,62,0.45)';
      const sh = hl([[-30, -3.5], [-12, -5.5], [0, -8], [20, -6], [20, -30], [-30, -30]]);
      cc.beginPath(); cc.moveTo(sh[0][0], sh[0][1]); for (const q of sh) cc.lineTo(q[0], q[1]); cc.closePath(); cc.fill();
      // eye: bright, wide when excited, narrowed when focused; blinks
      const open = (1 - R.blink) * (0.75 + 0.25 * Math.max(0, brow)) * (1 - 0.25 * Math.max(0, -brow));
      if (R.happy > 0.5) {
        strokeLines(cc, [hl([[-14.2, 1.4], [-11.6, -0.8], [-9, 1.2]])], 1.5);   // ^ ^ beaming
      } else if (open > 0.15) {
        const e = hl([[-11.4, 1.2]])[0];
        cc.fillStyle = 'rgb(255,250,240)'; cc.beginPath(); cc.ellipse(e[0] - 0.6, e[1], 2.6, 2.6 * open, hr, 0, TAU); cc.fill();
        cc.fillStyle = 'rgb(58,40,34)'; cc.beginPath(); cc.ellipse(e[0] - 1.1, e[1] + 0.2, 1.7, 2.4 * open, hr, 0, TAU); cc.fill();
        cc.fillStyle = '#fff'; cc.beginPath(); cc.arc(e[0] - 1.6, e[1] - 0.7 * open, 0.65, 0, TAU); cc.fill();
      }
      if (R.happy <= 0.5) strokeLines(cc, [hl([[-14.6, -1.2 + (1 - open) * 2.2], [-11.5, -1.9 + (1 - open) * 3], [-8.6, -1.1 + (1 - open) * 2.2]])], 1.5);
      // eyebrow: lifts with excitement, knits with focus
      strokeLines(cc, [hl([[-15.2, -5 - brow * 1.3 + Math.max(0, -brow) * 0.8], [-12, -5.8 - brow * 1.5], [-8.6, -5.4 - brow * 1.1]])], 1.4);
      // mouth: an easy smile that opens into a grin
      if (joy > 0.55) {
        const o = (joy - 0.55) / 0.45;
        const mp = hl([[-16.2, 10], [-13.6, 9.6 - o * 0.4], [-11.8, 9.4], [-13.2, 11.5 + o * 2.2], [-15.6, 11.6 + o * 1.4]]);
        cc.fillStyle = M.mouth; cc.beginPath(); spline(cc, mp, true); cc.fill();
        cc.fillStyle = 'rgba(255,250,240,0.9)'; const tq = hl([[-15.6, 10.1], [-12.4, 9.8], [-12.6, 10.8], [-15.4, 11]]);
        cc.beginPath(); cc.moveTo(tq[0][0], tq[0][1]); for (const q of tq) cc.lineTo(q[0], q[1]); cc.closePath(); cc.fill();
        strokeLines(cc, [mp.concat([mp[0]])], 0.7);
      } else {
        strokeLines(cc, [hl([[-16, 10.6 - joy * 0.6 + strain * 0.5], [-14, 10.9 - strain * 0.55], [-12, 10.4 - joy * 1.4 + strain * 0.6]])], 0.8 + strain * 0.35);
      }
      // a touch of colour in the cheek when he's thrilled
      const ck = hl([[-9.5, 7]])[0];
      cc.fillStyle = 'rgba(228,96,82,' + Math.min(0.55, 0.12 + joy * 0.16 + flush * 0.22).toFixed(3) + ')';
      cc.beginPath(); cc.ellipse(ck[0], ck[1], 3.4 + flush * 1.4, 1.9 + flush * 0.7, hr, 0, TAU); cc.fill();
      if (flush > 0.01) { cc.fillStyle = 'rgba(214,78,66,' + (flush * 0.2).toFixed(3) + ')'; cc.fill(spline_path(H)); }   // flushed with effort
      if (strain > 0.01) {   // and a crease between the brows
        strokeLines(cc, [hl([[-8.6, -7.6], [-8.2, -5.8]])], 0.5 * strain + 0.01, 'rgba(120,60,50,' + (strain * 0.7).toFixed(3) + ')');
      }
    } });
  // tousled dark hair; tips carry the follow-through (weights: 1 = tip, 0 = root)
  const HAIR = [[-20, -0.5, 1], [-15.5, -5, .3], [-20.5, -8, 1], [-16, -13, .4], [-14, -19.5, .55], [-6, -22.5, .5], [2, -23, .6],
    [9.5, -24.5, 1], [9, -19.5, .4], [17.5, -17, 1], [12.5, -12, .4], [18, -7, 1], [12, -3, .3], [13, 3, .9],
    [7.5, 5.5, .2], [4, -3, 0], [-3, -7.5, 0], [-11, -6.5, 0], [-14.2, -2.2, .1]];
  const hs = R.hair;
  const sway = (pts) => pts.map((q, i) => { const w = q[2] === undefined ? 1 : q[2]; return [q[0] + hs[0] * w, q[1] + hs[1] * w]; });
  const hairPts = sway(hl(HAIR).map((q, i) => [q[0], q[1], HAIR[i][2]]));
  parts.push({ pts: hairPts, m: M.hair, ks: 3.5, rw: 1.5,
    detail: (cc) => {
      const strand = (pts, wts) => sway(hl(pts).map((q, i) => [q[0], q[1], wts[i]]));
      strokeLines(cc, [strand([[-4, -12], [-10, -16], [-18, -10]], [0, .5, .9]), strand([[0, -13], [5, -19], [9.2, -23.5]], [0, .5, .95]),
        strand([[3, -10], [10, -13], [15, -18.5]], [0, .5, .95]), strand([[-6, -9], [-13, -9.5], [-20.5, -8.5]], [0, .5, .95]),
        strand([[5, -6], [12, -6], [16.8, -8]], [0, .5, .95])], 0.6, 'rgba(10,8,16,0.8)');
      // back-lit sheen
      cc.strokeStyle = 'rgba(255,214,150,0.55)'; cc.lineWidth = 1.1;
      cc.beginPath(); spline(cc, strand([[-6, -19], [0, -20.5], [6, -18.5]], [.3, .3, .3]), false); cc.stroke();
    } });
  parts.push({ pts: hl([[2, -2], [5.5, -3.5], [7, 1.5], [5, 6], [2, 5]]), m: M.skin, ks: 1.5, rw: 0.6,
    detail: (cc) => strokeLines(cc, [hl([[3.4, -0.5], [5, 1.5], [3.6, 3.6]])], 0.5) });
  // near arm on top
  const eN = R.elN, hN = R.hN;
  parts.push({ pts: capsule(R.shN, eN, 15, 12.5), m: M.jacket, ks: 4.5, rw: 1.8 });
  const cuffEnd = [lerp(eN[0], hN[0], 0.24), lerp(eN[1], hN[1], 0.24)];
  parts.push({ pts: capsule(eN, cuffEnd, 14.5, 13.5), m: M.lining, ks: 3, rw: 1.4,
    detail: (cc) => strokeLines(cc, [[[lerp(eN[0], cuffEnd[0], 0.5) - 6, lerp(eN[1], cuffEnd[1], 0.5) - 3], [lerp(eN[0], cuffEnd[0], 0.5) + 6, lerp(eN[1], cuffEnd[1], 0.5) + 3]]], 0.6) });
  const fa = [lerp(eN[0], hN[0], 0.2), lerp(eN[1], hN[1], 0.2)];
  parts.push({ pts: capsule(fa, hN, 10.5, 8.2), m: M.skin, ks: 2.5, rw: 1.3 });

  // which: 'back' = the far side of him (far leg, far arm, bag), 'front' = everything else, undefined = all
  const list = which ? parts.filter((pt) => (which === 'back') === !!pt.back) : parts;
  // pass 1: heavy silhouette ink; pass 2: cel paint + fine inner ink
  c.lineJoin = 'round'; c.lineCap = 'round';
  const paths = list.map((pt) => { const p = new Path2D(); spline(p, pt.pts, true); return p; });
  c.strokeStyle = INK; c.lineWidth = 2.7;
  for (const p of paths) c.stroke(p);
  for (const pt of list) celPart(c, pt, true);

  // light: warm wrap from the sun side, cool-green bounce from the river, leaf dapples
  c.save(); c.globalCompositeOperation = 'source-atop';
  let g = c.createLinearGradient(40, -260, -60, -40);
  g.addColorStop(0, rgba(P.rim, 0.28)); g.addColorStop(0.5, rgba(P.rim, 0.06)); g.addColorStop(1, rgba(P.rim, 0));
  c.fillStyle = g; c.fillRect(-160, -320, 320, 330);
  g = c.createLinearGradient(0, -36, 0, 0);
  g.addColorStop(0, 'rgba(60,120,110,0)'); g.addColorStop(1, 'rgba(60,120,110,0.32)');
  c.fillStyle = g; c.fillRect(-160, -40, 320, 42);
  const sw = canopySway(t);
  for (let i = 0; i < 4; i++) {
    const x = [-24, 8, -46, 14][i] + sw * (1.4 + i * 0.3), y = [-168, -118, -78, -40][i] + sw * 0.4;
    const f = 0.5 + 0.5 * osc(4 + i, t, i * 1.7);
    g = c.createRadialGradient(x, y, 0, x, y, 13 + i * 2);
    g.addColorStop(0, rgba(P.rim, 0.32 * f)); g.addColorStop(1, rgba(P.rim, 0));
    c.fillStyle = g; c.fillRect(x - 20, y - 20, 40, 40);
  }
  c.restore();
}

/** Hands, rod, line, float, fish and droplets — drawn on the main canvas. */
function drawRod(c, R, P) {
  const N = 16, pts = [], L = [], Rr = [];
  for (let i = 0; i <= N; i++) pts.push(qb(R.butt, R.rodC, R.tip, i / N));
  for (let i = 0; i <= N; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
    const w = lerp(2.6, 0.55, Math.pow(i / N, 0.85)), nx = -dy / d, ny = dx / d;
    L.push([pts[i][0] + nx * w, pts[i][1] + ny * w]); Rr.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  const poly = L.concat(Rr.reverse());
  c.beginPath(); c.moveTo(poly[0][0], poly[0][1]); for (const q of poly) c.lineTo(q[0], q[1]); c.closePath();
  c.fillStyle = 'rgb(196,160,92)'; c.fill();
  c.strokeStyle = INK; c.lineWidth = 0.8; c.stroke();
  c.strokeStyle = rgba(P.rim, 0.85); c.lineWidth = 0.7;
  c.beginPath(); for (let i = 1; i < N - 2; i++) { const a = pts[i], q = Rr[Rr.length - 1 - i]; const x = lerp(a[0], q[0], 0.55), y = lerp(a[1], q[1], 0.55); if (i === 1) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke();
  // bamboo nodes & cord wrap at the grip
  c.strokeStyle = 'rgba(90,60,30,0.85)'; c.lineWidth = 1;
  c.beginPath();
  for (const s of [0.16, 0.3, 0.44, 0.58, 0.72, 0.85]) {
    const i = Math.round(s * N), a = L[i], b = Rr[Rr.length - 1 - i]; c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
  }
  c.stroke();
  c.fillStyle = 'rgb(70,46,34)';
  const g0 = qb(R.butt, R.rodC, R.tip, 0.0), g1 = qb(R.butt, R.rodC, R.tip, 0.07);
  c.beginPath(); c.moveTo(g0[0], g0[1]); c.lineTo(g1[0], g1[1]); c.lineWidth = 5.6; c.strokeStyle = 'rgb(70,46,34)'; c.stroke();
}
function drawHand(c, h, el, M, far) {
  const a = Math.atan2(h[1] - el[1], h[0] - el[0]);
  const pts = xf([[-3, -5], [3.5, -5.6], [7.2, -2.4], [7.6, 2.4], [4, 5.6], [-3, 5]], h, a);
  const p = new Path2D(); spline(p, pts, true);
  c.strokeStyle = INK; c.lineWidth = 2.2; c.stroke(p);
  celPart(c, { pts, m: far ? M.skinFar : M.skin, ks: 2.2, rw: 1 }, true);
  strokeLines(c, [xf([[2, -3.5], [4.5, -0.5], [3.5, 3]], h, a)], 0.6);
}
function drawFish(c, f, M, P) {
  const Lf = 30, n = 9, top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, x = -u * Lf, y = f.bend * Math.sin(u * 2.6) * Lf * 0.16 * u;
    const w = u < 0.82 ? Lf * 0.15 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.08)), 0.75) : Lf * 0.035;
    top.push([x, y - w]); bot.push([x, y + w * 0.9]);
  }
  const tx = -Lf, ty = f.bend * Math.sin(2.6) * Lf * 0.16;
  const body = top.concat([[tx - 6, ty - 6 + f.bend * 3], [tx - 3, ty], [tx - 6, ty + 6 + f.bend * 3]], bot.reverse());
  c.save(); c.globalAlpha = f.a; c.translate(f.x, f.y); c.rotate(f.ang + Math.PI);
  if (Math.cos(f.ang + Math.PI) < 0) c.scale(1, -1);   // keep the dorsal side up
  const p = new Path2D(); spline(p, body, true);
  c.strokeStyle = INK; c.lineWidth = 2; c.stroke(p);
  c.fillStyle = M.fishBelly; c.fill(p);
  c.save(); c.clip(p);
  c.fillStyle = M.fishBack; c.beginPath(); spline(c, body, true, 0, -Lf * 0.1); c.fill();
  c.fillStyle = M.fishK; c.beginPath(); c.rect(-Lf - 10, Lf * 0.02, Lf + 12, 10); c.fill();
  c.strokeStyle = rgba(P.rim, 0.95); c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(-3, -1); c.quadraticCurveTo(-Lf * 0.45, -2 + f.bend * 1.5, -Lf * 0.85, -0.5 + f.bend * 2.5); c.stroke();
  c.restore();
  c.strokeStyle = INK; c.lineWidth = 0.8; c.stroke(p);
  c.fillStyle = 'rgb(30,26,30)'; c.beginPath(); c.arc(-4.2, -1.2, 1.4, 0, TAU); c.fill();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(-4.6, -1.6, 0.5, 0, TAU); c.fill();
  c.restore();
}
function drawDrops(c, t, Cc, P) {
  const g = 980;
  c.fillStyle = rgba(P.wHi);
  for (const d of Cc.drops) {
    const age = t - d.t0;
    if (age < 0 || age > 1.6) continue;
    const x = d.x + d.vx * age, y = d.y + d.vy * age + 0.5 * g * age * age;
    if (y > d.wy + 2 && age > 0.05) continue;
    const vx = d.vx, vy = d.vy + g * age, sp = Math.hypot(vx, vy) || 1;
    c.globalAlpha = Math.min(1, (1.6 - age) * 2);
    c.beginPath(); ellipsePath(c, x, y, d.s * (1 + sp / 900), d.s * 0.7, Math.atan2(vy, vx)); c.fill();
  }
  c.fillStyle = rgba(P.wHiWarm);
  for (const d of Cc.drops) {
    const age = t - d.t0;
    if (age < 0 || age > 1.6) continue;
    const x = d.x + d.vx * age, y = d.y + d.vy * age + 0.5 * g * age * age;
    if (y > d.wy + 2 && age > 0.05) continue;
    c.globalAlpha = Math.min(1, (1.6 - age) * 2);
    c.beginPath(); c.arc(x + d.s * 0.3, y - d.s * 0.3, d.s * 0.35, 0, TAU); c.fill();
  }
  c.globalAlpha = 1;
}
function drawLineAndFloat(c, S, P, t) {
  const tip = S.tip, E = S.E, C = S.ctrl;
  c.lineCap = 'round';
  c.strokeStyle = rgba(mixc(P.wHi, P.rim, 0.3), 0.55 + 0.35 * S.taut); c.lineWidth = 0.9 + 0.3 * S.taut;
  c.beginPath(); c.moveTo(tip[0], tip[1]); c.quadraticCurveTo(C[0], C[1], E[0], E[1]); c.stroke();
  // the taut line flashing in the sun
  if (S.taut > 0.05 && (S.flashT !== undefined || t < 30.5)) {
    const s0 = frac((S.flashT !== undefined ? S.flashT : t - 23.9) * 1.4), s1 = Math.min(1, s0 + 0.18);
    c.strokeStyle = rgba(P.wHiWarm, 0.95 * S.taut); c.lineWidth = 1.8;
    c.beginPath();
    for (let i = 0; i <= 8; i++) { const q = qb(tip, C, E, lerp(s0, s1, i / 8)); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }
    c.stroke();
  }
  // float: a little quill float, red cap
  if (S.floatA > 0.01) {
    let fx = E[0], fy = E[1], ang = 0;
    if (S.fOff > 0.5) {
      // walk back along the curve
      const L = Math.hypot(E[0] - C[0], E[1] - C[1]) + 1, u = 1 - S.fOff / L * 0.5;
      const q = qb(tip, C, E, clamp(u, 0, 1)), q2 = qb(tip, C, E, clamp(u + 0.01, 0, 1));
      fx = q[0]; fy = q[1]; ang = Math.atan2(q2[1] - q[1], q2[0] - q[0]) - Math.PI / 2;
    }
    c.save(); c.globalAlpha = S.floatA;
    if (S.fOff <= 0.5 && !S.hang) { c.beginPath(); c.rect(fx - 20, fy - 40, 40, S.waterY - fy + 40 + 0.6); c.clip(); }
    c.translate(fx, fy); c.rotate(ang);
    if (S.hang) c.scale(S.cs || CURSOR_SCALE, S.cs || CURSOR_SCALE);
    c.fillStyle = 'rgb(246,240,226)'; c.strokeStyle = INK; c.lineWidth = 0.8;
    c.beginPath(); c.ellipse(0, -2.5, 2.4, 5, 0, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = 'rgb(214,74,52)'; c.beginPath(); c.ellipse(0, -6.4, 2.1, 2.6, 0, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(0, -9); c.lineTo(0, -13); c.stroke();
    c.fillStyle = rgba(P.rim, 0.9); c.beginPath(); c.arc(0.8, -7.2, 0.8, 0, TAU); c.fill();
    if (S.hang) {   // the cursor bob: a little hook dangling under the float
      c.strokeStyle = INK; c.lineWidth = 0.7; c.beginPath(); c.moveTo(0, 2.5); c.lineTo(0, 9); c.stroke();
      c.strokeStyle = 'rgb(160,160,168)'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(0, 9); c.lineTo(0, 15); c.arc(-2.6, 15, 2.6, 0, Math.PI * 0.9); c.stroke();
    }
    c.restore();
    if (S.fOff <= 0.5 && !S.hang) {
      c.strokeStyle = rgba(P.wHi, 0.6); c.lineWidth = 0.8;
      c.beginPath(); c.ellipse(fx, S.waterY + 0.4, 4.5, 1.2, 0, 0, TAU); c.stroke();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Catches: fish and the odd treasure, each carrying a fun fact       */
/* ------------------------------------------------------------------ */
const CATCHES = {
  fish: { label: 'a river fish' },
  jjajangmyeon: { label: 'a bowl of jjajangmyeon' },
  bottle: { label: 'a note in a bottle' },
  viola: { label: 'an old viola' },
  tinikling: { label: 'a pair of Tinikling sticks' },
  hongkong: { label: 'a Hong Kong neon sign' },
};
const DEFAULT_FACTS = {
  fish: ['[Fun fact #1 about you. Set facts.fish in RiverFisher.init()]', '[Fun fact #2 about you]', '[Fun fact #3 about you]'],
  jjajangmyeon: ['[A jjajangmyeon fact. Set facts.jjajangmyeon]'],
  bottle: ['[A message-in-a-bottle fact. Set facts.bottle]'],
  viola: ['[A viola fact. Set facts.viola]'],
};
// where the hand grips each treasure (item-local units), and how it's tilted when shown off
const GRIP = { jjajangmyeon: { dx: -3, dy: 14, ang: 0, s: 1.3, lift: 78 }, bottle: { dx: 2, dy: -2, ang: -0.45, s: 1.3, lift: 64 }, viola: { dx: 0, dy: 33, ang: -0.22, s: 1.35, lift: 140 },
  tinikling: { dx: -20, dy: 0, ang: -2.2, s: 1.05, lift: 118 }, hongkong: { dx: 0, dy: 24, ang: 0, s: 1.05, lift: 96 } };
function drawBowl(c) {
  // a white restaurant bowl, glossy black-bean sauce, noodles, cucumber, chopsticks
  const body = new Path2D();
  body.moveTo(-17, 0); body.bezierCurveTo(-17, 8, -12, 14, -7, 15); body.lineTo(7, 15); body.bezierCurveTo(12, 14, 17, 8, 17, 0); body.closePath();
  c.lineWidth = 2.2; c.strokeStyle = INK; c.stroke(body);
  c.fillStyle = 'rgb(246,243,234)'; c.fill(body);
  c.save(); c.clip(body);
  c.fillStyle = 'rgb(206,200,190)'; c.beginPath(); c.ellipse(-9, 10, 12, 9, 0, 0, TAU); c.fill();   // cel shadow
  c.strokeStyle = 'rgb(196,58,46)'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-17, 4.5); c.quadraticCurveTo(0, 6.5, 17, 4.5); c.stroke();
  c.fillStyle = 'rgb(54,92,168)'; for (const x of [-10, -3, 4, 11]) { c.beginPath(); c.arc(x, 9, 1.1, 0, TAU); c.fill(); }
  c.restore();
  c.strokeStyle = INK; c.lineWidth = 1; c.stroke(body);
  // rim & sauce
  c.fillStyle = 'rgb(250,248,242)'; c.beginPath(); c.ellipse(0, 0, 17, 4.6, 0, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = 'rgb(240,214,138)';
  c.beginPath(); c.ellipse(0, 0.2, 15, 3.6, 0, 0, TAU); c.fill();
  const sauce = new Path2D(); sauce.moveTo(-13, 0.6); sauce.bezierCurveTo(-11, -6, -4, -9, 1, -8.5); sauce.bezierCurveTo(7, -8, 12, -4, 13, 0.6); sauce.quadraticCurveTo(0, 3, -13, 0.6); sauce.closePath();
  c.fillStyle = 'rgb(58,36,22)'; c.fill(sauce); c.lineWidth = 0.9; c.stroke(sauce);
  c.strokeStyle = 'rgb(240,214,138)'; c.lineWidth = 1.1;   // noodles peeking out
  c.beginPath(); c.moveTo(-13, 0.5); c.quadraticCurveTo(-10, -2.5, -8, 0.8); c.moveTo(9, 0.8); c.quadraticCurveTo(11, -2, 13.5, 0.4); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1;   // gloss
  c.beginPath(); c.moveTo(-5, -6.4); c.quadraticCurveTo(0, -8, 5, -6.6); c.stroke();
  c.fillStyle = 'rgb(124,191,74)';   // julienned cucumber
  for (const q of [[-4, -8.4, 0.3], [1, -9.4, -0.2], [5, -7.8, 0.5], [-1, -7.6, -0.7]]) { c.save(); c.translate(q[0], q[1]); c.rotate(q[2]); c.fillRect(-3, -0.6, 6, 1.2); c.restore(); }
  c.strokeStyle = 'rgb(168,120,70)'; c.lineWidth = 1.4;   // chopsticks
  c.beginPath(); c.moveTo(3, -5); c.lineTo(15, -22); c.moveTo(6, -4.5); c.lineTo(19, -20); c.stroke();
  c.strokeStyle = INK; c.lineWidth = 0.5; c.beginPath(); c.moveTo(3, -5); c.lineTo(15, -22); c.moveTo(6, -4.5); c.lineTo(19, -20); c.stroke();
}
function drawBottle(c, o) {
  o = o || {}; const corked = o.corked !== false, noteIn = o.noteIn !== false;
  // green glass, cork, a rolled note tied with red string
  const g = new Path2D();
  g.moveTo(-15, -6); g.lineTo(6, -6); g.quadraticCurveTo(10, -6, 12, -3); g.lineTo(17, -3); g.lineTo(17, 3); g.lineTo(12, 3); g.quadraticCurveTo(10, 6, 6, 6); g.lineTo(-15, 6); g.quadraticCurveTo(-18, 6, -18, 0); g.quadraticCurveTo(-18, -6, -15, -6); g.closePath();
  c.lineWidth = 2.2; c.strokeStyle = INK; c.stroke(g);
  c.fillStyle = 'rgba(150,200,170,0.55)'; c.fill(g);
  if (noteIn) {
  c.fillStyle = 'rgb(244,234,206)'; c.fillRect(-13, -3.2, 15, 6.4);   // the rolled note
  c.strokeStyle = 'rgba(120,100,70,0.7)'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(-13, -1); c.lineTo(2, -1); c.moveTo(-13, 1.2); c.lineTo(2, 1.2); c.stroke();
  c.fillStyle = 'rgb(200,60,50)'; c.fillRect(-6, -3.4, 1.8, 6.8);
  }
  c.fillStyle = 'rgba(110,170,140,0.35)'; c.fill(g);   // glass over the note
  if (corked) { c.fillStyle = 'rgb(176,128,80)'; c.fillRect(17, -2.6, 4.5, 5.2);   // cork
  c.strokeStyle = INK; c.lineWidth = 0.8; c.strokeRect(17, -2.6, 4.5, 5.2); }
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.2;   // glint on the glass
  c.beginPath(); c.moveTo(-14, -3.8); c.lineTo(5, -3.8); c.stroke();
  c.strokeStyle = INK; c.lineWidth = 0.9; c.stroke(g);
}
function drawTinikling(c) {
  // two long bamboo poles held together near one end, the way dancers carry them off the floor
  for (const [oy, tilt, len] of [[-3.6, -0.04, 112], [3.6, 0.035, 106]]) {
    c.save(); c.rotate(tilt); c.translate(0, oy);
    const x0 = -36, x1 = x0 + len, r = 3.3;
    const body = new Path2D();
    body.moveTo(x0, -r); body.lineTo(x1, -r * 0.88); body.quadraticCurveTo(x1 + 2, 0, x1, r * 0.88); body.lineTo(x0, r); body.quadraticCurveTo(x0 - 2, 0, x0, -r); body.closePath();
    c.lineWidth = 2.2; c.strokeStyle = INK; c.stroke(body);
    c.fillStyle = 'rgb(208,174,100)'; c.fill(body);
    c.save(); c.clip(body);
    c.fillStyle = 'rgb(163,126,64)'; c.fillRect(x0 - 3, r * 0.15, len + 6, r);                // cel shadow underneath
    c.fillStyle = 'rgba(255,244,210,0.75)'; c.fillRect(x0 + 2, -r * 0.72, len - 4, 1.1);     // sheen along the top
    c.restore();
    c.strokeStyle = 'rgb(112,82,40)'; c.lineWidth = 1.3;                                       // bamboo nodes
    c.beginPath(); for (let x = x0 + 13; x < x1 - 5; x += 19) { c.moveTo(x, -r); c.lineTo(x + 0.6, r); } c.stroke();
    c.lineWidth = 0.9; c.strokeStyle = INK; c.stroke(body);
    c.fillStyle = 'rgb(120,88,44)'; c.beginPath(); c.ellipse(x1 + 0.4, 0, 1.2, r * 0.75, 0, 0, TAU); c.fill();   // the hollow end
    c.restore();
  }
}
function drawNeonSign(c) {
  // a little "Welcome to Hong Kong" neon sign on a dark board
  const w = 80, h = 48, x = -w / 2, y = -h / 2;
  const board = new Path2D(); board.moveTo(x + 6, y); board.arcTo(x + w, y, x + w, y + h, 6); board.arcTo(x + w, y + h, x, y + h, 6); board.arcTo(x, y + h, x, y, 6); board.arcTo(x, y, x + w, y, 6); board.closePath();
  c.lineWidth = 2.4; c.strokeStyle = INK; c.stroke(board);
  c.fillStyle = 'rgb(26,28,52)'; c.fill(board);
  c.save(); c.clip(board); c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x, y, w, h * 0.42); c.restore();
  const neon = (draw, col, glow) => {   // a glowing tube: coloured halo, then a hot pale core
    c.save(); c.shadowColor = col; c.shadowBlur = glow; c.strokeStyle = col; c.fillStyle = col; draw(); draw(); c.restore();
    c.save(); c.globalAlpha = 0.85; c.strokeStyle = 'rgba(255,248,252,0.9)'; c.fillStyle = 'rgba(255,248,252,0.9)'; c.lineWidth *= 0.45; draw(); c.restore();
  };
  // a pink tube border
  c.lineWidth = 1.6;
  neon(() => { c.beginPath(); c.rect(x + 4.5, y + 4.5, w - 9, h - 9); c.stroke(); }, 'rgb(255,92,178)', 7);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '700 7.4px "Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif';
  neon(() => c.fillText('WELCOME TO', 0, y + 13.5), 'rgb(92,232,255)', 6);
  c.font = '900 13.5px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  neon(() => c.fillText('HONG KONG', 0, y + 26), 'rgb(255,98,186)', 8);
  c.font = '700 8px "PingFang HK", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif';
  neon(() => c.fillText('香港', 0, y + 37.5), 'rgb(255,214,92)', 6);
  c.textAlign = 'start'; c.textBaseline = 'alphabetic';
}
function drawViola(c) {
  // an old, water-stained viola with a strand of river weed caught on it
  const B = [[0, -18], [10, -16], [12.5, -9], [10, -3], [8, 2], [9.5, 8], [14, 16], [13, 26], [6, 31], [0, 32], [-6, 31], [-13, 26], [-14, 16], [-9.5, 8], [-8, 2], [-10, -3], [-12.5, -9], [-10, -16]];
  const body = new Path2D(); spline(body, B, true);
  c.lineWidth = 2.4; c.strokeStyle = INK; c.stroke(body);
  c.fillStyle = 'rgb(168,86,42)'; c.fill(body);
  c.save(); c.clip(body);
  c.fillStyle = 'rgb(112,52,24)'; const sh = new Path2D(); spline(sh, B, true, 4, -3); c.fill(body); c.fillStyle = 'rgb(168,86,42)'; c.fill(sh);
  c.fillStyle = 'rgba(255,214,150,0.35)'; c.beginPath(); c.ellipse(5, -8, 3, 7, 0.3, 0, TAU); c.ellipse(7, 18, 3.5, 8, 0.3, 0, TAU); c.fill();
  c.fillStyle = 'rgba(230,220,190,0.22)'; c.beginPath(); c.ellipse(-6, 22, 5, 3, 0.4, 0, TAU); c.fill();   // water stain
  c.restore();
  c.strokeStyle = INK; c.lineWidth = 1; c.stroke(body);
  c.strokeStyle = 'rgb(40,24,16)'; c.lineWidth = 1;   // f-holes
  c.beginPath(); c.moveTo(-5, 3); c.bezierCurveTo(-7, 7, -3, 10, -5, 14); c.moveTo(5, 3); c.bezierCurveTo(7, 7, 3, 10, 5, 14); c.stroke();
  c.fillStyle = 'rgb(38,30,28)';   // neck, fingerboard, pegbox, scroll
  c.beginPath(); c.moveTo(-2.4, -40); c.lineTo(2.4, -40); c.lineTo(3.2, 12); c.lineTo(-3.2, 12); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = 'rgb(150,76,36)'; c.beginPath(); c.moveTo(-2.6, -50); c.lineTo(2.6, -50); c.lineTo(2.6, -40); c.lineTo(-2.6, -40); c.closePath(); c.fill(); c.stroke();
  c.beginPath(); c.arc(0.5, -53, 3.6, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.arc(0.8, -53, 1.6, 0, TAU); c.stroke();
  c.lineWidth = 1.2; c.beginPath(); c.moveTo(-2.6, -47); c.lineTo(-5, -47); c.moveTo(2.6, -44); c.lineTo(5, -44); c.stroke();   // pegs
  c.fillStyle = 'rgb(38,30,28)'; c.beginPath(); c.moveTo(-3, 20); c.lineTo(3, 20); c.lineTo(2, 29); c.lineTo(-2, 29); c.closePath(); c.fill();   // tailpiece
  c.strokeStyle = 'rgb(214,196,150)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-4, 15); c.lineTo(4, 15); c.stroke();   // bridge
  c.strokeStyle = 'rgba(235,230,215,0.75)'; c.lineWidth = 0.35;   // strings
  c.beginPath(); for (const x of [-1.2, -0.4, 0.4, 1.2]) { c.moveTo(x, -40); c.lineTo(x * 1.4, 21); } c.stroke();
  c.strokeStyle = 'rgb(86,140,60)'; c.lineWidth = 1.6;   // river weed
  c.beginPath(); c.moveTo(-1, -30); c.bezierCurveTo(-8, -26, -6, -18, -13, -12); c.moveTo(-1, -30); c.quadraticCurveTo(4, -24, 2, -16); c.stroke();
}
/** draw a treasure at (x, y) = its grip point */
function drawTreasure(c, kind, x, y, ang, sc, a, o) {
  const g = GRIP[kind]; if (!g || a <= 0.01 || sc <= 0.01) return;
  c.save(); c.globalAlpha = a; c.translate(x, y); c.rotate(ang); c.scale(sc * g.s, sc * g.s); c.translate(-g.dx, -g.dy);
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (g.img) c.drawImage(g.img, -g.size / 2, -g.size / 2, g.size, g.size);   // a catch supplied as an image
  else if (kind === 'jjajangmyeon') drawBowl(c); else if (kind === 'bottle') drawBottle(c, o);
  else if (kind === 'tinikling') drawTinikling(c); else if (kind === 'hongkong') drawNeonSign(c); else drawViola(c);
  c.restore();
}


/* the wordless how-to bubble that floats over him while he idles: 1 click · 2 hold & reel · 3 catches */
const HINT_ICONS = (() => {
  const ink = '#25302f', hot = '#e0603f';
  const mouse = (pressed, extra) => '<svg viewBox="-5 -5 34 40" width="17" height="20" aria-hidden="true">' +
    '<rect x="4" y="3" width="16" height="26" rx="8" fill="#fff" stroke="' + ink + '" stroke-width="2"/>' +
    '<path d="M12 3.2A8 8 0 0 0 4.2 11V13H12Z" fill="' + (pressed ? hot : 'none') + '" stroke="none"/>' +
    '<path d="M12 3v10M4 13h16" stroke="' + ink + '" stroke-width="1.6" fill="none"/>' + (extra || '') + '</svg>';
  const tap = '<path d="M1 3.5-3 1.8M3.5.5 2-3.2M7.2-.6 7.6-4.4" stroke="' + hot + '" stroke-width="1.8" stroke-linecap="round" fill="none"/>';
  const hold = '<path d="M7 34h10" stroke="' + hot + '" stroke-width="2.2" stroke-linecap="round"/><circle cx="7" cy="34" r="1.6" fill="' + hot + '"/>';
  const reel = '<svg viewBox="0 0 32 32" width="21" height="21" aria-hidden="true">' +   // a rod angled up-left with its reel spinning
    '<path d="M29.6 28.2 4.2 2.8 3.2 3.8 28.2 29.6Z" fill="#c9a35d" stroke="' + ink + '" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M29.8 28 24.6 22.8 22.8 24.6 28 29.8Z" fill="#5a3a2c" stroke="' + ink + '" stroke-width="1.1"/>' +
    '<path d="M3.7 3.3V11" stroke="' + ink + '" stroke-width=".9"/><path d="M3.7 11v2.4a1.6 1.6 0 0 1-3.2 0" stroke="#8d8f98" stroke-width="1.1" fill="none"/>' +
    '<path d="M20.4 20.4 17.6 23.2" stroke="' + ink + '" stroke-width="1.8"/>' +
    '<circle cx="15.6" cy="25.2" r="4.4" fill="#fff" stroke="' + ink + '" stroke-width="1.6"/><circle cx="15.6" cy="25.2" r="1.3" fill="' + ink + '"/>' +
    '<path d="M15.6 25.2 11.6 27.4" stroke="' + ink + '" stroke-width="1.4" stroke-linecap="round"/><circle cx="11" cy="27.8" r="1.5" fill="' + hot + '"/>' +
    '<path d="M21.6 27.6A6.8 6.8 0 0 1 13.4 31.6" stroke="' + hot + '" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M15.6 30 13 31.6 15.2 33.4" stroke="' + hot + '" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -2)"/></svg>';
  return [mouse(true, tap), mouse(true, hold) + reel, '%CATCHES%'];
})();
/** the actual fish and bottle from the scene, painted small for the bubble */
function catchIcons(M, P) {
  const r = Math.min(3, (window.devicePixelRatio || 1) * 1.6), out = [];
  const fc = mkCanvas(46 * r, 22 * r), f = fc.getContext('2d');
  f.setTransform(r, 0, 0, r, 0, 0); f.lineJoin = 'round'; f.lineCap = 'round';
  drawFish(f, { x: 5, y: 11, ang: 0, bend: 0.35, a: 1 }, M, P);
  out.push('<img src="' + fc.toDataURL() + '" width="27" height="13" alt="">');
  const bc = mkCanvas(30 * r, 46 * r), b = bc.getContext('2d');
  b.setTransform(r, 0, 0, r, 0, 0);
  drawTreasure(b, 'bottle', 15, 23, -1.25, 0.8, 1, {});
  out.push('<img src="' + bc.toDataURL() + '" width="12" height="19" alt="">');
  return out.join('');
}
function hintBubble(M, P) {
  if (!document.getElementById('rf-hint-style')) {
    const st = document.createElement('style'); st.id = 'rf-hint-style';
    st.textContent = '.rf-hint{position:fixed;left:0;top:0;z-index:6;display:flex;align-items:center;gap:7px;padding:4px 8px;background:#fffaf0;border-radius:11px;' +
      'box-shadow:0 0 0 1.3px rgba(46,30,24,.8),0 6px 16px rgba(16,36,40,.2);pointer-events:none;opacity:0;transform:translateY(8px) scale(.94);transform-origin:50% 100%;' +
      'transition:opacity .35s ease,transform .45s cubic-bezier(.2,.9,.3,1.25)}' +
      '.rf-hint.on{opacity:1;transform:none;animation:rf-bob 3.2s ease-in-out .5s infinite}' +
      '@keyframes rf-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}' +
      '@media (prefers-reduced-motion:reduce){.rf-hint.on{animation:none}}' +
      '.rf-hint .rf-s{display:flex;align-items:center;gap:2px}.rf-hint img{display:block}' +
      '.rf-hint .rf-n{display:grid;place-items:center;width:13px;height:13px;border-radius:50%;background:#25302f;color:#fffaf0;font:700 8.5px/1 ui-sans-serif,system-ui,sans-serif;margin-right:1px}' +
      '.rf-hint .rf-sep{width:1px;align-self:stretch;margin:3px 0;background:rgba(46,30,24,.16)}' +
      '.rf-hint::after{content:"";position:absolute;left:calc(50% - 5px);bottom:-5px;width:10px;height:10px;background:#fffaf0;transform:rotate(45deg);box-shadow:1.3px 1.3px 0 0 rgba(46,30,24,.8);border-radius:0 0 2px 0}';
    document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.className = 'rf-hint'; el.setAttribute('data-rf-ignore', ''); el.setAttribute('role', 'note');
  el.setAttribute('aria-label', 'How to fish: 1, click the water to cast. 2, when a fish bites, hold the mouse to reel. 3, catch fish and treasures, each one a fun fact.');
  const icons = HINT_ICONS.slice(); icons[2] = catchIcons(M, P);
  el.innerHTML = icons.map((ic, i) => '<span class="rf-s"><span class="rf-n">' + (i + 1) + '</span>' + ic + '</span>').join('<span class="rf-sep"></span>');
  document.body.appendChild(el);
  return el;
}

/* the fact card: real DOM text so it's crisp, selectable and read out by screen readers */
/** a fact is a string, or { text, linkText, link }: the linkText part of the text becomes a link (plain text until link is set) */
function setFactText(el, f) {
  el.textContent = '';
  const text = typeof f === 'string' ? f : (f && f.text) || '';
  const lt = f && typeof f === 'object' && f.linkText, i = lt ? text.indexOf(lt) : -1;
  if (i < 0) { el.textContent = text; return; }
  el.append(text.slice(0, i));
  const a = document.createElement(f.link ? 'a' : 'span');
  if (f.link) { a.href = f.link; a.target = '_blank'; a.rel = 'noopener'; } else a.className = 'rf-soon';
  a.textContent = lt; el.append(a, text.slice(i + lt.length));
}
function factCard() {
  if (!document.getElementById('rf-fact-style')) {
    const st = document.createElement('style'); st.id = 'rf-fact-style';
    st.textContent = '.rf-fact{position:fixed;left:0;top:0;z-index:6;width:max-content;max-width:min(300px,calc(100vw - 32px));box-sizing:border-box;background:#fffaf0;color:#25302f;' +
      'border-radius:16px 18px 14px 18px;padding:14px 16px 12px;box-shadow:0 0 0 1.6px rgba(46,30,24,.8),0 12px 30px rgba(16,36,40,.28);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'opacity:0;transform:translateY(10px) scale(.94) rotate(-1.2deg);transform-origin:85% 100%;transition:opacity .3s ease,transform .4s cubic-bezier(.2,.9,.3,1.25);pointer-events:none;cursor:auto}' +
      '.rf-fact.on{opacity:1;transform:rotate(-1.2deg);pointer-events:auto}' +
      '.rf-fact .rf-k{display:block;font:700 11.5px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#9a6430;margin:0 0 6px}' +
      '.rf-fact .rf-t{margin:0}.rf-fact .rf-t a{color:#b4562c;font-weight:600;text-decoration:underline;text-underline-offset:2px}.rf-fact .rf-t .rf-soon{font-weight:600}' +
      '.rf-fact .rf-go{margin-top:10px;font:600 13px/1 ui-sans-serif,system-ui,sans-serif;background:#25302f;color:#fffaf0;border:0;border-radius:999px;padding:7px 13px;cursor:pointer}' +
      '.rf-fact::after{content:"";position:absolute;right:26px;bottom:-9px;width:16px;height:16px;background:#fffaf0;transform:rotate(45deg);box-shadow:1.6px 1.6px 0 0 rgba(46,30,24,.8);border-radius:0 0 3px 0}';
    document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.className = 'rf-fact'; el.setAttribute('data-rf-ignore', ''); el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  const k = document.createElement('span'); k.className = 'rf-k';
  const t = document.createElement('p'); t.className = 'rf-t';
  const b = document.createElement('button'); b.className = 'rf-go'; b.type = 'button'; b.textContent = 'Keep fishing →';
  el.append(k, t, b); document.body.appendChild(el);
  return { el, k, t, b };
}

/* ------------------------------------------------------------------ */
/*  The message in a bottle: plant the rod, pop the cork, slide the    */
/*  note out, unroll it and hold it up like a board to be broken       */
/* ------------------------------------------------------------------ */
const BOTTLE_LB = [-66, -128], NOTE_C = [-48, -150], NOTE_W = 58, NOTE_H = 40, CREEL_L = [-10, -72], BAG_L = [18, -78];
const BOTTLE_HOLD = 4.4;
const lerp2 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
const fromW = (p) => [(p[0] - FISH_X) / FS, (p[1] - FISH_Y) / FS];
/** bottle-local point (item units) → fisher-local, for a bottle gripped at hand `h` and tilted `ang` */
function bottlePt(h, ang, px, py) {
  const g = GRIP.bottle, q = rot((px - g.dx) * g.s, (py - g.dy) * g.s, ang);
  return [h[0] + q[0] / FS, h[1] + q[1] / FS];
}
const bottleAng = (el) => lerp(-0.45, -0.1, sstep(2.25, 2.5, el));
/** choreography while unwrapping the note (el = seconds into the bit) */
function bottleChoreo(el) {
  const k = { lh: 0, plant: sstep(0.5, 1.15, el), rodA: 1.3, g: [-14, -52] };
  const ang = bottleAng(el), w = lerp(8, NOTE_W, sstep(3.6, 4.35, el));
  // left hand: holds the bottle, drops it in the creel, then takes the note's left edge
  if (el < 2.85) k.lf = BOTTLE_LB;
  else if (el < 3.3) k.lf = lerp2(BOTTLE_LB, CREEL_L, sstep(2.85, 3.12, el));   // arrives ~3.12, lets go of it there
  else k.lf = lerp2(CREEL_L, [NOTE_C[0] - w / 2, NOTE_C[1]], sstep(3.3, 3.62, el));
  // right hand: plants the rod, pops the cork, pulls the note, unrolls it
  const cork = bottlePt(BOTTLE_LB, ang, 20.5, 0), neck = bottlePt(BOTTLE_LB, ang, 18, 0);
  const axis = [Math.cos(ang), Math.sin(ang)];
  let rf = null, rfw = 0;
  if (el >= 1.15) {
    rfw = sstep(1.15, 1.8, el);
    if (el < 2.0) rf = cork;
    else if (el < 2.25) rf = lerp2(cork, [cork[0] + 14, cork[1] - 9], sstep(2.0, 2.18, el));
    else if (el < 2.45) rf = lerp2([cork[0] + 14, cork[1] - 9], neck, sstep(2.25, 2.45, el));
    else if (el < 2.85) { const u = sstep(2.45, 2.85, el); rf = [neck[0] + axis[0] * u * 22, neck[1] + axis[1] * u * 22]; }
    else if (el < 3.6) rf = lerp2([neck[0] + axis[0] * 22, neck[1] + axis[1] * 22], [NOTE_C[0] + 4, NOTE_C[1]], sstep(2.85, 3.5, el));
    else rf = [NOTE_C[0] + w / 2, NOTE_C[1]];
  }
  k.rf = rf; k.rfw = rfw;
  k.bAng = ang; k.bScale = 1 - sstep(3.1, 3.3, el); k.corked = el < 2.0; k.noteIn = el < 2.45;
  k.scroll = el < 2.45 ? null : el < 2.85 ? 'slide' : el < 3.6 ? 'held' : 'paper';
  k.slideU = sstep(2.45, 2.85, el); k.w = w;
  // acting
  const he = el - BOTTLE_HOLD, hw = sstep(BOTTLE_HOLD - 0.5, BOTTLE_HOLD + 0.2, el), pop = sstep(1.9, 2.05, el) * (1 - sstep(2.4, 2.6, el));
  k.head = lerp(lerp(0.36, 0.22, sstep(2.9, 3.7, el)), 0.03 + 0.02 * Math.sin(Math.max(0, he) * 1.3), hw);
  k.joy = lerp(lerp(lerp(0.45, 0.65, sstep(2.4, 2.8, el)), 0.95, pop), 1, hw);
  k.brow = lerp(lerp(0.7, 1, pop), 0.35, hw);
  k.happy = he > 0.3 && he < 2.6 ? 1 : 0;
  k.lean = lerp(0.1, -0.03, hw); k.hy = -1.5 * hw;
  return k;
}
/** putting it all away: roll the note up, tuck it in the bag, pull the rod back out */
function bottleEndChoreo(el) {
  const w = lerp(NOTE_W, 8, sstep(0, 0.5, el));
  const k = { plant: 1 - sstep(1.5, 2.1, el), lh: sstep(1.7, 2.1, el), w };
  k.lf = el < 0.5 ? [NOTE_C[0] - w / 2, NOTE_C[1]] : lerp2([NOTE_C[0] - 4, NOTE_C[1]], [-30, -110], sstep(0.5, 0.8, el));
  const rodGrip = [PLANT_B[0] - Math.cos(PLANT_A) * 70, PLANT_B[1] - Math.sin(PLANT_A) * 70];
  if (el < 0.4) { k.rf = [NOTE_C[0] + w / 2, NOTE_C[1]]; k.rfw = 1; }
  else if (el < 0.95) { k.rf = lerp2([NOTE_C[0] + 4, NOTE_C[1]], BAG_L, sstep(0.4, 0.9, el)); k.rfw = 1; }
  else { k.rf = lerp2(BAG_L, rodGrip, sstep(0.95, 1.45, el)); k.rfw = 1 - sstep(1.5, 2.1, el); }
  k.scroll = el < 0.5 ? 'paper' : el < 0.95 ? 'held' : null;
  k.scrollScale = 1 - sstep(0.8, 0.95, el);
  k.joy = 0.7; k.brow = 0.4; k.ew = 1 - sstep(1.6, 2.1, el);
  return k;
}
function drawScroll(c, x, y, ang, len, sc) {
  c.save(); c.translate(x, y); c.rotate(ang); c.scale(sc, sc);
  const r = 3.6;
  c.fillStyle = 'rgb(244,234,206)'; c.strokeStyle = INK; c.lineWidth = 0.9;
  c.beginPath(); c.rect(-len / 2, -r, len, r * 2); c.fill(); c.stroke();
  c.fillStyle = 'rgb(222,206,170)'; c.beginPath(); c.ellipse(len / 2, 0, 1.4, r, 0, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = 'rgb(200,60,50)'; c.fillRect(-1, -r - 0.2, 2.2, r * 2 + 0.4);
  c.restore();
}
/** the unrolled note, held up flat like a board: rolled ends curl at the hands */
function drawNote(c, xl, xr, y, open) {
  const h = NOTE_H * FS, top = y - h / 2, w = xr - xl;
  if (w < 4) return;
  c.save();
  c.lineJoin = 'round';
  c.fillStyle = 'rgba(40,30,20,0.18)'; c.fillRect(xl + 3, top + 4, w, h);   // soft shadow on his jacket
  c.fillStyle = 'rgb(248,240,218)'; c.strokeStyle = INK; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(xl, top); c.lineTo(xr, top); c.lineTo(xr, top + h); c.lineTo(xl, top + h); c.closePath(); c.fill(); c.stroke();
  // paper tone & a cel shadow on the lower-left
  c.save(); c.clip();
  c.fillStyle = 'rgba(214,196,160,0.6)'; c.beginPath(); c.moveTo(xl, top + h * 0.55); c.lineTo(xl + w * 0.35, top + h); c.lineTo(xl, top + h); c.closePath(); c.fill();
  // handwriting: little scribbled lines (the real words are on the card)
  c.strokeStyle = 'rgba(60,50,70,0.55)'; c.lineWidth = 0.9;
  const lines = 4, a = clamp(open, 0, 1);
  for (let i = 0; i < lines; i++) {
    const ly = top + h * (0.24 + i * 0.17), lw = (w - 14) * (i === lines - 1 ? 0.55 : 0.9) * a;
    c.beginPath(); c.moveTo(xl + 7, ly);
    for (let x = 0; x < lw; x += 4) c.lineTo(xl + 7 + x, ly + Math.sin(x * 0.9 + i * 2) * 1.1);
    c.stroke();
  }
  if (a > 0.9) {   // a tiny heart doodle in the corner
    c.fillStyle = 'rgba(200,70,70,0.75)'; const hx = xr - 10, hy = top + h - 9;
    c.beginPath(); c.moveTo(hx, hy + 2.5); c.bezierCurveTo(hx - 4, hy - 1, hx - 2, hy - 4, hx, hy - 1.5); c.bezierCurveTo(hx + 2, hy - 4, hx + 4, hy - 1, hx, hy + 2.5); c.fill();
  }
  c.restore();
  // curled ends
  for (const [x, s] of [[xl, -1], [xr, 1]]) {
    c.fillStyle = 'rgb(232,220,192)'; c.beginPath(); c.ellipse(x, y, 3.2, h / 2 + 1.5, 0, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(46,30,24,0.6)'; c.beginPath(); c.moveTo(x + s * 1.2, top + 2); c.lineTo(x + s * 1.2, top + h - 2); c.stroke(); c.strokeStyle = INK;
  }
  c.restore();
}

/* ------------------------------------------------------------------ */
/*  GAME MODE — the cursor is the bob                                  */
/*  idle → (click) cast → wait/nibbles → (click on the bite) hook →    */
/*  fight minigame (hold to raise the bar over the fish) → catch/escape */
/* ------------------------------------------------------------------ */
const IDLE_A = 0.5, IDLE_B = 16, FIGHT_A = 24.4, FIGHT_B = 29.4;
// game cast timing (elapsed seconds → keyed timeline): the swing at its normal pace, then the float flies out in ~1.2 s instead of 2.9
const CAST_T = (el) => { const k = [[0, 47.2], [2.9, 50.1], [4.1, 53], [5.6, 54.5]];
  for (let i = 1; i < k.length; i++) if (el <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (el - k[i - 1][0]) / (k[i][0] - k[i - 1][0]));
  return 54.5 + (el - 5.6); };
const gss = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w));
function blendRig(a, b, w) {
  if (!a || w >= 1) return b;
  const r = {};
  for (const k in b) {
    const vb = b[k], va = a[k];
    if (typeof vb === 'number' && typeof va === 'number') r[k] = lerp(va, vb, w);
    else if (Array.isArray(vb) && Array.isArray(va) && vb.length === 2 && va.length === 2) r[k] = [lerp(va[0], vb[0], w), lerp(va[1], vb[1], w)];
    else r[k] = vb;
  }
  const P = r.P, lean = r.lean;
  r.T = (u, v) => { const q = rot(u, -v, -lean * (0.55 + 0.45 * clamp(v / 88, 0, 1.1))); return [P[0] + q[0], P[1] + q[1]]; };
  return r;
}
function clampCast(p) {
  let y = clamp(p[1], 640, 1040);
  const x = clamp(p[0], 40, Math.min(bankX(y) - 50, FISH_X - 130));
  y = Math.max(y, farWater(x) + 14);
  return [x, y];
}
function createGame() {
  return { state: 'idle', clock: 0, st: 0, cyc: 0, cursor: null, hold: false, rings: [], drops: [], fired: {}, sfx: [],
    fromR: null, bT0: -9, bDur: 0.35, fromE: null, eT0: -9, lastR: null, lastE: null, look: 0, ml: 0, R: null, S: null };
}
function setState(G, s) {
  if (G.state === 'fight' && G.mg) G.mg.out = 1;
  G.state = s; G.st = G.clock; G.cyc = 0; G.fired = {};
  G.fromR = G.lastR; G.bT0 = G.clock; G.bDur = 0.35; G.fromE = G.lastE; G.eT0 = G.clock;
}
function once(G, key) { if (G.fired[key]) return false; G.fired[key] = 1; return true; }
function addRing(G, x, y, size, a, life) { G.rings.push({ t: G.clock % LOOP, born: G.clock, x, y, size, a, life: life || 3 }); }
function addDrops(G, x, y, n, sp0, sp1, spread, smax, vxb) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() * 2 - 1) * spread, sp = sp0 + Math.random() * (sp1 - sp0);
    G.drops.push({ t0: G.clock + Math.random() * 0.06, x: x + (Math.random() * 2 - 1) * 5, y: y - 1, vx: Math.cos(a) * sp + (vxb || 0), vy: Math.sin(a) * sp, s: 0.9 + Math.random() * (smax - 0.9), wy: y + 1 });
  }
}
function newFish(G, delay) {
  const r = Math.random, a = G.clock + delay;
  // about twice as quick as it used to be: the fish swims up, nibbles once or twice, then bites (~2-4 s after landing)
  const n1 = a + 0.9 + r() * 0.4, n2 = n1 + 0.45 + r() * 0.4, n3 = n2 + 0.35 + r() * 0.3;
  const bite = n3 + 0.5 + r() * 0.5;
  G.fish = { arrive: a, nibs: [n1, n2, n3], bite, biteEnd: bite + 0.95,
    from: [G.target[0] - 140 - r() * 90, G.target[1] + 18 + r() * 30] };
  G.fired = {};
}
/** Sample without replacement: every fact (fish and treasures alike) comes up once before any repeats,
 *  and the bag is shuffled so the same kind of catch rarely comes twice in a row. */
function pickCatch(G) {
  const F = G.facts || DEFAULT_FACTS;
  if (!G.bag || !G.bag.length) {
    const bag = [];
    for (const kind of Object.keys(CATCHES)) for (const fact of (F[kind] || [])) bag.push({ kind, fact });
    if (!bag.length) bag.push({ kind: 'fish', fact: '' });
    for (let i = bag.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [bag[i], bag[j]] = [bag[j], bag[i]]; }
    // spread kinds out: avoid back-to-back repeats (also across the refill) where the mix allows it
    for (let i = 0; i < bag.length; i++) {
      const prev = i === 0 ? G.lastKind : bag[i - 1].kind;
      if (bag[i].kind !== prev) continue;
      const j = bag.findIndex((e, k) => k > i && e.kind !== prev);
      if (j > 0) [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    G.bag = bag;
  }
  let pick = G.bag.shift();
  if (G.forceKind && CATCHES[G.forceKind] && pick.kind !== G.forceKind) {   // test hook
    const j = G.bag.findIndex((e) => e.kind === G.forceKind);
    if (j >= 0) { G.bag.push(pick); pick = G.bag.splice(j, 1)[0]; } else pick = { kind: G.forceKind, fact: (F[G.forceKind] || [''])[0] };
  }
  G.lastKind = pick.kind;
  G.catches = (G.catches || 0) + 1;
  return { kind: pick.kind, label: CATCHES[pick.kind].label, fact: pick.fact, n: G.catches };
}
function gameDismiss(G) {
  if (G.state === 'bottle' && G.bottleHold) { G.bottleHold = false; setState(G, 'bottleEnd'); return; }
  if (G.state !== 'show') return;
  if (G.catch.kind === 'fish') setState(G, 'release');
  else { G.holdHand = G.lastR.hN.slice(); setState(G, 'stash'); G.bDur = 0.4; }
}
function startCast(G, target) { G.target = target; G.fish = null; G.hold = false; setState(G, 'cast'); }
function gameDown(G) {
  if (G.state === 'idle') { if (G.cursor) startCast(G, clampCast(G.cursor)); }
  else if (G.state === 'wait') {
    if (G.cursor) startCast(G, clampCast(G.cursor));
  } else if (G.state === 'fight') G.hold = true;
  else if (G.state === 'show' && G.clock - G.st > 0.5) gameDismiss(G);
  else if (G.state === 'bottle' && G.bottleHold && G.clock - G.holdT > 0.5) gameDismiss(G);
}
function dangle(tip, tipLag) {
  const sw = clamp(-(tip[0] - tipLag[0]) * 0.012, -1, 1);
  return [tip[0] - Math.sin(sw) * 110, tip[1] + Math.cos(sw) * 110, sw];
}
function updateMinigame(G, dt) {
  const m = G.mg, c = G.clock;
  m.show = Math.min(1, m.show + dt * 4);
  if (G.hold && !m.held) { m.held = true; m.graceEnd = Math.min(m.t0 + 3.5, Math.max(m.graceEnd, c + 0.9)); }
  const grace = c < m.graceEnd;
  m.vz += (G.hold ? 3.4 : -2.8) * dt; m.vz *= Math.exp(-0.9 * dt);
  m.z += m.vz * dt;
  const lo = m.zh / 2, hi = 1 - m.zh / 2;
  if (m.z < lo) { m.z = lo; m.vz = Math.max(0, -m.vz * 0.3); }
  if (m.z > hi) { m.z = hi; m.vz = Math.min(0, -m.vz * 0.3); }
  m.big = false;
  // camping at the top or bottom of the bar doesn't work: the fish heads the other way
  m.camp = !grace && (m.z <= lo + 0.01 || m.z >= hi - 0.01) ? (m.camp || 0) + dt : 0;
  if (m.camp > 0.7 && c < m.next - 0.15) m.next = c;
  if (grace) m.next = Math.max(m.next, m.graceEnd);
  if (c >= m.next) {   // the fish darts about: small wobbles and sudden big runs
    const big = Math.random() < 0.38 || m.camp > 0.7;
    let ft = clamp(big ? Math.random() : m.f + (Math.random() * 2 - 1) * 0.3, 0.04, 0.96);
    if (m.camp > 0.7) ft = m.z > 0.5 ? 0.05 + Math.random() * 0.4 : 0.55 + Math.random() * 0.4;
    m.big = big && Math.abs(ft - m.f) > 0.4;
    m.ft = ft; m.fk = big ? 6 + Math.random() * 4 : 2 + Math.random() * 3;
    m.next = c + 0.35 + Math.random() * (big ? 0.6 : 1.1);
  }
  const pf = m.f; m.f += clamp((m.ft - m.f) * Math.min(1, dt * m.fk), -1.5 * dt, 1.5 * dt); m.fv = (m.f - pf) / Math.max(dt, 1e-3);
  m.fj = clamp(m.f + 0.012 * Math.sin(c * 23), 0, 1);
  m.inside = Math.abs(m.fj - m.z) < m.zh / 2;
  m.p = clamp(m.p + (m.inside ? 0.28 : grace ? 0 : -0.19) * dt, 0, 1);
}
/** advance the game and build this frame's pose (R) and line/float/fish state (S) */
function updateGame(Eng, dt, tw) {
  const G = Eng.game, Cc = Eng.Cc;
  G.clock += dt; const c = G.clock, el = c - G.st;
  const foc = G.state === 'hook' || G.state === 'fight';   // "fish on!": the page steps back while he fights it
  if (foc && !G.focusOn) { G.focusOn = true; G.focusT = c; G.holdW = 0; } else if (!foc && G.focusOn) { G.focusOn = false; G.focusOffT = c; }
  G.drops = G.drops.filter((d) => c - d.t0 < 1.7);
  G.rings = G.rings.filter((r) => c - r.born < r.life + 1);
  if (G.mg && G.state !== 'fight') G.mg.out = Math.max(0, (G.mg.out || 0) - dt * 3);
  const cyc = (a, b) => { const len = b - a, k = Math.floor(el / len); if (k !== G.cyc) { G.cyc = k; G.fromR = G.lastR; G.bT0 = c; G.bDur = 0.5; } return a + el - k * len; };
  const mod = { lean: 0, head: 0, hy: 0 };
  let ta, R, E, S = {};
  const tipOf = (r) => toW(r.tip);
  // gentle head-tracking of the cursor while he's idle or waiting
  if (G.cursor && (G.state === 'idle' || G.state === 'wait')) {
    const hx = FISH_X - 18, hy = FISH_Y - 236;
    const want = clamp(Math.atan2(G.cursor[1] - hy, Math.max(70, Math.abs(hx - G.cursor[0]))) - 0.2, -0.3, 0.35);
    G.look += (want - G.look) * Math.min(1, dt * 3);
  } else G.look *= Math.max(0, 1 - dt * 2);
  mod.head = G.look * 0.6;

  switch (G.state) {
    case 'idle': {
      ta = cyc(IDLE_A, IDLE_B); R = rigAt(ta, tw, mod);
      const tip = tipOf(R);
      if (G.cursor) { E = G.cursor.slice(); S.hang = true; S.ctrl0 = [(tip[0] + E[0]) / 2, (tip[1] + E[1]) / 2 + 26 + Math.hypot(E[0] - tip[0], E[1] - tip[1]) * 0.05]; }
      else E = dangle(tip, tipOf(rigAt(ta - 0.3)));
      S.fOff = G.cursor ? 0 : 24; S.floatA = 1; S.taut = 0; S.waterY = E[1] + 40;
      break;
    }
    case 'cast': {
      ta = CAST_T(el); R = rigAt(ta, tw, mod);
      const tip = tipOf(R), T = G.target;
      const fp = [T[0] + 1.0 * Math.sin(c * 0.73), T[1] + 1.1 * Math.sin(c * 1.57)];
      if (ta < 48.2) E = dangle(tip, tipOf(rigAt(ta - 0.3)));
      else if (ta < 50.1) {
        const d0 = dangle(tip, tipOf(rigAt(ta - 0.3)));
        const ang = lerp(Math.PI / 2 + d0[2], BACKANG(ta), sstep(48.2, 48.8, ta)), L = LC(ta);
        E = [tip[0] + Math.cos(ang) * L, tip[1] + Math.sin(ang) * L];
      } else if (ta < 53) E = qb(Cc.Bk, [(Cc.Bk[0] + T[0]) / 2 - 60, -40], fp, CASTP(ta));
      else E = fp;
      S.fOff = 24 * (1 - sstep(52.6, 53, ta)); S.floatA = 1; S.taut = 0; S.waterY = T[1];
      if (ta >= 49.8 && once(G, 'swish')) G.sfx.push(['cast']);   // the rod comes forward and the line whips out
      if (ta >= 53 && once(G, 'land')) { addRing(G, T[0], T[1] + 1, 30, 0.6, 3.5); addDrops(G, T[0], T[1], 6, 40, 110, 0.7, 1.6); G.sfx.push(['land']); }
      if (ta >= 54.5) { setState(G, 'wait'); newFish(G, 0.3 + Math.random() * 0.8); }
      break;
    }
    case 'wait': {
      const F = G.fish, T = G.target;
      let ex = 0, dip = 0;
      if (F) {
        F.nibs.forEach((n, i) => { dip += 2.6 * gss(c, n, 0.1); ex += 0.7 * gss(c, n, 0.6); if (c >= n && once(G, 'n' + i)) { addRing(G, T[0], T[1] + 1, 12, 0.45, 2.4); G.sfx.push(['nibble', i]); } });
        const biting = sstep(F.bite - 0.02, F.bite + 0.1, c) * (1 - sstep(F.biteEnd - 0.15, F.biteEnd, c));
        dip += 10 * biting; ex = Math.max(ex, biting);
        if (c >= F.bite && once(G, 'bite')) { addRing(G, T[0], T[1] + 1, 26, 0.7, 3); addDrops(G, T[0], T[1], 4, 30, 80, 0.6, 1.3); }
        S.shadow = waitShadow(G);
        if (c > F.biteEnd + 1.6) newFish(G, 1.5 + Math.random() * 2.5);   // missed it: another fish will come
      }
      mod.lean += 0.07 * ex; mod.head += 0.08 * ex; mod.brow = 0.9; mod.joy = 0.15; mod.ew = clamp(ex, 0, 1);
      ta = cyc(IDLE_A, IDLE_B); R = rigAt(ta, tw, mod);
      const fp = [T[0] + 1.0 * Math.sin(c * 0.73), T[1] + 1.1 * Math.sin(c * 1.57)];
      E = [fp[0], fp[1] + dip]; S.fOff = 0; S.floatA = 1; S.taut = 0; S.waterY = fp[1];
      if (F && c >= F.bite + 0.08) {   // fish on: he strikes by himself and the reel bar comes up right away
        G.hookFrom = E.slice(0, 2); setState(G, 'hook');
        G.mg = { z: 0.3, vz: 0, f: 0.55, f0: 0.55, ft: 0.55, fk: 3, fv: 0, fj: 0.55, next: c + 2, p: 0.35, zh: 0.3, show: 0, inside: false, out: 0,
          t0: c, graceEnd: c + 2, held: false };   // the zone starts under the fish and sinks: pressing is the first thing to do
      }
      break;
    }
    case 'hook': {
      mod.flush = 1;
      ta = 23.55 + el; R = rigAt(ta, tw, mod);
      const h = G.hookFrom, s = sstep(23.55, 24, ta);
      E = [h[0] + 16 * s, h[1] + 5 * s]; S.floatA = 1 - sstep(23.6, 23.9, ta); S.fOff = 0; S.waterY = h[1] - 0.5;
      S.taut = sstep(23.7, 23.95, ta);
      if (once(G, 'set')) { addRing(G, h[0], h[1] + 1, 40, 0.7, 3.5); addDrops(G, h[0], h[1], 8, 80, 200, 0.8, 2); G.sfx.push(['hook']); }
      if (G.mg) G.mg.show = Math.min(1, G.mg.show + dt * 5);
      if (ta >= 24) { setState(G, 'fight'); G.hookPt = E.slice(0, 2); G.catch = pickCatch(G); }
      break;
    }
    case 'fight': {
      updateMinigame(G, dt);
      const m = G.mg, hp = G.hookPt;
      G.ml += ((m.inside ? -0.06 : 0.07) - G.ml) * Math.min(1, dt * 4);
      G.holdW = (G.holdW || 0) + ((G.hold ? 1 : 0) - (G.holdW || 0)) * Math.min(1, dt * 8);   // holding = hauling on the rod
      mod.lean += G.ml - 0.09 * G.holdW; mod.rodAdd = 0.13 * G.holdW; mod.bendAdd = 0.2 * G.holdW;
      mod.strain = 1; mod.flush = 1; mod.brow = -1; mod.joy = 0; mod.ew = 1;
      ta = cyc(FIGHT_A, FIGHT_B); R = rigAt(ta, tw, mod);
      // the fish's place in the bar maps to how far it has run out to the left
      let x = hp[0] - 230 * (m.f - (m.f0 || 0.3)) + 5 * Math.sin(c * 13), y = hp[1] + 4 + 3 * Math.sin(c * 7);
      x = clamp(x, 30, bankX(y) - 40); y = Math.max(y, farWater(x) + 10);
      E = [x, y];
      const vx = -230 * m.fv;
      S.fight = { x, y, ang: vx < 0 ? Math.PI : 0, a: 1, v: Math.abs(vx) + 40 };
      S.fOff = 0; S.floatA = 0; S.taut = 1; S.waterY = y; S.flashT = el;
      if (m.big) { addRing(G, x, y, 34, 0.55, 3); addDrops(G, x, y, 10, 90, 260, 1.1, 2.2); G.sfx.push(['thrash', 0.65]); }
      else if (Math.random() < dt * 1.4) G.sfx.push(['thrash', 0.22 + 0.18 * Math.random()]);   // it thrashes about
      if (m.p >= 1) { G.fex = E.slice(); FEX = G.fex; FLING = null; setState(G, 'catch'); }
      else if (m.p <= 0) { G.escFrom = E.slice(); setState(G, 'escape'); addRing(G, x, y, 40, 0.65, 3.5); addDrops(G, x, y, 12, 90, 260, 1.1, 2.2); G.sfx.push(['escape']); }
      break;
    }
    case 'catch': case 'show': case 'release': {
      if (G.state === 'catch') { ta = 29.7 + el; mod.flush = 1 - sstep(CATCH_T, CATCH_T + 1.2, ta); }
      else if (G.state === 'show') { ta = cyc(33.6, 37.6); mod.happy = el > 0.15 && el < 2.8 ? 1 : 0; }
      else ta = 38.2 + el;
      R = rigAt(ta, tw, mod);
      S = catchState(ta, R, Cc); E = S.E;
      if (ta < FLING_T0) { E = G.fex.slice(); S.fight = { x: E[0], y: E[1], ang: Math.PI, a: 1 - sstep(29.85, 30.05, ta), v: 40 }; S.taut = 1; }
      S.waterY = G.fex[1];
      const kind = G.catch.kind;
      if (kind !== 'fish' && S.fish) {   // a treasure instead of a fish: tumbling through the air, then held up by its grip
        const hw = toW(R.hN), g = GRIP[kind], spin = ta * 7;
        let d = ((g.ang - spin) % TAU + TAU * 1.5) % TAU - Math.PI;
        const held = sstep(CATCH_T - 0.3, CATCH_T, ta);
        const fl = ta < CATCH_T ? flingPos(ta) : null;
        S.treasure = { kind, x: fl ? lerp(fl[0], hw[0], held) : hw[0], y: fl ? lerp(fl[1], hw[1], held) : hw[1], ang: ta < CATCH_T ? spin + d * held : g.ang + 0.03 * Math.sin(c * 2.1), sc: 1, a: 1 };
        S.fish = null; if (ta >= CATCH_T) S.anchor = 1;
      } else if (S.fish && ta >= CATCH_T && ta < 41.9) S.anchor = 2;
      if (G.state === 'catch') {
        if (ta >= 30.0 && once(G, 'lift')) { addRing(G, G.fex[0], G.fex[1], 52, 0.75, 4); addDrops(G, G.fex[0], G.fex[1], 26, 120, 420, 1.0, 3.2, 60); G.sfx.push(['fling']); }
        if (ta >= CATCH_T && once(G, 'grab')) { const hw = toW(R.hN); addDrops(G, hw[0] - 10, hw[1], 9, 60, 180, 1.3, 1.8); }
        if (kind === 'bottle' && ta >= 31.9) { setState(G, 'bottle'); G.corkPop = null; G.bottleHold = false; }
        else if (ta >= 33.6) { setState(G, 'show'); if (G.onCatch) G.onCatch(G.catch); }
      } else if (G.state === 'show') {
        if (el > 40) gameDismiss(G);
      } else {
        if (ta >= 42.1 && once(G, 'rel')) { addRing(G, 1278, FISH_Y + 2, 36, 0.7, 4); addDrops(G, 1278, FISH_Y, 9, 60, 160, 0.8, 2); }
        if (ta >= 45.3) setState(G, 'idle');
      }
      break;
    }
    case 'bottle': case 'bottleEnd': {
      const k = G.state === 'bottle' ? bottleChoreo(el) : bottleEndChoreo(el);
      if (G.state === 'bottle' && el >= 3.1 && once(G, 'basket')) G.sfx.push(['basket']);   // the empty bottle goes into the creel
      if (G.state === 'bottle' && el >= BOTTLE_HOLD && !G.bottleHold) { G.bottleHold = true; G.holdT = c; if (G.onCatch) G.onCatch(G.catch); }
      mod.lf = k.lf; mod.lh = k.lh; mod.rf = k.rf; mod.rfw = k.rfw; mod.plant = k.plant;
      if (k.rodA !== undefined) { mod.rodA = k.rodA; mod.g = k.g; }
      if (k.head !== undefined) mod.head += k.head - 0.11;
      if (k.lean !== undefined) mod.lean += k.lean - 0.08;
      if (k.hy) mod.hy += k.hy;
      if (k.joy !== undefined) { mod.joy = k.joy; mod.brow = k.brow; mod.ew = k.ew !== undefined ? k.ew : 1; }
      if (k.happy !== undefined) mod.happy = k.happy;
      ta = cyc(0, 4); R = rigAt(ta, tw, mod);
      const tip = tipOf(R); E = dangle(tip, tipOf(rigAt(ta - 0.3, tw, mod)));
      S.fOff = 24; S.floatA = 1; S.taut = 0; S.waterY = E[1]; S.bottleK = k;
      if (G.state === 'bottle') {
        if (el >= 2.0 && !G.corkPop) G.corkPop = { t: c, p: toW(bottlePt(G.lastR.hN, k.bAng, 20.5, 0)) };
        if (G.corkPop && c - G.corkPop.t >= 0.8 && once(G, 'plop')) { const q = G.corkPop.p; addRing(G, q[0] + 88, q[1] + 96, 10, 0.45, 2); }
        if (G.bottleHold && c - G.holdT > 40) gameDismiss(G);
      } else if (el >= 2.2) setState(G, 'idle');
      break;
    }
    case 'reel': {   // hooked on the page's up-arrow: a long struggle, it snaps loose, he stumbles, then hops with a kick
      const rl = G.reel || { phase: 'tug', pull: 0 }, now = performance.now() / 1000;
      if (rl.phase === 'tug') {
        const pull = rl.pull || 0;
        ta = cyc(FIGHT_A, FIGHT_B);
        mod.lean += 0.1 - 0.28 * pull; mod.hy += 3 * (1 - pull) - 2 * pull;
        mod.rodA = lerp(0.98, 1.38, pull); mod.g = [lerp(-20, -10, pull), lerp(-46, -66, pull)];
        mod.strain = 1; mod.flush = 1; mod.brow = -1; mod.joy = 0; mod.ew = 1;
        R = rigAt(ta, tw, mod); R.bend += 0.25 + 0.15 * pull; S.noLine = true; E = toW(R.tip);
      } else {
        const a = now - rl.releaseT;
        const stumble = sstep(0, 0.07, a) * (1 - sstep(0.2, 0.45, a));
        const crouch = sstep(0.1, 0.2, a) * (1 - sstep(0.2, 0.26, a));
        const h = a > 0.24 && a < 0.74 ? Math.sin(Math.PI * (a - 0.24) / 0.5) : 0;
        const land = sstep(0.72, 0.8, a) * (1 - sstep(0.85, 1.25, a));
        mod.lean += -0.3 * stumble - 0.08 * h + 0.07 * land;
        mod.hy += -3 * stumble + 10 * crouch - 34 * h + 8 * land; mod.jump = sstep(0.18, 0.34, a) * (1 - sstep(0.62, 0.78, a));
        mod.hx = (mod.hx || 0) + 5 * stumble;
        mod.rodA = lerp(1.3, 1.62, sstep(0, 0.14, a)); mod.g = [-18, -58 - 4 * stumble];
        mod.lh = 1 - sstep(0.2, 0.32, a) * (1 - sstep(0.95, 1.25, a)); mod.lf = [-50, -256 - 30 * h];   // fist pump
        const happy = a > 0.2;
        mod.joy = happy ? 1 : 0.45; mod.brow = happy ? 0.8 : 1; mod.strain = 0; mod.flush = 1 - sstep(0.7, 1.7, a); mod.ew = 1; mod.happy = happy && a < 1.4 ? 1 : 0;
        ta = cyc(IDLE_A, IDLE_B); R = rigAt(ta, tw, mod);
        if (a >= 0.24 && once(G, 'hopOff')) addDrops(G, FISH_X - 6, FISH_Y, 14, 80, 240, 1.0, 2.2);
        if (a >= 0.74 && once(G, 'hopLand')) { addRing(G, FISH_X - 6, FISH_Y + 2, 44, 0.75, 3.5); addDrops(G, FISH_X - 6, FISH_Y, 20, 110, 300, 1.2, 2.4); }
        const tip = tipOf(R);
        E = dangle(tip, tipOf(rigAt(ta - 0.3, tw, mod))); S.noLine = a < 0.5; S.fOff = 24; S.floatA = 1; S.taut = 0; S.waterY = E[1];
      }
      break;
    }
    case 'stash': {   // a treasure goes into the creel at his hip
      const u = sstep(0, 0.9, el);
      mod.lh = sstep(1.15, 1.6, el); mod.lf = [lerp(G.holdHand[0], CREEL_L[0], u), lerp(G.holdHand[1], CREEL_L[1], u)];   // free hand to the creel, then back to the rod
      mod.joy = 0.7; mod.brow = 0.4; mod.ew = 1 - sstep(1.2, 1.7, el);
      ta = cyc(IDLE_A, IDLE_B); R = rigAt(ta, tw, mod);
      const tip = tipOf(R), hw = toW(R.hN), g = GRIP[G.catch.kind];
      E = dangle(tip, tipOf(rigAt(ta - 0.3)));
      const sink = sstep(0.9, 1.12, el), sc = 1 - sink;   // it drops into the creel once his hand is over it
      if (el >= 0.88 && once(G, 'basket')) G.sfx.push(['basket']);
      if (sc > 0.01) { S.treasure = { kind: G.catch.kind, x: hw[0], y: hw[1], ang: lerp(g.ang, 0, u), sc, a: 1, sink }; S.anchor = 1; }
      S.fOff = 24; S.floatA = 1; S.taut = 0; S.waterY = E[1];
      if (el >= 1.75) setState(G, 'idle');
      break;
    }
    case 'escape': {
      const env = sstep(0, 0.3, el) * (1 - sstep(1.8, 2.4, el));
      mod.lean += 0.14 * env; mod.head += 0.28 * env; mod.joy = 0; mod.brow = -0.5; mod.strain = 0; mod.ew = env;
      ta = cyc(IDLE_A, IDLE_B); R = rigAt(ta, tw, mod);
      const tip = tipOf(R), d = dangle(tip, tipOf(rigAt(ta - 0.3)));
      const u = sstep(0.1, 1.2, el);
      E = [lerp(G.escFrom[0], d[0], u), lerp(G.escFrom[1], d[1], u)];
      S.slack = 1 - u; S.fOff = 24 * u; S.floatA = u; S.taut = 0; S.waterY = E[1];
      const k = clamp(el / 1.2, 0, 1);
      if (k < 1) S.shadow = { x: G.escFrom[0] - 260 * k * k, y: G.escFrom[1] + 14 * k, ang: Math.PI, a: 0.45 * (1 - k) };
      if (el >= 2.4) setState(G, 'idle');
      break;
    }
  }
  // smooth every state change: pose and line end ease over from where they were
  R = blendRig(G.fromR, R, sstep(0, 1, (c - G.bT0) / G.bDur));
  const ew = sstep(0, 1, (c - G.eT0) / 0.3);
  if (G.fromE && ew < 1) E = [lerp(G.fromE[0], E[0], ew), lerp(G.fromE[1], E[1], ew)];
  const tip = toW(R.tip);
  if (S.anchor) {   // whatever he's holding stays glued to his (blended) hand
    const hw = toW(R.hN);
    if (S.anchor === 1 && S.treasure) { S.treasure.x = hw[0]; S.treasure.y = hw[1] + 10 * (S.treasure.sink || 0); }
    if (S.anchor === 2 && S.fish) { S.fish.x = hw[0] - 21; S.fish.y = hw[1] + 1; }
    if (G.state !== 'stash' && ta < 38.5) E = [hw[0] - 21, hw[1] + 1];
  }
  if (S.bottleK) {
    const k = S.bottleK, hN = R.hN, hF = R.hF, wN = toW(hN), wF = toW(hF);
    if (G.state === 'bottle' && k.bScale > 0.01) S.treasure = { kind: 'bottle', x: wN[0], y: wN[1] + 10 * (1 - k.bScale), ang: k.bAng, sc: k.bScale, a: 1, o: { corked: k.corked, noteIn: k.noteIn } };
    if (k.scroll === 'slide') { const nw = toW(bottlePt(hN, k.bAng, 18, 0)); S.scrollDraw = { x: (nw[0] + wF[0]) / 2, y: (nw[1] + wF[1]) / 2, ang: k.bAng, len: 16, sc: 1 }; }
    else if (k.scroll === 'held') S.scrollDraw = { x: wF[0] - 7, y: wF[1], ang: 0, len: 18, sc: k.scrollScale === undefined ? 1 : k.scrollScale };
    else if (k.scroll === 'paper') { S.note = { xl: wN[0], xr: wF[0], y: (wN[1] + wF[1]) / 2, open: (k.w - 8) / (NOTE_W - 8) }; S.handsFront = true; }
    if (G.state === 'bottle' && G.corkPop) {
      const tc = c - G.corkPop.t, q = G.corkPop.p;
      if (tc < 0.95) S.cork = { x: q[0] + 110 * tc, y: q[1] - 240 * tc + 450 * tc * tc, ang: tc * 14, a: 1 - sstep(0.78, 0.95, tc) };
    }
  }
  S.E = E; S.tip = tip; S.ta = ta;
  const w = wind(900, tw);
  if (S.hang && S.ctrl0) S.ctrl = [lerp((tip[0] + E[0]) / 2, S.ctrl0[0], ew), lerp((tip[1] + E[1]) / 2, S.ctrl0[1], ew)];
  else S.ctrl = [(tip[0] + E[0]) / 2 + TR.ox(ta) + w * 10, (tip[1] + E[1]) / 2 + TR.oy(ta) + (S.slack || 0) * 50];
  // the message in a bottle gets its "tada" when the note is unrolled, not for the bottle itself
  const isBottle = G.catch && G.catch.kind === 'bottle';
  const tadaWant = isBottle ? (G.state === 'bottle' && !!S.note && S.note.open > 0.6)
    : ((G.state === 'catch' && ta >= REVEAL_T) || G.state === 'show') && !!(S.treasure || S.fish);
  if (tadaWant && !G.tadaOn) { G.tadaOn = true; G.tadaT = c; G.sfx.push(['reveal']); } else if (!tadaWant && G.tadaOn) { G.tadaOn = false; G.tadaOffT = c; }
  if (tadaWant && isBottle) G.tadaPos = [(S.note.xl + S.note.xr) / 2, S.note.y];
  else if (tadaWant) {   // centre on the item itself, not the hand gripping it
    const it = S.treasure || S.fish, g = S.treasure && GRIP[S.treasure.kind];
    if (g) { const k = g.s * (it.sc || 1), q = rot(-g.dx * k, -g.dy * k, it.ang || 0); G.tadaPos = [it.x + q[0], it.y + q[1]]; }
    else G.tadaPos = [it.x, it.y];
  }
  if (G.tadaPos && G.tadaT !== undefined) {
    const a = G.tadaOn ? sstep(0, 0.3, c - G.tadaT) : 1 - sstep(0, 0.45, c - (G.tadaOffT || 0));
    S.tada = a > 0.01 ? { x: G.tadaPos[0], y: G.tadaPos[1], a, pop: G.tadaOn ? sstep(0, 0.45, c - G.tadaT) : 1, t: c } : null;
  }
  G.lastR = R; G.lastE = E; G.R = R; G.S = S;
}
function waitShadow(G) {
  const F = G.fish, T = G.target, c = G.clock;
  if (!F || c < F.arrive) return null;
  const near = [T[0] - 16, T[1] + 7];
  if (c < F.nibs[0] - 0.2) {
    const u = sstep(F.arrive, F.nibs[0] - 0.2, c);
    return { x: lerp(F.from[0], near[0], u), y: lerp(F.from[1], near[1], u) + Math.sin(c * 3) * 3 * (1 - u),
      ang: Math.atan2(near[1] - F.from[1], near[0] - F.from[0]), a: 0.45 * Math.min(1, (c - F.arrive) / 0.8) };
  }
  if (c < F.biteEnd + 0.05) {
    let lunge = 0; for (const n of F.nibs) lunge += 7 * gss(c, n, 0.12);
    lunge += 10 * sstep(F.bite - 0.1, F.bite, c);
    return { x: near[0] + lunge, y: near[1] + 1.5 * Math.sin(c * 4), ang: 0, a: 0.45 };
  }
  const u = (c - F.biteEnd) / 1.4; if (u > 1) return null;
  return { x: near[0] - 200 * u * u, y: near[1] + 30 * u, ang: Math.PI, a: 0.45 * (1 - u) };
}
function drawShadowFish(c, E, f) {
  c.save(); c.globalAlpha = f.a; c.translate(f.x, f.y + 4); c.rotate(f.ang + Math.PI);
  c.scale(0.7, 0.45); c.drawImage(E.fishShadow, -46, -20); c.restore();
}
function drawGhostBob(c, x, y, sc) {
  sc = sc || CURSOR_SCALE;
  c.save(); c.globalAlpha = 0.55; c.translate(x, y); c.scale(sc, sc);
  c.fillStyle = 'rgb(246,240,226)'; c.strokeStyle = INK; c.lineWidth = 0.8;
  c.beginPath(); c.ellipse(0, -2.5, 2.4, 5, 0, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = 'rgb(214,74,52)'; c.beginPath(); c.ellipse(0, -6.4, 2.1, 2.6, 0, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(0, -9); c.lineTo(0, -13); c.stroke();
  c.restore();
}
function rrect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
/** "tada!": warm spotlight rays fanning out from the catch he's holding up, with a soft glow at the centre */
function drawTada(c, T, q) {
  const n = q ? 14 : 10, r0 = 12, len = 175 * (0.55 + 0.45 * T.pop), spin = T.t * 0.18;
  c.save(); c.translate(T.x, T.y); c.globalCompositeOperation = 'screen';
  const glow = c.createRadialGradient(0, 0, 0, 0, 0, 58 * (0.6 + 0.4 * T.pop));
  glow.addColorStop(0, 'rgba(255,242,206,' + (0.75 * T.a).toFixed(3) + ')'); glow.addColorStop(1, 'rgba(255,240,200,0)');
  c.fillStyle = glow; c.beginPath(); c.arc(0, 0, 58, 0, TAU); c.fill();
  const beam = c.createRadialGradient(0, 0, r0, 0, 0, len);
  beam.addColorStop(0, 'rgba(255,238,190,' + (0.78 * T.a).toFixed(3) + ')'); beam.addColorStop(0.55, 'rgba(255,226,160,' + (0.34 * T.a).toFixed(3) + ')'); beam.addColorStop(1, 'rgba(255,226,160,0)');
  c.fillStyle = beam;
  for (let i = 0; i < n; i++) {
    const a = spin + i / n * TAU, w = (i % 2 ? 0.075 : 0.12) * (0.7 + 0.3 * T.pop), l = len * (i % 2 ? 0.78 : 1);
    c.beginPath(); c.moveTo(Math.cos(a - w * 0.35) * r0, Math.sin(a - w * 0.35) * r0);
    c.lineTo(Math.cos(a - w) * l, Math.sin(a - w) * l); c.lineTo(Math.cos(a + w) * l, Math.sin(a + w) * l);
    c.lineTo(Math.cos(a + w * 0.35) * r0, Math.sin(a + w * 0.35) * r0); c.closePath(); c.fill();
  }
  c.restore();
}
/** a little mouse with its left button pressed (and an up arrow) or released (down arrow), next to the reel bar */
function drawMouseCue(c, x, y, pressed) {
  const ink = 'rgba(46,30,24,0.92)', hot = 'rgb(224,96,63)', cream = '#fffaf0';
  c.save(); c.translate(x, y); c.shadowColor = 'rgba(20,32,34,0.35)'; c.shadowBlur = 5;
  rrect(c, -7, -11, 14, 22, 7); c.fillStyle = cream; c.fill(); c.shadowBlur = 0;
  if (pressed) { c.beginPath(); c.moveTo(0, -11); c.arc(0, -4, 7, -Math.PI / 2, -Math.PI, true); c.lineTo(-7, -2); c.lineTo(0, -2); c.closePath(); c.fillStyle = hot; c.fill(); }
  rrect(c, -7, -11, 14, 22, 7); c.lineWidth = 1.6; c.strokeStyle = ink; c.stroke();
  c.beginPath(); c.moveTo(0, -11); c.lineTo(0, -2); c.moveTo(-7, -2); c.lineTo(7, -2); c.lineWidth = 1.2; c.stroke();
  // arrow: up while pressed, down when released
  c.translate(16, 0); c.scale(1, pressed ? 1 : -1);
  c.beginPath(); c.moveTo(0, 8); c.lineTo(0, -7); c.moveTo(-5, -2); c.lineTo(0, -8); c.lineTo(5, -2);
  c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 4.4; c.strokeStyle = ink; c.stroke();
  c.lineWidth = 2.2; c.strokeStyle = pressed ? 'rgb(170,226,120)' : cream; c.stroke();
  c.restore();
}
/** the reel bar: hold to lift the green zone, keep the fish inside it */
function drawMinigame(c, G) {
  const m = G.mg; if (!m) return;
  const a = G.state === 'fight' || G.state === 'hook' ? m.show : (m.out || 0);
  if (a <= 0.01) return;
  const x = 1222, y0 = 546, h = 232, w = 20, cx = x + w / 2, cy = y0 + h / 2, sc = 0.82 + 0.18 * a;
  c.save(); c.globalAlpha = a; c.translate(cx, cy); c.scale(sc, sc); c.translate(-cx, -cy);
  // "hold to reel!" to the left of the bar, in the hero's serif (still: it fades with the bar)
  c.save(); c.translate(x - 10, cy);
  c.font = '600 13px ui-serif, Georgia, "Times New Roman", serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
  c.shadowColor = 'rgba(20,32,34,0.45)'; c.shadowBlur = 6;
  c.fillStyle = '#fffaf0'; c.fillText('hold to reel!', 0, 0);
  const pressed = m.held ? G.hold : (G.clock * 1.25) % 2 < 1;   // demo loop until the first press, then live
  drawMouseCue(c, -44, -34, pressed);
  c.restore();
  rrect(c, x, y0, w, h, 10); c.fillStyle = 'rgba(16,32,36,0.6)'; c.fill();
  c.lineWidth = 3.2; c.strokeStyle = 'rgba(46,30,24,0.85)'; c.stroke();
  c.lineWidth = 1.4; c.strokeStyle = 'rgba(255,244,220,0.9)'; c.stroke();
  const zh = h * m.zh, zy = y0 + h * (1 - m.z) - zh / 2;
  rrect(c, x + 3, zy, w - 6, zh, 7);
  c.fillStyle = m.inside ? 'rgba(186,236,132,0.78)' : 'rgba(186,236,132,0.4)'; c.fill();
  c.lineWidth = 1; c.strokeStyle = 'rgba(240,255,215,0.95)'; c.stroke();
  const fy = y0 + h * (1 - m.fj), wag = Math.sin(G.clock * 22) * 0.35;
  c.save(); c.translate(cx, fy); c.rotate(clamp(-m.fv * 0.25, -0.5, 0.5));
  c.beginPath(); c.moveTo(-8, 0); c.quadraticCurveTo(-2, -5, 5, -1.5); c.lineTo(10, -4 + wag * 4); c.lineTo(9, 0); c.lineTo(10, 4 + wag * 4); c.lineTo(5, 1.5); c.quadraticCurveTo(-2, 5, -8, 0); c.closePath();
  c.lineWidth = 2.2; c.strokeStyle = 'rgba(46,30,24,0.95)'; c.stroke();
  c.fillStyle = 'rgb(214,226,232)'; c.fill();
  c.fillStyle = 'rgb(92,112,136)'; c.beginPath(); c.moveTo(-7, -0.6); c.quadraticCurveTo(-2, -4.4, 5, -1.6); c.lineTo(4, -0.4); c.closePath(); c.fill();
  c.fillStyle = '#222'; c.beginPath(); c.arc(-5.2, -0.8, 0.8, 0, TAU); c.fill();
  c.restore();
  const px = x + w + 6;
  rrect(c, px, y0, 7, h, 3.5); c.fillStyle = 'rgba(16,32,36,0.55)'; c.fill();
  c.lineWidth = 2.6; c.strokeStyle = 'rgba(46,30,24,0.8)'; c.stroke();
  c.lineWidth = 1; c.strokeStyle = 'rgba(255,244,220,0.8)'; c.stroke();
  const ph = Math.max(0.001, (h - 4) * m.p);
  const col = m.p < 0.5 ? mixc([224, 103, 79], [242, 193, 78], m.p * 2) : mixc([242, 193, 78], [143, 209, 106], (m.p - 0.5) * 2);
  rrect(c, px + 1.5, y0 + h - 2 - ph, 4, ph, 2); c.fillStyle = rgba(col); c.fill();
  c.restore();
}
/** 0..1: how strongly the "fish on!" focus effects show (quick in, gentle out) */
function focusAmt(G) {
  if (!G || G.focusT === undefined) return 0;
  if (G.focusOn) return sstep(0, 0.14, G.clock - G.focusT);
  return G.focusOffT === undefined ? 0 : 1 - sstep(0, 0.5, G.clock - G.focusOffT);
}
/** a hand-inked "!" over his head from the moment a fish takes the hook (fades in and out, no other motion) */
function drawAlert(c, G, R) {
  const a = focusAmt(G); if (a <= 0.01 || !R) return;
  const h = toW(R.headC);   // no motion of its own: it just fades in and out over his head
  c.save(); c.globalAlpha = a;
  c.translate(h[0] + 6, h[1] - 42 * FS); c.rotate(-0.1); c.scale(FS * 1.15, FS * 1.15);
  c.lineJoin = 'round'; c.lineCap = 'round';
  // the mark: an even, round-ended red bar and a dot, with the scene's ink outline
  const RED = 'rgb(222,62,48)';
  c.beginPath(); c.moveTo(0, -38); c.lineTo(0, -14);
  c.lineWidth = 7.6 + 5.6; c.strokeStyle = INK; c.stroke();
  c.lineWidth = 7.6; c.strokeStyle = RED; c.stroke();
  c.beginPath(); c.arc(0, -1.5, 4.4, 0, TAU); c.fillStyle = RED; c.fill(); c.lineWidth = 2.8; c.strokeStyle = INK; c.stroke();
  // little surprise ticks either side
  c.lineWidth = 2.6;
  for (const [x0, y0, x1, y1] of [[-14, -34, -22, -40], [-15, -22, -25, -22], [14, -34, 22, -40], [15, -22, 25, -22]]) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
  c.restore();
}
/** manga-style action lines rushing in from the screen edges while the fish fights (screen space, redrawn on twos) */
function drawActionLines(c, G, w, h, dpr, q) {
  const a = focusAmt(G); if (a <= 0.01) return;
  const frame = Math.floor(G.clock * 12), rnd = mulberry32(frame * 7919 + 13);
  const n = q ? 84 : 40, cx = w / 2, cy = h / 2, reach = Math.min(w, h);
  const surge = G.mg && G.mg.big ? 1.25 : 1;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
  for (let i = 0; i < n; i++) {
    const ang = (i + rnd() * 0.8) / n * TAU;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    // where this ray leaves the screen rectangle
    const tEdge = Math.min(dx ? (dx > 0 ? (w - cx) / dx : -cx / dx) : Infinity, dy ? (dy > 0 ? (h - cy) / dy : -cy / dy) : Infinity) * 1.02;
    const len = reach * (0.07 + rnd() * 0.16) * surge * (0.55 + 0.45 * a);
    const ex = cx + dx * tEdge, ey = cy + dy * tEdge, ix = ex - dx * len, iy = ey - dy * len;
    const half = (1.2 + rnd() * 3.4) * dpr, nx = -dy * half, ny = dx * half;
    c.globalAlpha = a * (0.28 + rnd() * 0.42);
    c.fillStyle = rnd() < 0.82 ? 'rgb(36,26,22)' : 'rgb(255,250,240)';
    c.beginPath(); c.moveTo(ex + nx, ey + ny); c.lineTo(ix, iy); c.lineTo(ex - nx, ey - ny); c.closePath(); c.fill();
  }
  c.restore();
}

/** draw one catch, as held up, on its own canvas (size × size CSS px): handy for listing the catches outside the scene */
function catchArt(kind, size) {
  const g = GRIP[kind]; if (!g || (kind !== 'jjajangmyeon' && kind !== 'bottle' && kind !== 'viola' && kind !== 'tinikling' && kind !== 'hongkong' && !g.img)) return null;
  // draw big on a scratch canvas, find its edges, then fit it into the output with a little padding
  const W = 480, sc = 3, tmp = document.createElement('canvas'); tmp.width = tmp.height = W;
  const t = tmp.getContext('2d'); t.lineJoin = 'round'; t.lineCap = 'round';
  const q = rot(-g.dx * g.s * sc, -g.dy * g.s * sc, g.ang);
  drawTreasure(t, kind, W / 2 - q[0], W / 2 - q[1], g.ang, sc, 1, { corked: true, noteIn: true });
  const d = t.getImageData(0, 0, W, W).data; let x0 = W, y0 = W, x1 = 0, y1 = 0;
  for (let y = 0; y < W; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1), out = document.createElement('canvas');
  out.width = out.height = Math.round(size * dpr); out.style.width = out.style.height = size + 'px';
  const o = out.getContext('2d'), bw = x1 - x0 + 4, bh = y1 - y0 + 4, k = (size * dpr * 0.84) / Math.max(bw, bh);
  o.drawImage(tmp, x0 - 2, y0 - 2, bw, bh, (out.width - bw * k) / 2, (out.height - bh * k) / 2, bw * k, bh * k);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Sound: synthesised with Web Audio (no audio files)                 */
/*  reel ratchet ticks · splashes · a shimmer for the "tada"            */
/* ------------------------------------------------------------------ */
function createSfx(muted, specs) {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  let ac = null, out = null, noise = null;
  const X = { muted: !!muted, vol: 0.55, level: 1, played: [], files: {}, media: {}, specs: {} };
  for (const k in specs || {}) X.specs[k] = typeof specs[k] === 'string' ? { src: specs[k] } : specs[k];
  /** fetch + decode the sound files once audio is allowed. When the page is opened straight from disk (file://) the
   *  browser blocks fetch, so those files play through plain <audio> elements instead (no volume boost above 1 there).
   *  A file that can't load at all falls back to the synth. */
  const live = new Set();   // <audio> elements currently playing (so muting can silence them at once)
  const mediaFallback = (name) => {
    const el = new Audio(); el.preload = 'auto';
    el.addEventListener('canplaythrough', () => { X.media[name] = el; }, { once: true });
    el.src = X.specs[name].src; el.load();
  };
  const loadFiles = () => {
    for (const name in X.specs) {
      if (X.files[name] !== undefined) continue; X.files[name] = null;
      if (location.protocol === 'file:') { mediaFallback(name); continue; }
      fetch(X.specs[name].src).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => new Promise((res, rej) => ac.decodeAudioData(b, res, rej))).then((buf) => { X.files[name] = buf; })
        .catch(() => mediaFallback(name));
    }
  };
  /** play through an <audio> element (file:// pages); same slices, offsets and fades as the Web Audio path */
  const playMedia = (name, sp, k, skip) => {
    const base = X.media[name], vol = Math.min(1, X.vol * (sp.vol === undefined ? 1 : sp.vol) * 1.4);
    const off = (sp.slices ? sp.slices[(k | 0) % sp.slices.length] : (sp.start || 0)) + (skip || 0);
    const dur = (sp.dur || base.duration - (sp.start || 0)) - (skip || 0), fd = sp.fade || 0.06;
    const a = base.cloneNode(); a.volume = 0; a.currentTime = off; live.add(a); a.addEventListener('pause', () => live.delete(a));
    const p = a.play(); if (p && p.catch) p.catch(() => {});
    const t0 = performance.now(), fin = (sp.fade || 0.012) * 1000;
    const h = { media: a, dur, timer: 0 };
    const stepVol = () => {   // fade in, hold, fade out, stop
      const t = performance.now() - t0, end = dur * 1000;
      if (t >= end || h.stopped) { a.pause(); return; }
      a.volume = vol * Math.min(1, t / Math.max(1, fin), sp.dur ? Math.max(0, (end - t) / (fd * 1000)) : 1);
      h.timer = setTimeout(stepVol, 30);
    };
    stepVol();
    return h;
  };
  /** browsers only allow audio after a user gesture: call from pointer/key handlers */
  X.unlock = () => {
    try {
      if (!ac) {
        ac = new AC(); out = ac.createGain(); out.gain.value = X.muted ? 0 : X.vol;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
        out.connect(comp); comp.connect(ac.destination);
        noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        loadFiles();
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { ac = null; }
  };
  X.setLevel = (v) => { X.level = clamp(+v || 0, 0, 1); X.vol = 0.55 * X.level; if (ac && !X.muted) out.gain.setTargetAtTime(X.vol, ac.currentTime, 0.03); };
  X.setMuted = (m) => { X.muted = !!m; if (ac) out.gain.setTargetAtTime(X.muted ? 0 : X.vol, ac.currentTime, 0.03); if (X.muted) for (const a of live) a.pause(); };
  X.close = () => { if (ac && ac.close) ac.close(); ac = null; };
  X.state = () => (ac ? ac.state : 'locked');
  const ready = (name) => { X.played.push(name); if (X.played.length > 40) X.played.shift(); return ac && ac.state === 'running' && !X.muted; };
  const noiseSrc = (t, dur) => { const n = ac.createBufferSource(); n.buffer = noise; n.loop = true; n.start(t, Math.random() * 0.8); n.stop(t + dur + 0.05); return n; };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  /** play a loaded sound file (k picks one of its slices); returns false if it isn't loaded, so the caller can use the synth */
  X.file = (name, k, skip) => {
    const sp = X.specs[name], buf = X.files[name]; if (!sp || (!buf && !X.media[name])) return false;
    if (!ready(name)) return true;
    if (!buf) return playMedia(name, sp, k, skip);
    const t = ac.currentTime, vol = sp.vol === undefined ? 1 : sp.vol, fd = sp.fade || 0.06;
    const off = (sp.slices ? sp.slices[(k | 0) % sp.slices.length] : (sp.start || 0)) + (skip || 0);
    const dur = (sp.dur || buf.duration - (sp.start || 0)) - (skip || 0);
    const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = buf;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + (sp.fade || 0.012));
    if (sp.dur) { g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - fd)); g.gain.linearRampToValueAtTime(0, t + dur); }
    src.connect(g); g.connect(out); src.start(t, off, dur + 0.02);
    return { src, g, dur };
  };
  X.has = (name) => !!(X.files[name] || X.media[name]);
  X.now = () => (ac ? ac.currentTime : 0);
  /** fade a playing file out (used to end the fight loop) */
  X.stop = (h, fade) => {
    if (h && h.media) {   // <audio> fallback: quick fade, then pause
      const a = h.media, v0 = a.volume, t0 = performance.now(), ms = (fade || 0.2) * 1000; h.stopped = true; clearTimeout(h.timer);
      const f = () => { const u = (performance.now() - t0) / ms; if (u >= 1) { a.pause(); return; } a.volume = v0 * (1 - u); setTimeout(f, 30); }; f(); return;
    }
    if (!h || !ac) return; const t = ac.currentTime; try { h.g.gain.cancelScheduledValues(t); h.g.gain.setValueAtTime(h.g.gain.value, t); h.g.gain.linearRampToValueAtTime(0, t + (fade || 0.2)); h.src.stop(t + (fade || 0.2) + 0.02); } catch (e) {} };
  /** one click of the reel's ratchet */
  X.tick = (k) => {
    if (!ready('tick')) return; const t = ac.currentTime; k = k || 1;
    const n = noiseSrc(t, 0.03), bp = ac.createBiquadFilter(), g = ac.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 3000 + Math.random() * 700; bp.Q.value = 6;
    env(g, t, 0.001, 0.32 * k, 0.018); n.connect(bp); bp.connect(g); g.connect(out);
    const o = ac.createOscillator(), og = ac.createGain(); o.type = 'square'; o.frequency.value = 1350 + Math.random() * 150;
    env(og, t, 0.001, 0.04 * k, 0.012); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.03);
  };
  /** water: a burst of noise sweeping down, with a little "bloop" (k ≈ 0.3 ripple … 1 big splash) */
  X.splash = (k) => {
    if (!ready('splash')) return; const t = ac.currentTime; k = k || 1; const dur = 0.22 + 0.32 * k;
    const n = noiseSrc(t, dur), hp = ac.createBiquadFilter(), lp = ac.createBiquadFilter(), g = ac.createGain();
    hp.type = 'highpass'; hp.frequency.value = 180; lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(2400 + 2000 * k, t); lp.frequency.exponentialRampToValueAtTime(420, t + dur);
    env(g, t, 0.006, 0.5 * k, dur); n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
    const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(380 + 140 * Math.random(), t); o.frequency.exponentialRampToValueAtTime(120, t + 0.14);
    env(og, t, 0.004, 0.2 * k, 0.14); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.2);
  };
  /** "tada": a quick rising arpeggio of soft bells over a high sparkle */
  X.shimmer = () => {
    if (!ready('shimmer')) return; const t0 = ac.currentTime;
    [1318.5, 1661.2, 1975.5, 2637].forEach((f, i) => {
      const t = t0 + i * 0.07;
      for (const [mul, amp, type] of [[1, 0.15, 'sine'], [2.01, 0.045, 'sine'], [3, 0.02, 'triangle']]) {
        const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f * mul;
        env(g, t, 0.004, amp, 0.95 - i * 0.1); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.1);
      }
    });
    const n = noiseSrc(t0, 0.6), hp = ac.createBiquadFilter(), g = ac.createGain();
    hp.type = 'highpass'; hp.frequency.setValueAtTime(5000, t0); hp.frequency.linearRampToValueAtTime(9000, t0 + 0.5);
    env(g, t0, 0.02, 0.05, 0.5); n.connect(hp); hp.connect(g); g.connect(out);
  };
  return X;
}

/* ------------------------------------------------------------------ */
/*  Engine                                                             */
/* ------------------------------------------------------------------ */
let LAYOUT = null, CATCH = null, WPATH = null, RINGS = null, RISES = null;
function shared() {
  if (!LAYOUT) {
    LAYOUT = buildLayout(); WPATH = waterPath(); CATCH = makeCatchCache();
    RISES = LAYOUT.rises.map((r) => ({ t: r.t, x: r.x, y: r.y, life: 4, size: 34, a: 0.5 }));
    RINGS = catchRings().concat(RISES);
  }
}

function createEngine(canvas, opts) {
  shared();
  const o = Object.assign({ quality: 'high', parallax: true, startTime: 0, debug: false, reducedMotion: undefined, maxDpr: 2, time: undefined }, opts || {});
  const ctx = canvas.getContext('2d', { alpha: false });
  const E = { canvas, ctx, o, Y: LAYOUT, Cc: CATCH, q: o.quality === 'low' ? 0 : 1 };
  E.reelPh = 0; E.loops = {};
  E.P = compilePalette('day'); E.M = charMats(E.P);
  E.acc = 0; E.last = 0; E.running = false; E.visible = true; E.pageVisible = !document.hidden; E.userPaused = false;
  E.mouse = { tx: 0, ty: 0, x: 0, y: 0 }; E.scroll = 0; E.raf = 0; E.perf = { avg: 0 }; E.S = 0;
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  E.rm = o.reducedMotion !== undefined ? !!o.reducedMotion : !!(mq && mq.matches);
  // interactive by default: the cursor is the bob (o.interactive === false keeps the passive 60 s loop)
  E.game = o.interactive !== false && !E.rm ? createGame() : null;
  E.sfx = E.game && o.sound !== false ? createSfx(o.muted, o.sounds) : null;
  if (E.sfx && o.volume !== undefined) E.sfx.setLevel(o.volume);
  if (E.game) {
    const F = {}; for (const k in DEFAULT_FACTS) F[k] = DEFAULT_FACTS[k];
    if (o.facts) for (const k in o.facts) if (Array.isArray(o.facts[k])) F[k] = o.facts[k].map((f) => (f && typeof f === 'object' ? f : String(f)));
    E.game.facts = F; E.game.onCatch = o.onCatch || null;
    // extra catches supplied as images: { kind: { src, label, size } }. Each joins the pool once its image has loaded.
    if (o.catchImages) for (const kind in o.catchImages) {
      const ci = o.catchImages[kind], img = new Image(), size = ci.size || 36;
      img.onload = () => {
        CATCHES[kind] = { label: ci.label || 'a treasure' };
        GRIP[kind] = { dx: 0, dy: size * 0.45, ang: 0, s: 1, lift: size + 26, img, size };   // held up from its bottom edge
        if (!F[kind]) F[kind] = ['[A fact for ' + (ci.label || kind) + '. Set facts.' + kind + ']'];
        if (E.game) E.game.bag = null;   // reshuffle so it can turn up
      };
      img.src = ci.src;
    }
  }
  E.ptr = null;
  if (E.game && o.hideCursor !== false && !document.getElementById('rf-cursor-style')) {
    const st = document.createElement('style'); st.id = 'rf-cursor-style';
    st.textContent = 'html.rf-hide-cursor, html.rf-hide-cursor * { cursor: none !important; } html.rf-focus { overscroll-behavior: none; }';
    document.head.appendChild(st);
  }

  function buildStatic(S) {
    const t0 = performance.now(), P = E.P, L = {}, sp = {};
    E.S = S;
    L.sky = mkLayer(-60, -60, 2040, 740, S, (c) => { paintSky(c, P); paperTexture(c, -60, -60, 2040, 740, 0.12); });
    L.clouds = E.Y.clouds.map((d) => makeCloud(P, S, d));
    L.far = mkLayer(-60, 360, 2040, 400, S, (c) => paintFar(c, P));
    L.refl = mkLayer(-80, 586, 2080, 574, S * (E.q ? 0.75 : 0.5), (c) => paintReflection(c, P, L));
    L.tint = mkLayer(-80, 586, 2080, 574, S, (c) => paintWaterTint(c, P, WPATH));
    L.bank = mkLayer(-80, 586, 2080, 574, S, (c) => paintBank(c, P));
    L.trunk = mkLayer(1060, -80, 940, 1000, S, (c) => paintTrunk(c, P));
    L.raysA = makeRays(P, S, 61); L.raysB = E.q ? makeRays(P, S, 62) : null;
    sp.clumps = E.Y.clumps.map((d) => makeClump(P, S, d));
    sp.bushes = E.Y.bushes.map((d) => makeBush(P, S, d));
    sp.ferns = E.Y.ferns.map((d) => makeFern(P, S, d));
    sp.tufts = E.Y.tufts.map((d) => makeTuft(P, S, d));
    E.L = L; E.sp = sp;
    E.spot = softSpot(P.rim, 64); E.spotW = softSpot([255, 250, 236], 32);
    E.fishShadow = fishShadowSprite(P);
    E.grain = E.q ? grainTiles(6).map((cv) => ctx.createPattern(cv, 'repeat')) : [];
    E.buildMs = performance.now() - t0;
  }

  function layout() {
    const W = Math.max(1, canvas.clientWidth || window.innerWidth), H = Math.max(1, canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, E.q ? o.maxDpr : 1.5);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    let k = Math.max(W / W0, H / H0), vw = W / k, vh = H / k;
    let x0 = vw < W0 ? clamp(FISH_X - vw * 0.7, 0, W0 - vw) : 0;
    let y0 = vh < H0 ? (H0 - vh) * 0.6 : 0;
    if (o.crop) { k = W / o.crop[2]; vw = o.crop[2]; vh = H / k; x0 = o.crop[0]; y0 = o.crop[1]; }   // inspection only
    E.view = { W, H, dpr, k, m: k * dpr, x0, y0, vw, vh };
    // static layers: resolution bucketed so a resize rarely repaints
    const need = k * dpr, cap = E.q ? (W < 700 ? 1.25 : 1.5) : 0.75;
    const buckets = [0.5, 0.625, 0.75, 1, 1.25, 1.5];
    let S = buckets.find((b) => b >= need * 0.92) || 1.5; S = Math.min(S, cap);
    // fisher sprite at full device resolution
    const fk = k * dpr * FS;
    if (!E.fsCanvas || Math.abs(E.fk - fk) > 0.01) {
      E.fk = fk; E.fsCanvas = mkCanvas(280 * fk, 300 * fk); E.fsCtx = E.fsCanvas.getContext('2d');
      E.fsBackCanvas = mkCanvas(280 * fk, 300 * fk); E.fsBackCtx = E.fsBackCanvas.getContext('2d');
    }
    return S;
  }

  let rebuildTimer = 0;
  function onResize() {
    const S = layout();
    if (!E.L) buildStatic(S);
    else if (S > E.S + 0.01 || S < E.S * 0.6) {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => { buildStatic(S); draw(); }, 280);
    }
    draw();
  }

  /* ------------------------------ frame ------------------------------ */
  function render(t, tw) {
    const c = ctx, v = E.view, P = E.P, Y = E.Y;
    const px = o.parallax ? E.mouse.x * 7 : 0, py = (o.parallax ? E.mouse.y * 4 : 0) - E.scroll;
    const base = (d) => c.setTransform(v.m, 0, 0, v.m, (-v.x0 + px * d) * v.m, (-v.y0 + py * d) * v.m);
    let R, S;
    if (E.game) { if (!E.game.R) updateGame(E, 0, t); R = E.game.R; S = E.game.S; }
    else { R = rigAt(t); S = catchState(t, R, E.Cc); }
    const ta = S.ta !== undefined ? S.ta : t;
    const cs = clamp(34 / (30 * v.k), 1.6, 4.5); S.cs = cs;
    // fisher sprite
    const fk = E.fk;
    for (const [cv, cx, which] of [[E.fsBackCanvas, E.fsBackCtx, 'back'], [E.fsCanvas, E.fsCtx, 'front']]) {
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height);
      cx.setTransform(fk, 0, 0, fk, 150 * fk, 300 * fk);
      paintFisher(cx, R, E.M, P, t, which);
    }
    const fx = FISH_X - 150 * FS, fy = FISH_Y - 300 * FS;
    E.fsBack = { cv: E.fsBackCanvas, x: fx, y: fy, w: 280 * FS, h: 300 * FS };
    E.fs = { cv: E.fsCanvas, x: fx, y: fy, w: 280 * FS, h: 300 * FS };
    // the rod is held in his far hand: when the near hand is off it (showing a catch, pushing his hair) or the rod is
    // swung back over his shoulder, it belongs behind his body and near arm, not across them
    const rodBehind = (R.lh < 0.5 && (R.plant || 0) < 0.5) || R.rodA > 1.55;
    const L = E.L;
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    // sky, clouds, hills
    base(0.05); c.drawImage(L.sky.cv, L.sky.x, L.sky.y, L.sky.w, L.sky.h);
    base(0.1); drawClouds(c, E);
    base(0.2); c.drawImage(L.far.cv, L.far.x, L.far.y, L.far.w, L.far.h); drawHeron(c, E, t);
    // river
    base(0.35);
    c.save(); c.clip(WPATH);
    drawReflection(c, E, tw);
    drawCloudReflections(c, E, tw);
    drawFishShadows(c, E, t, tw);
    if (S.under) { c.save(); c.globalAlpha = S.under.a; c.translate(S.under.x, S.under.y); c.rotate(Math.PI); c.scale(0.8, 0.5); c.drawImage(E.fishShadow, -46, -20); c.restore(); }
    drawShins(c, E, R);
    if (S.fight) drawFight(c, E, S, t);
    if (S.shadow) drawShadowFish(c, E, S.shadow);
    drawFisherReflection(c, E, tw);
    c.drawImage(L.tint.cv, L.tint.x, L.tint.y, L.tint.w, L.tint.h);
    drawDapples(c, E, t, true);
    drawWaterHighlights(c, E, t, tw);
    drawRings(c, E, t, E.game ? RISES : RINGS);
    if (E.game) drawRings(c, E, E.game.clock % LOOP, E.game.rings);
    if (S.fight) drawFightSurface(c, E, S, t);
    c.restore();
    // banks, tree, canopy
    base(0.55); c.drawImage(L.bank.cv, L.bank.x, L.bank.y, L.bank.w, L.bank.h);
    drawBushes(c, E, t, false); drawTufts(c, E, t, 0);
    base(0.6); c.drawImage(L.trunk.cv, L.trunk.x, L.trunk.y, L.trunk.w, L.trunk.h);
    drawBushes(c, E, t, true); drawDapples(c, E, t, false); drawTufts(c, E, t, 1);
    base(0.7); drawCanopy(c, E, t);
    // the fisher
    base(0.55);
    c.drawImage(E.fsBack.cv, E.fsBack.x, E.fsBack.y, E.fsBack.w, E.fsBack.h);
    if (!rodBehind) c.drawImage(E.fs.cv, E.fs.x, E.fs.y, E.fs.w, E.fs.h);
    drawLegRipples(c, E, R, t);
    c.save(); c.translate(FISH_X, FISH_Y); c.scale(FS, FS); drawRod(c, R, P); drawHand(c, R.hF, R.elF, E.M, true); c.restore();
    if (rodBehind) c.drawImage(E.fs.cv, E.fs.x, E.fs.y, E.fs.w, E.fs.h);
    if (!S.noLine) drawLineAndFloat(c, S, P, ta);
    if (S.tada) drawTada(c, S.tada, E.q);
    if (S.treasure) drawTreasure(c, S.treasure.kind, S.treasure.x, S.treasure.y, S.treasure.ang, S.treasure.sc, S.treasure.a, S.treasure.o);
    if (S.cork) { c.save(); c.globalAlpha = S.cork.a; c.translate(S.cork.x, S.cork.y); c.rotate(S.cork.ang); c.fillStyle = 'rgb(176,128,80)'; c.strokeStyle = INK; c.lineWidth = 0.9; c.fillRect(-3, -3.4, 6, 6.8); c.strokeRect(-3, -3.4, 6, 6.8); c.restore(); }
    if (S.scrollDraw) drawScroll(c, S.scrollDraw.x, S.scrollDraw.y, S.scrollDraw.ang, S.scrollDraw.len, S.scrollDraw.sc);
    if (S.note) drawNote(c, S.note.xl, S.note.xr, S.note.y, S.note.open);
    if (S.fish) {
      drawFish(c, S.fish, E.M, P);
      const gl = bump(ta, CATCH_T, 0.12);   // a small glint as he snatches it            // the key pose: a small, elegant glint at the top of the arc
      if (gl > 0.03) drawGlint(c, S.fish.x - 6, S.fish.y + 6, 18 * gl, P, gl);
    } else if (S.treasure) { const gl = bump(ta, CATCH_T, 0.12); if (gl > 0.03) drawGlint(c, S.treasure.x - 8, S.treasure.y - 8, 20 * gl, P, gl); }
    c.save(); c.translate(FISH_X, FISH_Y); c.scale(FS, FS); drawHand(c, R.hN, R.elN, E.M, false); if (S.handsFront) drawHand(c, R.hF, R.elF, E.M, true); c.restore();
    if (E.game) drawDrops(c, E.game.clock, E.game, P); else drawDrops(c, t, E.Cc, P);
    base(0.6); drawReeds(c, E, t, 0);
    drawRays(c, E, t);
    base(1); drawTufts(c, E, t, 2); drawReeds(c, E, t, 1);
    base(0.8); drawLeaves(c, E, t); drawFluff(c, E, t); drawFlies(c, E, t, (Math.floor(t * 24) & 1) === 1);
    if (E.game) {
      base(0.55); drawMinigame(c, E.game); drawAlert(c, E.game, R);
      const G = E.game;   // while the line is out, the cursor is a ghost bob showing where the next cast goes
      if (G.cursor && G.ptrMouse && G.state !== 'idle' && G.state !== 'fight' && G.state !== 'hook') drawGhostBob(c, G.cursor[0], G.cursor[1], cs);
    }
    // finish: light-side diffusion, gentle vignette, film grain on twos
    base(0);
    if (!E.post) {
      const g1 = c.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, 900);
      g1.addColorStop(0, rgba(P.glow, 0.5)); g1.addColorStop(0.35, rgba(P.glow, 0.16)); g1.addColorStop(1, rgba(P.glow, 0));
      const g2 = c.createRadialGradient(820, 560, 300, 900, 560, 1250);
      g2.addColorStop(0, 'rgb(255,255,255)'); g2.addColorStop(1, rgba(mixc(P.wDeep, [255, 255, 255], 0.55)));
      E.post = { g1, g2 };
    }
    c.globalCompositeOperation = 'screen'; c.fillStyle = E.post.g1; c.fillRect(-100, -100, 2120, 1300);
    c.globalCompositeOperation = 'multiply'; c.fillStyle = E.post.g2; c.fillRect(-100, -100, 2120, 1300);
    if (E.grain.length) {
      const fi = Math.floor(t * 24) % E.grain.length, ox = (fi * 53) % 160, oy = (fi * 97) % 160;
      c.setTransform(1, 0, 0, 1, -ox, -oy);
      c.globalCompositeOperation = 'overlay'; c.globalAlpha = P.grain;
      c.fillStyle = E.grain[fi]; c.fillRect(0, 0, canvas.width + 160, canvas.height + 160);
    }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    if (E.game) drawActionLines(c, E.game, canvas.width, canvas.height, v.dpr, E.q);
  }

  function draw() {
    if (!E.L) return;
    const t0 = performance.now();
    const t = o.time !== undefined ? o.time : E.rm ? KEY_T : ((E.acc + o.startTime) % LOOP + LOOP) % LOOP;
    const tw = o.time !== undefined ? o.time : E.rm ? (KEY_T + E.acc * 0.2) % LOOP : t;
    E.t = t;
    render(t, tw);
    const ms = performance.now() - t0;
    E.perf.avg = E.perf.avg ? E.perf.avg * 0.95 + ms * 0.05 : ms; E.perf.last = ms;
    if (o.debug) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(8, 8, 230, 22 * E.view.dpr);
      ctx.fillStyle = '#fff'; ctx.font = (12 * E.view.dpr) + 'px monospace';
      ctx.fillText('t=' + t.toFixed(2) + 's  ' + E.perf.avg.toFixed(2) + 'ms  S=' + E.S, 14, 8 + 15 * E.view.dpr);
    }
    if (o.onFrame) o.onFrame(t, E.perf);
  }

  function tick(now) {
    E.raf = 0;
    if (!shouldRun()) return;
    const dt = E.last ? Math.min(0.1, (now - E.last) / 1000) : 0;
    if (E.rm && E.last && now - E.lastDraw < 80) { E.raf = requestAnimationFrame(tick); return; }
    E.last = now; E.lastDraw = now;
    E.acc = (E.acc + dt) % (LOOP * 1000);
    if (!E.rm) E.cloudT = (E.cloudT || 0) + dt;
    const k = 1 - Math.exp(-dt * 2.5);
    E.mouse.x += (E.mouse.tx - E.mouse.x) * k; E.mouse.y += (E.mouse.ty - E.mouse.y) * k;
    const st = Math.min(14, (window.scrollY || 0) * 0.02);
    E.scroll += (st - E.scroll) * Math.min(1, k * 3);
    if (E.game) { E.game.cursor = toScene(); updateGame(E, dt, ((E.acc + o.startTime) % LOOP + LOOP) % LOOP); syncCard(); syncHint(); syncFocus(); playSfx(dt); }
    draw();
    E.raf = requestAnimationFrame(tick);
  }
  const shouldRun = () => !E.userPaused && E.visible && !E.scrolledAway && E.pageVisible && !E.destroyed && o.time === undefined;
  function kick() { if (shouldRun() && !E.raf) { E.last = 0; E.raf = requestAnimationFrame(tick); } }

  /** rod tip in viewport (CSS px) coordinates */
  function tipClient() {
    const G = E.game; if (!G || !G.R || !E.view) return [window.innerWidth * 0.6, 0];
    const v = E.view, rc = canvas.getBoundingClientRect(), px = o.parallax ? E.mouse.x * 7 : 0, py = (o.parallax ? E.mouse.y * 4 : 0) - E.scroll;
    const w = toW(G.R.tip);
    return [(w[0] - v.x0 + px * 0.55) * v.m / v.dpr + rc.left, (w[1] - v.y0 + py * 0.55) * v.m / v.dpr + rc.top];
  }
  /** "Back to top": he hooks the button, tugs, and hauls the whole page up to him. */
  function reelUp(btn, opts) {
    if (E.reeling) return E.reeling;
    opts = opts || {};
    const heroH = o.heroHeight || canvas.clientHeight || window.innerHeight;
    const startY = window.scrollY || 0;
    const target = typeof opts.to === 'number' ? opts.to : opts.to && opts.to.getBoundingClientRect ? opts.to.getBoundingClientRect().top + startY : heroH;
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight), toY = clamp(target, 0, maxY);
    if (!E.game || E.rm || !btn || E.destroyed) { window.scrollTo({ top: toY, behavior: E.rm ? 'auto' : 'smooth' }); return Promise.resolve(); }
    E.reeling = new Promise((resolve) => {
      const G = E.game;
      const ov = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
      Object.assign(ov.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', zIndex: '10000', pointerEvents: 'none' });
      ov.width = Math.round(window.innerWidth * dpr); ov.height = Math.round(window.innerHeight * dpr); document.body.appendChild(ov);
      const oc = ov.getContext('2d');
      btn.classList.add('rf-hooked');
      G.reel = { phase: 'tug', pull: 0 }; setState(G, 'reel'); G.hold = false; syncCard();
      if (!E.raf) draw();
      const T0 = performance.now() / 1000, A = 0.6, STRUG = 3.0, REL = A + STRUG, SC = clamp(0.65 + Math.abs(toY - startY) / 3000, 0.7, 1.1), END = REL + SC + 0.9;
      const easeOut = (u) => 1 - Math.pow(1 - u, 3);
      const PULSES = [[0.25, 5], [0.8, 7], [1.35, 8], [1.9, 11], [2.5, 14]];   // [time into the struggle, how hard]
      const dir = toY >= startY ? 1 : -1;   // pulling the content up = scrolling down
      let relY = startY, freeFrom = null;
      const finish = () => { ov.remove(); btn.classList.remove('rf-hooked'); G.reel = null; if (G.state === 'reel') setState(G, 'idle'); E.reeling = null; resolve(); };
      const frame = () => {
        if (E.destroyed) { finish(); return; }
        const now = performance.now() / 1000, el = now - T0, tip = tipClient(), rb = btn.getBoundingClientRect();
        const hookAt = [rb.left + rb.width / 2, rb.top + 2];
        const anchor = [tip[0], Math.min(tip[1], heroH - (window.scrollY || 0))];   // the line comes from wherever the scene is visible
        let hook = hookAt, taut = 0, la = 1, buzz = 0;
        if (el < A) {   // the hook drops down from his rod tip onto the arrow
          const u = sstep(0, 1, el / A); hook = [lerp(anchor[0], hookAt[0], u), lerp(anchor[1], hookAt[1], u)];
        } else if (el < REL) {   // a real struggle: the page creeps, trembles and slips back
          const k = el - A; let pull = 0, lift = 0;
          for (const [t0, amp] of PULSES) { const g = Math.exp(-Math.pow((k - t0) / 0.11, 2)); pull = Math.max(pull, g * amp / 14); lift = Math.max(lift, g * amp); }
          const strain = 0.35 + 0.65 * sstep(0, STRUG, k);
          const nudge = (2 + 6 * sstep(0, STRUG, k) + lift + Math.sin(el * 61) * 0.8 * strain) * dir;
          window.scrollTo(0, startY + nudge); relY = startY + nudge;
          buzz = strain; taut = 0.8 + 0.2 * pull;
          G.reel.phase = 'tug'; G.reel.pull = Math.max(pull, 0.25 * strain);
        } else {   // it gives way all at once: the page is hauled up while he stumbles and hops
          if (G.reel.phase !== 'loose') { G.reel.phase = 'loose'; G.reel.releaseT = now; setState(G, 'reel'); freeFrom = hookAt; }
          const r = el - REL;
          if (r <= SC) { window.scrollTo(0, lerp(relY, toY, easeOut(r / SC))); onScroll(); }
          else if (Math.abs((window.scrollY || 0) - toY) > 1) { window.scrollTo(0, toY); onScroll(); }
          // the hook pops free and the slack line springs back up to the rod
          const f = sstep(0, 0.45, r);
          hook = [lerp(freeFrom[0], anchor[0], f), lerp(freeFrom[1], anchor[1] + 40, f) - Math.sin(Math.PI * f) * 40];
          la = 1 - sstep(0.25, 0.5, r);
          if (el > END) { finish(); return; }
        }
        // draw the line on top of the page
        oc.setTransform(dpr, 0, 0, dpr, 0, 0); oc.clearRect(0, 0, ov.width, ov.height);
        if (la > 0.01) {
          oc.globalAlpha = la; oc.lineCap = 'round';
          const vib = buzz ? Math.sin(now * 90) * 3 * buzz : 0;
          const mx = (anchor[0] + hook[0]) / 2 + (1 - taut) * 18 + vib, my = (anchor[1] + hook[1]) / 2 + (1 - taut) * 40;
          oc.strokeStyle = 'rgba(46,30,24,0.35)'; oc.lineWidth = 2.4;
          oc.beginPath(); oc.moveTo(anchor[0], anchor[1]); oc.quadraticCurveTo(mx, my, hook[0], hook[1]); oc.stroke();
          oc.strokeStyle = 'rgba(255,250,236,0.95)'; oc.lineWidth = 1.3;
          oc.beginPath(); oc.moveTo(anchor[0], anchor[1]); oc.quadraticCurveTo(mx, my, hook[0], hook[1]); oc.stroke();
          const fq = qb(anchor, [mx, my], hook, 0.86);   // the float, a little way up the line
          oc.fillStyle = '#f6f0e2'; oc.strokeStyle = INK; oc.lineWidth = 1;
          oc.beginPath(); oc.ellipse(fq[0], fq[1], 3.2, 6.5, 0, 0, TAU); oc.fill(); oc.stroke();
          oc.fillStyle = '#d64a34'; oc.beginPath(); oc.ellipse(fq[0], fq[1] - 5, 2.8, 3.2, 0, 0, TAU); oc.fill(); oc.stroke();
          // the hook, caught over the top of the button's ring
          oc.strokeStyle = '#c9ccd4'; oc.lineWidth = 1.8;
          oc.beginPath(); oc.moveTo(hook[0], hook[1] - 7); oc.lineTo(hook[0], hook[1] + 1); oc.arc(hook[0] - 3.4, hook[1] + 1, 3.4, 0, Math.PI * 0.95); oc.stroke();
          oc.globalAlpha = 1;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return E.reeling;
  }
  // the wordless how-to bubble over his head while he idles
  function syncHint() {
    const G = E.game; if (!G || o.hint === false) return;
    const heroH = o.heroHeight || canvas.clientHeight || window.innerHeight;
    const want = G.state === 'idle' && G.clock - G.st > 1.2 && !E.reeling && !E.scrolledAway && (window.scrollY || 0) < heroH * 0.4;
    if (want && !E.hint) E.hint = hintBubble(E.M, E.P);
    if (!E.hint) return;
    if (want !== E.hintOn) { E.hintOn = want; if (want) void E.hint.offsetWidth; E.hint.classList.toggle('on', want); }
    if (want && G.R && E.view) {
      const v = E.view, rc = canvas.getBoundingClientRect(), px = o.parallax ? E.mouse.x * 7 : 0, py = (o.parallax ? E.mouse.y * 4 : 0) - E.scroll;
      const h = toW(G.R.headC), ax = h[0], ay = h[1] - 34 * FS;
      const cx = (ax - v.x0 + px * 0.55) * v.m / v.dpr + rc.left, cy = (ay - v.y0 + py * 0.55) * v.m / v.dpr + rc.top;
      const el = E.hint, w = el.offsetWidth, hh = el.offsetHeight;
      el.style.left = clamp(cx - w / 2, 10, window.innerWidth - w - 10) + 'px';
      el.style.top = clamp(cy - hh - 8, 10, window.innerHeight - hh - 10) + 'px';
    }
  }
  // sounds: drain the game's queue; the reel ratchets while he's hauling (holding during a fight, or reeling up the page)
  function playSfx(dt) {
    const G = E.game; if (!G) return;
    const q = G.sfx; G.sfx = [];
    if (!E.sfx) return;
    const FALLBACK = { hook: ['splash', 0.75], reveal: ['shimmer'], thrash: ['splash'], fling: ['splash', 1], cast: [], land: ['splash', 0.3], escape: ['splash', 0.7] };   // synth stand-ins when a file isn't there
    // looped clips: copies overlap end to end with soft fades so there's no seam; they fade out when their moment ends
    const loop = (key, on, randomStart) => {
      const L = E.loops[key] || (E.loops[key] = { h: null, next: 0 });
      if (on && E.sfx.has(key)) {
        const now = E.sfx.now(), sp = E.sfx.specs[key], fade = sp.fade || 0.25;
        if (!L.h || now >= L.next) {
          const full = (sp.dur || 2), skip = !L.h && randomStart ? Math.random() * Math.max(0, full - 1.5) : 0;
          const h = E.sfx.file(key, 0, skip);
          if (h && h.dur) { L.h = h; L.next = now + h.dur - fade; } else { L.h = L.h || { muted: true }; L.next = now + 0.5; }
        }
      } else if (L.h) { if (L.h.src || L.h.media) E.sfx.stop(L.h, 0.2); L.h = null; }
    };
    const hauling = (G.state === 'fight' && G.hold) || (G.state === 'reel' && G.reel && G.reel.phase !== 'loose');
    // letting go mid-fight: the reel unwinds as the line runs back out (only the newest one plays, so tapping doesn't pile up;
    // pressing again cuts it off). Falls back to the cast sound if there's no release file.
    const relName = E.sfx.has('release') ? 'release' : E.sfx.has('cast') ? 'cast' : null;
    if (relName && G.state === 'fight' && E.prevHold && !G.hold) {
      if (E.releaseH && (E.releaseH.src || E.releaseH.media)) E.sfx.stop(E.releaseH, 0.08);
      E.releaseH = E.sfx.file(relName);
    } else if (E.releaseH && G.hold && !E.prevHold) { if (E.releaseH.src || E.releaseH.media) E.sfx.stop(E.releaseH, 0.1); E.releaseH = null; }
    E.prevHold = G.state === 'fight' && G.hold;
    loop('fight', G.state === 'hook' || G.state === 'fight' || (G.state === 'catch' && G.clock - G.st < 0.3));   // runs on 0.3 s past the catch
    loop('reel', hauling, true);
    for (const [name, k] of q) {
      if (name === 'thrash' && E.sfx.has('fight')) continue;
      if (E.sfx.file(name, k)) continue;
      const fb = FALLBACK[name] || [name, k];
      if (fb.length && typeof E.sfx[fb[0]] === 'function' && !['file', 'unlock', 'setMuted', 'close', 'state'].includes(fb[0])) E.sfx[fb[0]](fb[1]);
    }
    if (hauling && !E.sfx.has('reel')) { E.reelPh += dt * (G.state === 'fight' && G.mg && !G.mg.inside ? 15 : 22); while (E.reelPh >= 1) { E.reelPh -= 1; E.sfx.tick(0.8 + 0.4 * Math.random()); } }
    else E.reelPh = 0.6;
  }
  // "fish on!": while he strikes and fights, html.rf-focus hides the page's text and buttons (page CSS) and the scroll is held
  function syncFocus() {
    const on = !!(E.game && E.game.focusOn);
    if (on === !!E.focus) return;
    E.focus = on; E.lockY = window.scrollY || 0;
    root.classList.toggle('rf-focus', on);
  }
  // the fun-fact card follows the catch he's holding up
  function syncCard() {
    const G = E.game; if (!G) return;
    const want = G.state === 'show' || (G.state === 'bottle' && G.bottleHold) ? G.catch : null;
    if (want && !E.card) { E.card = factCard(); E.card.b.addEventListener('click', () => { gameDismiss(E.game); syncCard(); }); }
    if (!E.card) return;
    if (want !== E.cardInfo) {
      E.cardInfo = want;
      if (want) { E.card.k.textContent = 'Catch #' + want.n + ' · ' + want.label; setFactText(E.card.t, want.fact); void E.card.el.offsetWidth; E.card.el.classList.add('on'); }
      else E.card.el.classList.remove('on');
    }
    if (want && E.view) {
      const v = E.view, rc = canvas.getBoundingClientRect(), px = o.parallax ? E.mouse.x * 7 : 0, py = (o.parallax ? E.mouse.y * 4 : 0) - E.scroll;
      const hw = toW(G.R.hN), hf = toW(G.R.hF);
      let ax = hw[0] - 30, ay = hw[1] - (GRIP[want.kind] ? GRIP[want.kind].lift : 60);
      if (G.state === 'bottle') { ax = (hw[0] + hf[0]) / 2 - 24; ay = Math.min(hw[1], hf[1]) - NOTE_H * FS / 2 - 14; }
      const cx = (ax - v.x0 + px * 0.55) * v.m / v.dpr + rc.left, cy = (ay - v.y0 + py * 0.55) * v.m / v.dpr + rc.top;
      const el = E.card.el, w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = clamp(cx - w + 34, 12, window.innerWidth - w - 12) + 'px';
      el.style.top = clamp(cy - h, 12, window.innerHeight - h - 12) + 'px';
    }
  }
  // pointer → scene coordinates on the fisher's parallax plane
  function toScene() {
    if (!E.ptr || !E.view) return null;
    const v = E.view, rc = canvas.getBoundingClientRect();
    const px = o.parallax ? E.mouse.x * 7 : 0, py = (o.parallax ? E.mouse.y * 4 : 0) - E.scroll;
    const x = (E.ptr[0] - rc.left) * v.dpr / v.m + v.x0 - px * 0.55, y = (E.ptr[1] - rc.top) * v.dpr / v.m + v.y0 - py * 0.55;
    return [x, y];
  }
  const UI = 'a,button,input,textarea,select,label,summary,option,[role="button"],[role="link"],[role="slider"],[contenteditable],[data-rf-ignore]';
  const isUI = (el) => !!(el && el.closest && el.closest(UI));
  const root = document.documentElement;
  const onPtrMove = (e) => {
    if (!E.game) return;
    // only where the river is actually showing: above the bottom of the hero (content below covers the fixed canvas)
    const rc = canvas.getBoundingClientRect(), heroBottom = rc.top + (o.heroHeight || canvas.clientHeight || window.innerHeight) - (window.scrollY || 0);
    const inside = e.clientX >= rc.left && e.clientX <= rc.right && e.clientY >= rc.top && e.clientY <= Math.min(rc.bottom, heroBottom);
    const ui = isUI(e.target);
    E.ptr = inside && !ui ? [e.clientX, e.clientY] : (inside && E.game.state === 'fight' ? [e.clientX, e.clientY] : null);
    E.game.ptrMouse = e.pointerType === 'mouse';
    if (o.hideCursor !== false) root.classList.toggle('rf-hide-cursor', inside && !ui && e.pointerType === 'mouse');
  };
  const onPtrDown = (e) => {
    if (E.sfx) E.sfx.unlock();
    if (!E.game || e.button !== 0 || isUI(e.target) || E.destroyed) return;
    onPtrMove(e);
    if (!E.ptr && E.game.state !== 'fight') return;   // clicked on page content below the hero: not a cast
    E.game.cursor = toScene();
    gameDown(E.game); kick();
  };
  const onPtrUp = () => { if (E.game) E.game.hold = false; };
  const onMouseDown = (e) => {
    if (!E.game || e.button !== 0 || isUI(e.target)) return;
    const rc = canvas.getBoundingClientRect(), heroBottom = rc.top + (o.heroHeight || canvas.clientHeight || window.innerHeight) - (window.scrollY || 0);
    if (e.clientY <= heroBottom) e.preventDefault();   // no text-selection drags while fishing (content below stays selectable)
  };   // no text-selection drags while fishing
  const onKey = (e) => {
    if (E.sfx && e.type === 'keydown') E.sfx.unlock();
    if (!E.game || e.code !== 'Space' || isUI(document.activeElement) || E.game.state !== 'fight') return;
    e.preventDefault(); E.game.hold = e.type === 'keydown';
  };
  const onOut = (e) => { if (E.game && !e.relatedTarget) { E.ptr = null; root.classList.remove('rf-hide-cursor'); } };
  // no accidental scrolling mid-fight: wheel, touch drags and scroll keys are swallowed, anything else is undone
  const SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
  const onLockWheel = (e) => { if (E.focus) e.preventDefault(); };
  const onLockKey = (e) => { if (E.focus && SCROLL_KEYS.includes(e.key) && !isUI(document.activeElement)) e.preventDefault(); };
  const onLockScroll = () => { if (E.focus && Math.abs((window.scrollY || 0) - E.lockY) > 0.5) window.scrollTo(0, E.lockY); };
  if (E.game) {
    window.addEventListener('pointermove', onPtrMove, { passive: true });
    window.addEventListener('pointerdown', onPtrDown);
    window.addEventListener('pointerup', onPtrUp); window.addEventListener('pointercancel', onPtrUp); window.addEventListener('blur', onPtrUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
    document.addEventListener('mouseout', onOut);
    window.addEventListener('wheel', onLockWheel, { passive: false }); window.addEventListener('touchmove', onLockWheel, { passive: false });
    window.addEventListener('keydown', onLockKey); window.addEventListener('scroll', onLockScroll);
  }
  // listeners
  const onMove = (e) => { E.mouse.tx = clamp(e.clientX / window.innerWidth * 2 - 1, -1, 1); E.mouse.ty = clamp(e.clientY / window.innerHeight * 2 - 1, -1, 1); };
  const onVis = () => { E.pageVisible = !document.hidden; kick(); };
  // a position:fixed canvas never leaves the viewport, so also pause once the page has scrolled a full screen past it
  function onScroll() { E.scrolledAway = (window.scrollY || 0) > (canvas.clientHeight || window.innerHeight) * 1.05; kick(); }
  const onMq = (e) => { if (o.reducedMotion === undefined) { E.rm = e.matches; draw(); } };
  let ro = null, io = null;
  if (window.ResizeObserver) { ro = new ResizeObserver(() => onResize()); ro.observe(canvas); } else window.addEventListener('resize', onResize);
  if (window.IntersectionObserver) { io = new IntersectionObserver((en) => { E.visible = en[0].isIntersecting; kick(); }); io.observe(canvas); }
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('scroll', onScroll, { passive: true });
  if (o.parallax) window.addEventListener('pointermove', onMove, { passive: true });
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq);

  onResize();
  kick();

  return {
    pause() { E.userPaused = true; if (E.raf) cancelAnimationFrame(E.raf); E.raf = 0; },
    /** the fisher hooks `button` and hauls the page back to the top */
    reelUp(button, opts) { return reelUp(button, opts); },
    resume() { E.userPaused = false; kick(); },
    /** sound on/off (sound only plays after the visitor's first click or key press) */
    mute(on) { if (E.sfx) E.sfx.setMuted(on !== false); }, get muted() { return E.sfx ? E.sfx.muted : true; },
    /** sound level 0..1 (on top of mute) */
    volume(v) { if (E.sfx) E.sfx.setLevel(v); }, get level() { return E.sfx ? E.sfx.level : 0; },
    destroy() {
      E.destroyed = true; if (E.raf) cancelAnimationFrame(E.raf); E.raf = 0;
      if (ro) ro.disconnect(); else window.removeEventListener('resize', onResize);
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPtrMove); window.removeEventListener('pointerdown', onPtrDown);
      window.removeEventListener('pointerup', onPtrUp); window.removeEventListener('pointercancel', onPtrUp); window.removeEventListener('blur', onPtrUp);
      window.removeEventListener('mousedown', onMouseDown); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
      document.removeEventListener('mouseout', onOut); root.classList.remove('rf-hide-cursor', 'rf-focus');
      window.removeEventListener('wheel', onLockWheel); window.removeEventListener('touchmove', onLockWheel);
      window.removeEventListener('keydown', onLockKey); window.removeEventListener('scroll', onLockScroll);
      if (E.card) { E.card.el.remove(); E.card = null; }
      if (E.hint) { E.hint.remove(); E.hint = null; }
      if (E.sfx) { E.sfx.close(); E.sfx = null; } E.loops = {};
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
      clearTimeout(rebuildTimer);
      E.L = null; E.sp = null; E.fsCanvas = null;
    },
    /** jump to a time in the loop (seconds) */
    seek(t) { E.acc = ((t - o.startTime) % LOOP + LOOP) % LOOP; draw(); },
    /** render one exact frame and hold it (testing / stills) */
    renderAt(t) { o.time = t; draw(); },
    play() { o.time = undefined; kick(); },
    get time() { return E.t; }, get stats() { return { frameMs: E.perf.avg, buildMs: E.buildMs, res: E.S }; },
    /** game hooks (also handy for scripted tests) */
    game: E.game && {
      get state() { return E.game.state; }, get progress() { return E.game.mg ? E.game.mg.p : 0; }, get fish() { return E.game.fish; }, get clock() { return E.game.clock; }, get mg() { return E.game.mg; },
      pointAt(x, y) { E.game.cursor = [x, y]; E.game.ptrMouse = true; },
      click() { gameDown(E.game); }, get catch() { return E.game.catch; }, forceCatch(kind) { E.game.forceKind = kind; }, press() { E.game.hold = true; }, release() { E.game.hold = false; },
      step(sec) { const n = Math.max(1, Math.round(sec * 60)); for (let i = 0; i < n; i++) { E.acc += 1 / 60; const cur = E.game.cursor; updateGame(E, 1 / 60, ((E.acc + o.startTime) % LOOP + LOOP) % LOOP); E.game.cursor = cur; playSfx(1 / 60); } draw(); syncCard(); syncHint(); },
      get sounds() { return E.sfx ? { audio: E.sfx.state(), muted: E.sfx.muted, played: E.sfx.played.slice(), loaded: Object.keys(E.sfx.files).filter((k) => E.sfx.files[k]), media: Object.keys(E.sfx.media) } : null; },
    },
  };
}

function drawFight(c, E, S, t) {
  const f = S.fight;
  c.save(); c.globalAlpha = 0.5 * f.a; c.translate(f.x, f.y + 5); c.rotate(f.ang + Math.PI);
  c.scale(0.7, 0.45 + 0.1 * Math.sin(t * 21)); c.drawImage(E.fishShadow, -46, -20); c.restore();
}
function drawFightSurface(c, E, S, t) {
  const f = S.fight, P = E.P, sp = clamp(f.v / 120, 0.3, 1.4);
  const x = S.E[0], y = f.y - 1.5, back = f.ang + Math.PI;
  c.save(); c.strokeStyle = rgba(P.wHi); c.fillStyle = rgba(P.wHi);
  // V-wake trailing the line where it slices the surface
  c.globalAlpha = 0.6 * f.a; c.lineWidth = 1.1;
  for (const s of [-1, 1]) {
    c.beginPath(); c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(back + s * 0.35) * 14 * sp, y + Math.sin(back + s * 0.35) * 4 * sp + 2, x + Math.cos(back + s * 0.5) * 30 * sp, y + Math.sin(back + s * 0.5) * 7 * sp + 3);
    c.stroke();
  }
  // churning foam around the entry point
  for (let i = 0; i < 5; i++) {
    const a = t * (3 + i) + i * 1.7, r = 4 + 3 * Math.sin(t * 9 + i);
    c.globalAlpha = (0.35 + 0.25 * Math.sin(t * 15 + i * 2)) * f.a;
    c.beginPath(); lens(c, x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 0.35, 5 + i, 1.1, 0); c.fill();
  }
  c.globalAlpha = 0.7 * f.a; c.lineWidth = 0.9;
  c.beginPath(); c.ellipse(x, y + 0.5, 5 + 2 * Math.sin(t * 25), 1.4, 0, 0, TAU); c.stroke();
  c.restore();
}
function drawGlint(c, x, y, r, P, a) {
  c.save(); c.globalAlpha = a; c.fillStyle = rgba(P.wHiWarm);
  c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r * 0.12, y); c.lineTo(x, y + r); c.lineTo(x - r * 0.12, y); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(x - r * 0.7, y); c.lineTo(x, y + r * 0.1); c.lineTo(x + r * 0.7, y); c.lineTo(x, y - r * 0.1); c.closePath(); c.fill();
  c.restore();
}
function drawLegRipples(c, E, R, t) {
  c.strokeStyle = rgba(E.P.wHi); c.lineWidth = 1.1;
  for (const [k, ph] of [[R.kneeN, 0], [R.kneeF, 1.7]]) {
    const x = FISH_X + k[0] * FS;
    for (let j = 0; j < 2; j++) {
      const u = frac(t / 2.5 + j * 0.5 + ph * 0.2);
      c.globalAlpha = 0.5 * (1 - u);
      c.beginPath(); c.ellipse(x, FISH_Y + 1, 11 + u * 16, 2.6 + u * 3.5, 0, 0.15, Math.PI - 0.15); c.stroke();
    }
    c.globalAlpha = 0.16 + 0.08 * osc(9, t, ph);
    c.beginPath(); c.moveTo(x - 9, FISH_Y + 2); c.quadraticCurveTo(x - 30, FISH_Y + 6, x - 52, FISH_Y + 12 + osc(7, t, ph) * 2); c.stroke();
  }
  c.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */
let current = null;
const API = {
  init(canvas, options) { if (current) current.destroy(); current = createEngine(canvas, options); return current; },
  pause() { if (current) current.pause(); },
  reelUp(button, opts) { return current ? current.reelUp(button, opts) : (window.scrollTo({ top: window.innerHeight, behavior: 'smooth' }), Promise.resolve()); },
  resume() { if (current) current.resume(); },
  mute(on) { if (current) current.mute(on); },
  volume(v) { if (current) current.volume(v); },
  /** a picture of one catch (canvas) and its label, for listing the catches outside the scene */
  catchArt(kind, size) { return catchArt(kind, size || 96); },
  labelOf(kind) { return CATCHES[kind] ? CATCHES[kind].label : null; },
  destroy() { if (current) { current.destroy(); current = null; } },
  get instance() { return current; },
  /** create an independent instance (several canvases on one page) */
  create(canvas, options) { return createEngine(canvas, options); },
  LOOP,
};
root.RiverFisher = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
