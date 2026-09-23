import { v, type Infer } from './schema.ts';
import { BookingRequestSchema, BranchSchema, DemoVehicleSchema, IdSchema, InstantSchema, SearchResultSchema, ServiceSchema, SlotOptionSchema } from './domain.ts';
import { BookingSchema, CallbackSchema } from './app.ts';
import type { ToolName } from './tools.ts';
const prepared = v.object({ actionId:IdSchema, actionType:v.enum(['create','reschedule','cancel']), snapshot:SlotOptionSchema, expiresAt:InstantSchema, confirmation:v.string({min:1,max:500}) });
export const toolOutputs = {
  get_services:v.object({ services:v.array(ServiceSchema,{max:4}), vehicles:v.array(DemoVehicleSchema,{max:3}), branches:v.array(BranchSchema,{max:2}), bufferMinutes:v.literal(15), currency:v.literal('KZT'), demoData:v.literal(true) }),
  update_request:v.object({ request:BookingRequestSchema, missingFields:v.array(v.string({min:1,max:100}),{max:10}) }),
  find_options:v.extend(SearchResultSchema,{searchDurationMs:v.int()}),
  prepare_booking:prepared,
  confirm_booking:BookingSchema,
  get_booking:v.union([BookingSchema,v.object({status:v.literal('not_committed'),actionId:IdSchema,canRetry:v.boolean()})]),
  prepare_change:prepared,
  reschedule_booking:BookingSchema,
  cancel_booking:BookingSchema,
  create_callback_request:CallbackSchema,
} as const satisfies Record<ToolName,unknown>;
export type ToolResult<N extends ToolName> = Infer<(typeof toolOutputs)[N]>;
export function parseToolResult<N extends ToolName>(name:N,value:unknown):ToolResult<N>{return toolOutputs[name].parse(value) as ToolResult<N>}
export function exportToolOutputSchemas(){return Object.fromEntries(Object.entries(toolOutputs).map(([name,schema])=>[name,schema.jsonSchema]))}
