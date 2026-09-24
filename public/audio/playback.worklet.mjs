import { LinearResampler, pcm16ToFloat, PlaybackRing, fadeOut } from './pcm.mjs';
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new LinearResampler(24000, sampleRate); this.fade = null; this.fadeOffset = 0;
    this.ring = new PlaybackRing(sampleRate * 15); this.wasPlaying = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'clear') {
        const tail = new Float32Array(Math.min(this.ring.available, Math.ceil(sampleRate * 0.008)));
        this.ring.pull(tail); this.fade = tail.length ? fadeOut(tail) : null; this.fadeOffset = 0;
        this.ring.clear(); this.resampler.reset(); this.wasPlaying = Boolean(this.fade); return;
      }
      try {
        if (!this.ring.available) this.resampler.reset();
        const valid = this.ring.push(this.resampler.process(pcm16ToFloat(data)));
        if (!valid) { this.resampler.reset(); this.port.postMessage({ type: 'overflow' }); }
      } catch { this.port.postMessage({ type: 'invalid-audio' }); }
    };
  }
  process(inputs, outputs) {
    const output = outputs[0]; if (!output?.[0]) return true;
    if (this.fade) {
      const count = Math.min(output[0].length, this.fade.length - this.fadeOffset);
      output[0].set(this.fade.subarray(this.fadeOffset, this.fadeOffset + count));
      if (count < output[0].length) output[0].fill(0, count);
      for (let c = 1; c < output.length; c++) output[c].set(output[0]);
      this.fadeOffset += count;
      if (this.fadeOffset >= this.fade.length) { this.fade = null; this.fadeOffset = 0; }
      if (this.wasPlaying && !this.fade) { this.port.postMessage({ type: 'drained' }); this.wasPlaying = false; }
      return true;
    }
    const hadAudio = this.ring.available > 0;
    this.ring.pull(output[0]);
    for (let c = 1; c < output.length; c++) output[c].set(output[0]);
    if (hadAudio) this.wasPlaying = true;
    if (this.wasPlaying && !this.ring.available) { this.port.postMessage({ type: 'drained' }); this.wasPlaying = false; }
    return true;
  }
}
registerProcessor('slotpilot-playback', PlaybackProcessor);
