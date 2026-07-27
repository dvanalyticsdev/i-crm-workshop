const KOLKATA_TIME_ZONE = "Asia/Kolkata";
const KOLKATA_OFFSET_SUFFIX = "+05:30";

function getFormatterParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOLKATA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
}

export function toKolkataDateKey(date = new Date()) {
  const parts = getFormatterParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseKolkataDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00${KOLKATA_OFFSET_SUFFIX}`);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getKolkataDayRange(offsetDays = 0, now = new Date()) {
  const baseDate = new Date(now.getTime() + (offsetDays * 24 * 60 * 60 * 1000));
  const dateKey = toKolkataDateKey(baseDate);
  const start = new Date(`${dateKey}T00:00:00${KOLKATA_OFFSET_SUFFIX}`);
  const end = new Date(`${dateKey}T23:59:59.999${KOLKATA_OFFSET_SUFFIX}`);
  return { start, end, dateKey };
}

export function shiftKolkataDateKey(dateKey, offsetDays = 0) {
  const base = parseKolkataDate(dateKey);
  if (!base) {
    return "";
  }
  return toKolkataDateKey(new Date(base.getTime() + (offsetDays * 24 * 60 * 60 * 1000)));
}

export function formatKolkataDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString("en-IN", {
    timeZone: KOLKATA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}
