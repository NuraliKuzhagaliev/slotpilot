import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingSession } from '../agents/booking.ts';
import { createDraft } from '../src/server/domain/requests.ts';

test('voice prompt stays compact and preserves natural date/time and booking safety rules', () => {
  const session = bookingSession('2026-09-24T10:00:00.000Z', createDraft('request-12345678', 'user-12345678', 'slotpilot-demo'));
  assert.ok(session.system_prompt.length < 5000, `prompt has ${session.system_prompt.length} characters`);
  assert.match(session.system_prompt, /after lunch 13:00–17:00/);
  assert.match(session.system_prompt, /middle = 11–20/);
  assert.match(session.system_prompt, /allowedDateRange/);
  assert.match(session.system_prompt, /separate final confirmation/);
  assert.equal('turn_detection' in session.input, false, 'use AssemblyAI adaptive semantic turn detection');
  assert.equal(session.input.transcription_mode, 'min_latency');
  assert.deepEqual(session.input.language_codes, ['en']);
  assert.ok(session.input.transcription_prompt.length <= 1750);
  assert.match(session.input.transcription_prompt, /Wheel alignment/);
  assert.match(session.system_prompt, /under 30 words/);
});
