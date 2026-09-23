import { VEHICLE_IDS } from './shared/contracts.mjs';
const services = [
  { id: 'oil-change', name: 'Oil change', durationMinutes: 30, priceKzt: 15000, vehicleIds: ['sedan-petrol', 'crossover-petrol'] },
  { id: 'brake-check', name: 'Brake inspection', durationMinutes: 45, priceKzt: 10000, vehicleIds: [...VEHICLE_IDS] },
  { id: 'diagnostics', name: 'Computer diagnostics', durationMinutes: 30, priceKzt: 12000, vehicleIds: [...VEHICLE_IDS] },
  { id: 'tire-service', name: 'Tire service', durationMinutes: 45, priceKzt: 20000, vehicleIds: [...VEHICLE_IDS] },
];
const vehicles = [
  { id: 'sedan-petrol', name: 'Demo petrol sedan' },
  { id: 'crossover-petrol', name: 'Demo petrol crossover' },
  { id: 'ev-demo', name: 'Demo electric vehicle' },
];
export function getServices(vehicleId) {
  return structuredClone({
    demoData: true, currency: 'KZT', timeZone: 'Asia/Almaty', vehicles,
    services: services.filter(service => !vehicleId || service.vehicleIds.includes(vehicleId)),
    rules: { maxServicesPerVisit: 3, visitBufferMinutes: 15, consumablesIncludedInPrice: true,
      schedulingEnabled: false,
      disclaimer: 'Fictional demonstration data. No slot availability or booking is provided by this access probe. Diagnostics reserves investigation time, not a promise to repair.' },
  });
}
export function branchNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}`, timeZone: 'Asia/Almaty', serverTime: now.toISOString() };
}
