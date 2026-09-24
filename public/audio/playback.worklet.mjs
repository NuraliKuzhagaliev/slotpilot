import { LinearResampler, pcm16ToFloat, PlaybackRing, fadeOut } from './pcm.mjs';
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new LinearResampler(24000, sampleRate); this.fade = null; this.fadeOffset = 0;
    this.ring = new PlaybackRing(sampleRate * 15); this.wasPlaying = false;
    this.buffering = true; this.finishing = false; this.silenceFrames = 0; this.lastSample = 0; this.gain = 0;
    this.prebuffer = Math.ceil(sampleRate * 0.06); // Absorb small gaps between network packets.
    this.rampSamples = Math.ceil(sampleRate * 0.008);
    this.port.onmessage = ({ data }) => {
      if (data === 'end') { this.finishing = true; return; }
      if (data === 'start') { this.finishing = false; return; }
      if (data === 'clear') {
        // Fade from the sample we actually played, not from future queued speech.
        const length = Math.ceil(sampleRate * 0.01);
        this.fade = fadeOut(new Float32Array(length).fill(this.lastSample)); this.fadeOffset = 0;
        this.ring.clear(); this.resampler.reset(); this.buffering = true;
        this.gain = 0; this.silenceFrames = 0; this.wasPlaying = false; this.finishing = false; return;
      }
      try {
        // Keep interpolation phase/sample continuity across short network gaps.
        // Resetting at every ring underrun can create an audible click at chunk edges.
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
      this.lastSample = output[0][output[0].length - 1];
      if (this.fadeOffset >= this.fade.length) { this.fade = null; this.fadeOffset = 0; this.lastSample = 0; }
      return true;
    }
    if (this.buffering && (this.ring.available >= this.prebuffer || this.finishing && this.ring.available)) this.buffering = false;
    const count = this.buffering ? 0 : Math.min(this.ring.available, output[0].length);
    if (count) {
      const chunk = output[0].subarray(0, count); this.ring.pull(chunk);
      // Soft ceiling and short ramps keep packet edges and near-clipping spikes gentle.
      for (let i = 0; i < count; i++) {
        this.gain = Math.min(1, this.gain + 1 / this.rampSamples);
        const s = chunk[i] * this.gain;
        chunk[i] = s / (1 + 0.4 * Math.abs(s));
      }
      this.lastSample = chunk[count - 1]; this.wasPlaying = true; this.silenceFrames = 0;
    }
    if (count < output[0].length) {
      // A packet ran out: ramp the last audible sample to zero before waiting for more.
      const gap = output[0].length - count;
      for (let i = 0; i < gap; i++) output[0][count + i] = this.lastSample * Math.max(0, 1 - (i + 1) / Math.min(this.rampSamples, gap));
      this.lastSample = 0; this.gain = 0; this.buffering = true;
      this.silenceFrames += output[0].length;
    }
    for (let c = 1; c < output.length; c++) output[c].set(output[0]);
    if (this.wasPlaying && this.silenceFrames >= sampleRate * 0.25) { this.port.postMessage({ type: 'drained' }); this.wasPlaying = false; }
    return true;
  }
}
registerProcessor('slotpilot-playback', PlaybackProcessor);
