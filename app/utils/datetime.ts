export const getUserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

const ISO_WITHOUT_TZ_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/;
const HAS_TZ_SUFFIX_REGEX = /(z|[+-]\d{2}:\d{2}|[+-]\d{4}|utc|gmt)$/i;
const EN_AT_TIME_REGEX =
  /^([a-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i;
const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const parseAsUtcDate = (raw: string): Date | null => {
  const value = raw.trim();
  if (!value) return null;

  if (ISO_WITHOUT_TZ_REGEX.test(value)) {
    const isoLike = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(`${isoLike}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const enAtMatch = value.match(EN_AT_TIME_REGEX);
  if (enAtMatch) {
    const monthToken = enAtMatch[1].toLowerCase();
    const month = MONTHS[monthToken];
    if (month !== undefined) {
      const day = Number(enAtMatch[2]);
      const year = Number(enAtMatch[3]);
      let hour = Number(enAtMatch[4]);
      const minute = Number(enAtMatch[5]);
      const ampm = enAtMatch[6].toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      const date = new Date(Date.UTC(year, month, day, hour, minute, 0));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  if (!HAS_TZ_SUFFIX_REGEX.test(value)) {
    const withUtc = `${value} UTC`;
    const asUtc = new Date(withUtc);
    if (!Number.isNaN(asUtc.getTime())) return asUtc;
  }
  return null;
};

export const formatDateTimeForUser = (
  value?: string | number | Date | null,
  fallback = '-',
  withTimeZoneName = false
) => {
  if (value === undefined || value === null || value === '') return fallback;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? parseAsUtcDate(value) ?? new Date(value)
        : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const timeZone = getUserTimeZone();
  const formatter = withTimeZoneName
    ? new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
        timeZoneName: 'short',
      })
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      });
  return formatter.format(date);
};
