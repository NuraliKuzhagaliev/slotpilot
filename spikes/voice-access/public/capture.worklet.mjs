import { LinearResampler, floatToPcm16 } from './pcm.mjs';
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new LinearResampler(sampleRate, 24000);
    this.frame = new Float32Array(480); this.used = 0;
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] ?? []) channel.fill(0); // Never echo the microphone locally.
    const input = inputs[0]?.[0];
    if (!input) return true;
    const samples = this.resampler.process(input);
    for (const value of samples) {
      this.frame[this.used++] = value;
      if (this.used === this.frame.length) {
        const buffer = floatToPcm16(this.frame);
        this.port.postMessage(buffer, [buffer]); this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor('slotpilot-capture', CaptureProcessor);
