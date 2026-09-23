// Executed with Node's built-in TS erasure. No external API calls or DB writes.
import { randomUUID } from 'node:crypto';
import { makeDemoDataset } from '../src/server/db/demo-fixtures.ts';
import { createDraft, updateRequest, acceptSearchResult } from '../src/server/domain/requests.ts';
import { searchOwnedRequest, comparePreviousOption } from '../src/server/domain/scheduler.ts';
import { addDays, localParts } from '../src/server/domain/time.ts';
const now = process.argv.includes('--fixed') ? '2026-09-23T05:00:00.000Z' : new Date().toISOString();
const tomorrow = addDays(localParts(now).date, 1);
const data = makeDemoDataset(now);
const actor = { userId: 'demo-client', role: 'client' };
const context = { now, nextOptionId: () => `option-${randomUUID()}` };
const rows = [];
const display = option => ({ branch: option.branchId, date: option.date, start: localParts(option.startAt).time,
  ready: localParts(option.readyAt).time, minutes: option.totalDurationMinutes, priceKzt: option.totalPriceKzt });
let state = createDraft('engine-demo', actor.userId, 'offline-demo');
state = updateRequest(state, actor, { vehicleId: 'sedan-petrol', serviceIds: ['oil-change'], allowedDates: [tomorrow],
  arrivalNotBefore: '14:00', maxBudgetKzt: 40000, allowedBranchIds: ['centre'] }, state.requestVersion);
const first = searchOwnedRequest(state, actor, state.requestVersion, data, context);
state = acceptSearchResult(state, first).state;
if (!first.options[0]) throw new Error('Fixture did not produce the initial option.');
rows.push({ step: '1. Oil change / Centre', ...display(first.options[0]) });
const previous = first.options[0];
state = updateRequest(state, actor, { addServiceIds: ['brake-check', 'diagnostics'], readyNoLaterThan: '16:00' }, state.requestVersion);
const comparison = comparePreviousOption(previous, state.constraints, data, now);
const second = searchOwnedRequest(state, actor, state.requestVersion, data, context);
const alternative = second.relaxations.find(item => item.kind === 'another_branch');
if (second.options.length || !alternative) throw new Error('Fixture did not enforce the branch/deadline constraint.');
rows.push({ step: '2. Old start, with three services (REJECTED)', branch: previous.branchId, date: tomorrow,
  start: localParts(previous.startAt).time, ready: localParts(comparison.newReadyAt).time,
  minutes: comparison.totalDurationMinutes, priceKzt: comparison.totalPriceKzt });
rows.push({ step: '3. Another branch (CONSENT REQUIRED)', ...display(alternative.preview) });
// Explicit scripted consent to CONSIDER another branch, NOT consent to create a booking.
state = updateRequest(state, actor, alternative.patch, state.requestVersion);
const third = searchOwnedRequest(state, actor, state.requestVersion, data, context);
state = acceptSearchResult(state, third).state;
rows.push({ step: '4. After scripted branch consent (PROPOSAL ONLY)', ...display(third.options[0]) });
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ demoData: true, persistence: 'none', clock: now, timeZone: 'Asia/Almaty', rows,
    previousOptionComparison: comparison, finalRequest: state, bookingCreated: false }, null, 2));
} else {
  console.log('\nSlotPilot · OFFLINE CONSTRAINT ENGINE DEMO · no voice, no database, no booking\n');
  console.table(rows);
  console.log(`Why the old start fails: ${comparison.reasons.map(item => item.message).join(' ')}`);
  console.log(`Actual allowed options before branch consent: ${second.options.length}`);
  console.log(`Versions: request=${state.requestVersion}; state=${state.stateRevision}`);
  console.log('This script stops at a proposal. No appointment was created or reserved.\n');
}
