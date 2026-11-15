// Neon Bazaar — all sound is synthesized with WebAudio: filtered noise
// bursts for gunfire, short sine blips for UI and the Spark, a low sweep
// for the explosion. No audio files, no network, nothing to load.

export function createAudio() {
  const audio = {
    ctx: null,
    master: null,
    muted: false,
  };

  /** Lazily created on the first user gesture (browsers block audio before it). */
  audio.ensure = () => {
    if (audio.ctx) {
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.5;
      audio.master.connect(audio.ctx.destination);
      return true;
    } catch {
      return false;
    }
  };

  audio.setMuted = (m) => {
    audio.muted = m;
    if (audio.master) audio.master.gain.value = m ? 0 : 0.5;
  };

  function noiseBuffer(ctx, seconds) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst(dur, filterFreq, filterType, gain, when = 0) {
    if (!audio.ctx || audio.muted) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, dur + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(audio.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, type, gain, slideTo = null, when = 0) {
    if (!audio.ctx || audio.muted) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(audio.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // One shot per weapon: a crack plus a body thump. The railgun gets a
  // charge whine before the blast so the player hears it coming.
  audio.shot = (kind) => {
    if (!audio.ctx) return;
    if (kind === 'rifle') { burst(0.09, 1800, 'bandpass', 0.5); burst(0.12, 220, 'lowpass', 0.5); }
    else if (kind === 'smg') { burst(0.06, 2400, 'bandpass', 0.35); burst(0.08, 260, 'lowpass', 0.35); }
    else if (kind === 'pistol') { burst(0.08, 1500, 'bandpass', 0.45); burst(0.1, 200, 'lowpass', 0.4); }
    else if (kind === 'marksman') { burst(0.22, 900, 'bandpass', 0.7); burst(0.3, 140, 'lowpass', 0.7); }
    else if (kind === 'railgun') {
      tone(1800, 0.25, 'sawtooth', 0.12, 3200);
      burst(0.35, 700, 'bandpass', 0.8, 0.22);
      burst(0.5, 90, 'lowpass', 0.9, 0.22);
    }
  };
  audio.dryFire = () => { if (audio.ctx) tone(1200, 0.04, 'square', 0.12); };
  audio.reload = () => {
    tone(900, 0.05, 'square', 0.15);
    tone(600, 0.05, 'square', 0.15, null, 0.18);
    tone(1100, 0.05, 'square', 0.18, null, 0.4);
  };
  audio.hit = (headshot) => {
    if (!audio.ctx) return;
    tone(headshot ? 2200 : 1600, 0.06, 'sine', 0.3);
  };
  audio.hurt = () => { burst(0.15, 400, 'lowpass', 0.4); };
  audio.step = () => { burst(0.05, 500, 'lowpass', 0.08); };
  audio.grenadeThrow = () => { burst(0.12, 900, 'bandpass', 0.2); };
  audio.explosion = () => {
    burst(0.7, 300, 'lowpass', 0.9);
    tone(120, 0.6, 'sine', 0.6, 35);
  };
  audio.beep = () => { tone(1050, 0.09, 'sine', 0.25); };
  audio.plantDone = () => { tone(700, 0.15, 'sine', 0.3); tone(1050, 0.2, 'sine', 0.3, null, 0.15); };
  audio.defuseDone = () => { tone(1050, 0.15, 'sine', 0.3); tone(1400, 0.25, 'sine', 0.3, null, 0.15); };
  audio.roundWin = () => { tone(523, 0.14, 'sine', 0.3); tone(784, 0.22, 'sine', 0.3, null, 0.14); };
  audio.roundLose = () => { tone(392, 0.2, 'sine', 0.3); tone(262, 0.35, 'sine', 0.3, null, 0.18); };
  audio.buy = () => { tone(880, 0.06, 'sine', 0.2); tone(1318, 0.1, 'sine', 0.2, null, 0.06); };
  audio.power = () => {
    tone(440, 0.1, 'sawtooth', 0.15);
    tone(660, 0.1, 'sawtooth', 0.15, null, 0.1);
    tone(880, 0.2, 'sawtooth', 0.18, null, 0.2);
  };
  return audio;
}
