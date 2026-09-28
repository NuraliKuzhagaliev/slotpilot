// This only suppresses a redundant browser request. It never changes versions
// or substitutes for server validation of an operation that actually writes.
export function patchAlreadySaved(patch, constraints) {
  if (!patch || !constraints || typeof patch !== 'object' || Array.isArray(patch)) return false;
  const entries = Object.entries(patch);
  if (!entries.length) return false;
  return entries.every(([key, value]) => {
    if (key === 'addServiceIds') return Array.isArray(value) && value.length > 0 && value.every(id => constraints.serviceIds?.includes(id));
    if (!['serviceIds', 'vehicleId', 'allowedDates', 'allowedBranchIds', 'preferredBranchId', 'arrivalNotBefore', 'arrivalNotAfter', 'readyNoLaterThan', 'maxBudgetKzt'].includes(key)) return false;
    return JSON.stringify(constraints[key] ?? null) === JSON.stringify(value);
  });
}
