/**
 * Two sounds, both synthesised. No audio files ship with this app.
 *
 * A quill scratch is filtered noise with a fast decay; a paper rustle is the
 * same idea over a longer, softer envelope with a slow filter sweep. Off by
 * default, and the context is only created after a user gesture so no browser
 * ever has to complain about autoplay.
 */

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    // Slightly brown noise: whiter noise sounds like static, not like paper.
    const white = Math.random() * 2 - 1;
    last = (last + 0.045 * white) / 1.045;
    data[i] = last * 3.2;
  }
  return buffer;
}

/** A nib catching on the grain: short, bright, and gone. */
export function playQuillScratch(volume = 0.14): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.18);

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(2400, now);
  band.frequency.exponentialRampToValueAtTime(1100, now + 0.16);
  band.Q.value = 1.6;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

  source.connect(band).connect(gain).connect(ctx.destination);
  source.start(now);
  source.stop(now + 0.2);
}

/** A sheet being opened out: longer, softer, with the filter sweeping down. */
export function playPaperRustle(volume = 0.1): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 1.3);

  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.setValueAtTime(5200, now);
  low.frequency.exponentialRampToValueAtTime(900, now + 1.1);

  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 420;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.09);
  gain.gain.exponentialRampToValueAtTime(volume * 0.5, now + 0.55);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);

  source.connect(high).connect(low).connect(gain).connect(ctx.destination);
  source.start(now);
  source.stop(now + 1.3);
}
