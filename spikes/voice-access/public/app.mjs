import { api, VoiceController } from './controller.mjs';
const $ = id => document.getElementById(id);
let session = null, status = null, busy = false, startedAt = null;
let events = [], transcripts = new Map();
const evidence = { microphone: false, providerReady: false, audioReceived: false, finalUserTranscript: false,
  toolResultReceived: false, toolResultSent: false, interruption: false, captureRate: null, playbackRate: null };
const safeEvents = /^(microphone\.ready|session\.(ready|ended)|input\.speech\.started|reply\.(interrupted|completed)|playback\.cleared|tool\.(call|result\.(sent|discarded)|queue\.(new-user-turn|interrupted|closed))|catalog\.manual-read|auth\.(login|logout))$/;
function logEvent(event) {
  if (!safeEvents.test(event.type)) return;
  events.push(event); if (events.length > 200) events.shift();
  $('events').replaceChildren(...events.slice().reverse().map(row => {
    const el = document.createElement('div'), time = document.createElement('time'), label = document.createElement('span');
    time.textContent = new Date(row.at).toLocaleTimeString('en-GB'); label.textContent = row.type;
    el.append(time, label); return el;
  }));
  $('event-count').textContent = `${events.length} events`;
  if (event.type === 'tool.result.sent' && evidence.toolResultReceived) evidence.toolResultSent = true;
  renderEvidence();
}
function showError(error) { $('error').textContent = `${error.code ? `${error.code}: ` : ''}${error.message}`; $('error').hidden = false; }
function clearError() { $('error').hidden = true; $('error').textContent = ''; }
function refreshControls() {
  $('start').disabled = busy || (!voice.active && (!session || !status?.apiKeyConfigured || !$('consent').checked));
  $('start-label').textContent = voice.active ? 'Stop conversation' : 'Start voice check';
  $('consent').disabled = voice.active;
  $('catalog-check').disabled = !session || voice.active || busy;
  $('login-form').hidden = Boolean(session); $('logout').hidden = !session;
  $('logout').disabled = busy;
  $('auth-status').textContent = session ? `Signed in as ${session.role}. Your key stays on the local server.` : 'Sign in with your generated demo credentials.';
}
function renderEvidence() {
  const checks = { mic: evidence.microphone, provider: evidence.providerReady, audio: evidence.audioReceived && evidence.finalUserTranscript,
    tool: evidence.toolResultReceived && evidence.toolResultSent, interruption: evidence.interruption };
  for (const [key, done] of Object.entries(checks)) {
    const el = $(`check-${key}`); el.classList.toggle('done', done);
    el.querySelector('.check-status').textContent = done ? 'Observed' : 'Waiting';
    el.querySelector('.check-icon').textContent = done ? '✓' : String(Object.keys(checks).indexOf(key) + 1);
  }
  const count = Object.values(checks).filter(Boolean).length;
  $('progress').textContent = `${count} / 5`;
  $('heard-audio').disabled = !evidence.audioReceived;
  $('heard-stop').disabled = !evidence.interruption;
  $('gate-status').textContent = count === 5 && $('heard-audio').checked && $('heard-stop').checked
    ? 'Probe evidence collected + human audio checks confirmed. Review before starting stage 1.'
    : count === 5 ? 'Events observed. Confirm the two human audio checks.' : 'Live verification is still required.';
}
function resetEvidence() {
  Object.assign(evidence, { microphone: false, providerReady: false, audioReceived: false, finalUserTranscript: false,
    toolResultReceived: false, toolResultSent: false, interruption: false, captureRate: null, playbackRate: null });
  $('heard-audio').checked = false; $('heard-stop').checked = false;
  events = []; transcripts = new Map(); $('events').replaceChildren(); $('event-count').textContent = '0 events';
  $('transcript').replaceChildren(); renderEvidence();
}
function showTranscript(entry) {
  transcripts.set(entry.id, entry);
  if (transcripts.size > 100) transcripts.delete(transcripts.keys().next().value);
  $('transcript').replaceChildren(...[...transcripts.values()].map(row => {
    const div = document.createElement('div'); div.className = `utterance${row.final ? '' : ' partial'}`;
    const speaker = document.createElement('strong'), text = document.createElement('p');
    speaker.textContent = row.speaker === 'user' ? 'YOU' : 'SLOTPILOT'; text.textContent = row.text;
    div.append(speaker, text);
    if (row.interrupted) { const tag = document.createElement('small'); tag.textContent = 'Interrupted'; div.append(tag); }
    return div;
  }));
  $('transcript').scrollTop = $('transcript').scrollHeight;
  if (entry.speaker === 'user' && entry.final) { evidence.finalUserTranscript = true; renderEvidence(); }
}
function showCatalog(result, source) {
  if (!result?.ok || !Array.isArray(result.data?.services)) return;
  const { services, vehicles } = result.data;
  const previous = $('vehicle').value;
  $('vehicle').replaceChildren(new Option('All demo vehicles', ''), ...vehicles.map(vehicle => new Option(vehicle.name, vehicle.id)));
  $('vehicle').value = previous;
  $('catalog').replaceChildren(...services.map(service => {
    const row = document.createElement('div'), label = document.createElement('div'), name = document.createElement('strong');
    const duration = document.createElement('small'), price = document.createElement('span');
    row.className = 'catalog-row'; name.textContent = service.name;
    duration.textContent = `${service.durationMinutes} min · demo consumables included`;
    price.className = 'price'; price.textContent = `${new Intl.NumberFormat('en-US').format(service.priceKzt)} KZT`;
    label.append(name, duration); row.append(label, price); return row;
  }));
  const note = document.createElement('p'); note.className = 'catalog-note';
  note.textContent = `One ${result.data.rules.visitBufferMinutes}-minute buffer per visit. Up to ${result.data.rules.maxServicesPerVisit} services. No slots are checked in this build.`;
  $('catalog').append(note);
  $('catalog-note').textContent = source === 'voice' ? 'Returned by the server for the voice agent. Not a booking.' : 'Manual server check completed. This does not verify the voice integration.';
}
const voice = new VoiceController({
  state: state => {
    const labels = { idle: 'Not connected', microphone: 'Requesting microphone', connecting: 'Connecting', listening: 'Listening', responding: 'Responding', error: 'Stopped after error' };
    $('connection-status').textContent = labels[state] ?? state;
    $('connection-dot').classList.toggle('active', state === 'listening' || state === 'responding');
    $('voice-orbit').classList.toggle('live', state === 'responding'); refreshControls();
  },
  event: logEvent,
  microphone: rates => { evidence.microphone = true; evidence.captureRate = rates.captureRate; evidence.playbackRate = rates.playbackRate; renderEvidence(); },
  connected: () => { evidence.providerReady = true; renderEvidence(); },
  audioReceived: () => { if (!evidence.audioReceived) { evidence.audioReceived = true; renderEvidence(); } },
  interrupted: () => { evidence.interruption = true; renderEvidence(); },
  transcript: showTranscript,
  toolResult: ({ result }) => {
    if (result.ok && result.meta?.scope === 'voice-access-probe') { evidence.toolResultReceived = true; showCatalog(result, 'voice'); renderEvidence(); }
  },
  error: showError,
  notice: message => { $('voice-hint').textContent = message; },
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); clearError(); busy = true; $('login-button').disabled = true; refreshControls();
  try {
    session = await api('/api/login', { username: $('username').value, password: $('password').value });
    $('password').value = ''; logEvent({ type: 'auth.login', at: new Date().toISOString() });
  } catch (error) { showError(error); }
  finally { busy = false; $('login-button').disabled = false; refreshControls(); }
});
$('logout').addEventListener('click', async () => {
  clearError(); busy = true; refreshControls();
  try { await voice.stop(); await api('/api/logout', {}); session = null; resetEvidence(); }
  catch (error) { showError(error); }
  finally { busy = false; refreshControls(); }
});
$('start').addEventListener('click', async () => {
  clearError();
  if (voice.active) { await voice.stop(); refreshControls(); return; }
  if (!$('consent').checked || !session) return;
  resetEvidence(); startedAt = new Date().toISOString();
  $('voice-hint').textContent = 'Ask about a service. Use English and fictional details.';
  await voice.start(); refreshControls();
});
$('consent').addEventListener('change', refreshControls);
$('heard-audio').addEventListener('change', renderEvidence); $('heard-stop').addEventListener('change', renderEvidence);
$('catalog-check').addEventListener('click', async () => {
  clearError(); busy = true; refreshControls();
  try {
    const vehicleId = $('vehicle').value;
    const result = await api('/api/tools', { callId: `manual_${crypto.randomUUID()}`, name: 'get_services', arguments: vehicleId ? { vehicleId } : {} });
    showCatalog(result, 'manual'); logEvent({ type: 'catalog.manual-read', at: new Date().toISOString() });
  } catch (error) { showError(error); }
  finally { busy = false; refreshControls(); }
});
$('export-report').addEventListener('click', () => {
  const report = {
    stage: 'SlotPilot voice access probe', generatedAt: new Date().toISOString(), startedAt,
    classification: 'Local observations and explicitly self-reported human audio checks; review for authenticity. Not proof of production readiness.',
    evidence, manualChecks: { heardAgentAudio: $('heard-audio').checked, heardPlaybackStop: $('heard-stop').checked },
    observedEvents: events, excludes: ['API keys', 'temporary tokens', 'session cookies', 'audio', 'transcript text', 'contact details'],
    bookingImplemented: false, databaseImplemented: false,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'slotpilot-voice-check.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('pagehide', () => { void voice.stop(''); });
async function bootstrap() {
  try {
    status = await api('/api/status');
    const clock = status.serverClock; $('branch-time').textContent = `${clock.date} · ${clock.time}`;
    $('session-limit').textContent = `Max ${status.maxSessionSeconds} seconds`;
    const issues = [];
    if (!status.authConfigured) issues.push('Run npm run setup to generate .env.local and demo passwords.');
    if (!status.apiKeyConfigured) issues.push('Voice is disabled: add ASSEMBLYAI_API_KEY to server .env.local and restart. Manual catalogue checks still work after sign-in.');
    $('setup-notice').textContent = issues.join(' '); $('setup-notice').hidden = issues.length === 0;
    try { session = await api('/api/session'); } catch (error) { if (error.code !== 'NOT_AUTHORIZED') throw error; }
    refreshControls();
  } catch { showError({ message: 'Could not reach the local SlotPilot server. Start it with npm run dev.' }); }
}
renderEvidence(); void bootstrap();
