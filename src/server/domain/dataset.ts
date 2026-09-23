import { DatasetSchema, type Dataset } from '../../contracts/domain.ts';
import { DomainError } from './errors.ts';
import { minutes } from './time.ts';
/** Runtime validation of internal seed/load boundaries, not just API inputs. */
export function validateDataset(input: unknown): Dataset {
  const data = DatasetSchema.parse(input);
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  for (const items of [data.branches, data.technicians, data.bays, data.services, data.vehicles, data.reservations])
    if (!unique(items.map(item => item.id))) throw new DomainError('VALIDATION_ERROR', 'Duplicate dataset identifier.');
  const branchIds = new Set(data.branches.map(branch => branch.id));
  const vehicleIds = new Set(data.vehicles.map(vehicle => vehicle.id));
  const serviceIds = new Set(data.services.map(service => service.id));
  for (const item of [...data.branches, ...data.technicians, ...data.bays]) {
    if (minutes(item.workingHours.open) >= minutes(item.workingHours.close))
      throw new DomainError('VALIDATION_ERROR', 'Working hours must end after they start.');
  }
  for (const branch of data.branches) {
    if (data.technicians.filter(item => item.branchId === branch.id).length !== 2
      || data.bays.filter(item => item.branchId === branch.id).length !== 2)
      throw new DomainError('VALIDATION_ERROR', 'Demo requires two technicians and two bays per branch.');
  }
  for (const resource of [...data.technicians, ...data.bays]) {
    if (!branchIds.has(resource.branchId) || resource.serviceIds.some(id => !serviceIds.has(id)))
      throw new DomainError('VALIDATION_ERROR', 'Invalid resource reference.');
  }
  for (const service of data.services) {
    if (service.vehicleIds.some(id => !vehicleIds.has(id))) throw new DomainError('VALIDATION_ERROR', 'Invalid vehicle reference.');
  }
  for (const reservation of data.reservations) {
    const resources = reservation.resourceKind === 'technician' ? data.technicians : data.bays;
    if (!resources.some(resource => resource.id === reservation.resourceId)
      || Date.parse(reservation.endAt) <= Date.parse(reservation.startAt))
      throw new DomainError('VALIDATION_ERROR', 'Invalid reservation resource or interval.');
  }
  return data;
}
