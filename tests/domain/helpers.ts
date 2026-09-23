import { createDraft, updateRequest } from '../../src/server/domain/requests.ts';
import { findOptions } from '../../src/server/domain/scheduler.ts';
import { makeDemoDataset } from '../../src/server/db/demo-fixtures.ts';
import type { BookingRequest, Dataset, RequestPatch } from '../../src/contracts/domain.ts';
export const NOW = '2026-09-23T05:00:00.000Z';
export const TOMORROW = '2026-09-24';
export const ACTOR = { userId: 'client-1', role: 'client' } as const;
export function request(patch: RequestPatch = {}): BookingRequest {
  const draft = createDraft('request-1', ACTOR.userId, 'test-fixture');
  return updateRequest(draft, ACTOR, { vehicleId: 'sedan-petrol', serviceIds: ['oil-change'], allowedDates: [TOMORROW],
    allowedBranchIds: ['centre'], arrivalNotBefore: '14:00', maxBudgetKzt: 40000, ...patch }, draft.requestVersion);
}
export function search(state = request(), data = makeDemoDataset(NOW), now = NOW) {
  let n = 0;
  return findOptions(state, data, { now, nextOptionId: () => `option-${++n}` });
}
export function freeData(): Dataset { const data = makeDemoDataset(NOW); data.reservations = []; return data; }
