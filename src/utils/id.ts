import { v5 } from '@se-oss/uuid';

import { UUID_NAMESPACES } from '../constants.js';

export async function createTrackId(
  provider: 'acrcloud' | 'audd' | 'shazam',
  sourceId: string
): Promise<string> {
  const namespace = UUID_NAMESPACES[provider];
  return v5(sourceId, namespace);
}

export function normalizeIsrc(isrc?: string | null): string | null {
  if (!isrc) return null;
  const cleaned = isrc
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

export function parseDateOnly(dateStr?: string | null): string | null {
  if (!dateStr || dateStr === 'None') return null;
  // Match YYYY-MM-DD
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
  }
  // Match year only
  const yearMatch = /^(\d{4})/.exec(dateStr);
  if (yearMatch) {
    const year = Number.parseInt(yearMatch[1], 10);
    if (year >= 1700 && year <= new Date().getFullYear()) {
      return `${year}-01-01`;
    }
  }
  return null;
}
