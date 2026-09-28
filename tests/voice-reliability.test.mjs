import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolResults } from '../src/features/voice/tool-results.mjs';
import { patchAlreadySaved } from '../src/features/voice/saved-patch.mjs';
import { diagnosticEvent, diagnosticExport } from '../src/features/voice/diagnostics.mjs';

test('an old tool completion cannot open the window while a newer reply is active', () => {
  const sent = [], gate = new ToolResults(frame => sent.push(frame));
  gate.started('fc-old'); gate.register('old');
  gate.started('new'); gate.done('fc-old', 'completed');
  gate.push('old', { call_id: 'old' });
  assert.equal(sent.length, 0);
  gate.done('new', 'completed'); assert.equal(sent.length, 1);
});
test('interrupting a newer reply retains an earlier committed tool result for the next idle window', () => {
  const sent = [], gate = new ToolResults(frame => sent.push(frame));
  gate.started('resp-saved'); gate.register('saved'); gate.done('resp-saved', 'completed'); gate.started('new');
  gate.push('saved', { call_id: 'saved' }); gate.done('new', 'interrupted');
  assert.equal(sent.length, 0);
  gate.started('answer'); gate.done('answer', 'completed');
  assert.deepEqual(sent, [{ call_id: 'saved' }]);
});
test('deduplication accepts exact saved preferences but never assumes remove/range operations succeeded', () => {
  const constraints = { allowedDates: ['2026-10-15'], serviceIds: ['brake-check', 'tire-service'], vehicleId: 'crossover-petrol' };
  assert.equal(patchAlreadySaved({ allowedDates: ['2026-10-15'], addServiceIds: ['brake-check'] }, constraints), true);
  assert.equal(patchAlreadySaved({ allowedDates: ['2026-10-16'] }, constraints), false);
  for (const patch of [{}, { removeServiceIds: [] }, { allowedDateRange: null }, { unexpected: null }, []]) assert.equal(patchAlreadySaved(patch, constraints), false);
});
test('diagnostics preserve correlation and timing but discard private fields and raw provider messages', () => {
  const e = diagnosticEvent('tool.http.done', { callId: 'call-1', sessionId: 'session-1', status: 200, durationMs: 32.1, arguments: { email: 'private' }, text: 'private', token: 'secret', reason: 'private', url: '?token=secret' });
  const exported = diagnosticExport(Array(450).fill({ ...e, audio: 'secret', raw: { token: 'secret' } }));
  assert.equal(exported.events.length, 400);
  assert.equal(exported.events[0].durationMs, 32);
  assert.equal(exported.events[0].sessionId, 'session-1');
  assert.doesNotMatch(JSON.stringify(exported), /private|secret/);
});
