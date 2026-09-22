export type ScheduleType = "one_time" | "weekly" | "monthly";
export type RecurrenceInput = { scheduleType: ScheduleType; timeZone: string; anchorLocal: string; after: Date };

type Wall = { year: number; month: number; day: number; hour: number; minute: number };

function parseWall(value: string): Wall {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid local schedule time.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const test = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (year < 1970 || test.getUTCFullYear() !== year || test.getUTCMonth() + 1 !== month || test.getUTCDate() !== day || hour > 23 || minute > 59) throw new Error("Invalid local schedule time.");
  return { year, month, day, hour, minute };
}

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function localParts(format: Intl.DateTimeFormat, instant: number): Wall {
  const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

function matches(a: Wall, b: Wall) {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

function resolveWall(wall: Wall, format: Intl.DateTimeFormat): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // The timezone offset may differ on either side of a DST boundary. Probe
  // both sides, then round-trip candidates through Intl before accepting one.
  const offsets = new Set([-36, -12, 12, 36].map((hours) => {
    const probe = naive + hours * 3_600_000;
    const part = localParts(format, probe);
    return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute) - probe;
  }));
  for (let shift = 0; shift <= 180; shift++) {
    const shifted = new Date(naive + shift * 60_000);
    const target: Wall = { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
    const candidates = [...offsets].map((offset) => Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute) - offset)
      .filter((instant) => matches(localParts(format, instant), target)).sort((a, b) => a - b);
    if (candidates.length) return new Date(candidates[0]);
  }
  throw new Error("No valid local time within three hours of schedule.");
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Return the next instant, strictly after `after`, preserving the anchor's wall clock. */
export function nextOccurrence({ scheduleType, timeZone, anchorLocal, after }: RecurrenceInput): Date | null {
  if (!Number.isFinite(after.getTime())) throw new Error("Invalid recurrence cursor.");
  const anchor = parseWall(anchorLocal);
  const format = formatter(timeZone);
  if (scheduleType === "one_time") {
    const occurrence = resolveWall(anchor, format);
    return occurrence > after ? occurrence : null;
  }
  if (scheduleType === "weekly") {
    const anchorDay = Date.UTC(anchor.year, anchor.month - 1, anchor.day);
    const start = Math.max(0, Math.floor((after.getTime() - anchorDay) / (7 * 86_400_000)) - 1);
    for (let index = start; index < start + 4; index++) {
      const day = new Date(anchorDay + index * 7 * 86_400_000);
      const candidate = resolveWall({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: anchor.hour, minute: anchor.minute }, format);
      if (candidate > after) return candidate;
    }
  } else if (scheduleType === "monthly") {
    const anchorMonth = anchor.year * 12 + anchor.month - 1;
    const cursor = localParts(format, after.getTime());
    const start = Math.max(0, cursor.year * 12 + cursor.month - 1 - anchorMonth - 1);
    for (let index = start; index < start + 4; index++) {
      const month = anchorMonth + index;
      const year = Math.floor(month / 12);
      const monthNumber = month % 12 + 1;
      const candidate = resolveWall({ year, month: monthNumber, day: Math.min(anchor.day, daysInMonth(year, monthNumber)), hour: anchor.hour, minute: anchor.minute }, format);
      if (candidate > after) return candidate;
    }
  } else throw new Error("Invalid recurrence type.");
  throw new Error("Could not compute next schedule occurrence.");
}
