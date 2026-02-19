import { KST_OFFSET_HOURS } from '../config/digest.constants';

export function parseDateToIso(value: string): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString();
}

export function computeAgeHours(iso: string): number | null {
  if (!iso) {
    return null;
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const deltaMs = Date.now() - parsed.getTime();
  return deltaMs / (1000 * 60 * 60);
}

export function getKstNow(): Date {
  const now = new Date();
  const kstShiftMinutes = KST_OFFSET_HOURS * 60 + now.getTimezoneOffset();
  return new Date(now.getTime() + kstShiftMinutes * 60 * 1000);
}

export function formatDateYYYYMMDD(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatKstIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${ms}+09:00`;
}
