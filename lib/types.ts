// ---- OpenF1 API shapes (only the fields we use) ----
export interface Of1Session {
  session_key: number;
  session_name: string;
  session_type: string;
  year: number;
  date_start: string;
  circuit_short_name: string;
  location: string;
  country_name: string;
}
export interface Of1Driver {
  driver_number: number;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string | null;
}
export interface Of1Lap {
  driver_number: number;
  lap_number: number;
  date_start: string | null;
  lap_duration: number | null;
  is_pit_out_lap: boolean;
}
export interface Of1Car {
  date: string;
  driver_number: number;
  speed: number;
  throttle: number;
  brake: number;
  n_gear: number;
  rpm: number;
  drs: number;
}
export interface Of1Loc {
  date: string;
  driver_number: number;
  x: number;
  y: number;
  z: number;
}

// ---- internal model ----
export interface Sample {
  t: number; // seconds from lap start
  x: number;
  y: number;
  d: number; // metres travelled
  speed: number;
  throttle: number;
  brake: number; // 0 or 1
  gear: number;
  rpm: number;
  drs: number; // 0 or 1
}
export interface DriverMeta {
  number: number;
  code: string;
  name: string;
  team: string;
  colour: string;
}
export interface DriverModel extends DriverMeta {
  lap: number;
  lapTime: number;
  samples: Sample[];
  joined: number;
  within: number;
}
export interface Model {
  drivers: DriverModel[];
  track: [number, number][];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  maxT: number;
  trackLen: number;
  sourceLabel: string;
  online: boolean;
}
export interface OfflineSample {
  meta: { source: string; session_key: number; session: string; circuit: string; note: string };
  driver: { code: string; name: string; number: number; team: string; colour: string; lap: number; lapTime: number };
  samples: Sample[];
}
