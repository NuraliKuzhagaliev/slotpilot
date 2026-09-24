import { LinearResampler, pcm16ToFloat, PlaybackRing, fadeOut } from './pcm.mjs';
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new LinearResampler(24000, sampleRate); this.fade = null; this.fadeOffset = 0;
    this.ring = new PlaybackRing(sampleRate * 15); this.wasPlaying = false;
    this.silenceFrames = 0; this.lastSample = 0; this.ramp = 0;
    this.tailSample = 0; this.tailRemaining = 0;
    this.rampSamples = Math.ceil(sampleRate * 0.002);
    // A small reservoir absorbs network jitter. A lone short packet must still
    // play: never wait indefinitely for another packet or reply.done.
    this.buffering = true; this.bufferWait = 0; this.ended = false;
    this.targetFrames = Math.ceil(sampleRate * 0.04);
    this.maxWaitFrames = Math.ceil(sampleRate * 0.06);
    this.port.onmessage = ({ data }) => {
      if (data === 'clear') {
        // Fade from the sample actually sent to the speaker. The queued PCM may
        // start at another phase or level, which would make the cut click.
        const tail = new Float32Array(Math.ceil(sampleRate * 0.008));
        tail.fill(this.lastSample);
        this.fade = fadeOut(tail); this.fadeOffset = 0;
        this.ring.clear(); this.resampler.reset(); this.silenceFrames = 0;
        this.tailSample = 0; this.tailRemaining = 0;
        this.buffering = true; this.bufferWait = 0; this.ended = false;
        this.lastSample = 0; this.ramp = 0; this.wasPlaying = false; return;
      }
      if (data === 'start') {
        this.ended = false;
        if (!this.ring.available && !this.wasPlaying) {
          this.buffering = true; this.bufferWait = 0; this.resampler.reset();
        }
        return;
      }
      if (data === 'end') { this.ended = true; return; }
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
    if (this.buffering && this.ring.available) {
      this.bufferWait += output[0].length;
      if (this.ended || this.ring.available >= this.targetFrames || this.bufferWait >= this.maxWaitFrames) {
        this.buffering = false; this.bufferWait = 0;
      }
    }
    const count = this.buffering ? 0 : Math.min(this.ring.available, output[0].length);
    if (count) {
      const chunk = output[0].subarray(0, count); this.ring.pull(chunk);
      // Blend playback into the tail after a real underrun or interruption.
      for (let i = 0; i < count; i++) {
        this.ramp = Math.min(1, this.ramp + 1 / this.rampSamples);
        const weight = this.tailRemaining / this.rampSamples;
        chunk[i] = chunk[i] * 0.75 * this.ramp + this.tailSample * weight * (1 - this.ramp);
        if (this.tailRemaining) this.tailRemaining--;
      }
      if (!this.wasPlaying) this.port.postMessage({ type: 'started' });
      this.lastSample = chunk[count - 1]; this.wasPlaying = true; this.silenceFrames = 0;
    }
    if (count < output[0].length) {
      if (!this.buffering && !this.ended) {
        this.buffering = true; this.bufferWait = 0;
        if (this.wasPlaying) this.port.postMessage({ type: 'underrun' });
      }
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
