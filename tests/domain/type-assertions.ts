// Compiled by tsconfig.core.json; not executed. These protect inferred input types.
import { RequestPatchSchema, CustomerConstraintsSchema } from '../../src/contracts/domain.ts';
import type { RequestPatch, CustomerConstraints } from '../../src/contracts/domain.ts';
import type { ToolArguments } from '../../src/contracts/tools.ts';
const patch: RequestPatch = { maxBudgetKzt: null, addServiceIds: ['oil-change'] };
RequestPatchSchema.parse(patch);
// @ts-expect-error Service IDs must stay within the shared enum.
const unknownService: RequestPatch = { serviceIds: ['replace-engine'] };
// @ts-expect-error A nullable budget is a number or null, never a string.
const textualBudget: RequestPatch = { maxBudgetKzt: 'cheap' };
// @ts-expect-error Tool inputs do not carry model-supplied user identity.
const injectedOwner: ToolArguments<'find_options'> = { expectedRequestVersion: 1, userId: 'admin' };
// @ts-expect-error Required request fields cannot vanish from inferred types.
const incompleteConstraints: CustomerConstraints = { serviceIds: ['oil-change'] };
// @ts-expect-error Arbitrary confirmed=true is not a confirmation reference.
const weakConfirmation: ToolArguments<'confirm_booking'> = { actionId: 'a', confirmed: true };
const example: CustomerConstraints = CustomerConstraintsSchema.parse({});
void [unknownService, textualBudget, injectedOwner, incompleteConstraints, weakConfirmation, example];
