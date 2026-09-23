import { writeFile, mkdir } from 'node:fs/promises';
import { exportToolInputSchemas, parseToolArguments } from '../src/contracts/tools.ts';
import * as domain from '../src/contracts/domain.ts';
import * as app from '../src/contracts/app.ts';
import { exportToolOutputSchemas } from '../src/contracts/tool-outputs.ts';
const samples = {
  get_services: [{}, { vehicleId: 'sedan-petrol' }, { vehicleId: 'unknown' }, { userId: 'fake' }],
  update_request: [{ patch: {}, expectedRequestVersion: 1 }, { patch: { maxBudgetKzt: null }, expectedRequestVersion: 1 },
    { patch: { maxBudgetKzt: 1.5 }, expectedRequestVersion: 1 }, { patch: {}, expectedRequestVersion: 0 },
    { patch: { allowedDates: ['2026-02-30'] }, expectedRequestVersion: 1 },
    { patch: { serviceIds: ['oil-change', 'oil-change'] }, expectedRequestVersion: 1 },
    { patch: {}, expectedRequestVersion: 1, role: 'admin' }],
  find_options: [{ expectedRequestVersion: 1 }, {}, { expectedRequestVersion: '1' }],
  prepare_booking: [{ optionId: 'opt', expectedRequestVersion: 1 }, { optionId: 'opt' }],
  confirm_booking: [{ actionId: 'act', confirmationRef: 'ref' }, { actionId: 'act', confirmed: true }],
  get_booking: [{ actionId: 'act' }, { bookingId: 'b' }, {}, { actionId: 'a', bookingId: 'b' }],
  prepare_change: [{ changeType: 'cancel', bookingId: 'b', expectedBookingVersion: 1 },
    { changeType: 'reschedule', bookingId: 'b', expectedBookingVersion: 1, optionId: 'o', expectedRequestVersion: 2 },
    { changeType: 'reschedule', bookingId: 'b', expectedBookingVersion: 1 },
    { changeType: 'cancel', bookingId: 'b', expectedBookingVersion: 1, optionId: 'o' }],
  reschedule_booking: [{ actionId: 'a', confirmationRef: 'r' }, { actionId: 'a' }],
  cancel_booking: [{ actionId: 'a', confirmationRef: 'r' }, { actionId: 'a', confirmed: true }],
  create_callback_request: [{ reason: 'Need a human', expectedRequestVersion: 1 }, { reason: '', expectedRequestVersion: 1 }],
};
const corpus = Object.entries(samples).flatMap(([name, entries]) => entries.map(value => {
  let accepted = true; try { parseToolArguments(name, value); } catch { accepted = false; }
  return { name, value, accepted };
}));
const models = Object.fromEntries(Object.entries(domain).filter(([name, value]) => name.endsWith('Schema') && value?.jsonSchema)
  .map(([name, value]) => [name, value.jsonSchema]));
await mkdir(new URL('../docs/stage1a/', import.meta.url), { recursive: true });
for (const [name, value] of [['tool-input-schemas.json', exportToolInputSchemas()], ['domain-schemas.json', models], ['contract-corpus.json', corpus]])
  await writeFile(new URL(`../docs/stage1a/${name}`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
console.log(`Exported ${Object.keys(models).length} domain schemas, 10 tool input schemas and ${corpus.length} runtime examples.`);
await mkdir(new URL('../docs/stage2/', import.meta.url), { recursive: true });
const appModels=Object.fromEntries(Object.entries(app).filter(([name,value])=>name.endsWith('Schema')&&value?.jsonSchema).map(([name,value])=>[name,value.jsonSchema]));
for (const [name,value] of [['app-schemas.json',appModels],['tool-output-schemas.json',exportToolOutputSchemas()]])
  await writeFile(new URL(`../docs/stage2/${name}`,import.meta.url),JSON.stringify(value,null,2)+'\n');
console.log(`Exported ${Object.keys(appModels).length} application schemas and 10 tool output schemas.`);
