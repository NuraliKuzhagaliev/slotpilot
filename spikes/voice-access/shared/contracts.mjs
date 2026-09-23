// Probe contracts only. Stage 1 will promote agreed schemas into src/contracts/domain.ts.
export const VEHICLE_IDS = Object.freeze(['sedan-petrol', 'crossover-petrol', 'ev-demo']);
export const getServicesParameters = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: { vehicleId: { type: 'string', enum: [...VEHICLE_IDS],
    description: 'Optional demo vehicle ID. Omit when unknown. Example: sedan-petrol.' } },
});
export const getServicesTool = Object.freeze({
  type: 'function', name: 'get_services',
  description: 'Read the demo service catalogue from the SlotPilot server. Always call this before describing prices, service durations, vehicles or compatibility. This tool cannot search slots or book a visit.',
  parameters: getServicesParameters, execution_mode: 'interactive', timeout_seconds: 20,
});
export function parseToolCall(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool call must be an object.');
  if (Object.keys(value).some(k => !['callId', 'name', 'arguments'].includes(k))) throw new Error('Unexpected tool-call field.');
  if (typeof value.callId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.callId)) throw new Error('Invalid callId.');
  if (value.name !== 'get_services') throw new Error('Only get_services is enabled in stage 0.');
  const args = value.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object.');
  if (Object.keys(args).some(k => k !== 'vehicleId')) throw new Error('Unknown argument.');
  if (args.vehicleId !== undefined && !getServicesParameters.properties.vehicleId.enum.includes(args.vehicleId))
    throw new Error('Unsupported demo vehicle.');
  return { callId: value.callId, name: value.name, arguments: { ...args } };
}
