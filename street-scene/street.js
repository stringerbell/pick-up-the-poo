// The street, on the art: the picture, its characters, the leash between the kid and the dog, made-up sounds, and
// what happens there on the lines' cues: the dog drags the kid out, poos on the neighbor's lawn and the neighbor
// storms out; the neighbor's gestures through the ultimatum and his going back inside; your brother taking the
// money. The game (src/scene/play.ts) mounts it on the home scene's page once the dog drags you out the door.
//
// createStreet(stage, { home, street, homeBase, streetBase, floor, muteButton, onClick, onHover }):
//   home, street: the home scene's MANIFEST and this scene's STREET (manifest.js);
//   homeBase, streetBase: where their frames are, from the page (e.g. '' and '../street-scene/');
//   floor: where the kid can walk ([x0, y0, x1, y1], src/scene/layout.ts's STREET);
//   muteButton: false when the page brings its own (the home scene's, carried over);
//   onClick(button, point, double): a click on the picture (in picture pixels; double: the second of a quick two);
//   onHover(point | null): the pointer over the picture.
// The lines are the game's (rooms/street.yaml's scenes, dialogues/ultimatum.yaml): the game shows them, and calls
// `cue(name)` on their cues and `speaking(who, text)` as each one shows.
const W = 1536, H = 1024;

const CSS = `
.street .sprite, .street .shadow { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
.street .sprite { visibility: hidden; }
.street .sprite.on { visibility: visible; }
.street .shadow { border-radius: 50%; background: radial-gradient(closest-side, rgba(30,15,5,.45), rgba(30,15,5,0)); }
.street.noshadows .shadow { display: none; }
.street .leash { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.street .fade { position: absolute; inset: 0; z-index: 5500; background: #000; opacity: 1; pointer-events: none; }
.street .mute.own { position: absolute; left: 1.2%; right: auto; top: 1.6%; z-index: 6600; font: 600 13px/1 system-ui, sans-serif; padding: 5px 9px; border-radius: 14px; border: 1px solid rgba(255,240,200,.35); background: rgba(20,12,6,.55); color: #fff4dc; cursor: pointer; }
.street .mute.own.off { opacity: .7; text-decoration: line-through; }
`;

// The street's perspective: the sidewalk slabs' joints meet at the horizon; the kid (1.4 m) is 335 px tall at y 755
// (measured from sources/street-2.png, drawn with him standing there).
const HORIZON = 50, K = 239 / (755 - HORIZON);

// Where things are, as floor points (feet, wheels). The kid and the dog on the sidewalk; the dog's leap onto the
// neighbor's lawn (behind the fence: on it, he's above the pickets' tops); the neighbor's door and where he stops on
// his walk, behind the gate. Your brother along the front of the sidewalk (the jerk), his friends on the road.
export const AT = {
  kid: [380, 765], dog: [650, 785], takeoff: [585, 785], lawn: [770, 528], poo: [712, 530],
  door: [532, 338], steps: [522, 415], walk: [452, 517],
};
const LANE = { bro: 818, friend1: 902, friend2: 968 };
const SOUND_KEY = 'pick-up-the-poo:sound-off';
// The kid's frames from the home scene have no leash in them: where his hand is (metres from his feet, facing right).
const HAND = { run: [0.2, -0.78], walk: [0.12, -0.62], idle: [0.16, -0.6] };

