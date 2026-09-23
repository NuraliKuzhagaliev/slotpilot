/** Input contracts ONLY. This registry is NOT an AssemblyAI session configuration.
 * Do not advertise unimplemented write tools to the live voice probe.
 */
import { v, type Infer } from './schema.ts';
import { IdSchema, VehicleIdSchema, RequestPatchSchema } from './domain.ts';
const version = v.int(1);
export const toolInputs = {
  get_services: v.object({ vehicleId: v.optional(VehicleIdSchema) }),
  update_request: v.object({ patch: RequestPatchSchema, expectedRequestVersion: version }),
  find_options: v.object({ expectedRequestVersion: version }),
  prepare_booking: v.object({ optionId: IdSchema, expectedRequestVersion: version }),
  confirm_booking: v.object({ actionId: IdSchema, confirmationRef: IdSchema }),
  get_booking: v.union([v.object({ bookingId: IdSchema }), v.object({ actionId: IdSchema })]),
  prepare_change: v.union([
    v.object({ changeType: v.literal('reschedule'), bookingId: IdSchema, expectedBookingVersion: version, optionId: IdSchema, expectedRequestVersion: version }),
    v.object({ changeType: v.literal('cancel'), bookingId: IdSchema, expectedBookingVersion: version }),
  ]),
  reschedule_booking: v.object({ actionId: IdSchema, confirmationRef: IdSchema }),
  cancel_booking: v.object({ actionId: IdSchema, confirmationRef: IdSchema }),
  create_callback_request: v.object({ reason: v.string({ min: 1, max: 500 }), expectedRequestVersion: version }),
} as const;
export type ToolName = keyof typeof toolInputs;
export type ToolArguments<N extends ToolName> = Infer<(typeof toolInputs)[N]>;
export const ToolNameSchema = v.enum(['get_services', 'update_request', 'find_options', 'prepare_booking', 'confirm_booking',
  'get_booking', 'prepare_change', 'reschedule_booking', 'cancel_booking', 'create_callback_request']);
export function exportToolInputSchemas(): Record<ToolName, Readonly<Record<string, unknown>>> {
  return Object.fromEntries(Object.entries(toolInputs).map(([name, schema]) => [name, schema.jsonSchema])) as Record<ToolName, Readonly<Record<string, unknown>>>;
}
/** Runtime and generated JSON Schema use exactly the same structural definitions. */
export function parseToolArguments<N extends ToolName>(name: N, value: unknown): ToolArguments<N> {
  ToolNameSchema.parse(name);
  return toolInputs[name].parse(value) as ToolArguments<N>;
}
