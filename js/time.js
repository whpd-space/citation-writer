function utcDate(value) {
  if (value === null || value === undefined || value === '') return null;
  let normalized = value;
  if (typeof normalized === 'string') {
    normalized = normalized.trim();
    const hasClock = /[T ]\d{2}:\d{2}/.test(normalized);
    const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(normalized);
    if (hasClock && !hasZone) normalized = `${normalized.replace(' ', 'T')}Z`;
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoUtcDateTime(value) {
  return utcDate(value)?.toISOString() || '';
}

export function formatUtcDateTime(value) {
  const iso = isoUtcDateTime(value);
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : 'Unknown time';
}

export function formatRelativeTime(value, now = Date.now()) {
  const date = utcDate(value);
  if (!date) return 'Unknown time';
  const seconds = Math.round((date.getTime() - Number(now)) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const ranges = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
    [Infinity, 'year']
  ];
  let amount = seconds;
  for (const [limit, unit] of ranges) {
    if (Math.abs(amount) < limit) return formatter.format(Math.round(amount), unit);
    amount /= limit;
  }
  return formatter.format(Math.round(amount), 'year');
}
