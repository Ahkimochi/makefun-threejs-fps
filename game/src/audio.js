// Sound, synthesised with WebAudio: no audio files, no network. A short
// noise buffer is built once and reused for every gunshot and explosion;
// the rest is oscillators. Nothing here runs before the player's first click,
// so the AudioContext is created lazily and every call is guarded.
let ctx = null;
let noiseBuffer = null;

function ensure() {
  if (ctx) return ctx;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    ctx = new AudioContext();
    const length = Math.floor(ctx.sampleRate * 0.25);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
  return ctx;
}

function noiseBurst(duration, volume, filterFreq) {
  const audio = ensure();
  if (!audio || !noiseBuffer) return;
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start();
  source.stop(audio.currentTime + duration);
}

function tone(freq, duration, volume, type = 'square', slideTo = 0) {
  const audio = ensure();
  if (!audio) return;
  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audio.currentTime);
  if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, audio.currentTime + duration);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + duration);
}

export const audio = {
  unlock() {
    const audioCtx = ensure();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  },
  shot(weaponId) {
    if (weaponId === 'dmr') {
      noiseBurst(0.22, 0.5, 1400);
      tone(140, 0.14, 0.22, 'square', 55);
    } else if (weaponId === 'pistol') {
      noiseBurst(0.09, 0.3, 2600);
      tone(320, 0.06, 0.12, 'square', 140);
    } else if (weaponId === 'smg') {
      noiseBurst(0.06, 0.22, 3200);
    } else {
      noiseBurst(0.11, 0.36, 2200);
      tone(220, 0.08, 0.16, 'square', 90);
    }
  },
  enemyShot() {
    noiseBurst(0.08, 0.12, 1800);
  },
  dryFire() {
    tone(1400, 0.03, 0.08, 'square');
  },
  reload() {
    tone(500, 0.05, 0.1, 'square');
    setTimeout(() => tone(700, 0.05, 0.1, 'square'), 180);
  },
  hit() {
    tone(1150, 0.05, 0.14, 'sine');
  },
  kill() {
    tone(1150, 0.05, 0.16, 'sine');
    setTimeout(() => tone(1500, 0.07, 0.16, 'sine'), 70);
  },
  hurt() {
    tone(180, 0.12, 0.2, 'sawtooth', 90);
  },
  explosion() {
    noiseBurst(0.7, 0.7, 500);
    tone(90, 0.5, 0.4, 'sine', 35);
  },
  plantBeep() {
    tone(880, 0.08, 0.12, 'sine');
  },
  plantDone() {
    tone(880, 0.1, 0.14, 'sine');
    setTimeout(() => tone(1174, 0.14, 0.14, 'sine'), 110);
  },
  roundWin() {
    tone(523, 0.12, 0.16, 'triangle');
    setTimeout(() => tone(659, 0.12, 0.16, 'triangle'), 130);
    setTimeout(() => tone(784, 0.2, 0.18, 'triangle'), 260);
  },
  roundLose() {
    tone(392, 0.16, 0.16, 'triangle', 330);
    setTimeout(() => tone(311, 0.24, 0.16, 'triangle', 262), 170);
  },
  buy() {
    tone(990, 0.06, 0.1, 'sine');
    setTimeout(() => tone(1320, 0.08, 0.1, 'sine'), 70);
  },
};
