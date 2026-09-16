import type { Of1Session, Of1Driver, Of1Lap, Of1Car, Of1Loc } from "./types";

// Everything is routed through our serverless proxy (/api/f1), which forwards to
// OpenF1 server-side and caches the response. The client never hits OpenF1 directly.
const proxied = (path: string) =>
  "/api/f1?u=" + encodeURIComponent("https://api.openf1.org" + path);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(proxied(path));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export const getSessions = (year: number) =>
  get<Of1Session[]>(`/v1/sessions?year=${year}`);

export const getDrivers = (sessionKey: number | string) =>
  get<Of1Driver[]>(`/v1/drivers?session_key=${sessionKey}`);

export const getLaps = (sessionKey: number | string) =>
  get<Of1Lap[]>(`/v1/laps?session_key=${sessionKey}`);

export const getCarData = (
  sessionKey: number | string,
  driverNumber: number,
  iso0: string,
  iso1: string
) =>
  get<Of1Car[]>(
    `/v1/car_data?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${iso0}&date<=${iso1}`
  );

export const getLocation = (
  sessionKey: number | string,
  driverNumber: number,
  iso0: string,
  iso1: string
) =>
  get<Of1Loc[]>(
    `/v1/location?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${iso0}&date<=${iso1}`
  );
