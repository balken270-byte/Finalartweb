// audio.js — full soundscape via Web Audio synthesis. No files needed, no
// network needed, always works. Call init() from a user gesture.

let ctx = null, master = null, sfxBus = null, musicBus = null;
let musicTimer = null, intensity = 0;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.0; musicBus.connect(master);
  startMusic();
}
export function setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); }

// ---------- tiny synth helpers ----------
const now = () => ctx.currentTime;
function env(g, t0, a, peak, d, sustain = 0) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t0 + a + d);
}
function tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.15, vol = 0.3, delay = 0, bus = null, filter = null }) {
  const t0 = now() + delay;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
  const g = ctx.createGain(); env(g, t0, 0.005, vol, dur);
  let head = o;
  if (filter) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = filter; o.connect(fl); head = fl; }
  head.connect(g); g.connect(bus || sfxBus);
  o.start(t0); o.stop(t0 + dur + 0.1);
}
function noise({ dur = 0.3, vol = 0.3, delay = 0, filterF0 = 2000, filterF1 = 200, type = 'lowpass' }) {
  const t0 = now() + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const fl = ctx.createBiquadFilter(); fl.type = type;
  fl.frequency.setValueAtTime(filterF0, t0);
  fl.frequency.exponentialRampToValueAtTime(Math.max(filterF1, 20), t0 + dur);
  const g = ctx.createGain(); env(g, t0, 0.005, vol, dur);
  src.connect(fl); fl.connect(g); g.connect(sfxBus);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

// ---------- the SFX vocabulary ----------
const SFX = {
  select:    () => tone({ f0: 760, f1: 980, dur: 0.06, vol: 0.12, type: 'triangle' }),
  command:   () => { tone({ f0: 520, f1: 700, dur: 0.05, vol: 0.12, type: 'triangle' }); tone({ f0: 700, f1: 900, dur: 0.05, vol: 0.1, delay: 0.05, type: 'triangle' }); },
  error:     () => tone({ f0: 140, f1: 110, dur: 0.16, vol: 0.2, type: 'sawtooth', filter: 500 }),
  recruit:   () => { tone({ f0: 300, f1: 560, dur: 0.12, vol: 0.2, type: 'sine' }); tone({ f0: 900, dur: 0.05, vol: 0.08, delay: 0.08, type: 'triangle' }); },
  place:     () => { noise({ dur: 0.18, vol: 0.18, filterF0: 900, filterF1: 150 }); tone({ f0: 120, f1: 70, dur: 0.2, vol: 0.3 }); },
  built:     () => { [523, 659, 784].forEach((f, i) => tone({ f0: f, dur: 0.18, vol: 0.13, delay: i * 0.06, type: 'triangle' })); noise({ dur: 0.12, vol: 0.08, filterF0: 3000, filterF1: 800, delay: 0.02 }); },
  laser:     () => tone({ f0: 1100, f1: 240, dur: 0.11, vol: 0.11, type: 'square', filter: 2400 }),
  turret:    () => tone({ f0: 620, f1: 150, dur: 0.14, vol: 0.13, type: 'square', filter: 1600 }),
  explosion: () => { noise({ dur: 0.5, vol: 0.4, filterF0: 2500, filterF1: 60 }); tone({ f0: 90, f1: 32, dur: 0.4, vol: 0.4 }); },
  demolish:  () => { noise({ dur: 0.8, vol: 0.5, filterF0: 1800, filterF1: 40 }); tone({ f0: 70, f1: 26, dur: 0.7, vol: 0.5 }); noise({ dur: 0.3, vol: 0.2, delay: 0.15, filterF0: 500, filterF1: 60 }); },
  alarm:     () => { for (let i = 0; i < 2; i++) { tone({ f0: 880, dur: 0.11, vol: 0.14, delay: i * 0.26, type: 'square', filter: 1800 }); tone({ f0: 660, dur: 0.11, vol: 0.14, delay: i * 0.26 + 0.12, type: 'square', filter: 1800 }); } },
  incident:  () => { tone({ f0: 420, f1: 200, dur: 0.5, vol: 0.2, type: 'sawtooth', filter: 900 }); tone({ f0: 445, f1: 210, dur: 0.5, vol: 0.15, type: 'sawtooth', filter: 900 }); },
  complete:  () => [392, 494, 587, 784].forEach((f, i) => tone({ f0: f, dur: 0.3, vol: 0.16, delay: i * 0.09, type: 'triangle' })),
  probe:     () => { tone({ f0: 200, f1: 90, dur: 0.16, vol: 0.3, type: 'sine' }); tone({ f0: 200, f1: 90, dur: 0.16, vol: 0.3, delay: 0.22, type: 'sine' }); },
  safety:    () => [523, 659].forEach((f, i) => tone({ f0: f, dur: 0.22, vol: 0.12, delay: i * 0.1, type: 'sine' })),
  siStart:   () => { tone({ f0: 60, f1: 220, dur: 1.6, vol: 0.22, type: 'sawtooth', filter: 700 }); [220, 277, 330, 440].forEach((f, i) => tone({ f0: f, dur: 0.8, vol: 0.09, delay: 0.4 + i * 0.12, type: 'triangle' })); },
  win:       () => { [261, 330, 392, 523, 659, 784, 1046].forEach((f, i) => tone({ f0: f, dur: 1.2, vol: 0.12, delay: i * 0.12, type: 'triangle' })); noise({ dur: 2, vol: 0.06, filterF0: 6000, filterF1: 1500, type: 'highpass' }); },
  defeat:    () => [392, 330, 261, 196].forEach((f, i) => tone({ f0: f, dur: 0.7, vol: 0.14, delay: i * 0.25, type: 'triangle', filter: 1200 })),
};

export function sfx(name) { if (ctx && SFX[name]) SFX[name](); }

// ---------- ambient music: a slow modal pad that tightens as the race heats up ----------
const CHORDS = [
  [110.0, 164.8, 220.0, 261.6],   // Am
  [87.3, 130.8, 174.6, 261.6],    // F
  [98.0, 146.8, 196.0, 246.9],    // G
  [82.4, 123.5, 164.8, 246.9],    // Em
];
let chordIdx = 0;

function startMusic() {
  musicBus.gain.linearRampToValueAtTime(0.16, now() + 4);
  const step = () => {
    if (!ctx) return;
    const chord = CHORDS[chordIdx % CHORDS.length]; chordIdx++;
    const t0 = now() + 0.05, dur = 7.6;
    const cutoff = 300 + intensity * 1400;
    for (const f of chord) {
      for (const det of [-3, 3]) {
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.value = f; o.detune.value = det * (1 + intensity);
        const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff; fl.Q.value = 0.6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.05, t0 + 2.4);
        g.gain.linearRampToValueAtTime(0.04, t0 + dur - 2);
        g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.4);
        o.connect(fl); fl.connect(g); g.connect(musicBus);
        o.start(t0); o.stop(t0 + dur + 0.6);
      }
    }
    // heartbeat pulse rises with intensity
    if (intensity > 0.25) {
      const beats = Math.round(2 + intensity * 4);
      for (let i = 0; i < beats; i++) {
        const bt = t0 + (i * dur) / beats;
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 55;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, bt);
        g.gain.linearRampToValueAtTime(0.10 * intensity, bt + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.28);
        o.connect(g); g.connect(musicBus);
        o.start(bt); o.stop(bt + 0.35);
      }
    }
    musicTimer = setTimeout(step, dur * 1000 - 300);
  };
  step();
}

export function stopMusic() { if (musicTimer) clearTimeout(musicTimer); if (musicBus) musicBus.gain.linearRampToValueAtTime(0, now() + 1.5); }
