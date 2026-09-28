import { diagnosticEvent } from './diagnostics.mjs';
import { BrowserAudio } from './audio.mjs';
import { ToolResults } from './tool-results.mjs';
import { voiceToolPayload } from './tool-payload.mjs';
import { patchAlreadySaved } from './saved-patch.mjs';
import { transcriptPatch, unsavedTranscriptPatch } from './transcript-patch.mjs';
export async function api(path, body) {
    try {
        const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(path === '/api/tools' ? 8000 : 15000) });
        const d = await r.json();
        if (!r.ok)
            throw Object.assign(new Error(d.error?.message || 'Request failed.'), { code: d.error?.code, status: r.status });
        return d;
    }
    catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
            throw Object.assign(new Error('The request timed out. Checking the saved state may be necessary.'), { code: 'REQUEST_TIMEOUT' });
        throw error;
    }
}
export class VoiceController {
    constructor(callbacks) { this.c = callbacks; this.active = false; this.generation = 0; this.epoch = 0; this.results = new ToolResults(frame => { this.send(frame); this.responseProgress = performance.now(); this.event('tool.result.sent', { callId: frame.call_id }); }); this.seen = new Set(); this.chain = Promise.resolve(); this.pendingPatches = new Map(); this.seenTranscripts = new Set(); this.manualVersion = 0; this.evidenceChain = Promise.resolve(); this.confirmationRef = null; this.suppressed = new Set(); this.replyId = null; this.playing = false; this.lastEvent = ''; this.volume = .55; }
    emit(n, v) { this.c[n]?.(v); }
    send(m) { if (this.socket?.readyState === 1)
        this.socket.send(JSON.stringify(m)); }
    event(type, detail = {}) { this.emit('event', diagnosticEvent(type, detail)); }
    async toolApi(input) { const started = performance.now(); this.event('tool.http.started', { name: input.name, callId: input.callId }); try {
        const result = await api('/api/tools', input);
        this.event('tool.http.done', { name: input.name, callId: input.callId, status: 200, durationMs: Math.round(performance.now() - started) });
        return result;
    }
    catch (error) {
        this.event('tool.http.failed', { name: input.name, callId: input.callId, code: error.code ?? 'CONNECTION_ERROR', status: error.status, durationMs: Math.round(performance.now() - started) });
        throw error;
    } }
    cut(source) { if (this.replyId)
        this.suppressed.add(this.replyId); this.dropAudio = true; this.audio?.clear(); this.playing = false; this.emit('state', 'listening'); this.event(`playback.cleared.${source}`); }
    setVolume(value) { this.volume = Math.max(.2, Math.min(.9, Number.isFinite(value) ? value : .55)); this.audio?.setVolume?.(this.volume); }
    async start() {
        if (this.active)
            return;
        this.active = true;
        this.ready = false;
        this.sessionEnded = false;
        this.seen.clear();
        this.seenTranscripts.clear();
        this.pendingPatches.clear();
        this.suppressed.clear();
        this.replyId = null;
        this.playing = false;
        this.dropAudio = false;
        this.confirmationRef = null;
        this.speechStopped = null;
        this.lastSaved = null;
        this.waitingSince = null;
        this.speechActive = false;
        this.replyActive = false;
        this.toolBusy = 0;
        this.syncBusy = 0;
        this.recoveryAttempted = false;
        this.finalTurn = false;
        this.responseProgress = 0;
        this.chain = Promise.resolve();
        this.evidenceChain = Promise.resolve();
        this.slowSince = null;
        const g = ++this.generation;
        this.emit('state', 'connecting');
        this.audio = new BrowserAudio(buffer => {
            if (g !== this.generation || !this.ready || this.socket?.readyState !== 1)
                return;
            if (this.socket.bufferedAmount > 192000) {
                if (this.slowSince === null) {
                    this.slowSince = performance.now();
                    this.event('network.backpressure');
                }
                if (performance.now() - this.slowSince > 3000) {
                    this.emit('error', 'Network is too slow. Conversation stopped; check the saved visit state.');
                    void this.stop();
                }
                return;
            }
            if (this.slowSince !== null)
                this.event('network.recovered');
            this.slowSince = null;
            // The provider distinguishes true interruptions from short backchannels.
            // Loudspeaker echo must never make us discard an otherwise valid reply.
            let raw = '';
            for (const b of new Uint8Array(buffer))
                raw += String.fromCharCode(b);
            this.send({ type: 'input.audio', audio: btoa(raw) });
        }, kind => { if (g !== this.generation)
            return; if (kind === 'started' && this.speechStopped) {
            this.emit('latency', Math.round(performance.now() - this.speechStopped));
            this.event('playback.first');
            this.speechStopped = null;
            this.waitingSince = null;
        } if (kind === 'underrun')
            this.event('playback.underrun'); if (kind === 'drained') {
            this.playing = false;
            this.emit('state', 'listening');
        } if (kind === 'playback-suspended') {
            this.event('playback.suspended');
            this.emit('error', 'Your browser paused audio. Tap the page to resume sound.');
        } if (kind === 'overflow' || kind === 'invalid-audio') {
            this.emit('error', 'Audio playback failed. Restart the conversation and check your output device.');
            void this.stop();
        } });
        try {
            const [, token] = await Promise.all([this.audio.open(), api('/api/voice/token', { consent: true })]);
            if (g !== this.generation)
                return;
            this.audio.setVolume?.(this.volume);
            this.basePrompt = token.session.system_prompt.split('\nCURRENT SERVER STATE:')[0];
            const url = new URL(token.websocketUrl);
            if (url.origin !== 'wss://agents.assemblyai.com' || url.pathname !== '/v1/ws')
                throw new Error('Invalid voice endpoint');
            url.searchParams.set('token', token.token);
            const ws = new WebSocket(url);
            this.socket = ws;
            this.connectTimer = setTimeout(() => { this.emit('error', 'Voice connection timed out.'); void this.stop(); }, 20000);
            ws.onopen = () => { if (g !== this.generation) {
                ws.close();
                return;
            } this.send({ type: 'session.update', session: token.session }); };
            ws.onmessage = ({ data }) => {
                if (g !== this.generation)
                    return;
                let e;
                try {
                    e = JSON.parse(data);
                }
                catch {
                    return;
                }
                const t = e.type;
                if (t === 'session.ready') {
                    clearTimeout(this.connectTimer);
                    this.ready = true;
                    this.emit('state', 'listening');
                    this.event('voice.connected', { sessionId: typeof e.session_id === 'string' ? e.session_id.slice(0, 100) : undefined });
                    this.watchdog = setInterval(() => this.checkResponse(), 1000);
                    this.durationTimer = setTimeout(() => void this.stop(), token.maxSessionSeconds * 1000);
                }
                if (t === 'input.speech.started') {
                    this.speechActive = true;
                    this.finalTurn = false;
                    this.waitingSince = null;
                    this.results.started();
                    if (!this.playing)
                        this.epoch++;
                    this.lastEvent = t;
                    this.confirmationRef = null;
                    if (this.c.snapshot()?.request?.preparedAction)
                        this.evidenceChain = this.evidenceChain.then(() => g === this.generation ? api('/api/evidence', { kind: 'speech_started' }) : undefined).catch(() => { });
                    this.userSpeechStarted = performance.now();
                }
                if (t === 'input.speech.stopped') {
                    this.speechActive = false;
                    this.speechStopped = performance.now();
                    this.waitingSince = this.speechStopped;
                    this.recoveryAttempted = false;
                    this.event('speech.stopped');
                }
                if (t === 'reply.started') {
                    this.replyActive = true;
                    this.lastEvent = t;
                    this.results.started(e.reply_id);
                    this.replyId = e.reply_id;
                    this.dropAudio = false;
                    this.replyHadAudio = false;
                    this.replyHadText = false;
                    this.audio.startReply();
                    this.emit('state', 'thinking');
                    this.event('reply.started', { replyId: e.reply_id });
                }
                if (t === 'reply.audio' && !this.dropAudio && !this.suppressed.has(e.reply_id) && (!e.reply_id || e.reply_id === this.replyId)) {
                    try {
                        this.audio.play(e.data);
                    }
                    catch {
                        this.event('reply.invalid-audio');
                        this.emit('error', 'One voice reply had invalid audio. Please speak again.');
                        this.cut('invalid-audio');
                        return;
                    }
                    if (!this.replyHadAudio)
                        this.event('reply.audio.first');
                    this.replyHadAudio = true;
                    this.playing = true;
                    this.emit('state', 'responding');
                }
                if (t === 'reply.done') {
                    if (e.reply_id && this.replyId && e.reply_id !== this.replyId && e.status === 'interrupted') {
                        this.suppressed.add(e.reply_id);
                        this.results.cancel(e.reply_id);
                        return;
                    }
                    if (e.reply_id && this.replyId && e.reply_id !== this.replyId && !e.reply_id.startsWith('fc-'))
                        return;
                    if (!e.reply_id || e.reply_id === this.replyId)
                        this.replyActive = false;
                    this.lastEvent = t;
                    if (e.status === 'interrupted') {
                        this.epoch++;
                        this.results.done(e.reply_id, e.status);
                        this.cut('interrupted');
                    }
                    else {
                        if (!e.reply_id || e.reply_id === this.replyId)
                            this.audio.finishReply();
                        this.results.done(e.reply_id, e.status);
                        if (this.replyHadText && !this.replyHadAudio && !this.dropAudio && e.reply_id === this.replyId && !e.reply_id?.startsWith('fc-')) {
                            this.emit('error', 'The voice service sent text without audio. Please speak again.');
                            this.event('reply.missing-audio');
                        }
                    }
                    this.event(`reply.done.${e.status}`, { replyId: e.reply_id });
                }
                if (['transcript.user', 'transcript.user.delta', 'transcript.agent'].includes(t) && typeof e.text === 'string') {
                    if (t === 'transcript.agent' && e.reply_id === this.replyId && e.text.trim())
                        this.replyHadText = true;
                    this.emit('transcript', { id: `${t === 'transcript.agent' ? 'agent' : 'user'}:${e.item_id ?? e.reply_id ?? 'current'}`, speaker: t === 'transcript.agent' ? 'agent' : 'user', text: e.text, final: t !== 'transcript.user.delta' });
                    if (t === 'transcript.user') {
                        this.finalTurn = true;
                        this.event('speech.final');
                        this.rememberTranscript(e.text, e.item_id ?? crypto.randomUUID(), g);
                        const epoch = this.epoch;
                        const action = this.c.snapshot()?.request?.preparedAction;
                        if (action)
                            this.evidenceChain = this.evidenceChain.then(async () => { if (epoch !== this.epoch || g !== this.generation)
                                return; const ev = await api('/api/evidence', { kind: 'confirmation', actionId: action.actionId, source: 'voice', text: e.text, itemId: e.item_id ?? crypto.randomUUID() }); if (epoch === this.epoch && g === this.generation)
                                this.confirmationRef = ev.confirmationRef; }).catch(() => { if (g === this.generation)
                                this.confirmationRef = null; });
                    }
                }
                if (t === 'tool.call' && !this.seen.has(e.call_id)) {
                    this.event('tool.call', { name: e.name, callId: e.call_id });
                    this.seen.add(e.call_id);
                    this.toolBusy++;
                    this.results.register(e.call_id);
                    if (e.name === 'update_request')
                        this.deferTranscriptPatches();
                    const epoch = this.epoch;
                    const write = ['update_request', 'prepare_booking', 'prepare_change', 'confirm_booking', 'reschedule_booking', 'cancel_booking', 'create_callback_request'].includes(e.name);
                    this.chain = this.chain.then(async () => {
                        if (g !== this.generation)
                            return;
                        if (epoch !== this.epoch) {
                            this.results.push(e.call_id, { type: 'tool.result', call_id: e.call_id, result: JSON.stringify({ ok: false, error: { code: 'TURN_CHANGED', message: 'The customer spoke while this tool was queued. Re-evaluate the current request.' } }), is_error: true });
                            return;
                        }
                        let args;
                        let result;
                        const requestId = this.c.snapshot()?.request?.requestId;
                        try {
                            try {
                                args = typeof e.arguments === 'string' ? JSON.parse(e.arguments) : e.arguments;
                            }
                            catch {
                                throw Object.assign(new Error('Tool arguments must be valid JSON. Correct them and try again.'), { code: 'INVALID_ARGUMENTS' });
                            }
                            if (['confirm_booking', 'reschedule_booking', 'cancel_booking'].includes(e.name)) {
                                await this.evidenceChain;
                                args = { ...args, confirmationRef: this.confirmationRef ?? 'no-evidence' };
                            }
                            ;
                            const current = this.c.snapshot()?.request;
                            // The final transcript may already have saved these exact preferences.
                            // Reuse only a successful, still-current result; never rebase a mutation.
                            if (e.name === 'update_request' && this.lastSaved?.request?.requestId === current?.requestId && this.lastSaved.request.requestVersion === current?.requestVersion && this.lastSaved.request.stateRevision === current?.stateRevision && patchAlreadySaved(args?.patch, current?.constraints)) {
                                result = this.lastSaved;
                                this.event('tool.update.reused', { callId: e.call_id });
                            }
                            else {
                                result = await this.toolApi({ callId: e.call_id, name: e.name, arguments: args, requestId });
                                if (g === this.generation) {
                                    this.emit('updateSnapshot', result);
                                    if (e.name === 'update_request')
                                        this.lastSaved = result;
                                }
                            }
                        }
                        catch (error) {
                            const code = error.code ?? 'CONNECTION_ERROR';
                            result = { ok: false, error: { code, message: error.message } };
                            if (code === 'VALIDATION_ERROR')
                                this.event('tool.validation-error');
                            if (code === 'STALE_REQUEST') {
                                try {
                                    const latest = await api('/api/requests');
                                    this.emit('updateSnapshot', latest);
                                    result = { ...result, request: latest.request, search: latest.search };
                                    this.event('tool.stale-reconciled');
                                }
                                catch {
                                    this.event('tool.stale-reconcile-failed');
                                }
                            }
                            if (write && args && !['VALIDATION_ERROR', 'NOT_AUTHORIZED', 'CONFIRMATION_REQUIRED', 'STALE_REQUEST'].includes(code)) {
                                // An HTTP timeout cannot tell us whether the database committed. Check
                                // the exact action without holding up the next voice tool call.
                                const check = args?.actionId ? api('/api/tools', { callId: crypto.randomUUID(), name: 'get_booking', arguments: { actionId: args.actionId }, requestId }) : Promise.resolve().then(() => this.c.reconcile?.());
                                void check.then(snapshot => { if (snapshot?.request)
                                    this.emit('updateSnapshot', snapshot); }).catch(() => this.emit('error', 'Could not verify the saved action yet. Refresh the visit state.'));
                            }
                        }
                        // A new utterance must not strand the provider waiting for tool.result.
                        // Writes report their actual result; stale reads ask the agent to re-check.
                        if (g !== this.generation)
                            return;
                        if (epoch !== this.epoch && !write) {
                            this.event('tool.result.stale');
                            result = { ok: false, error: { code: 'TURN_CHANGED', message: 'The customer spoke while this lookup ran. Re-evaluate the current request.' } };
                        }
                        this.event('tool.result.queued', { callId: e.call_id });
                        this.results.push(e.call_id, { type: 'tool.result', call_id: e.call_id, result: JSON.stringify(voiceToolPayload(result)), is_error: result.ok === false });
                        if (e.name === 'update_request')
                            this.flushTranscriptPatches();
                    }).catch(() => this.emit('error', 'A tool call failed. Check the saved visit state.')).finally(() => { if (g === this.generation)
                        this.toolBusy--; });
                }
                if (t === 'session.error' || t === 'error') {
                    const code = typeof e.code === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(e.code) ? e.code : 'unknown';
                    this.event(`voice.provider-error.${code}`);
                    const recoverable = this.ready && t === 'session.error' && ['invalid_format', 'invalid_audio', 'invalid_value', 'immutable_field', 'invalid_config', 'server_error', 'audio_rate_violation'].includes(code);
                    if (recoverable) {
                        this.emit('error', `Voice service warning (${code}). The conversation is still connected.`);
                    }
                    else {
                        this.emit('error', `Voice service error (${code}). Restart the conversation; saved bookings remain intact.`);
                        void this.stop();
                    }
                }
                if (t === 'session.ended') {
                    this.sessionEnded = true;
                    void this.stop();
                }
            };
            ws.onerror = () => { if (g !== this.generation)
                return; this.emit('error', 'Voice connection failed.'); void this.stop(); };
            ws.onclose = e => { if (g === this.generation) {
                this.event('voice.closed', { code: e?.code });
                this.emit('error', 'Voice disconnected. Checking the saved visit.');
                void this.stop();
                void this.c.reconcile?.();
            } };
        }
        catch (e) {
            if (g !== this.generation)
                return;
            this.emit('error', e.name === 'NotAllowedError' ? 'Allow microphone access, then try again.' : e.message);
            await this.stop();
        }
    }
    rememberTranscript(text, id, g) { const key = `${id}:${text}`; if (this.seenTranscripts.has(key))
        return; this.seenTranscripts.add(key); if (this.seenTranscripts.size > 100)
        this.seenTranscripts.delete(this.seenTranscripts.values().next().value); const patch = transcriptPatch(text); const request = this.c.snapshot()?.request; if (!patch || !request)
        return; const record = { id, key, patch, requestId: request.requestId, g, manualVersion: this.manualVersion, timer: null }; this.pendingPatches.set(key, record); record.timer = setTimeout(() => this.flushTranscriptPatch(key), 350); }
    deferTranscriptPatches() { for (const record of this.pendingPatches.values()) {
        clearTimeout(record.timer);
        record.timer = setTimeout(() => this.flushTranscriptPatch(record.key), 1500);
    } }
    flushTranscriptPatches() { for (const key of [...this.pendingPatches.keys()])
        this.flushTranscriptPatch(key); }
    flushTranscriptPatch(key) { const record = this.pendingPatches.get(key); if (!record)
        return; clearTimeout(record.timer); this.pendingPatches.delete(key); this.syncBusy++; this.chain = this.chain.then(() => this.saveTranscriptPatch(record)).catch(() => this.event('transcript.sync-failed')).finally(() => { if (record.g === this.generation)
        this.syncBusy--; }); }
    async saveTranscriptPatch(record) { if (record.g !== this.generation || record.manualVersion !== this.manualVersion)
        return; for (let attempt = 0; attempt < 2; attempt++) {
        const request = this.c.snapshot()?.request;
        if (!request || request.requestId !== record.requestId || request.bookingId)
            return;
        const patch = unsavedTranscriptPatch(record.patch, request.constraints);
        if (!patch)
            return;
        try {
            const result = await this.toolApi({ callId: crypto.randomUUID(), name: 'update_request', arguments: { patch, expectedRequestVersion: request.requestVersion }, requestId: request.requestId });
            if (record.g === this.generation) {
                this.emit('updateSnapshot', result);
                this.lastSaved = result;
                this.refreshPrompt(result.request);
                this.event('transcript.saved');
            }
            return;
        }
        catch (error) {
            if (error.code !== 'STALE_REQUEST' || attempt !== 0) {
                this.event('transcript.sync-failed');
                this.emit('error', 'Could not save that spoken detail. Check the visit form.');
                return;
            }
            try {
                const latest = await api('/api/requests');
                if (record.g !== this.generation || record.manualVersion !== this.manualVersion)
                    return;
                this.emit('updateSnapshot', latest);
            }
            catch {
                this.event('transcript.sync-failed');
                return;
            }
        }
    } }
    refreshPrompt(request) { if (!this.active || !this.ready || !request)
        return; this.send({ type: 'session.update', session: { system_prompt: `${this.basePrompt}\nCURRENT AUTHORITATIVE STATE: ${JSON.stringify({ requestId: request.requestId, requestVersion: request.requestVersion, constraints: request.constraints, stage: request.stage, options: request.options?.map(o => ({ optionId: o.optionId, date: o.date, branchId: o.branchId, startAt: o.startAt, readyAt: o.readyAt, totalPriceKzt: o.totalPriceKzt })) })}. These are saved server facts. Ask only for missing required details; if options exist, offer the first one now. Never claim a booking without confirmation.` } }); }
    checkResponse() { if (!this.active || !this.ready || this.waitingSince === null || this.speechActive || !this.finalTurn)
        return; const elapsed = performance.now() - this.waitingSince; if (elapsed < 6000 || this.recoveryAttempted || performance.now() - this.responseProgress < 3000)
        return; this.emit('state', 'delayed'); if (this.replyActive || this.toolBusy || this.syncBusy || this.pendingPatches.size || this.results.pending.length)
        return; this.recoveryAttempted = true; this.refreshPrompt(this.c.snapshot()?.request); this.send({ type: 'reply.create', instructions: 'Respond to the latest customer message using the saved visit state. Offer an available option or ask only for a missing required detail. Do not repeat the greeting or request confirmation of preferences already saved. Booking still requires the full readback and separate final consent.' }); this.event('reply.recovery.requested'); }
    sync() { if (!this.active)
        return; this.manualVersion++; for (const record of this.pendingPatches.values())
        clearTimeout(record.timer); this.pendingPatches.clear(); this.cut('manual-edit'); this.epoch++; this.results.started(); this.confirmationRef = null; const s = this.c.snapshot(); this.send({ type: 'session.update', session: { system_prompt: `${this.basePrompt}\nMANUAL UPDATE: Previous proposals are superseded. CURRENT AUTHORITATIVE STATE: ${JSON.stringify(s?.request)}. Use this latest requestVersion and conditions before recommending anything.` } }); }
    async stop() { if (!this.active)
        return; this.active = false; this.ready = false; this.generation++; this.epoch++; for (const record of this.pendingPatches.values())
        clearTimeout(record.timer); this.pendingPatches.clear(); this.results.clear(); clearInterval(this.watchdog); clearTimeout(this.durationTimer); clearTimeout(this.connectTimer); const ws = this.socket; this.socket = null; if (this.sessionEnded)
        ws?.close();
    else if (ws?.readyState === 1) {
        ws.send(JSON.stringify({ type: 'session.end' }));
        const timer = setTimeout(() => ws.close(), 1200);
        ws.addEventListener('message', e => { try {
            if (JSON.parse(e.data).type === 'session.ended') {
                clearTimeout(timer);
                ws.close();
            }
        }
        catch { } });
    }
    else if (ws?.readyState === 0)
        ws.close(); const a = this.audio; this.audio = null; const stoppedGeneration = this.generation; await a?.close(); if (stoppedGeneration !== this.generation)
        return; this.emit('state', 'idle'); this.event('voice.stopped'); }
}
