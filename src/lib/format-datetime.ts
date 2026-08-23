// Saudi Arabia is UTC+3 year-round (no DST), so a fixed offset is a correct,
// dependency-free way to render a server-generated UTC timestamp as Saudi
// local time -- unlike `Intl.DateTimeFormat` with a named zone, this doesn't
// depend on the runtime (server or browser) having full ICU timezone data,
// which isn't guaranteed in every serverless/edge environment.
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

function toRiyadh(input: Date | string): Date {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Date(date.getTime() + RIYADH_OFFSET_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatRiyadhDateTime(input: Date | string): string {
  const r = toRiyadh(input);
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())} ${pad(r.getUTCHours())}:${pad(r.getUTCMinutes())}:${pad(r.getUTCSeconds())}`;
}

export function formatRiyadhDate(input: Date | string): string {
  const r = toRiyadh(input);
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
}
