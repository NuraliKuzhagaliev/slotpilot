/** IN-MEMORY FIXTURE ONLY. This does not seed or mutate a PostgreSQL database. */
import { SERVICE_IDS, VEHICLE_IDS, type Dataset, type Service, type ResourceReservation } from '../../contracts/domain.ts';
import { horizonDates, localToIso } from '../domain/time.ts';
import { validateDataset } from '../domain/dataset.ts';
export function makeDemoDataset(now: string): Dataset {
  const hours = { open: '09:00', close: '18:00' };
  const services: Service[] = [
    { id: 'oil-change', name: 'Oil change', durationMinutes: 30, priceKzt: 15000, vehicleIds: ['sedan-petrol', 'crossover-petrol'] },
    { id: 'brake-check', name: 'Brake inspection', durationMinutes: 45, priceKzt: 10000, vehicleIds: [...VEHICLE_IDS] },
    { id: 'diagnostics', name: 'Computer diagnostics', durationMinutes: 30, priceKzt: 12000, vehicleIds: [...VEHICLE_IDS] },
    { id: 'tire-service', name: 'Tire service', durationMinutes: 45, priceKzt: 20000, vehicleIds: [...VEHICLE_IDS] },
  ];
  const branches: Dataset['branches'] = [
    { id: 'centre', name: 'Centre', timeZone: 'Asia/Almaty', workingHours: hours },
    { id: 'north', name: 'North', timeZone: 'Asia/Almaty', workingHours: hours },
  ];
  const technicians = branches.flatMap(branch => [
    { id: `${branch.id}-universal-tech`, branchId: branch.id, name: `${branch.name} · universal technician`, serviceIds: [...SERVICE_IDS], workingHours: hours },
    { id: `${branch.id}-tyre-tech`, branchId: branch.id, name: `${branch.name} · tyre technician`, serviceIds: ['tire-service'] as Service['id'][], workingHours: hours },
  ]);
  const bays = branches.flatMap(branch => [
    { id: `${branch.id}-universal-bay`, branchId: branch.id, name: `${branch.name} · universal bay`, serviceIds: [...SERVICE_IDS], workingHours: hours },
    { id: `${branch.id}-tyre-bay`, branchId: branch.id, name: `${branch.name} · tyre bay`, serviceIds: ['tire-service'] as Service['id'][], workingHours: hours },
  ]);
  const reservations: ResourceReservation[] = [];
  for (const date of horizonDates(now)) {
    for (const branch of branches) {
      for (const kind of ['technician', 'bay'] as const) {
        const suffix = kind === 'technician' ? 'tech' : 'bay';
        reservations.push({ id: `fixture-${date}-${branch.id}-${suffix}`, resourceKind: kind,
          resourceId: `${branch.id}-universal-${suffix}`, startAt: localToIso(date, '09:00'),
          endAt: localToIso(date, branch.id === 'centre' ? '15:00' : '14:00'), status: 'active' });
      }
    }
  }
  return validateDataset({ demoData: true, calendarRevision: 1, branches, services, technicians, bays, reservations,
    vehicles: [{ id: 'sedan-petrol', name: 'Demo petrol sedan' }, { id: 'crossover-petrol', name: 'Demo petrol crossover' },
      { id: 'ev-demo', name: 'Demo electric vehicle' }] });
}
