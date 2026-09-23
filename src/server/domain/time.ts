import { DateSchema, TimeSchema, InstantSchema, RULES } from '../../contracts/domain.ts';
import { DomainError } from './errors.ts';
const defaultFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: RULES.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function localParts(now: string, timeZone: string = RULES.timeZone): { date: string; time: string } {
  InstantSchema.parse(now);
  const formatter = timeZone === RULES.timeZone ? defaultFormatter : new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = formatter.formatToParts(new Date(now));
  const get = (name: string): string => parts.find(part => part.type === name)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
export function addDays(date: string, days: number): string {
  DateSchema.parse(date);
  if (!Number.isInteger(days)) throw new DomainError('VALIDATION_ERROR', 'Day offset must be an integer.');
  const instant = new Date(`${date}T00:00:00.000Z`); instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}
export function horizonDates(now: string): string[] {
  const today = localParts(now).date;
  return Array.from({ length: RULES.horizonDays }, (_, offset) => addDays(today, offset));
}
export function minutes(time: string): number {
  TimeSchema.parse(time); return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
export function timeOfDay(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= 1440) throw new DomainError('VALIDATION_ERROR', 'Invalid minute of day.');
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
/** Uses IANA conversion, never the laptop zone or a hard-coded +05:00. */
export function localToIso(date: string, time: string, timeZone: string = RULES.timeZone): string {
  DateSchema.parse(date); TimeSchema.parse(time);
  const target = Date.parse(`${date}T${time}:00.000Z`); let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const visible = localParts(new Date(guess).toISOString(), timeZone);
    const difference = target - Date.parse(`${visible.date}T${visible.time}:00.000Z`);
    if (difference === 0) return new Date(guess).toISOString();
    guess += difference;
  }
  throw new DomainError('VALIDATION_ERROR', 'Local date and time do not resolve in the branch time zone.');
}
export function addMinutes(instant: string, duration: number): string {
  InstantSchema.parse(instant);
  if (!Number.isFinite(duration)) throw new DomainError('VALIDATION_ERROR', 'Invalid duration.');
  return new Date(Date.parse(instant) + duration * 60_000).toISOString();
}
export function overlaps(start: string, end: string, otherStart: string, otherEnd: string): boolean {
  return Date.parse(start) < Date.parse(otherEnd) && Date.parse(otherStart) < Date.parse(end);
}
