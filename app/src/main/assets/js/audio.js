'use strict';
/* LINKFIRE — synthesized SFX (WebAudio, no asset files). */
const Snd = (() => {
  let ctx = null, master = null, nbuf = null, vol = 0.8;

  function init() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = vol;
        master.connect(ctx.destination);
        const n = ctx.sampleRate;
        nbuf = ctx.createBuffer(1, n, n);
        const d = nbuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(f, dur, type, v, f2, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, v, fc, delay) {
    const t = ctx.currentTime + (delay || 0);
    const s = ctx.createBufferSource();
    s.buffer = nbuf;
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass'; fl.frequency.value = fc;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const S = {
    ar(v)  { noise(.06, .45 * v, 3000); tone(190, .07, 'sawtooth', .25 * v, 70); },
    smg(v) { noise(.045, .35 * v, 4000); tone(260, .05, 'square', .18 * v, 90); },
    sg(v)  { noise(.22, .9 * v, 1800); tone(110, .2, 'sawtooth', .45 * v, 40); },
    sn(v)  { noise(.3, .8 * v, 5000); tone(420, .28, 'sawtooth', .4 * v, 50); tone(90, .4, 'sine', .5 * v, 35); },
    pt(v)  { noise(.07, .5 * v, 3500); tone(320, .09, 'square', .28 * v, 110); },
    reload() { tone(900, .04, 'square', .12, 500); tone(500, .05, 'square', .12, 300, .18); },
    rdone()  { tone(300, .05, 'square', .18, 600); tone(700, .06, 'square', .15, 900, .07); },
    empty()  { tone(180, .04, 'square', .12); },
    swap()   { tone(600, .04, 'triangle', .15, 900); },
    hit()    { tone(1200, .05, 'square', .2, 700); },
    hurt()   { noise(.12, .5, 900); tone(120, .15, 'sawtooth', .35, 60); },
    kill()   { tone(500, .08, 'square', .25, 900); tone(900, .12, 'square', .25, 1400, .08); },
    die()    { tone(300, .4, 'sawtooth', .3, 50); noise(.3, .4, 600); },
    dash()   { noise(.18, .35, 2500); tone(300, .15, 'sine', .2, 900); },
    shield() { tone(500, .4, 'sine', .25, 1000); tone(750, .4, 'sine', .2, 1500); },
    sbreak() { noise(.25, .6, 6000); tone(900, .2, 'square', .2, 150); },
    scan()   { tone(400, .5, 'sine', .25, 1600); tone(800, .5, 'sine', .15, 2400, .1); },
    inv()    { tone(900, .5, 'sine', .2, 200); },
    heal()   { tone(500, .15, 'sine', .2, 700); tone(700, .2, 'sine', .2, 1000, .12); },
    start()  { tone(400, .1, 'square', .2); tone(600, .1, 'square', .2, 0, .15); },
    go()     { tone(800, .25, 'square', .25, 1200); },
    win()    { [523, 659, 784, 1046].forEach((f, i) => tone(f, .2, 'square', .2, 0, i * .12)); },
    lose()   { [400, 350, 300, 220].forEach((f, i) => tone(f, .25, 'sawtooth', .2, 0, i * .15)); },
    click()  { tone(700, .03, 'square', .1); }
  };

  return {
    init,
    setVol(v) { vol = v; if (master) master.gain.value = v; },
    play(name, v) {
      if (!ctx || vol <= 0) return;
      if (ctx.state === 'suspended') ctx.resume();
      const f = S[name];
      if (f) f(v === undefined ? 1 : v);
    }
  };
})();
