// Schedule math in the workspace timezone (no external libs).

export type ScheduleSpec = { kind: string; at_time?: string | null; day_of_week?: number | null; day_of_month?: number | null; interval_minutes?: number | null; run_at?: string | null; timezone?: string | null };

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

/** UTC Date for a wall-clock time in tz. */
export function zoned(tz: string, y: number, m: number, d: number, h: number, mi: number): Date {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    const diff = asUtc - Date.UTC(y, m - 1, d, h, mi);
    if (!diff) break;
    guess -= diff;
  }
  return new Date(guess);
}

const hm = (s?: string | null) => { const m = String(s || "09:00").match(/^(\d{1,2}):(\d{2})/); return m ? [Math.min(23, +m[1]), Math.min(59, +m[2])] : [9, 0]; };

export function nextRunAt(spec: ScheduleSpec, from = new Date()): Date | null {
  const tz = spec.timezone || "Asia/Kolkata";
  const [H, M] = hm(spec.at_time);
  const now = parts(from, tz);
  const after = (c: Date) => c.getTime() > from.getTime() + 1000;
  switch (spec.kind) {
    case "once": { const t = spec.run_at ? new Date(spec.run_at) : null; return t && after(t) ? t : null; }
    case "interval": return new Date(from.getTime() + Math.max(5, Number(spec.interval_minutes) || 60) * 60000);
    case "hourly": {
      let c = zoned(tz, now.y, now.m, now.d, now.h, M);
      if (!after(c)) c = new Date(c.getTime() + 3600000);
      return c;
    }
    case "daily": {
      for (let k = 0; k < 3; k++) { const base = new Date(Date.UTC(now.y, now.m - 1, now.d + k)); const c = zoned(tz, base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), H, M); if (after(c)) return c; }
      return null;
    }
    case "weekly": {
      const dow = Number(spec.day_of_week ?? 1);
      for (let k = 0; k < 15; k++) { const base = new Date(Date.UTC(now.y, now.m - 1, now.d + k)); if (base.getUTCDay() !== dow) continue; const c = zoned(tz, base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), H, M); if (after(c)) return c; }
      return null;
    }
    case "monthly": {
      const dom = Math.max(1, Math.min(31, Number(spec.day_of_month ?? 1)));
      for (let k = 0; k < 3; k++) {
        const y = now.y + Math.floor((now.m - 1 + k) / 12), m = ((now.m - 1 + k) % 12) + 1;
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const c = zoned(tz, y, m, Math.min(dom, last), H, M);
        if (after(c)) return c;
      }
      return null;
    }
  }
  return null;
}

/** Cron for n8n's Schedule Trigger, or null when only the ticker can run it. */
export function cronFor(spec: ScheduleSpec): string | null {
  const [H, M] = hm(spec.at_time);
  switch (spec.kind) {
    case "hourly": return `${M} * * * *`;
    case "daily": return `${M} ${H} * * *`;
    case "weekly": return `${M} ${H} * * ${Number(spec.day_of_week ?? 1)}`;
    case "monthly": return `${M} ${H} ${Math.min(28, Number(spec.day_of_month ?? 1))} * *`;
    case "interval": {
      const n = Number(spec.interval_minutes) || 60;
      if (n < 60 && 60 % n === 0) return `*/${n} * * * *`;
      if (n % 60 === 0 && 24 % (n / 60) === 0) return `0 */${n / 60} * * *`;
      return null;
    }
  }
  return null;
}

export function describeSchedule(spec: ScheduleSpec) {
  const [H, M] = hm(spec.at_time);
  const time = `${String(H).padStart(2, "0")}:${String(M).padStart(2, "0")}`;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  switch (spec.kind) {
    case "once": return `Once at ${spec.run_at}`;
    case "hourly": return `Hourly at :${String(M).padStart(2, "0")}`;
    case "daily": return `Daily at ${time}`;
    case "weekly": return `Weekly on ${days[Number(spec.day_of_week ?? 1)]} at ${time}`;
    case "monthly": return `Monthly on day ${spec.day_of_month ?? 1} at ${time}`;
    case "interval": return `Every ${spec.interval_minutes} minutes`;
  }
  return spec.kind;
}
