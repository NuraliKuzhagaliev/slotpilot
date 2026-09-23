export class BrowserAudio {
  constructor(onCapture, onPlaybackEvent = () => {}) {
    this.onCapture = onCapture; this.onPlaybackEvent = onPlaybackEvent; this.closed = false;
  }
  async open() {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext)
      throw new Error('MIC_UNAVAILABLE');
    try {
      this.captureContext = new AudioContext();
      this.playContext = new AudioContext();
      await Promise.all([this.captureContext.resume(), this.playContext.resume()]);
      if (this.closed) throw new Error('CANCELLED');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 } });
      if (this.closed) { await this.close(); throw new Error('CANCELLED'); }
      await Promise.all([
        this.captureContext.audioWorklet.addModule('/capture.worklet.mjs'),
        this.playContext.audioWorklet.addModule('/playback.worklet.mjs'),
      ]);
      if (this.closed) throw new Error('CANCELLED');
      this.source = this.captureContext.createMediaStreamSource(this.stream);
      this.captureNode = new AudioWorkletNode(this.captureContext, 'slotpilot-capture');
      this.captureNode.port.onmessage = event => { if (!this.closed) this.onCapture(event.data); };
      this.source.connect(this.captureNode).connect(this.captureContext.destination);
      this.playNode = new AudioWorkletNode(this.playContext, 'slotpilot-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      this.playNode.port.onmessage = event => this.onPlaybackEvent(event.data.type);
      this.playNode.connect(this.playContext.destination);
      return { captureRate: this.captureContext.sampleRate, playbackRate: this.playContext.sampleRate, wireRate: 24000 };
    } catch (error) { await this.close(); throw error; }
  }
  play(base64) {
    if (this.closed || !this.playNode) return;
    if (typeof base64 !== 'string' || base64.length > 2000000) throw new Error('INVALID_AUDIO');
    const raw = atob(base64);
    if (raw.length % 2) throw new Error('INVALID_AUDIO');
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    this.playNode.port.postMessage(bytes.buffer, [bytes.buffer]);
  }
  clear() { this.playNode?.port.postMessage('clear'); }
  async close() {
    this.closed = true;
    this.clear(); this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect(); this.captureNode?.disconnect(); this.playNode?.disconnect();
    await Promise.all([this.captureContext, this.playContext].filter(Boolean).map(ctx => ctx.state === 'closed' ? null : ctx.close().catch(() => {})));
  }
}
