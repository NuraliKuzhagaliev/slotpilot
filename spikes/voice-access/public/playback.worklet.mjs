import { LinearResampler, pcm16ToFloat, PlaybackRing } from './pcm.mjs';
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new LinearResampler(24000, sampleRate);
    this.ring = new PlaybackRing(sampleRate * 15); this.wasPlaying = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'clear') { this.ring.clear(); this.resampler.reset(); this.wasPlaying = false; return; }
      try {
        if (!this.ring.available) this.resampler.reset();
        const valid = this.ring.push(this.resampler.process(pcm16ToFloat(data)));
        if (!valid) { this.resampler.reset(); this.port.postMessage({ type: 'overflow' }); }
      } catch { this.port.postMessage({ type: 'invalid-audio' }); }
    };
  }
  process(inputs, outputs) {
    const output = outputs[0]; if (!output?.[0]) return true;
    const hadAudio = this.ring.available > 0;
    this.ring.pull(output[0]);
    for (let c = 1; c < output.length; c++) output[c].set(output[0]);
    if (hadAudio) this.wasPlaying = true;
    if (this.wasPlaying && !this.ring.available) { this.port.postMessage({ type: 'drained' }); this.wasPlaying = false; }
    return true;
  }
}
registerProcessor('slotpilot-playback', PlaybackProcessor);
