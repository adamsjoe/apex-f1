import type {
  Of1Car,
  Of1Loc,
  Of1Lap,
  Sample,
  DriverMeta,
  DriverModel,
  Model,
  OfflineSample,
} from "./types";

export const JOIN_TOL_MS = 500;

/** Fastest timed, non-pit-out lap for a driver, or null. */
export function fastestLap(laps: Of1Lap[], driverNumber: number): Of1Lap | null {
  const valid = laps.filter(
    (l) =>
      l.driver_number === driverNumber &&
      l.lap_duration != null &&
      l.date_start != null &&
      !l.is_pit_out_lap
  );
  if (!valid.length) return null;
  return valid.reduce((a, b) => (a.lap_duration! < b.lap_duration! ? a : b));
}

/** Join location (X/Y) onto car_data by nearest timestamp, then compute distance. */
export function buildDriverModel(
  car: Of1Car[],
  loc: Of1Loc[],
  lap: Of1Lap,
  meta: DriverMeta
): DriverModel {
  const c = car
    .map((p) => ({ ...p, _t: Date.parse(p.date) }))
    .sort((a, b) => a._t - b._t);
  const l = loc
    .map((p) => ({ ...p, _t: Date.parse(p.date) }))
    .filter((p) => !(p.x === 0 && p.y === 0))
    .sort((a, b) => a._t - b._t);

  let j = 0;
  const samples: Sample[] = [];
  let joined = 0;
  let within = 0;
  const t0 = c.length ? c[0]._t : 0;

  for (const cp of c) {
    while (j < l.length - 1 && Math.abs(l[j + 1]._t - cp._t) <= Math.abs(l[j]._t - cp._t)) j++;
    const lp = l[j];
    if (!lp) continue;
    joined++;
    const dt = Math.abs(lp._t - cp._t);
    if (dt > JOIN_TOL_MS) continue;
    within++;
    samples.push({
      t: (cp._t - t0) / 1000,
      x: lp.x,
      y: lp.y,
      z: lp.z,
      d: 0,
      speed: cp.speed,
      throttle: cp.throttle,
      brake: cp.brake > 0 ? 1 : 0,
      gear: cp.n_gear,
      rpm: cp.rpm,
      drs: cp.drs >= 10 ? 1 : 0,
    });
  }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    b.d = a.d + Math.hypot((b.x - a.x) / 10, (b.y - a.y) / 10);
  }
  return { ...meta, lap: lap.lap_number, lapTime: lap.lap_duration!, samples, joined, within };
}

export function finaliseModel(
  drivers: DriverModel[],
  sourceLabel: string,
  online: boolean
): Model {
  const track = drivers
    .reduce((a, b) => (a.samples.length >= b.samples.length ? a : b))
    .samples.map((p) => [p.x, p.y, p.z] as [number, number, number]);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const d of drivers)
    for (const p of d.samples) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

  const maxT = Math.max(
    ...drivers.map((d) => d.lapTime || d.samples[d.samples.length - 1].t)
  );
  const trackLen = Math.max(...drivers.map((d) => d.samples[d.samples.length - 1].d));
  return { drivers, track, bounds: { minX, maxX, minY, maxY, minZ, maxZ }, maxT, trackLen, sourceLabel, online };
}

export function fromOffline(s: OfflineSample): Model {
  const dm: DriverModel = {
    number: s.driver.number,
    code: s.driver.code,
    name: s.driver.name,
    team: s.driver.team,
    colour: s.driver.colour,
    lap: s.driver.lap,
    lapTime: s.driver.lapTime,
    samples: s.samples.map((p) => ({ ...p, z: 0 })),
    joined: s.samples.length,
    within: s.samples.length,
  };
  return finaliseModel([dm], `${s.meta.source} · ${s.meta.session} (bundled)`, false);
}

// ---- interpolation ----
export function indexAtT(s: Sample[], t: number): number {
  let lo = 0, hi = s.length - 1;
  if (t <= s[0].t) return 0;
  if (t >= s[hi].t) return Math.max(0, hi - 1);
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s[m].t < t) lo = m + 1;
    else hi = m;
  }
  return Math.max(0, lo - 1);
}

function cm(p0: number, p1: number, p2: number, p3: number, f: number): number {
  const f2 = f * f, f3 = f2 * f;
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
}

export interface SamplePt extends Sample {
  done: boolean;
}

export function sampleAt(d: DriverModel, t: number): SamplePt {
  const s = d.samples;
  const end = d.lapTime || s[s.length - 1].t;
  const done = t >= end;
  const tt = done ? end : t;
  const i = indexAtT(s, tt);
  const a = s[i], b = s[i + 1];
  const f = (tt - a.t) / ((b.t - a.t) || 1);
  const p0 = s[Math.max(0, i - 1)], p3 = s[Math.min(s.length - 1, i + 2)];
  return {
    t: tt,
    x: cm(p0.x, a.x, b.x, p3.x, f),
    y: cm(p0.y, a.y, b.y, p3.y, f),
    z: cm(p0.z, a.z, b.z, p3.z, f),
    d: a.d + (b.d - a.d) * f,
    speed: a.speed + (b.speed - a.speed) * f,
    throttle: a.throttle + (b.throttle - a.throttle) * f,
    brake: f < 0.5 ? a.brake : b.brake,
    gear: f < 0.5 ? a.gear : b.gear,
    rpm: a.rpm + (b.rpm - a.rpm) * f,
    drs: f < 0.5 ? a.drs : b.drs,
    done,
  };
}

export function tAtDistance(d: DriverModel, dist: number): number {
  const s = d.samples;
  if (dist <= s[0].d) return s[0].t;
  if (dist >= s[s.length - 1].d) return s[s.length - 1].t;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s[m].d < dist) lo = m + 1;
    else hi = m;
  }
  const b = s[lo], a = s[lo - 1] || b;
  const f = (dist - a.d) / ((b.d - a.d) || 1);
  return a.t + (b.t - a.t) * f;
}
