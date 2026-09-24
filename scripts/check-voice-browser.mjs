// Real Chromium AudioWorklets with synthetic PCM, not a live provider/microphone test.
// PLAYWRIGHT_MODULE can point to an existing Playwright installation.
// BROWSER_PATH optionally selects installed Chrome/Edge; no dependency changes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const server = createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname;
  if (file === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Voice audio verification</title>'); return; }
  if (!['/audio/pcm.mjs', '/audio/playback.worklet.mjs', '/audio/capture.worklet.mjs'].includes(file)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(new URL(`../public${file}`, import.meta.url))); }
  catch { res.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const hardwareRate = Number(process.env.AUDIO_SAMPLE_RATE || 48000);
  assert.ok([44100, 48000].includes(hardwareRate));
  const result = await page.evaluate(async hardwareRate => {
    const context = new OfflineAudioContext(1, hardwareRate / 2, hardwareRate);
    await context.audioWorklet.addModule('/audio/playback.worklet.mjs');
    const player = new AudioWorkletNode(context, 'slotpilot-playback', { numberOfInputs: 0, outputChannelCount: [1] });
    const events = []; player.port.onmessage = e => events.push(e.data.type);
    player.connect(context.destination);
    const positions = [0, 11, 17, 23, 34, 40, 46, 57, 63, 69, 80, 86];
    const pauses = positions.map(frame => context.suspend(frame * 128 / 48000));
    const rendered = context.startRendering();
    for (let packet = 0; packet < positions.length; packet++) {
      await pauses[packet];
      const pcm = new Int16Array(480);
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(24000 * Math.sin(2 * Math.PI * 440 * (packet * 480 + i) / 24000));
      player.port.postMessage(pcm.buffer, [pcm.buffer]);
      if (packet === positions.length - 1) player.port.postMessage('end');
      // Deliver the MessagePort data before offline rendering resumes.
      await new Promise(resolve => setTimeout(resolve, 10));
      await context.resume();
    }
    const wave = (await rendered).getChannelData(0);
    let first = -1, last = -1, jump = 0;
    for (let i = 0; i < wave.length; i++) {
      if (Math.abs(wave[i]) > .01) { if (first === -1) first = i; last = i; }
      if (i) jump = Math.max(jump, Math.abs(wave[i] - wave[i - 1]));
    }
    let run = 0, largestHole = 0;
    for (let i = first; i <= last; i++) { run = Math.abs(wave[i]) < 1e-7 ? run + 1 : 0; largestHole = Math.max(largestHole, run); }
    const capture = new OfflineAudioContext(1, hardwareRate, hardwareRate);
    await capture.audioWorklet.addModule('/audio/capture.worklet.mjs');
    const mic = new AudioWorkletNode(capture, 'slotpilot-capture');
    const frames = [];
    mic.port.onmessage = e => frames.push(new Int16Array(e.data).length);
    const oscillator = capture.createOscillator(); oscillator.connect(mic).connect(capture.destination); oscillator.start();
    const silentOutput = (await capture.startRendering()).getChannelData(0);
    await new Promise(resolve => setTimeout(resolve, 50));
    return { hardwareRate, firstRenderMs: first * 1000 / hardwareRate, speechMs: (last - first) * 1000 / hardwareRate, largestHole, largestJump: jump,
      events, captureSamples: frames.reduce((a, b) => a + b, 0), captureFrameSizes: [...new Set(frames)],
      captureEcho: silentOutput.some(value => value !== 0) };
  }, hardwareRate);
  assert.ok(result.firstRenderMs >= 0 && result.firstRenderMs <= 65);
  assert.ok(result.speechMs >= 235 && result.speechMs <= 245);
  assert.ok(result.largestHole < 4, JSON.stringify(result));
  assert.ok(result.largestJump < .13);
  assert.equal(result.events.includes('underrun'), false);
  assert.equal(result.captureSamples, 24000);
  assert.deepEqual(result.captureFrameSizes, [480]);
  assert.equal(result.captureEcho, false);
  console.log(JSON.stringify({ check: 'real-browser-synthetic-audio', ...result }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
