/** Streaming linear resampler for speech. Retains fractional position across chunks.
 * Uses the actual AudioContext sample rate; never assumes the device runs at 24 kHz.
 */
export class LinearResampler {
  constructor(fromRate, toRate) {
    if (!(fromRate > 0 && toRate > 0)) throw new Error('Invalid sample rate.');
    this.step = fromRate / toRate; this.reset();
  }
  reset() { this.position = 0; this.previous = 0; }
  process(samples) {
    if (!samples.length) return new Float32Array(0);
    if (this.step === 1) return Float32Array.from(samples);
    const out = new Float32Array(Math.ceil((samples.length + 1) / this.step) + 2);
    let count = 0, position = this.position;
    while (position < samples.length) {
      const i = Math.floor(position), f = position - i;
      const a = i === 0 ? this.previous : samples[i - 1];
      const b = samples[i];
      out[count++] = a + (b - a) * f;
      position += this.step;
    }
    this.position = position - samples.length; this.previous = samples[samples.length - 1];
    return out.subarray(0, count);
  }
}
export function floatToPcm16(samples) {
  const result = new ArrayBuffer(samples.length * 2), view = new DataView(result);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
    view.setInt16(i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return result;
}
export function pcm16ToFloat(buffer) {
  if (buffer.byteLength % 2) throw new Error('PCM16 payload must have even byte length.');
  const view = new DataView(buffer), out = new Float32Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
export class PlaybackRing {
  constructor(capacity) { this.data = new Float32Array(capacity); this.clear(); }
  clear() { this.read = 0; this.write = 0; this.available = 0; }
  push(samples) {
    if (samples.length > this.data.length - this.available) { this.clear(); return false; }
    for (const s of samples) { this.data[this.write] = s; this.write = (this.write + 1) % this.data.length; this.available++; }
    return true;
  }
  pull(output) {
    for (let i = 0; i < output.length; i++) {
      if (this.available) { output[i] = this.data[this.read]; this.read = (this.read + 1) % this.data.length; this.available--; }
      else output[i] = 0;
    }
  }
}
