import { LinearResampler, pcm16ToFloat, PlaybackRing, fadeOut } from './pcm.mjs';
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new LinearResampler(24000, sampleRate); this.fade = null; this.fadeOffset = 0;
    this.ring = new PlaybackRing(sampleRate * 15); this.wasPlaying = false;
    this.silenceFrames = 0; this.lastSample = 0; this.ramp = 0;
    this.tailSample = 0; this.tailRemaining = 0;
    this.rampSamples = Math.ceil(sampleRate * 0.002);
    this.port.onmessage = ({ data }) => {
      if (data === 'clear') {
        // Fade from the sample actually sent to the speaker. The queued PCM may
        // start at another phase or level, which would make the cut click.
        const tail = new Float32Array(Math.ceil(sampleRate * 0.008));
        tail.fill(this.lastSample);
        this.fade = fadeOut(tail); this.fadeOffset = 0;
        this.ring.clear(); this.resampler.reset(); this.silenceFrames = 0;
        this.tailSample = 0; this.tailRemaining = 0;
        this.lastSample = 0; this.ramp = 0; this.wasPlaying = false; return;
      }
      if (data === 'start' || data === 'end') return; // Older clients can still send these.
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
    const count = Math.min(this.ring.available, output[0].length);
    if (count) {
      const chunk = output[0].subarray(0, count); this.ring.pull(chunk);
      // Play every packet immediately. Blend a packet arriving during an
      // underrun with the remaining tail instead of jumping between samples.
      for (let i = 0; i < count; i++) {
        this.ramp = Math.min(1, this.ramp + 1 / this.rampSamples);
        const weight = this.tailRemaining / this.rampSamples;
        chunk[i] = chunk[i] * 0.75 * this.ramp + this.tailSample * weight * (1 - this.ramp);
        if (this.tailRemaining) this.tailRemaining--;
      }
      this.lastSample = chunk[count - 1]; this.wasPlaying = true; this.silenceFrames = 0;
    }
    if (count < output[0].length) {
      // Keep the 2 ms fade across render blocks, including a one-sample gap.
      if (!this.tailRemaining && this.lastSample) {
        this.tailSample = this.lastSample; this.tailRemaining = this.rampSamples;
      }
      for (let i = count; i < output[0].length; i++) {
        output[0][i] = this.tailRemaining ? this.tailSample * (--this.tailRemaining / this.rampSamples) : 0;
      }
      this.lastSample = output[0][output[0].length - 1]; this.ramp = 0;
      this.silenceFrames += output[0].length;
    }
    for (let c = 1; c < output.length; c++) output[c].set(output[0]);
    if (this.wasPlaying && this.silenceFrames >= sampleRate * 0.25) { this.port.postMessage({ type: 'drained' }); this.wasPlaying = false; }
    return true;
  }
}
registerProcessor('slotpilot-playback', PlaybackProcessor);
