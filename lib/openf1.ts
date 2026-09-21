import type { Of1Session, Of1Driver, Of1Lap, Of1Car, Of1Loc } from "./types";

// Everything is routed through our serverless proxy (/api/f1), which forwards to
// OpenF1 server-side and caches the response. The client never hits OpenF1 directly.
const proxied = (path: string) =>
  "/api/f1?u=" + encodeURIComponent("https://api.openf1.org" + path);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// OpenF1 occasionally 404s/errors transiently even for data that exists;
// a short retry with backoff clears most of these without user intervention.
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;

async function get<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * 2 ** (attempt - 1));
    try {
      const res = await fetch(proxied(path));
      if (res.ok) return (await res.json()) as T;
      lastErr = new Error(`HTTP ${res.status} for ${path}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
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