export function createStreet(stage, hooks) {
  const { home, street, homeBase = '', streetBase = '' } = hooks;
  if (!document.getElementById('street-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'street-css', textContent: CSS }));
  stage.classList.add('street');
  if (!stage.querySelector('img.room')) stage.append(Object.assign(document.createElement('img'), { className: 'room', src: streetBase + 'street.png', alt: 'Your street', draggable: false }));

  const SETS = {};
  const homeSet = (k) => ({ ...home[k], frames: home[k].frames.map((f) => ({ ...f, src: homeBase + f.src, ay: f.ay ?? f.h })) });
  for (const k of ['sleep', 'walk', 'run', 'idle', 'back', 'front', 'jumpSide']) SETS[k] = homeSet(k);
  SETS.sleep.frames.forEach((f, i) => { f.ax = f.w / 2; f.leash = street.homeLeash.sleep[i] ?? undefined; });
  for (const [k, hand] of Object.entries(HAND)) for (const f of SETS[k].frames) f.hand = hand;
  for (const k of ['bro', 'friend1', 'friend2', 'kidSt', 'dogSt', 'dogRunS', 'dogUpS', 'dogBiz', 'poo', 'neighbor']) {
    SETS[k] = { ...street[k], frames: street[k].frames.map((f) => ({ ...f, src: streetBase + f.src })) };
  }
  for (const s of Object.values(SETS)) for (const f of s.frames) new Image().src = f.src; // preload

  const opts = { speed: 1, moped: 4.25, dogSpeed: 3.75, leashLen: 1.5, size: 1 };
  // The perspective: the street's, until `room()` puts up another picture on the same kind of camera.
  const persp = { horizon: HORIZON, k: K };
  const pxPerM = (y) => opts.size * persp.k * (y - persp.horizon);
  const unit = () => stage.clientWidth / W;

  // ── Actors ──
  const actors = [];
  // Each actor is drawn on a canvas, not an <img> whose src changes every frame: on an iPhone a swapped src can go blank
  // while the frame decodes (a playtest: "the boy walking is glitchy on mobile"); a canvas keeps the last frame up till
  // the next one's ready to draw.
  const frameImages = new Map();
  function frameImage(src) {
    // (Soaked, while it's raining on everyone: hooks.wetSrc, src/scene/wet.ts.)
    if (hooks.wetSrc) src = hooks.wetSrc(src);
    let im = frameImages.get(src);
    if (!im) { im = new Image(); im.decoding = 'async'; im.src = src; frameImages.set(src, im); }
    return im;
  }
  function actor(set, shadowM) {
    const img = document.createElement('canvas'); img.className = 'sprite'; stage.append(img);
    const sh = document.createElement('div'); sh.className = 'shadow'; stage.append(sh);
    const a = { set, frame: 0, x: -9999, y: 0, flip: false, lift: 0, shown: false, img, sh, shadowM, anim: null, move: null, path: null, leap: null, v: 0, brain: null, hold: false, phase: Math.random() * 7 };
    actors.push(a);
    return a;
  }
  const poo = actor('poo', 0), kid = actor('kidSt', 0.5), dog = actor('sleep', 1.0), neighbor = actor('neighbor', 0.55);
  const bro = actor('bro', 1.4), friend1 = actor('friend1', 1.4), friend2 = actor('friend2', 1.4);
  const mopeds = [bro, friend1, friend2];

  function render(a) {
    if (!a.shown) { a.img.classList.remove('on'); a.sh.style.display = 'none'; return; }
    const S = SETS[a.set], want = S.frames[a.frame];
    // (Redrawn when the frame changes, or its picture does: wet or dry, standing still.)
    const im = frameImage(want.src);
    if (a.drawn !== want || a.drawnIm !== im) {
      if (im.complete && im.naturalWidth) {
        if (a.img.width !== im.naturalWidth || a.img.height !== im.naturalHeight) { a.img.width = im.naturalWidth; a.img.height = im.naturalHeight; }
        const g = a.img.getContext('2d');
        g.clearRect(0, 0, a.img.width, a.img.height); g.drawImage(im, 0, 0);
        a.drawn = want; a.drawnSet = S; a.drawnIm = im;
      }
    }
    // Laid out as the frame that's drawn (the one asked for, once it's loaded; till then, the last one).
    if (!a.drawn) { a.img.classList.remove('on'); return; }
    const f = a.drawn, FS = a.drawnSet ?? S, k = (pxPerM(a.y) / FS.pxPerM) * (f.k ?? 1), u = unit();
    // People standing about breathe, each to their own rhythm (a slow rise and fall, from the feet).
    const b = a.brain && !a.brain.walking ? 1 + 0.011 * Math.sin(T * 1.6 + a.phase) : 1;
    const w = f.w * k, left = a.flip ? a.x - (f.w - f.ax) * k : a.x - f.ax * k, top = a.y - f.ay * k * b - a.lift + 2;
    a.img.classList.add('on');
    a.img.style.width = w * u + 'px';
    a.img.style.transform = `translate(${left * u}px, ${top * u}px)` + (a.flip ? ` translateX(${w * u}px) scaleX(-1)` : '') + (b !== 1 ? ` scaleY(${b})` : '');
    // In the air (the leap over the fence), he's in front of everything (not riding down in a basket: in it).
    a.img.style.zIndex = Math.round(a.y) + (a.lift > 4 && !a.aboard ? 400 : 0);
    if (!a.shadowM || a.aboard) { a.sh.style.display = 'none'; return; }
    const m = pxPerM(a.y), sw = a.shadowM * m * Math.max(0.55, 1 - a.lift / (m * 1.5)), sh = Math.max(6, sw * 0.13);
    a.sh.style.display = '';
    Object.assign(a.sh.style, { width: sw * u + 'px', height: sh * u + 'px', transform: `translate(${(a.x - sw / 2) * u}px, ${(a.y - sh * 0.7) * u}px)`, zIndex: Math.round(a.y) - 1 });
  }

  // Where the leash leaves a frame (the kid's fist, the dog's collar), in the picture. The frames have no leash
  // hanging in the air (tools/cut.ts takes it out): the page draws it, one line from one to the other.
  function leashPoint(a) {
    const S = SETS[a.set], f = S.frames[a.frame], k = pxPerM(a.y) / S.pxPerM, s = a.flip ? -1 : 1;
    if (f.leash) return [a.x + s * f.leash[0] * k, a.y + f.leash[1] * k - a.lift];
    if (f.hand) { const m = pxPerM(a.y); return [a.x + s * f.hand[0] * m, a.y + f.hand[1] * m - a.lift]; }
    return null;
  }
  const leash = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leash.setAttribute('class', 'leash'); leash.setAttribute('viewBox', `0 0 ${W} ${H}`); leash.setAttribute('preserveAspectRatio', 'none');
  leash.innerHTML = '<path fill="none" stroke="#7a0f17" stroke-width="7" stroke-linecap="round" /><path fill="none" stroke="#c42330" stroke-width="4" stroke-linecap="round" />';
  stage.append(leash);
  // Straight when it's taut, sagging when there's slack. Over the fence, it's in front of the fence.
  function drawLeash() {
    const p = kid.shown && dog.shown && leashPoint(kid), q = p && leashPoint(dog);
    if (!p || !q) { leash.style.display = 'none'; return; }
    const L = opts.leashLen * pxPerM((kid.y + dog.y) / 2), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const sag = Math.min(70, Math.max(0, L - d) * 0.55);
    const mx = (p[0] + q[0]) / 2, my = Math.max(p[1], q[1]) + sag;
    for (const path of leash.children) path.setAttribute('d', `M${p[0]},${p[1]} Q${mx},${my} ${q[0]},${q[1]}`);
    leash.style.display = '';
    leash.style.zIndex = dog.lift > 4 || dog.y < 600 ? 1000 : Math.round(Math.min(kid.y, dog.y)) - 2;
  }

  // ── Scene time: everything waits on the tick, in scene time (opts.speed scales it). ──
  let T = 0, timers = [], triggers = [], chase = null, run = 0;
  /** Things and people coming down out of the sky together (`descend`). */
  let descents = [];
  const wait = (ms) => new Promise((r) => timers.push({ at: T + ms / 1000, r }));
  function animate(a, frames, fps, loop = true) {
    return new Promise((r) => { a.anim = { frames, fps, loop, t: 0, r }; a.frame = frames[0]; });
  }
  async function seq(a, set, steps) {
    a.anim = null; a.set = set;
    for (const [f, ms] of steps) { a.frame = f; await wait(ms); }
  }
  /** Ride to x (either way): accelerate from v0 to vmax (m/s), then brake to a stop over `brake` metres (0: don't stop). */
  function drive(a, x, { v0 = 0, vmax = opts.moped, acc = 3.5, brake = 0 } = {}) {
    return new Promise((r) => { a.v = v0; a.move = { x, dir: Math.sign(x - a.x) || 1, vmax, acc, brake, r }; });
  }
  /** Walk to a floor point at `mps` (depth counts double, as it's foreshortened). */
  const walk = (a, to, mps) => new Promise((r) => { a.path = { to, mps, r }; });
  /** A leap: an arc from where he is to `to`, `height` metres up, over `ms`. */
  const leapTo = (a, to, ms, height) => new Promise((r) => { a.leap = { from: [a.x, a.y], to, t: 0, dur: ms / 1000, height, r }; });
  /** Call fn once when a passes x, going the scene's way (`dir`). */
  const when = (a, x, fn) => triggers.push({ a, x, dir, fn });

  // ── Sound (made up on the spot) ──
  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== '1'; } catch {}
  const muteBtn = Object.assign(document.createElement('button'), { className: 'mute own', textContent: 'Sound' });
  muteBtn.classList.toggle('off', !soundOn);
  muteBtn.onpointerdown = (e) => e.stopPropagation();
  muteBtn.onclick = () => {
    soundOn = !soundOn; muteBtn.classList.toggle('off', !soundOn);
    try { localStorage.setItem(SOUND_KEY, soundOn ? '0' : '1'); } catch {}
    if (master) master.gain.value = soundOn ? 1 : 0;
  };
  if (hooks.muteButton !== false) stage.append(muteBtn);
  function setSound(on) { soundOn = on; muteBtn.classList.toggle('off', !on); if (master) master.gain.value = on ? 1 : 0; }
  let ac = null, master = null, noise = null;
  function startAudio() {
    if (ac) { if (!window.gamePaused) ac.resume(); return; }
    ac = new AudioContext();
    window.addEventListener('pausechange', () => { if (window.gamePaused) ac.suspend(); else ac.resume(); });
    master = ac.createGain(); master.gain.value = soundOn ? 1 : 0; master.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const m of mopeds) m.engine = engine();
  }
  // A little two-stroke: a buzzy saw through a soft clip and a lowpass, chopped by its firing rate.
  function engine() {
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g2 = ac.createGain(), shaper = ac.createWaveShaper();
    const lp = ac.createBiquadFilter(), chop = ac.createGain(), lfo = ac.createOscillator(), lfoG = ac.createGain(), vol = ac.createGain(), pan = ac.createStereoPanner();
    o1.type = 'sawtooth'; o2.type = 'square'; g2.gain.value = 0.35; lfo.type = 'square';
    const curve = new Float32Array(256); for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 128) - 1) * 3); shaper.curve = curve;
    lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 3;
    chop.gain.value = 0.65; lfoG.gain.value = 0.35; vol.gain.value = 0;
    lfo.connect(lfoG).connect(chop.gain);
    o1.connect(shaper); o2.connect(g2).connect(shaper); shaper.connect(lp).connect(chop).connect(vol).connect(pan).connect(master);
    for (const o of [o1, o2, lfo]) o.start();
    return {
      set(hz, volume, p) {
        const t = ac.currentTime;
        o1.frequency.setTargetAtTime(hz, t, 0.06); o2.frequency.setTargetAtTime(hz * 0.5, t, 0.06); lfo.frequency.setTargetAtTime(hz / 4, t, 0.06);
        vol.gain.setTargetAtTime(volume, t, 0.08); pan.pan.setTargetAtTime(p, t, 0.08);
      },
    };
  }
  function noiseBurst({ at = 0, dur, from, to = from, q = 1, gain }) {
    if (!ac) return;
    const t = ac.currentTime + at, src = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise; bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + dur);
  }
  function tone({ at = 0, type = 'sine', from, to = from, dur, gain, lp = 0 }) {
    if (!ac) return;
    const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o.connect(g);
    if (lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; out = out.connect(f); }
    out.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  // The recorded sounds (the game's, prototypes/sounds: hooks.sample, false while it's loading), else the made-up ones.
  const rec = (name, opts) => !!(ac && hooks.sample?.(name, opts));
  const BARKS = ['single-bark', 'bark-upset', 'single-bark'];
  const squeak = () => { if (rec('squeak', { gain: 0.9 })) { rec('squeak', { gain: 0.8, rate: 1.06, at: 0.22 }); return; } for (const s of [0, 0.22]) { tone({ at: s, type: 'triangle', from: 950, to: 1650, dur: 0.07, gain: 0.22 }); tone({ at: s + 0.07, type: 'triangle', from: 1650, to: 1150, dur: 0.1, gain: 0.18 }); } };
  const bark = () => { if (rec(BARKS[Math.floor(Math.random() * BARKS.length)], { gain: 0.8, rate: 0.95 + Math.random() * 0.1 })) return; noiseBurst({ dur: 0.14, from: 1100, to: 600, q: 1.4, gain: 0.5 }); tone({ type: 'sawtooth', from: 420, to: 190, dur: 0.13, gain: 0.25, lp: 1800 }); };
  const growl = () => { if (rec('dog-growls', { slice: 1.4, gain: 0.7 })) return; for (let i = 0; i < 7; i++) tone({ at: i * 0.09, type: 'sawtooth', from: 95 + Math.random() * 20, to: 80, dur: 0.11, gain: 0.16, lp: 520 }); };
  const whoosh = () => noiseBurst({ dur: 0.28, from: 500, to: 3200, q: 0.8, gain: 0.35 });
  const yank = () => tone({ type: 'sine', from: 140, to: 50, dur: 0.14, gain: 0.5 });
  const skid = (dur) => noiseBurst({ dur, from: 2600, to: 1400, q: 0.7, gain: 0.22 });
  // A big wet lick.
  const slurp = () => { if (rec('dog-lick', { slice: 0.6, gain: 0.7 })) return; noiseBurst({ dur: 0.16, from: 2600, to: 900, q: 2.2, gain: 0.32 }); tone({ type: 'sine', from: 520, to: 300, dur: 0.12, gain: 0.12 }); };
  const thump = () => { tone({ type: 'sine', from: 110, to: 45, dur: 0.12, gain: 0.45 }); noiseBurst({ dur: 0.08, from: 900, q: 0.7, gain: 0.15 }); };
  const rustle = () => { for (let i = 0; i < 3; i++) noiseBurst({ at: i * 0.12, dur: 0.1, from: 3000, to: 1800, q: 0.6, gain: 0.12 }); };
  const plop = () => rec('dog-poop', { gain: 0.8 }) || tone({ type: 'sine', from: 520, to: 140, dur: 0.12, gain: 0.3 });
  const door = () => { noiseBurst({ dur: 0.18, from: 300, q: 0.6, gain: 0.55 }); tone({ type: 'square', from: 90, to: 50, dur: 0.15, gain: 0.25, lp: 400 }); };
  const steps = () => { for (let i = 0; i < 6; i++) tone({ at: i * 0.32, type: 'sine', from: 160, to: 70, dur: 0.07, gain: 0.25 }); };
  // A footfall off the recording for what you're walking on (hooks.step: pavement, gravel, wet), else a tap.
  const footfall = (run) => (ac && hooks.step?.(run)) || noiseBurst({ dur: 0.06, from: 1600 + Math.random() * 400, to: 700, q: 0.9, gain: run ? 0.12 : 0.07 });

  // The mopeds, recorded (the user's, cut in three: prototypes/sounds/moped-arrive, -idle, -leave), quiet; the made-up
  // engines only if the recordings aren't loaded.
  const MOPED_GAIN = 0.3;
  let mopedRecorded = false;
  const moped = (name) => { if (rec(name, { gain: MOPED_GAIN, key: 'moped' })) mopedRecorded = true; };
  function engineSounds() {
    if (!ac) return;
    for (const m of mopeds) {
      const off = m.x < 0 ? -m.x : m.x > W ? m.x - W : 0;
      const near = m.on && !mopedRecorded ? Math.max(0, 1 - off / 1100) : 0;
      m.engine.set(32 + m.v * 24, 0.055 * near * near, Math.max(-1, Math.min(1, (m.x - W / 2) / (W * 0.6))));
    }
  }

  // ── The tick ──
  let last = performance.now();
  function tick(now) {
    // (Stopped while the game's paused: src/scene/pause.ts.)
    const dt = window.gamePaused ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000)) * opts.speed; last = now; T += dt;
    for (const tm of timers.filter((tm) => T >= tm.at)) { timers.splice(timers.indexOf(tm), 1); tm.r(); }
    for (const D of descents.slice()) { D.t += dt; if (lower(D)) { descents.splice(descents.indexOf(D), 1); for (const a of D.as) a.aboard = false; D.r(); } }
    for (const a of actors) {
      // Someone with a mind of their own (src/scene/puppet.ts): resting, blinking, fidgeting, talking, walking.
      if (a.brain && !a.anim && !a.hold) a.frame = a.brain.tick(dt);
      if (a.anim) {
        const A = a.anim; A.t += dt;
        let i = Math.floor(A.t * A.fps);
        if (A.loop) i %= A.frames.length; else if (i >= A.frames.length) { i = A.frames.length - 1; if (A.r) { A.r(); A.r = null; } }
        a.frame = A.frames[i];
      }
      if (a.move) {
        const M = a.move, m = pxPerM(a.y), left = (M.x - a.x) * M.dir;
        if (M.brake && left < M.brake * m) a.v = Math.max(0.25, M.vmax * Math.sqrt(Math.max(0, left) / (M.brake * m)));
        else a.v = Math.min(M.vmax, a.v + M.acc * dt);
        a.x += M.dir * a.v * m * dt;
        if ((a.x - M.x) * M.dir >= 0) { a.x = M.x; if (M.brake) a.v = 0; const r = M.r; a.move = null; r(); }
      }
      if (a.path) {
        const P = a.path, dx = P.to[0] - a.x, dy = (P.to[1] - a.y) * 2, d = Math.hypot(dx, dy), step = P.mps * pxPerM(a.y) * dt;
        if (d <= step) { [a.x, a.y] = P.to; const r = P.r; a.path = null; r(); }
        else { a.x += (dx / d) * step; a.y += (dy / d) * step / 2; }
        if (a.brain && a.path) a.brain.walkBy(step / pxPerM(a.y) / (a.m ?? 1), Math.abs(dy) > Math.abs(dx) * 1.2 ? (dy < 0 ? 'away' : 'toward') : 'side');
      }
      if (a.leap) {
        const L = a.leap; L.t += dt;
        const u = Math.min(1, L.t / L.dur);
        a.x = L.from[0] + (L.to[0] - L.from[0]) * u; a.y = L.from[1] + (L.to[1] - L.from[1]) * u;
        a.lift = Math.sin(Math.PI * u) * L.height * pxPerM(a.y);
        if (u >= 1) { a.lift = 0; const r = L.r; a.leap = null; r(); }
      }
    }
    for (const tr of triggers.filter((tr) => (tr.a.x - tr.x) * tr.dir >= 0)) { triggers.splice(triggers.indexOf(tr), 1); tr.fn(); }
    if (chase) stepChase(dt);
    if (stroll) stepStroll(dt);
    stepDog(dt);
    for (const a of actors) render(a);
    drawLeash();
    engineSounds();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // The chase: the dog gallops after the mopeds (the scene's way, `dir`); once the leash is taut the kid is yanked off
  // his feet and flies after him, then skids on his heels, and his weight brakes the dog to a stop by DOG_STOP from
  // the edge of the picture he's running at.
  const DOG_STOP = 246;
  function stepChase(dt) {
    const c = chase, m = pxPerM(dog.y), stop = dir > 0 ? W - DOG_STOP : DOG_STOP;
    dog.x += dir * c.v * m * dt;
    const p = leashPoint(kid), q = leashPoint(dog), L = opts.leashLen * pxPerM((kid.y + dog.y) / 2);
    if (!c.yanked && (q[0] - p[0]) * dir > L) { c.yanked = true; c.t = 0; Object.assign(kid, { set: 'kidSt', frame: 2, flip: dir < 0 }); yank(); whoosh(); }
    if (c.yanked) {
      c.t += dt;
      const FLY = 0.38;
      if (c.t < FLY) { kid.frame = 2; kid.lift = Math.sin(Math.PI * c.t / FLY) * 0.18 * pxPerM(kid.y); }
      else {
        if (kid.frame !== 3) { kid.frame = 3; kid.lift = 0; c.decel = Math.max(4, c.v * c.v / (2 * Math.max(0.3, (stop - dog.x) * dir / m))); skid(c.v / c.decel + 0.3); }
        c.v = Math.max(0, c.v - c.decel * dt);
      }
      // Keep him at the end of the leash (he only ever goes forward).
      const p2 = leashPoint(kid), want = q[0] - dir * L;
      if ((want - p2[0]) * dir > 0) kid.x += want - p2[0];
    }
    if (c.yanked && c.v === 0) { const r = c.r; chase = null; r(); }
  }

  // ── Walking the sidewalk (once the scenes leave you the street): the home scene's walk and run, in profile, feet
  // locked to the floor (moving by how far the planted foot travels each frame). The dog follows (stepDog). ──
  let FLOOR = hooks.floor ?? [30, 700, 1510, 830];
  let stroll = null, facing = 1;
  function walkTo(p, run = false) {
    const to = [Math.max(FLOOR[0], Math.min(FLOOR[2], p[0])), Math.max(FLOOR[1], Math.min(FLOOR[3], p[1]))];
    stroll?.r();
    if (heel?.state === 'down') { heel = null; dog.anim = null; }
    dogFollows();
    return new Promise((r) => { stroll = { to, run, t: 0, r }; });
  }
  function stepStroll(dt) {
    const S = stroll, dx = S.to[0] - kid.x, dy = (S.to[1] - kid.y) / 0.45, len = Math.hypot(dx, dy);
    if (len < 2) { stroll = null; kidIdle(4); kid.flip = facing < 0; S.r(); return; }
    if (Math.abs(dx) > 1) facing = Math.sign(dx);
    const set = S.run ? 'run' : 'walk', cyc = SETS[set], k = pxPerM(kid.y) / cyc.pxPerM;
    if (kid.set !== set) { kid.set = set; S.t = 0; }
    kid.anim = null; kid.flip = facing < 0;
    const before = Math.floor(S.t);
    S.t += dt * (S.run ? 11 : 6);
    let left = len;
    for (let i = before; i < Math.floor(S.t) && left > 0; i++) {
      const d = Math.min(cyc.steps[i % 8] * k, left); left -= d;
      kid.x += (dx / len) * d; kid.y += (dy / len) * d * 0.45;
      if ((i + 1) % 4 === 0) footfall(S.run);
    }
    kid.frame = Math.floor(S.t) % 8;
  }

  // ── The dog on the leash, when you walk: he's never dragged. He gets up and trots after you (galloping when you
  // run), stands about when you stop, and after a bit flops down where he is and goes back to sleep. ──
  const DOG_SETTLE = 1.6; // seconds of you standing still before he lies down again
  let heel = null; // { state: 'up' | 'follow' | 'down', idle, busy }
  /** Wakes him to follow, if he's asleep on the leash beside you (not in a scene, not off somewhere). */
  function dogFollows() {
    if (!dog.shown || dashing || chase || dog.set !== 'sleep' || heel) return;
    const me = run;
    heel = { state: 'up', idle: 0 };
    void seq(dog, 'dogUpS', [[0, 110], [1, 110], [2, 110], [3, 90]]).then(() => { if (me === run && heel) heel.state = 'follow'; });
  }
  function stepDog(dt) {
    if (!heel || heel.state !== 'follow') return;
    if (dashing || chase || !dog.shown) { heel = null; return; }
    // His place: a little behind you, on the floor.
    const m = pxPerM(kid.y), to = [kid.x - facing * 0.95 * m, Math.min(FLOOR[3], kid.y + 18)];
    const dx = to[0] - dog.x, dy = (to[1] - dog.y) * 2, d = Math.hypot(dx, dy);
    if (d > 6) {
      const v = Math.min((stroll?.run ? 5.2 : 3) * m, d * 3.2), step = Math.min(d, v * dt);
      dog.x += (dx / d) * step; dog.y += (dy / d) * (step / 2);
      if (Math.abs(dx) > 2) dog.flip = dx > 0; // the gallop faces left
      if (dog.set !== 'dogRunS') { dog.set = 'dogRunS'; dog.trot = 0; }
      dog.anim = null;
      dog.trot = (dog.trot ?? 0) + step / m * 2.6; // about two and a half frames a metre
      dog.frame = Math.floor(dog.trot) % 8;
      heel.idle = 0;
      return;
    }
    // There: standing about (his getting-up's last frame), facing you; then down, and asleep again.
    if (dog.set !== "dogUpS") { dog.set = "dogUpS"; dog.frame = 3; dog.flip = kid.x > dog.x; } // all his frames face left
    if (stroll) return;
    heel.idle += dt;
    if (heel.idle < DOG_SETTLE) return;
    heel.state = 'down';
    const me = run, flip = dog.flip;
    void seq(dog, 'dogUpS', [[3, 140], [2, 160], [1, 180], [0, 200]]).then(() => {
      if (me !== run || !heel || heel.state !== 'down') return;
      heel = null; sleepDog(flip);
    });
  }

  const fadeEl = Object.assign(document.createElement('div'), { className: 'fade' }); stage.append(fadeEl);
  function fade(to, ms = 0) { fadeEl.style.transition = ms ? `opacity ${ms}ms ease-in-out` : 'none'; fadeEl.style.opacity = to; }
  const at = (e) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / unit(), (e.clientY - r.top) / unit()]; };
  let lastClick = { t: 0, p: [0, 0] };
  // On a touch screen, a long press is a right click (look); a tap waits for the finger to lift to know which.
  let press = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const p = at(e);
    press = { p, timer: setTimeout(() => { press = null; hooks.onClick?.('right', p, false); }, 450) };
  });
  stage.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || !press) return;
    clearTimeout(press.timer);
    const p = press.p; press = null;
    const now = performance.now(), double = now - lastClick.t < 350 && Math.hypot(p[0] - lastClick.p[0], p[1] - lastClick.p[1]) < 40;
    lastClick = { t: now, p };
    hooks.onClick?.('left', p, double);
  });
  stage.addEventListener('pointercancel', () => { if (press) { clearTimeout(press.timer); press = null; } });
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    const p = at(e), now = performance.now(), button = e.button === 2 ? 'right' : 'left';
    const double = button === 'left' && now - lastClick.t < 350 && Math.hypot(p[0] - lastClick.p[0], p[1] - lastClick.p[1]) < 40;
    lastClick = { t: now, p };
    hooks.onClick?.(button, p, double);
  });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('pointermove', (e) => hooks.onHover?.(at(e)));
  stage.addEventListener('pointerleave', () => hooks.onHover?.(null));
  const RIDE = [0, 1];
  const sleepDog = (flip = false) => { Object.assign(dog, { set: 'sleep', flip, lift: 0 }); animate(dog, [0, 1, 2, 3, 2, 1], 1.6); };
  const kidIdle = (frame) => { Object.assign(kid, { set: 'idle', frame, anim: null, flip: false, lift: 0 }); };

  /** Where everything is at the start of a part: 'arrive' (out of the door), or 'brother' (after the ultimatum). */
  function start(part) {
    run++; timers = []; triggers = []; chase = null; heel = null;
    for (const a of actors) if (!a.person) Object.assign(a, { anim: null, move: null, path: null, leap: null, lift: 0, v: 0, flip: false, shown: false, on: false, aboard: false });
    for (const [m, x] of [[bro, -700], [friend1, -1250], [friend2, -1700]]) {
      const name = m === bro ? 'bro' : m === friend1 ? 'friend1' : 'friend2';
      Object.assign(m, { set: name, frame: 0, x, y: LANE[name], shown: true });
    }
    if (part === 'arrive') {
      Object.assign(dog, { set: 'dogRunS', x: -260, y: AT.dog[1], flip: true, shown: true });
      Object.assign(kid, { set: 'run', frame: 0, x: -700, y: AT.kid[1], shown: true });
    } else {
      Object.assign(poo, { set: 'poo', frame: 0, x: AT.poo[0], y: AT.poo[1], shown: true });
      Object.assign(dog, { x: AT.dog[0], y: AT.dog[1], shown: true }); sleepDog();
      Object.assign(kid, { set: 'kidSt', frame: 0, x: AT.kid[0], y: AT.kid[1], shown: true });
    }
  }

  /**
   * Another walkable picture on the same camera (Main Street, the quarry), or the street again on a later visit: its
   * picture, perspective and floor, and nobody in it but the kid, standing at `at` (facing into the picture), with the
   * dog asleep on the leash beside him. `poo`: the poo on the neighbor's lawn (the street, until it's picked up).
   */
  function room({ src, horizon = HORIZON, k = K, floor = [30, 700, 1510, 830], at, face, poo: withPoo = false }) {
    background(src);
    // A new picture: whoever was standing in the last one isn't in this one (they're set again by `props`).
    for (const el of propEls.values()) el.remove();
    propEls.clear();
    for (const P of people.values()) removeActor(P.a);
    people.clear();
    for (const D of descents) D.r();
    descents = [];
    Object.assign(persp, { horizon, k });
    FLOOR = floor;
    start('here');
    stroll = null;
    // A little way in from the edge, so the dog (asleep behind him on the leash) is in the picture too.
    const x = Math.max(floor[0] + 230, Math.min(floor[2] - 230, at[0])), y = Math.max(floor[1], Math.min(floor[3], at[1]));
    facing = face ?? (x < W / 2 ? 1 : -1);
    for (const m of mopeds) m.shown = false;
    Object.assign(kid, { set: 'idle', frame: 4, x, y, flip: facing < 0, shown: true });
    seatedAway = false;
    Object.assign(dog, { x: x - facing * 0.9 * pxPerM(y), y: Math.min(floor[3], y + 18), shown: true }); sleepDog(facing < 0);
    // (Only your street has it: a playtest found it on the quarry's crane, carried over from the street.)
    if (withPoo) Object.assign(poo, { set: 'poo', frame: 0, x: AT.poo[0], y: AT.poo[1], shown: true });
    else poo.shown = false;
    fade(1); fade(0, 600);
  }
  /**
   * People and things standing in the picture: each `{ src | look, at: [x, y] (where its feet are), m (how tall, in
   * metres), id?, who?, enter?, leave? }`, sized by the picture's perspective and layered by depth with everyone else.
   * Called again with whoever's there now. A `look` is a person (hooks.people, src/scene/puppet.ts: they breathe, blink,
   * fidget and talk); `src` is a thing (the moped on its side, the crate). With `live` (it's happening in front of you),
   * nobody pops: a person who comes walks in by `enter` (points from off the picture to where they stand) and one who
   * goes walks off by `leave`; one with the same `id` and another look changes into it (the foreman waking up, by the
   * move his awake look has `from` his asleep one); a thing fades.
   */
  const propEls = new Map();
  const people = new Map();
  const peopleBase = hooks.peopleBase ?? '../people/';
  function setFor(look, m) {
    const key = `${look}@${m}`, A = hooks.people?.[look];
    if (!SETS[key] && A) {
      const r = A.frames[A.rest];
      SETS[key] = { pxPerM: (r.h * (r.k ?? 1)) / m, frames: A.frames.map((f) => ({ ...f, src: peopleBase + f.src })) };
      for (const f of SETS[key].frames) frameImage(f.src);
    }
    return key;
  }
  function removeActor(a) { a.img.remove(); a.sh.remove(); actors.splice(actors.indexOf(a), 1); }
  function fadeIt(el, on, ms = 500) {
    el.style.transition = 'none'; el.style.opacity = on ? '0' : '1';
    void el.offsetWidth;
    el.style.transition = `opacity ${ms}ms ease-in-out`; el.style.opacity = on ? '1' : '0';
  }
  /** Walks a person through floor points (each, in turn), facing the way they go; resolves when they're there. */
  async function walkThrough(a, points, face = false) {
    const A = hooks.people[a.look], speed = (A.walk?.speed ?? 0.5) * (a.hurry ?? 1);
    for (const p of points) {
      if (Math.abs(p[0] - a.x) > 2) a.flip = p[0] < a.x;
      await walk(a, p, speed * a.m);
    }
    a.brain.walkBy(0); a.flip = face;
  }
  function addPerson(p, live) {
    const A = hooks.people?.[p.look];
    if (!A) return;
    const a = actor(setFor(p.look, p.m), 0.5);
    a.img.classList.add('person');
    if (p.who) a.img.dataset.who = p.who;
    Object.assign(a, { person: true, look: p.look, m: p.m, x: p.at[0], y: p.at[1], shown: true, flip: !!p.flip, hurry: p.hurry ?? 1, brain: new hooks.Puppet(A) });
    const P = { a, p };
    people.set(p.id ?? p.look, P);
    if (live && p.enter?.length && A.walk) {
      Object.assign(a, { x: p.enter[0][0], y: p.enter[0][1] });
      P.busy = walkThrough(a, [...p.enter.slice(1), p.at], !!p.flip).finally(() => { P.busy = null; });
    } else if (live) fadeIt(a.img, true);
  }
  /** Once the person with this id has walked in (or straight away: they're there, or not here at all). */
  function settled(id) { return people.get(id)?.busy ?? Promise.resolve(); }
  function props(list, live = false) {
    const things = list.filter((p) => !p.look), persons = list.filter((p) => p.look);
    // Things, by picture and place: the same things stand somewhere else in another picture.
    const key = (p) => `${p.src}@${p.at}`;
    const keep = new Set(things.map(key));
    for (const [k, el] of propEls) if (!keep.has(k)) {
      propEls.delete(k);
      if (live) { fadeIt(el, false); setTimeout(() => el.remove(), 520); } else el.remove();
    }
    for (const p of things) {
      if (propEls.has(key(p))) continue;
      const el = Object.assign(document.createElement('img'), { className: 'prop', draggable: false });
      el.style.cssText = 'position:absolute;pointer-events:none;visibility:hidden;transform-origin:50% 100%';
      el.onload = () => {
        const h = p.m * pxPerM(p.at[1]), w = h * (el.naturalWidth / el.naturalHeight);
        // (`z`: drawn at another depth than its feet's: the balloon's far side, under whoever's in its basket.)
        Object.assign(el.style, { left: `${((p.at[0] - w / 2) / W) * 100}%`, top: `${((p.at[1] - h) / H) * 100}%`, width: `${(w / W) * 100}%`, zIndex: String(p.z ?? Math.round(p.at[1])), visibility: 'visible' });
        if (live) fadeIt(el, true);
      };
      // Rocking a little on its feet, for as long as it's there (the balloon, tugging at its basket): everything that
      // sways sways together (on the page's clock), so a thing drawn in layers stays in one piece.
      if (p.sway) el.animate([{ rotate: `${-p.sway}deg` }, { rotate: `${p.sway}deg` }], { duration: 3600, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' }).startTime = 0;
      el.src = p.src;
      stage.append(el);
      propEls.set(key(p), el);
    }
    // People, by who they are.
    const here = new Map(persons.map((p) => [p.id ?? p.look, p]));
    for (const [id, P] of people) if (!here.has(id)) {
      people.delete(id);
      const { a, p } = P, A = hooks.people[a.look];
      if (live && p.leave?.length && A.walk) {
        a.brain.talk(false);
        void Promise.resolve(P.busy).then(() => walkThrough(a, p.leave)).then(() => removeActor(a));
      } else if (live) { fadeIt(a.img, false); setTimeout(() => removeActor(a), 520); }
      else removeActor(a);
    }
    for (const [id, p] of here) {
      const P = people.get(id);
      if (!P) { addPerson(p, live); continue; }
      if (P.p.look === p.look && `${P.p.at}` === `${p.at}`) { P.p = p; continue; }
      // Someone else now (asleep, then awake; the camp grown): the move between, if it's happening in front of you.
      const { a } = P, old = P.p.look, before = hooks.people[old]?.to?.[p.look];
      P.p = p;
      const change = async () => {
        if (live && before) await a.brain.play(before);
        Object.assign(a, { look: p.look, m: p.m, set: setFor(p.look, p.m), x: p.at[0], y: p.at[1] });
        a.frame = hooks.people[p.look].rest;
        await a.brain.become(hooks.people[p.look], live ? old : undefined);
      };
      P.busy = Promise.resolve(P.busy).then(change).finally(() => { P.busy = null; });
    }
  }
  /** A line calls for something of someone: a move (the puppet plays it), or `=look`, another look right now. */
  function hearing(a, p, text) {
    const act = a.brain.hear(text);
    if (!act?.startsWith('=')) return;
    void personLook(p.id ?? p.look, act.slice(1));
  }
  /**
   * Someone in the picture becomes another look of theirs, now, in front of you (a cue: `[grandma:grandma-furious]`), by
   * the move between if the new look has one (`from`); resolves when it's done.
   */
  function personLook(id, look) {
    const P = people.get(id), a = P?.a;
    if (!P || !hooks.people[look] || a.look === look) return Promise.resolve();
    P.p = { ...P.p, look };
    const old = a.look;
    // Drawn at the same scale (looks cut from the same sheets, the foreman asleep and awake): how tall they are changes.
    const restH = (A) => A.frames[A.rest].h * (A.frames[A.rest].k ?? 1), m = a.m * restH(hooks.people[look]) / restH(hooks.people[old]);
    P.busy = Promise.resolve(P.busy).then(async () => {
      Object.assign(a, { look, m, set: setFor(look, m) });
      a.frame = hooks.people[look].rest;
      await a.brain.become(hooks.people[look], old);
    }).finally(() => { P.busy = null; });
    return P.busy;
  }
  /** A person in the picture walks through floor points (a chase), then stands where they end up; resolves then. */
  function personWalk(id, points) {
    const P = people.get(id);
    if (!P || !hooks.people[P.a.look]?.walk) return Promise.resolve();
    P.busy = Promise.resolve(P.busy).then(() => walkThrough(P.a, points, !!P.p.flip)).finally(() => { P.busy = null; });
    return P.busy;
  }
  /**
   * A person hops to a floor point (out over the balloon basket's rim): a stride, an arc `height` metres up, and down,
   * facing the way they go; resolves when they've landed.
   */
  function personHop(id, to, ms = 600, height = 0.6) {
    const P = people.get(id);
    if (!P) return Promise.resolve();
    const { a } = P;
    P.busy = Promise.resolve(P.busy).then(async () => {
      if (Math.abs(to[0] - a.x) > 2) a.flip = to[0] < a.x;
      a.brain.walkBy(0.3);
      rustle();
      await leapTo(a, to, ms, height);
      thump();
      a.brain.walkBy(0);
    }).finally(() => { P.busy = null; });
    return P.busy;
  }

  /**
   * Coming down out of the sky together (the balloon landing on Main Street, whoever's in its basket in it): things (by
   * their src) and people (by id), and the kid if `kid`, from `height` (picture px) above where they stand, slowing as
   * they come, with a thump and a little bounce as it touches down. Resolves when it's down.
   */
  function descend({ things = [], ids = [], kid: withKid = false, height, ms }) {
    const els = [...propEls].filter(([k]) => things.some((src) => k.startsWith(`${src}@`))).map(([, el]) => el);
    const as = [...ids.map((id) => people.get(id)?.a).filter(Boolean), ...(withKid ? [kid] : [])];
    for (const a of as) a.aboard = true;
    return new Promise((r) => { const D = { els, as, height, dur: ms / 1000, t: 0, landed: false, r }; descents.push(D); lower(D); });
  }
  /** How high a descent is, `u` of the way through: down, slowing as it comes, to the ground at 85%; a bounce; down. */
  const DOWN = 0.85;
  const descentLift = (u, height) => (u < DOWN ? height * (1 - u / DOWN) ** 2 : Math.sin((Math.PI * (u - DOWN)) / (1 - DOWN)) * Math.min(14, height * 0.02));
  /** A descent's moment now; done or not. */
  function lower(D) {
    const u = Math.min(1, D.t / D.dur), L = u >= 1 ? 0 : descentLift(u, D.height), px = unit();
    for (const el of D.els) el.style.translate = L ? `0 ${-L * px}px` : '';
    for (const a of D.as) a.lift = L;
    if (u >= DOWN && !D.landed) { D.landed = true; thump(); }
    return u >= 1;
  }

  /** The kid stood somewhere in the picture, now (in the balloon's basket), facing `face` (1: right, -1: left). */
  function kidAt(at, face = 1) {
    stroll?.r(); stroll = null; seatedAway = false;
    kidIdle(4);
    Object.assign(kid, { x: at[0], y: at[1], shown: true, flip: face < 0 });
    facing = face;
  }
  /** The kid hops to a floor point (out over the basket's rim), and lands there. */
  const kidHop = (to) => hop(kid, to);

  /** A person in the picture plays a move (by look or id: `wave`, `wake`); resolves when it's done. */
  function personMove(id, move) { return people.get(id)?.a.brain?.play(move) ?? Promise.resolve(); }

  /** Swap the picture (the weather changing), keeping everyone where they are. */
  function background(src, crossfade = false) {
    const img = stage.querySelector('img.room');
    if (!img || img.src.endsWith(src.replace(/^(\.\.\/)+/, ''))) return;
    if (!crossfade) { img.src = src; return; }
    // The new picture over the old, faded in; then it's the picture.
    const nu = Object.assign(document.createElement('img'), { className: 'room', alt: img.alt, draggable: false });
    nu.style.cssText = 'position:absolute;left:0;top:0;opacity:0;transition:opacity 700ms ease-in-out';
    nu.onload = () => { void nu.offsetWidth; nu.style.opacity = '1'; setTimeout(() => { img.src = src; nu.remove(); }, 750); };
    nu.src = src;
    img.after(nu);
  }

  // ── What happens, on the cues in the lines (rooms/street.yaml's scenes, dialogues/ultimatum.yaml). A cue that
  // returns a promise holds the lines until it's done. ──

  // Out of the door: the dog drags the kid in from the left at a gallop, the kid running behind on the leash, to the
  // neighbor's fence. Starts as the picture fades in; the fence cue waits for it.
  let entering = Promise.resolve();
  function enter() {
    start('arrive'); const me = run;
    fade(1); fade(0, 700);
    animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 14); animate(kid, [0, 1, 2, 3, 4, 5, 6, 7], 11);
    const lead = opts.leashLen * pxPerM(AT.kid[1]) * 0.9;
    entering = new Promise((r) => {
      let was = performance.now();
      const step = (now) => {
        if (me !== run) return;
        const dt = Math.min(0.05, (now - was) / 1000) * opts.speed; was = now;
        dog.x = Math.min(AT.takeoff[0], dog.x + 3.6 * pxPerM(dog.y) * dt);
        const q = leashPoint(dog), p = leashPoint(kid);
        kid.x = Math.min(AT.kid[0], kid.x + Math.max(0, (q[0] - lead) - p[0]));
        if (dog.x >= AT.takeoff[0]) r(); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return entering;
  }
  /** [dog-jumps-fence]: over the fence, a sniff of the perfect lawn, and the squat. */
  async function jumpsFence() {
    await entering;
    dog.anim = null; dog.frame = 6; rustle();
    const landing = leapTo(dog, AT.lawn, 520, 0.9);
    // The kid skids to a stop at the fence, then watches (from behind: he's facing the yard).
    kid.anim = null; Object.assign(kid, { set: 'kidSt', frame: 3 }); skid(0.35);
    await landing; dog.frame = 1; thump();
    await wait(120);
    kidIdle(6);
    Object.assign(dog, { set: 'dogBiz', frame: 0, flip: false });
    await wait(1100);
    dog.frame = 1;
    await wait(500);
  }
  /** [dog-poos]: the poo; he kicks grass at it, hops back over and flops down asleep on the sidewalk. */
  async function poos() {
    Object.assign(poo, { set: 'poo', frame: 0, x: AT.poo[0], y: AT.poo[1], shown: true }); plop();
    await wait(500);
    dog.frame = 2; rustle(); await wait(650);
    Object.assign(dog, { set: 'dogRunS', frame: 6, flip: false }); rustle();
    await leapTo(dog, AT.dog, 520, 0.8); thump();
    await seq(dog, 'dogUpS', [[3, 260], [2, 260], [1, 220], [0, 300]]);
    sleepDog();
    kidIdle(4);
    await wait(700);
  }
  // ── The finale (pick-up-the-poo): the cookies, and you're let onto his lawn at last. A playtest: "this should be a
  // cutscene", and the dog's encore "should be a similar animation" to the first time. ──

  /** [neighbor-steps-aside]: cookie in hand, he steps aside off his lawn's poo: go on, then. */
  const stepsAside = () => personWalk('neighbor', [[880, 505]]);
  /** [kid-onto-lawn]: through his gate (or over his fence, if the crate's still in it) and across his lawn to the poo. */
  async function ontoLawn() {
    const me = run;
    stroll?.r(); stroll = null; heel = null;
    if (gate.blocked) {
      await kidThrough([[kid.x + (HOP.out[0] - kid.x) * 0.999, HOP.out[1]]]); if (me !== run) return;
      await hop(kid, HOP.in); if (me !== run) return;
    } else {
      await kidThrough([[kid.x + (UP_THE_WALK[0][0] - kid.x) * 0.999, UP_THE_WALK[0][1]]]); if (me !== run) return;
      if (gate.opensTo) { Object.assign(kid, { set: 'back', frame: 0, anim: null }); background(gate.opensTo, true); gate.opensTo = null; await wait(600); if (me !== run) return; }
      await kidThrough([UP_THE_WALK[1]]); if (me !== run) return;
    }
    await kidThrough([[600, 556], [AT.poo[0] - 58, AT.poo[1] + 24]]); if (me !== run) return;
    kidIdle(6);
  }
  /** [kid-crouches]: down by the poo, bag on his hand. */
  async function crouches() { Object.assign(kid, { set: 'jumpSide', frame: 3, flip: false, anim: null, lift: 0 }); rustle(); await wait(500); }
  /** [kid-stands-up]: up again, the bag tied. */
  async function standsUp() { kidIdle(6); await wait(300); }
  /**
   * [dog-poos-again]: his encore, as the first time: up from his nap, over the fence onto the lawn, the squat, the poo
   * right where the first one was, a kick of grass at it, and asleep right there in the sunshine.
   */
  /** Where he naps after his encore: off to the right of it, toward the neighbor, not on it. */
  const NAP_AGAIN = [865, 556];
  async function poosAgain() {
    const me = run;
    if (!dog.shown) { pooAgain(); plop(); return; }
    heel = null; dashing = true;
    try {
      dog.anim = null;
      if (dog.set === 'sleep') { await seq(dog, 'dogUpS', [[0, 140], [1, 140], [2, 140], [3, 160]]); if (me !== run) return; }
      Object.assign(dog, { set: 'dogRunS', flip: AT.takeoff[0] > dog.x }); animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 16);
      await walk(dog, AT.takeoff, 4.2); if (me !== run) return;
      dog.anim = null; Object.assign(dog, { set: 'dogRunS', frame: 6, flip: true }); rustle();
      await leapTo(dog, AT.lawn, 520, 0.9); if (me !== run) return;
      dog.frame = 1; thump();
      Object.assign(dog, { set: 'dogBiz', frame: 0, flip: false });
      await wait(1100); if (me !== run) return;
      dog.frame = 1; await wait(450);
      pooAgain(); plop();
      await wait(500); if (me !== run) return;
      dog.frame = 2; rustle(); await wait(650); if (me !== run) return;
      // A few steps off it before he flops down (a playtest: "the dog looks like he's sleeping in the poop").
      Object.assign(dog, { set: 'dogRunS', flip: true }); animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 10);
      await walk(dog, NAP_AGAIN, 1.8); if (me !== run) return;
      dog.anim = null; sleepDog(true);
    } finally { dashing = false; }
  }
  /** [neighbor-storms-out]: his door bangs open and he storms down his walk to his gate. */
  async function stormsOut() {
    door(); kidIdle(6);
    Object.assign(neighbor, { set: 'neighbor', frame: 0, x: AT.door[0], y: AT.door[1], shown: true });
    animate(neighbor, [0, 1], 4); steps();
    await walk(neighbor, AT.steps, 1.5);
    await walk(neighbor, AT.walk, 1.5);
    neighbor.anim = null; neighbor.frame = 6;
  }
  /** [neighbor-goes-in]: he stomps back up his walk and inside. */
  async function goesIn() {
    neighbor.flip = false; animate(neighbor, [2, 3], 4); steps();
    await walk(neighbor, AT.steps, 1.5);
    await walk(neighbor, AT.door, 1.5);
    neighbor.shown = false; neighbor.anim = null; door();
    kidIdle(4);
    await wait(400);
  }
  // Your brother takes the money wherever the kid is when he sets off. The mopeds come up from behind him, pass, stop
  // ahead, and ride on; the dog chases them that way. `dir` is that way: right (+1), unless he's in the right half of
  // the street, where there's no room ahead: then it all goes left.
  let dir = 1;
  const clampX = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  /** [kid-sets-off]: off to the store, right where he is, the money out. */
  function setsOff() {
    stroll?.r(); stroll = null;
    dir = kid.x < W / 2 ? 1 : -1;
    Object.assign(kid, { set: 'kidSt', frame: 0, anim: null, flip: dir < 0 });
  }
  /** [mopeds-snatch]: engines from behind; your brother plucks the money out of his hand going by, and they stop. */
  async function snatch() {
    const K = kid.x;
    // In from behind him: your brother along the front of the sidewalk, just in front of the kid; his friends on the road.
    for (const [m, d] of [[bro, 700], [friend1, 1250], [friend2, 1700]]) Object.assign(m, { x: dir > 0 ? -d : W + d, shown: true, frame: 0, anim: null, move: null, flip: dir < 0 });
    bro.y = Math.min(860, kid.y + 53);
    for (const m of mopeds) m.on = true;
    // Coming up from behind, and stopping (then idling while they talk: below).
    moped('moped-arrive');
    await wait(500);
    const go = (m, x, brake) => { animate(m, RIDE, 7); return drive(m, x, { v0: opts.moped, brake }); };
    when(bro, K - dir * 170, () => { bro.anim = null; bro.frame = 2; });
    when(bro, K + dir * 10, () => { kid.frame = 1; whoosh(); });
    when(bro, K + dir * 200, () => animate(bro, RIDE, 7));
    // He stops ahead of the kid, one friend further on, the other behind: all in the picture.
    const broStop = go(bro, clampX(K + dir * 680, 200, 1336), 1.1);
    wait(450).then(() => go(friend1, clampX(K + dir * 960, 90, 1446), 1.2).then(() => { friend1.anim = null; friend1.frame = 0; }));
    // The other friend stops behind him, unless he's near the edge he came from: then on ahead, past the first.
    const behind = K - dir * 285, roomBehind = dir > 0 ? behind > 240 : behind < W - 240;
    wait(900).then(() => go(friend2, roomBehind ? behind : clampX(K + dir * 1230, 90, 1446), 1.0).then(() => { friend2.anim = null; friend2.frame = 0; }));
    await broStop; bro.anim = null; bro.frame = 3;
    if (mopedRecorded) moped('moped-idle');
    await wait(200);
  }
  /**
   * [mopeds-leave]: a wheelie, the friends after him, and the duck horn as the last one passes the dog, which wakes
   * him (he LOVES a squeak): he's up, facing them. Doesn't hold the lines (the kid shouts after them).
   */
  let woken = Promise.resolve();
  function leave() {
    const me = run, off = (n) => (dir > 0 ? W + n : -n);
    // A rev, and off up the street into the distance.
    if (mopedRecorded) moped('moped-leave');
    bro.frame = 4; bro.anim = null;
    drive(bro, off(1100), { v0: 0.3, vmax: opts.moped * 1.4, acc: 3 });
    when(bro, bro.x + dir * 240, () => animate(bro, RIDE, 9));
    wait(350).then(() => { animate(friend1, RIDE, 8); drive(friend1, off(1400), { v0: 0.3, vmax: opts.moped * 1.4, acc: 3 }); });
    wait(850).then(() => { animate(friend2, RIDE, 8); drive(friend2, off(1900), { v0: 0.3, vmax: opts.moped * 1.4, acc: 3.5 }); });
    woken = new Promise((r) => when(friend2, dog.x + dir * 330, async () => {
      if (me !== run) return;
      squeak();
      await wait(250);
      // He leaps up facing them (his getting-up frames face left).
      dog.anim = null; dog.set = 'dogUpS'; dog.frame = 0; await wait(180);
      dog.flip = dir > 0; await seq(dog, 'dogUpS', [[1, 240], [2, 420], [3, 300]]);
      r();
    }));
  }
  /** [dog-chases]: he sees the mopeds, growls, and charges after them, yanking the kid along; then barks at the street. */
  let barking = Promise.resolve();
  async function chases() {
    const me = run;
    await woken;
    // His growling frames face right; his gallop faces left.
    Object.assign(dog, { set: 'dogSt', frame: 0, flip: dir < 0 }); growl(); kid.frame = 1;
    await wait(700);
    dog.frame = 2; bark(); await wait(300);
    dog.set = 'dogRunS'; dog.flip = dir > 0; animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 14);
    await new Promise((r) => { chase = { v: opts.dogSpeed, yanked: false, r }; }); if (me !== run) return;
    for (const m of mopeds) m.on = false;
    dog.anim = null; dog.set = 'dogSt'; dog.flip = dir < 0; dog.frame = 2; bark();
    rec('bark-upset-2', { gain: 0.75 });
    barking = (async () => { for (const f of [1, 3, 1, 3, 1]) { await wait(420); dog.frame = f; bark(); } await wait(300); })();
    await wait(500);
  }
  /** [dog-sleeps]: done barking, he turns back toward the kid, flops down, and he's asleep again. */
  async function sleeps() {
    await barking;
    dog.flip = dir < 0;
    await seq(dog, 'dogUpS', [[3, 300], [2, 300], [1, 250], [0, 400]]);
    sleepDog(dir < 0);
    kid.frame = 5;
    await wait(400);
  }
  /**
   * [dog-dash-porch], [dog-dash-moped], [dog-dash-door]: his enemies, on later visits. He's up, he gallops there (by
   * `via`, the way in through the neighbor's gate), barks his head off, then trots back and flops down where he was.
   * The lines don't wait for him: it plays under them.
   */
  let dashing = false;
  async function dash(route) {
    if (dashing || !dog.shown) return;
    dashing = true; heel = null;
    const me = run, home = [dog.x, dog.y], flip = dog.flip;
    try {
      await seq(dog, 'dogUpS', [[0, 120], [1, 120], [2, 120], [3, 120]]); if (me !== run) return;
      const gallop = async (to) => {
        dog.set = 'dogRunS'; dog.flip = to[0] > dog.x; animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 16);
        await walk(dog, to, 4.5);
      };
      for (const p of route) { await gallop(p); if (me !== run) return; }
      dog.anim = null; dog.set = 'dogSt'; dog.flip = route[route.length - 1][0] < home[0]; dog.frame = 2; bark();
      for (const f of [1, 3, 1, 3]) { await wait(380); if (me !== run) return; dog.frame = f; bark(); }
      await wait(300);
      for (const p of [...route.slice(0, -1).reverse(), home]) { await gallop(p); if (me !== run) return; }
      rec('dog-panting', { slice: 2.2, gain: 0.45 });
      sleepDog(flip);
    } finally { dashing = false; }
  }
  const GATE = [350, 705];
  const dashPorch = () => { void dash([GATE, AT.walk, [AT.steps[0], AT.steps[1] + 12]]); };
  const dashMoped = () => { void dash([[840, 735]]); };
  /**
   * [dog-licks]: let at someone (the foreman, `at` where their feet are): he's up, bounds over to them, and jumps up at
   * their face, again and again, slurping. Resolves when he's done licking (the lines go on: it did it); then he trots
   * back to you.
   */
  async function dogLicks(at) {
    if (dashing || !dog.shown) return;
    dashing = true; heel = null;
    const me = run;
    try {
      await seq(dog, 'dogUpS', [[0, 100], [1, 100], [2, 100], [3, 80]]); if (me !== run) return;
      // Right up at their knees, on our side of them.
      const side = at[0] > dog.x ? -1 : 1, to = [at[0] + side * 0.3 * pxPerM(at[1]), Math.min(FLOOR[3], at[1] + 8)];
      dog.set = 'dogRunS'; dog.flip = to[0] > dog.x; animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 16);
      await walk(dog, to, 4.2); if (me !== run) return;
      dog.anim = null;
      // Up at the face (mid-bound, reaching), down into a bow, up again (all his frames face left).
      const flip = at[0] > dog.x;
      for (let i = 0; i < 4; i++) {
        Object.assign(dog, { set: 'dogRunS', frame: 1, flip });
        const up = leapTo(dog, [dog.x, dog.y], 300, 0.55);
        await wait(130); slurp(); dog.frame = 2;
        await up; if (me !== run) return;
        Object.assign(dog, { set: 'dogUpS', frame: 3, flip }); thump();
        await wait(i === 3 ? 260 : 150); if (me !== run) return;
      }
    } finally { dashing = false; }
    if (me === run) heel = { state: 'follow', idle: 0 };
  }
  // (Indoors asleep in his bed, Act 3's doorbell trick: he bursts out of your front door, and comes to you.)
  const dashDoor = () => { if (!dog.shown) { dogFrom([120, 700]); return; } void dash([[150, 700]]); };

  // ── The ding-dong ditch (his doorbell, Act 2): you drop the leash, sneak up his walk behind his back, ring, and dive
  // behind his hedge; the dog charges the porch (rabbits bursting out of the hedge as he goes past), the neighbor whirls
  // round and chases him round and round the lawn; then you come back out. A playtest: the neighbor "waiting in the
  // lawn, which makes using the doorbell awkward", "show, not tell", "no rabbits", "the dog's timing is super late". ──
  const UP_THE_WALK = [[350, 712], [415, 610], [452, 522], [496, 456], [522, 420]];
  const BEHIND_HEDGE = [618, 404];
  const LAWN_LOOP = [[650, 452], [890, 446], [965, 496], [800, 524], [590, 506], [530, 440]];
  // Out of his hedge (its foot, along the front of his house), each its own way: anywhere the dog isn't.
  const HEDGE = [[640, 414], [720, 416], [790, 414], [860, 416], [925, 413], [975, 415]];
  let ditch = null; // { from: where you stood on the sidewalk, porch: the dog's barking at the door }
  /**
   * His garden gate, where his walk meets the sidewalk (the page says how it is, as the picture changes): shut, with the
   * picture of it open for you to swing it to (`opensTo`) on your way up; open; or `blocked`, the crate wedged in it, so
   * you (and the dog) hop his front fence beside it. A playtest: "the kid walks through the closed gate".
   */
  let gate = { opensTo: null, blocked: false };
  function setGate(g) { gate = { opensTo: g?.opensTo ?? null, blocked: !!g?.blocked }; }
  // Over his front fence, just right of the gate: the sidewalk side, and his side (the lawn by his walk).
  const HOP = { out: [545, 722], in: [540, 600] };
  /** Over his front fence (the crate's in his gate): a hop, kid or dog. */
  async function hop(a, to) {
    if (a === kid) Object.assign(kid, { set: 'jumpSide', frame: 1, flip: to[0] < kid.x, anim: null });
    else Object.assign(a, { set: 'dogRunS', frame: 6, flip: to[0] > a.x, anim: null });
    rustle();
    await leapTo(a, to, a === kid ? 460 : 420, a === kid ? 0.5 : 0.7);
    if (a === kid) kid.frame = 3;
    thump();
  }
  /** The kid walking through points off the sidewalk (his walk): across, away from us, toward us. */
  async function kidThrough(points, mps = 1.2) {
    for (const p of points) {
      const dx = p[0] - kid.x, dy = p[1] - kid.y;
      const set = Math.abs(dy) * 1.4 > Math.abs(dx) ? (dy < 0 ? 'back' : 'front') : 'walk';
      Object.assign(kid, { set, flip: set === 'walk' && dx < 0, lift: 0 });
      animate(kid, [0, 1, 2, 3, 4, 5, 6, 7], set === 'walk' ? 7 : 8);
      await walk(kid, p, mps);
      footfall(false);
    }
    kid.anim = null;
  }
  /** [kid-rings-doorbell]: leash down, up his walk, the bell; resolves on the ring (then he dives behind the hedge). */
  async function ringsDoorbell() {
    const me = run;
    stroll?.r(); stroll = null; heel = null;
    ditch = { from: [kid.x, kid.y], porch: false };
    // The leash dropped: the dog stays put, and flops down if he was up.
    if (dog.shown && dog.set !== 'sleep') { const f = dog.flip; dog.anim = null; void seq(dog, 'dogUpS', [[3, 120], [2, 120], [1, 120], [0, 140]]).then(() => { if (me === run && !dashing) sleepDog(f); }); }
    if (gate.blocked) {
      // The crate's in his gate: over the fence beside it, onto his walk.
      await kidThrough([[kid.x + (HOP.out[0] - kid.x) * 0.999, HOP.out[1]]]); if (me !== run) return;
      await hop(kid, HOP.in); if (me !== run) return;
      await kidThrough(UP_THE_WALK.slice(2)); if (me !== run) return;
    } else {
      await kidThrough([[kid.x + (UP_THE_WALK[0][0] - kid.x) * 0.999, UP_THE_WALK[0][1]]]); if (me !== run) return;
      // Shut: he opens it (it swings open), and leaves it open behind him.
      if (gate.opensTo) {
        Object.assign(kid, { set: 'back', frame: 0, anim: null });
        background(gate.opensTo, true); gate.opensTo = null;
        await wait(650); if (me !== run) return;
      }
      await kidThrough(UP_THE_WALK.slice(1)); if (me !== run) return;
    }
    Object.assign(kid, { set: 'back', frame: 0, anim: null, flip: false });
    await wait(350); if (me !== run) return;
    // DING-DONG (the line says it), and over the edge of the steps into the hedge.
    void (async () => {
      await wait(250); if (me !== run) return;
      Object.assign(kid, { set: 'jumpSide', frame: 1, flip: false }); rustle();
      await leapTo(kid, BEHIND_HEDGE, 420, 0.45); if (me !== run) return;
      kid.frame = 3; rustle(); await wait(120);
      kid.shown = false;
    })();
  }
  /** A rabbit out of the hedge, hopping through points (fast), then gone (into the garden, the hedge, off the picture). */
  function rabbit(from, points, { delay = 0, m = 0.46, hurry = 0.8, keep = false } = {}) {
    const A = hooks.people?.rabbit;
    if (!A) return Promise.resolve();
    const a = actor(setFor('rabbit', m), 0.25);
    Object.assign(a, { person: true, look: 'rabbit', m, x: from[0], y: from[1], shown: false, hurry, brain: new hooks.Puppet(A) });
    const me = run;
    return (async () => {
      await wait(delay);
      if (me !== run) { removeActor(a); return; }
      a.shown = true; fadeIt(a.img, true, 160);
      await walkThrough(a, points);
      if (keep || me !== run) return;
      fadeIt(a.img, false, 260); await wait(280); removeActor(a);
    })();
  }
  /** [rabbits-scatter]: dozens of them (well, six), out of the hedge every which way but the dog's. */
  function rabbitsScatter(delay = 0) {
    const ways = [
      [[600, 470], [470, 530], [420, 640], [300, 720], [-60, 760]],   // down his walk, out of the gate, off down the street
      [[700, 470], [610, 520], [520, 470], [500, 330]],             // round the walk and behind his house
      [[870, 470], [1010, 470], [1150, 455]],                       // under his fence, into Grandma's garden
      [[930, 470], [1060, 430], [1180, 410]],
      [[990, 470], [1060, 520], [1200, 470]],
      [[1010, 418], [1080, 380], [1150, 360]],
    ];
    return Promise.all(HEDGE.map((h, i) => rabbit(h, ways[i], { delay: delay + [0, 160, 60, 240, 120, 300][i], hurry: 0.75 + (i % 3) * 0.12 })));
  }
  /**
   * [dog-charges-porch]: the dog's up (his sworn enemy), and through the gate and up the walk to the porch, barking at
   * the door; the rabbits burst out of the hedge as he goes by. Resolves once he's barked at it a bit.
   */
  async function chargesPorch() {
    if (dashing || !dog.shown) return;
    dashing = true; heel = null;
    const me = run;
    ditch ??= { from: [kid.x, kid.y], porch: false };
    await seq(dog, 'dogUpS', [[0, 90], [1, 90], [2, 90], [3, 80]]); if (me !== run) { dashing = false; return; }
    bark();
    const gallop = async (to, mps = 4.6) => { dog.set = 'dogRunS'; dog.flip = to[0] > dog.x; animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 16); await walk(dog, to, mps); };
    if (gate.blocked) {
      // Over the fence beside the crate in his gate.
      await gallop(HOP.out); if (me !== run) { dashing = false; return; }
      await hop(dog, HOP.in); if (me !== run) { dashing = false; return; }
      await gallop(AT.walk); if (me !== run) { dashing = false; return; }
    } else for (const p of [GATE, AT.walk]) { await gallop(p); if (me !== run) { dashing = false; return; } }
    await gallop([AT.steps[0], AT.steps[1] + 12]); if (me !== run) { dashing = false; return; }
    ditch.porch = true;
    dog.anim = null; Object.assign(dog, { set: 'dogSt', flip: false, frame: 2 }); bark();
    // He keeps on at the door till something chases him off it.
    void (async () => { for (const f of [1, 3, 1, 3, 1, 3, 1, 3]) { await wait(380); if (me !== run || !ditch?.porch) return; dog.frame = f; bark(); } })();
    await wait(700);
  }
  /**
   * [neighbor-chases]: the neighbor after him, round and round the lawn (the dog loving it), till he gives up where he
   * stood guard. Resolves when he stops; the dog goes back down to the sidewalk and flops down.
   */
  async function chaseRound() {
    const me = run, P = people.get('neighbor');
    if (ditch) ditch.porch = false;
    const loops = [...LAWN_LOOP, ...LAWN_LOOP];
    // Round and round his lawn: feet in the grass, and the dog barking his head off.
    const pound = (async () => { for (let i = 0; i < 6 && me === run; i++) { rec('grass-run', { gain: 0.45, rate: 0.95 + Math.random() * 0.1 }); if (i % 2) rec('bark-upset-2', { gain: 0.6 }); await wait(1100); } })();
    void pound;
    const dogRun = (async () => {
      if (!dog.shown) return;
      dashing = true;
      try {
        for (const p of loops) { dog.set = 'dogRunS'; dog.flip = p[0] > dog.x; animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 16); await walk(dog, p, 3.4); if (me !== run) return; }
        for (const p of [AT.walk, GATE, ditch?.from ? [ditch.from[0] - 120, Math.min(FLOOR[3], ditch.from[1] + 18)] : AT.dog]) {
          dog.set = 'dogRunS'; dog.flip = p[0] > dog.x; animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 16); await walk(dog, p, 4.2); if (me !== run) return;
        }
        sleepDog(dog.flip);
      } finally { dashing = false; }
    })();
    if (P && hooks.people[P.a.look]?.walk) {
      const back = [P.a.x, P.a.y], hurry = P.a.hurry;
      await wait(500);
      P.a.hurry = 2.6;
      P.busy = Promise.resolve(P.busy).then(() => walkThrough(P.a, [...loops.slice(0, 9), back], !!P.p.flip)).finally(() => { P.a.hurry = hurry; P.busy = null; });
      await P.busy;
    } else await dogRun;
  }
  /** [kid-comes-back]: out from behind the hedge, down his walk, and back on the sidewalk; the dog comes to heel. */
  async function comesBack() {
    const me = run, d = ditch;
    ditch = null;
    if (!d) return;
    // The dog, if he's still at the door: back down to the sidewalk.
    if (d.porch && dog.shown) {
      dashing = true;
      const run4 = async (p) => { dog.set = 'dogRunS'; dog.flip = p[0] > dog.x; animate(dog, [0, 1, 2, 3, 4, 5, 6, 7], 16); await walk(dog, p, 4.2); };
      const down = [d.from[0] - 120, Math.min(FLOOR[3], d.from[1] + 18)];
      // (Back over the fence, if the crate's in his gate.)
      const legs = gate.blocked ? [AT.walk, HOP.in, { hop: HOP.out }, down] : [AT.walk, GATE, down];
      for (const p of legs) { if ('hop' in p) await hop(dog, p.hop); else await run4(p); if (me !== run) { dashing = false; return; } }
      sleepDog(dog.flip); dashing = false;
    }
    if (!kid.shown) {
      Object.assign(kid, { x: BEHIND_HEDGE[0], y: BEHIND_HEDGE[1], set: 'jumpSide', frame: 1, flip: true, shown: true }); rustle();
      await leapTo(kid, [UP_THE_WALK[3][0], UP_THE_WALK[3][1]], 380, 0.35); if (me !== run) return;
    }
    if (gate.blocked) {
      await kidThrough([UP_THE_WALK[2], HOP.in], 1.4); if (me !== run) return;
      await hop(kid, HOP.out); if (me !== run) return;
      await kidThrough([d.from], 1.4); if (me !== run) return;
    } else { await kidThrough([...UP_THE_WALK.slice(0, 3).reverse(), d.from], 1.4); if (me !== run) return; }
    kidIdle(4); facing = 1; kid.flip = false;
    dogFollows();
  }
  /**
   * [rabbit-into-crate]: one rabbit, out of the hedge and down his walk, straight in at the crate's open door (its far end,
   * facing up the walk: a playtest found "the opening to the crate isn't faced towards the rabbits"). SNAP.
   */
  const CRATE_DOOR = [446, 532];
  function intoCrate() { return rabbit([600, 414], [[560, 452], [500, 492], CRATE_DOOR, [420, 568]], { hurry: 0.9 }); }
  /** [rabbit-swerves]: one rabbit, out for the crate, and back under the hedge (the dog was there, or it smells of him). */
  function swerves() { return rabbit([760, 414], [[700, 480], [660, 512], [700, 470], [790, 418]], { hurry: 0.9 }); }

  /** [poo-picked-up]: gone from the lawn. At last. [poo-again]: back, right where it was. */
  function pooGone() { poo.shown = false; }
  function pooAgain() { Object.assign(poo, { set: 'poo', frame: 0, x: AT.poo[0], y: AT.poo[1], shown: true }); }
  /** The dog on the leash beside the kid, or not (he's somewhere else in the picture: asleep in the crane's wheel). */
  function dogShown(on) { dog.shown = on; if (!on) heel = null; }
  /** Where the dog on the leash is (his feet). */
  const dogAt = () => [dog.x, dog.y];
  /** The kid in the picture, or not (he's sitting on Grandma's stool: a person in the picture, the page's). Stood up
   * again where he sat, facing the way he was. */
  let seatedAway = false;
  function kidShown(on, at) {
    // Only ever undoes its own hiding (a scene may have him out of the picture for its own reasons).
    if (!on) { if (!kid.shown) return; stroll?.r(); stroll = null; seatedAway = true; kid.shown = false; return; }
    if (!seatedAway) return;
    seatedAway = false;
    if (at) { kidIdle(4); Object.assign(kid, { x: at[0], y: Math.max(FLOOR[1], Math.min(FLOOR[3], at[1])) }); facing = 1; }
    kid.shown = true;
  }
  /** Back from somewhere in the picture (the treadwheel): he's there, hops down, and trots back to heel. */
  function dogFrom(at) {
    const me = run;
    heel = null; dog.anim = null;
    Object.assign(dog, { set: 'dogRunS', frame: 0, x: at[0], y: at[1], flip: kid.x > at[0], shown: true });
    void leapTo(dog, [at[0] + (kid.x > at[0] ? 60 : -60), Math.max(FLOOR[1], Math.min(FLOOR[3], kid.y + 18))], 520, 0.7).then(() => {
      if (me === run) heel = { state: 'follow', idle: 0 };
    });
  }
  const CUES = { 'kid-rings-doorbell': ringsDoorbell, 'dog-charges-porch': () => { void chargesPorch(); }, 'neighbor-chases': chaseRound, 'kid-comes-back': comesBack, 'rabbits-scatter': () => { void rabbitsScatter(900); }, 'rabbit-into-crate': intoCrate, 'rabbit-swerves': swerves, 'dog-licks': () => dogLicks(lickAt), 'dog-dash-porch': dashPorch, 'dog-dash-moped': dashMoped, 'dog-dash-door': dashDoor, 'poo-picked-up': pooGone, 'poo-again': pooAgain, 'kid-sets-off': setsOff, 'dog-jumps-fence': jumpsFence, 'dog-poos': poos, 'neighbor-storms-out': stormsOut, 'neighbor-goes-in': goesIn, 'mopeds-snatch': snatch, 'mopeds-leave': leave, 'dog-chases': chases, 'dog-sleeps': sleeps, 'neighbor-steps-aside': stepsAside, 'kid-onto-lawn': ontoLawn, 'kid-crouches': crouches, 'kid-stands-up': standsUp, 'dog-poos-again': poosAgain };
  /** Plays a cue, if it's one of the street's: a promise to hold the lines on, or nothing. */
  /** Who the dog licks on [dog-licks]: where their feet are (the page says, by who's nearest). */
  let lickAt = [W / 2, 740];
  const licks = (at) => { lickAt = at; };
  function cue(name) { return CUES[name]?.(); }
  const handles = (name) => name in CUES;

  // Who's speaking, as each line shows: the neighbor gestures on his lines (pointing at the poo first) and glares,
  // arms crossed, through the kid's; your brother waves the bills, then stuffs them in his vest; his friend points
  // down the street; the kid shouts the lines that end in "!" (and watches, empty-handed, while they talk).
  const TALK = [4, 5, 7, 5, 4, 7], BRO = [3, 5, 0];
  let talks = 0, broLines = 0;
  function speaking(who, text) {
    // Whoever's line it is moves their mouth (the name their lines go by: "Grandma", "Mom").
    for (const { a, p } of people.values()) { a.brain.talk(!!who && !!p.who && who.startsWith(p.who)); if (text) hearing(a, p, text); }
    neighbor.hold = !!who && neighbor.shown;
    if (!who) return;
    if (neighbor.shown) {
      neighbor.anim = null; neighbor.frame = who === 'Neighbor' ? TALK[talks++ % TALK.length] : 6;
      // Pointing at the poo: it's on his right (the drawing points left).
      neighbor.flip = neighbor.frame === 4;
      return;
    }
    if (who === 'Brother') { bro.frame = BRO[Math.min(broLines++, BRO.length - 1)]; if (kid.set === 'kidSt' && kid.frame === 4) kid.frame = 1; }
    else if (who === 'His friend') { friend1.frame = 2; bro.frame = 0; if (kid.set === 'kidSt') kid.frame = 1; }
    else if (!who && kid.set === 'kidSt' && !chase && kid.frame !== 3 && kid.frame !== 5 && /!$/.test(text)) kid.frame = 4;
    if (who !== 'His friend' && friend1.frame === 2) friend1.frame = 0;
  }

  return { stage, opts, start, enter, room, background, gate: setGate, props, settled, licks, kidShown, kidAt, kidHop, dogAt, personMove, personLook, personWalk, personHop, descend, dogShown, dogFrom, cue, handles, speaking, fade, startAudio, walkTo, setSound, kid };
}
