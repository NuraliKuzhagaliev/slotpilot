/** Canonical product contracts. Probe-only legacy schemas stay isolated in spikes/.
 * All public types and tool JSON schemas derive from these runtime schemas.
 */
import { v, type Infer } from './schema.ts';
export { ContractError } from './schema.ts';
export const RULES = Object.freeze({ currency: 'KZT', timeZone: 'Asia/Almaty', visitBufferMinutes: 15,
  slotStepMinutes: 15, maxServicesPerVisit: 3, horizonDays: 7, optionTtlSeconds: 120, maxOptions: 3 } as const);
export const SERVICE_IDS = ['oil-change', 'brake-check', 'diagnostics', 'tire-service'] as const;
export const VEHICLE_IDS = ['sedan-petrol', 'crossover-petrol', 'ev-demo'] as const;
export const BRANCH_IDS = ['centre', 'north'] as const;
export const IdSchema = v.string({ min: 1, max: 200, pattern: '^[A-Za-z0-9_.:-]+$' });
export const ServiceIdSchema = v.enum(SERVICE_IDS);
export const VehicleIdSchema = v.enum(VEHICLE_IDS);
export const BranchIdSchema = v.enum(BRANCH_IDS);
export const TimeSchema = v.string({ min: 5, max: 5, pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' });
export const DateSchema = v.string({ min: 10, max: 10, pattern: '^\\d{4}-\\d{2}-\\d{2}$', format: 'date',
  check: value => { const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; } });
export const InstantSchema = v.string({ min: 20, max: 35, format: 'date-time',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.\\d{1,3})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$',
  check: value => { try { DateSchema.parse(value.slice(0, 10)); return Number.isFinite(Date.parse(value)); } catch { return false; } } });
const HoursSchema = v.object({ open: TimeSchema, close: TimeSchema });
export const BranchSchema = v.object({ id: BranchIdSchema, name: v.string({ min: 1, max: 80 }),
  timeZone: v.literal(RULES.timeZone), workingHours: HoursSchema });
export const ServiceSchema = v.object({ id: ServiceIdSchema, name: v.string({ min: 1, max: 80 }),
  durationMinutes: v.int(1, 600), priceKzt: v.int(0, 1_000_000_000),
  vehicleIds: v.array(VehicleIdSchema, { min: 1, max: 3, unique: true }) });
export const DemoVehicleSchema = v.object({ id: VehicleIdSchema, name: v.string({ min: 1, max: 80 }) });
const resourceFields = { id: IdSchema, branchId: BranchIdSchema, name: v.string({ min: 1, max: 80 }),
  serviceIds: v.array(ServiceIdSchema, { min: 1, max: 4, unique: true }), workingHours: HoursSchema };
export const TechnicianSchema = v.object(resourceFields);
export const BaySchema = v.object(resourceFields);
const serviceList = v.array(ServiceIdSchema, { max: RULES.maxServicesPerVisit, unique: true });
const fields = {
  serviceIds: serviceList,
  vehicleId: v.nullable(VehicleIdSchema),
  allowedDates: v.nullable(v.array(DateSchema, { min: 1, max: RULES.horizonDays, unique: true })),
  arrivalNotBefore: v.nullable(TimeSchema), readyNoLaterThan: v.nullable(TimeSchema),
  maxBudgetKzt: v.nullable(v.int(0, 3_000_000_000)),
  allowedBranchIds: v.nullable(v.array(BranchIdSchema, { min: 1, max: 2, unique: true })),
  preferredBranchId: v.nullable(BranchIdSchema), rankingPreference: v.enum(['earliest_ready', 'cheapest']),
};
export const CustomerConstraintsSchema = v.object(fields);
export const RequestPatchSchema = v.object({
  serviceIds: v.optional(fields.serviceIds), addServiceIds: v.optional(serviceList), removeServiceIds: v.optional(serviceList),
  vehicleId: v.optional(fields.vehicleId), allowedDates: v.optional(fields.allowedDates),
  arrivalNotBefore: v.optional(fields.arrivalNotBefore), readyNoLaterThan: v.optional(fields.readyNoLaterThan),
  maxBudgetKzt: v.optional(fields.maxBudgetKzt), allowedBranchIds: v.optional(fields.allowedBranchIds),
  preferredBranchId: v.optional(fields.preferredBranchId), rankingPreference: v.optional(fields.rankingPreference),
});
export const ResourceReservationSchema = v.object({ id: IdSchema, resourceId: IdSchema,
  resourceKind: v.enum(['technician', 'bay']), startAt: InstantSchema, endAt: InstantSchema,
  status: v.enum(['active', 'cancelled']) });
export const PartRuleSchema = v.object({ branchId: BranchIdSchema, vehicleId: VehicleIdSchema, availableFrom: v.nullable(DateSchema) });
export const DatasetSchema = v.object({ demoData: v.literal(true), calendarRevision: v.int(1),
  branches: v.array(BranchSchema, { min: 2, max: 2 }), services: v.array(ServiceSchema, { min: 4, max: 4 }),
  vehicles: v.array(DemoVehicleSchema, { min: 2, max: 3 }), technicians: v.array(TechnicianSchema, { min: 4, max: 4 }),
  bays: v.array(BaySchema, { min: 4, max: 4 }), reservations: v.array(ResourceReservationSchema, { max: 2000 }), parts: v.optional(v.array(PartRuleSchema, { max: 6 })) });
export const ErrorCodeSchema = v.enum(['VALIDATION_ERROR', 'STALE_REQUEST', 'OPTION_EXPIRED', 'SLOT_CONFLICT',
  'NO_OPTIONS', 'BUDGET_EXCEEDED', 'PART_UNAVAILABLE', 'NOT_AUTHORIZED', 'OPERATION_PENDING', 'INTERNAL_ERROR',
  'MISSING_FIELDS', 'VEHICLE_UNSUPPORTED', 'NO_COMPATIBLE_TECHNICIAN', 'NO_COMPATIBLE_BAY',
  'TECHNICIAN_BUSY', 'BAY_BUSY', 'OUTSIDE_HOURS', 'BEFORE_ARRIVAL', 'AFTER_DEADLINE',
  'OUTSIDE_HORIZON', 'PAST_TIME', 'REQUEST_CLOSED', 'BRANCH_NOT_ALLOWED', 'DATE_NOT_ALLOWED',
  'STALE_BOOKING', 'CONFIRMATION_REQUIRED', 'SETUP_REQUIRED', 'DATABASE_UNAVAILABLE', 'RATE_LIMIT',
  'KEY_NOT_CONFIGURED', 'PROVIDER_ACCESS_DENIED', 'PROVIDER_ERROR', 'PROVIDER_UNREACHABLE', 'VOICE_LIMIT']);
export const ReasonSchema = v.object({ code: ErrorCodeSchema, message: v.string({ min: 1, max: 500 }) });
const visitFields = { branchId: BranchIdSchema, date: DateSchema, startAt: InstantSchema, readyAt: InstantSchema,
  timeZone: v.literal(RULES.timeZone), serviceIds: v.array(ServiceIdSchema, { min: 1, max: 3, unique: true }),
  vehicleId: VehicleIdSchema, totalPriceKzt: v.int(0, 3_000_000_000), totalDurationMinutes: v.int(1, 1815),
  currency: v.literal('KZT') };
export const VisitPreviewSchema = v.object(visitFields);
export const SlotOptionSchema = v.object({ ...visitFields, optionId: IdSchema, requestId: IdSchema,
  requestVersion: v.int(1), calendarRevision: v.int(1), technicianId: IdSchema, bayId: IdSchema,
  expiresAt: InstantSchema, explanations: v.array(v.string({ min: 1, max: 500 }), { min: 1, max: 8 }) });
export const PreparedActionSchema = v.object({ actionId: IdSchema, requestId: IdSchema,
  actionType: v.enum(['create', 'reschedule', 'cancel']), requestVersion: v.int(1),
  expectedBookingVersion: v.nullable(v.int(1)), bookingId: v.nullable(IdSchema),
  snapshot: SlotOptionSchema, createdAt: InstantSchema, expiresAt: InstantSchema });
export const BookingRequestSchema = v.object({ requestId: IdSchema, ownerId: IdSchema, namespace: IdSchema,
  requestVersion: v.int(1), stateRevision: v.int(0), constraints: CustomerConstraintsSchema,
  stage: v.enum(['collecting', 'searching', 'offered', 'awaiting_confirmation', 'executing', 'booked', 'reconciling']),
  options: v.array(SlotOptionSchema, { max: 3 }), preparedAction: v.nullable(PreparedActionSchema),
  bookingId: v.nullable(IdSchema) });
export const RelaxationSchema = v.object({ kind: v.enum(['another_branch', 'another_day', 'later_ready', 'larger_budget', 'fewer_services']),
  message: v.string({ min: 1, max: 500 }), requiresNewConsent: v.literal(true), patch: RequestPatchSchema,
  preview: VisitPreviewSchema });
export const SearchResultSchema = v.object({ requestId: IdSchema, requestVersion: v.int(1), sourceStateRevision: v.int(0),
  calendarRevision: v.int(1), computedAt: InstantSchema, status: v.enum(['ok', 'no_options']),
  options: v.array(SlotOptionSchema, { max: 3 }), reasons: v.array(ReasonSchema, { max: 30 }),
  relaxations: v.array(RelaxationSchema, { max: 3 }) });
export const ActorSchema = v.object({ userId: IdSchema, role: v.enum(['client', 'admin']) });
export const PreviousOptionComparisonSchema = v.object({ previousOptionId: IdSchema, stillFits: v.boolean(),
  newReadyAt: v.nullable(InstantSchema), totalDurationMinutes: v.nullable(v.int(1)),
  totalPriceKzt: v.nullable(v.int(0)), reasons: v.array(ReasonSchema, { max: 30 }) });
export type Branch = Infer<typeof BranchSchema>;
export type Service = Infer<typeof ServiceSchema>;
export type DemoVehicle = Infer<typeof DemoVehicleSchema>;
export type Technician = Infer<typeof TechnicianSchema>;
export type Bay = Infer<typeof BaySchema>;
export type CustomerConstraints = Infer<typeof CustomerConstraintsSchema>;
export type RequestPatch = Infer<typeof RequestPatchSchema>;
export type ResourceReservation = Infer<typeof ResourceReservationSchema>;
export type Dataset = Infer<typeof DatasetSchema>;
export type SlotOption = Infer<typeof SlotOptionSchema>;
export type VisitPreview = Infer<typeof VisitPreviewSchema>;
export type PreparedAction = Infer<typeof PreparedActionSchema>;
export type BookingRequest = Infer<typeof BookingRequestSchema>;
export type SearchResult = Infer<typeof SearchResultSchema>;
export type Relaxation = Infer<typeof RelaxationSchema>;
export type Reason = Infer<typeof ReasonSchema>;
export type ErrorCode = Infer<typeof ErrorCodeSchema>;
export type Actor = Infer<typeof ActorSchema>;
export type PreviousOptionComparison = Infer<typeof PreviousOptionComparisonSchema>;
