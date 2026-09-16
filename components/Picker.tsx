"use client";

import { useEffect, useState } from "react";
import { getSessions, getDrivers, getLaps, getCarData, getLocation } from "@/lib/openf1";
import { fastestLap, buildDriverModel, finaliseModel, fromOffline } from "@/lib/pipeline";
import { OFFLINE_SAMPLE } from "@/lib/sample";
import type { Model, DriverMeta, DriverModel, Of1Session, Of1Driver } from "@/lib/types";

interface Props {
  onLoading: () => void;
  onModel: (m: Model) => void;
  onError: (title: string, msg: string) => void;
}

const FIRST_YEAR = 2023; // OpenF1 data starts here

function metaOf(d: Of1Driver): DriverMeta {
  return {
    number: d.driver_number,
    code: d.name_acronym || String(d.driver_number),
    name: d.full_name || "",
    team: d.team_name || "",
    colour: d.team_colour ? "#" + d.team_colour : "#cccccc",
  };
}

export default function Picker({ onLoading, onModel, onError }: Props) {
  const years = (() => {
    const now = new Date().getFullYear();
    const ys: number[] = [];
    for (let y = now; y >= FIRST_YEAR; y--) ys.push(y);
    return ys;
  })();

  const [year, setYear] = useState<number>(years[0]);
  const [sessions, setSessions] = useState<Of1Session[]>([]);
  const [sessionKey, setSessionKey] = useState<string>("");
  const [drivers, setDrivers] = useState<Of1Driver[]>([]);
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [busy, setBusy] = useState(false);

  // year -> sessions
  useEffect(() => {
    let cancelled = false;
    setLoadingSessions(true);
    setSessions([]);
    setSessionKey("");
    setDrivers([]);
    (async () => {
      try {
        const s = await getSessions(year);
        if (cancelled) return;
        s.sort((x, y2) => (y2.date_start || "").localeCompare(x.date_start || ""));
        setSessions(s);
        setSessionKey(s.length ? String(s[0].session_key) : "");
      } catch {
        if (!cancelled) {
          setSessions([]);
          onError(
            "Can't reach OpenF1",
            "The session list didn't load. In local dev use `npm run dev` (the /api/f1 route runs there), or try the offline demo."
          );
        }
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  // session -> drivers
  useEffect(() => {
    if (!sessionKey) {
      setDrivers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ds = await getDrivers(sessionKey);
        if (cancelled) return;
        setDrivers(ds);
        if (ds.length) {
          setA(String(ds[0].driver_number));
          setB(String(ds[Math.min(1, ds.length - 1)].driver_number));
        }
      } catch {
        if (!cancelled) setDrivers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  async function compare() {
    if (a === b) {
      onError("Pick two different drivers", "Choose two distinct drivers to compare their fastest laps.");
      return;
    }
    const mA = drivers.find((d) => String(d.driver_number) === a);
    const mB = drivers.find((d) => String(d.driver_number) === b);
    if (!mA || !mB) return;
    setBusy(true);
    onLoading();
    try {
      const laps = await getLaps(sessionKey);
      const built: DriverModel[] = [];
      for (const dm of [metaOf(mA), metaOf(mB)]) {
        const best = fastestLap(laps, dm.number);
        if (!best) throw new Error(`No timed lap found for ${dm.code}`);
        const t0 = Date.parse(best.date_start!);
        const t1 = t0 + best.lap_duration! * 1000;
        const iso0 = new Date(t0 - 300).toISOString();
        const iso1 = new Date(t1 + 300).toISOString();
        const [car, loc] = await Promise.all([
          getCarData(sessionKey, dm.number, iso0, iso1),
          getLocation(sessionKey, dm.number, iso0, iso1),
        ]);
        const model = buildDriverModel(car, loc, best, dm);
        if (model.samples.length < 20) throw new Error(`Sparse telemetry for ${dm.code}`);
        built.push(model);
      }
      // Teammates share a team colour, and some sessions have none — force distinct hues.
      if (built[0].colour.toLowerCase() === built[1].colour.toLowerCase()) {
        built[0].colour = "#38b6ff";
        built[1].colour = "#ff7a45";
      }
      const sess = sessions.find((s) => String(s.session_key) === sessionKey);
      const label = sess ? `${sess.circuit_short_name} · ${sess.session_name} · ${year}` : `session ${sessionKey}`;
      onModel(finaliseModel(built, `OpenF1 · ${label} · session ${sessionKey}`, true));
    } catch (e) {
      onError(
        "Couldn't build the matchup",
        (e instanceof Error ? e.message : "Fetch failed") +
          ". If this is a plain file with no server, the proxy isn't running — use `npm run dev` or the offline demo."
      );
    } finally {
      setBusy(false);
    }
  }

  function demo() {
    onModel(fromOffline(OFFLINE_SAMPLE));
  }

  return (
    <div className="picker">
      <div className="sel">
        <select aria-label="Year" title="Season" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <div className="sel">
        <select
          aria-label="Session"
          title="Event / session"
          value={sessionKey}
          disabled={loadingSessions || !sessions.length}
          onChange={(e) => setSessionKey(e.target.value)}
        >
          {loadingSessions && <option>Loading…</option>}
          {!loadingSessions && !sessions.length && <option>No sessions</option>}
          {sessions.map((s) => (
            <option key={s.session_key} value={s.session_key}>
              {(s.circuit_short_name || s.location || "?") + " · " + (s.session_name || s.session_type)}
            </option>
          ))}
        </select>
      </div>
      <div className="sel">
        <select aria-label="Driver one" title="First driver" value={a} disabled={!drivers.length} onChange={(e) => setA(e.target.value)}>
          {drivers.map((d) => (
            <option key={d.driver_number} value={d.driver_number}>
              {(d.name_acronym || d.driver_number) + " · " + (d.full_name || "")}
            </option>
          ))}
        </select>
      </div>
      <div className="sel">
        <select aria-label="Driver two" title="Second driver" value={b} disabled={!drivers.length} onChange={(e) => setB(e.target.value)}>
          {drivers.map((d) => (
            <option key={d.driver_number} value={d.driver_number}>
              {(d.name_acronym || d.driver_number) + " · " + (d.full_name || "")}
            </option>
          ))}
        </select>
      </div>
      <button className="btn primary" disabled={!drivers.length || busy} onClick={compare}>
        {busy ? "Loading…" : "Compare"}
      </button>
      <button className="btn ghost" onClick={demo}>
        Offline demo
      </button>
    </div>
  );
}
