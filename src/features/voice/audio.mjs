export class BrowserAudio {
  constructor(onCapture, onPlaybackEvent = () => {}) {
    this.onCapture = onCapture; this.onPlaybackEvent = onPlaybackEvent; this.closed = false;
  }
  async open({ microphone = true } = {}) {
    if ((microphone && !navigator.mediaDevices?.getUserMedia) || !globalThis.AudioContext)
      throw new Error('MIC_UNAVAILABLE');
    try {
      if (microphone) this.captureContext = new AudioContext({ latencyHint: 'interactive' });
      this.playContext = new AudioContext({ latencyHint: 'interactive' });
      await Promise.all([this.captureContext?.resume(), this.playContext.resume()]);
      if (this.closed) throw new Error('CANCELLED');
      if (microphone) this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 } });
      if (this.closed) { await this.close(); throw new Error('CANCELLED'); }
      await Promise.all([
        this.captureContext?.audioWorklet.addModule('/audio/capture.worklet.mjs?v=20260924-2'),
        this.playContext.audioWorklet.addModule('/audio/playback.worklet.mjs?v=20260928-1'),
      ]);
      if (this.closed) throw new Error('CANCELLED');
      if (microphone) {
        this.source = this.captureContext.createMediaStreamSource(this.stream);
        this.captureNode = new AudioWorkletNode(this.captureContext, 'slotpilot-capture');
        this.captureNode.port.onmessage = event => { if (!this.closed) this.onCapture(event.data); };
        this.source.connect(this.captureNode).connect(this.captureContext.destination);
        this.captureNode.onprocessorerror = () => { if (!this.closed) this.onPlaybackEvent('invalid-audio'); };
      }
      this.playNode = new AudioWorkletNode(this.playContext, 'slotpilot-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      this.playNode.port.onmessage = event => { if (!this.closed) this.onPlaybackEvent(event.data.type); };
      this.playNode.onprocessorerror = () => { if (!this.closed) this.onPlaybackEvent('invalid-audio'); };
      this.playNode.connect(this.playContext.destination);
      return { captureRate: this.captureContext?.sampleRate ?? null, playbackRate: this.playContext.sampleRate, wireRate: 24000 };
    } catch (error) { await this.close(); throw error; }
  }
  play(base64) {
    if (this.closed || !this.playNode) return;
    if (this.playContext.state === 'suspended') {
      if (!this.resumeOnGesture && typeof document !== 'undefined') {
        this.resumeOnGesture = () => void this.playContext.resume().then(() => this.clearResumeGesture()).catch(() => {});
        document.addEventListener('pointerdown', this.resumeOnGesture, { passive: true });
      }
      void this.playContext.resume().then(() => this.clearResumeGesture()).catch(() => this.onPlaybackEvent('playback-suspended'));
    }
    if (typeof base64 !== 'string' || base64.length > 2000000) throw new Error('INVALID_AUDIO');
    const raw = atob(base64);
    if (raw.length % 2) throw new Error('INVALID_AUDIO');
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    this.playNode.port.postMessage(bytes.buffer, [bytes.buffer]);
  }
  startReply() { this.playNode?.port.postMessage('start'); }
  finishReply() { this.playNode?.port.postMessage('end'); }
  setVolume(value) { this.playNode?.port.postMessage({ type: 'volume', value }); }
  clear() { this.playNode?.port.postMessage('clear'); }
  clearResumeGesture() { if (this.resumeOnGesture && typeof document !== 'undefined') document.removeEventListener('pointerdown', this.resumeOnGesture); this.resumeOnGesture = null; }
  async close() {
    this.closed = true;
    this.clearResumeGesture();
    this.clear(); this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect(); this.captureNode?.disconnect(); this.playNode?.disconnect();
    await Promise.all([this.captureContext, this.playContext].filter(Boolean).map(ctx => ctx.state === 'closed' ? null : ctx.close().catch(() => {})));
  }
}
