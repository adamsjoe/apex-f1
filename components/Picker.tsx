"use client";

import { useEffect, useRef, useState } from "react";
import { getSessions, getDrivers, getLaps, getCarData, getLocation } from "@/lib/openf1";
import { fastestLap, buildDriverModel, finaliseModel, fromOffline } from "@/lib/pipeline";
import { OFFLINE_SAMPLE } from "@/lib/sample";
import type { Model, DriverMeta, Of1Session, Of1Driver } from "@/lib/types";

interface Props {
  onLoading: () => void;
  onModel: (m: Model) => void;
  onError: (title: string, msg: string) => void;
}

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
  const [sessions, setSessions] = useState<Of1Session[]>([]);
  const [drivers, setDrivers] = useState<Of1Driver[]>([]);
  const [sessionKey, setSessionKey] = useState<string>("");
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const loadedDriversFor = useRef<string>("");

  // sessions on mount
  useEffect(() => {
    (async () => {
      try {
        let all: Of1Session[] = [];
        for (const y of [2025, 2024, 2023]) {
          try {
            all = all.concat(await getSessions(y));
          } catch {
            /* ignore a year that fails */
          }
        }
        if (!all.length) throw new Error("no sessions");
        all.sort((x, y) => (y.date_start || "").localeCompare(x.date_start || ""));
        setSessions(all);
        setSessionKey(String(all[0].session_key));
      } catch {
        onError(
          "Can't reach OpenF1",
          "The session list didn't load. In local dev, run with `npx vercel dev` so the /api/f1 function is available, or use the offline demo."
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // drivers when session changes
  useEffect(() => {
    if (!sessionKey || loadedDriversFor.current === sessionKey) return;
    loadedDriversFor.current = sessionKey;
    (async () => {
      try {
        const ds = await getDrivers(sessionKey);
        setDrivers(ds);
        if (ds.length) {
          setA(String(ds[0].driver_number));
          setB(String(ds[Math.min(1, ds.length - 1)].driver_number));
        }
      } catch {
        setDrivers([]);
      }
    })();
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
      const built = [];
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
      const sess = sessions.find((s) => String(s.session_key) === sessionKey);
      const label = sess ? `${sess.circuit_short_name} · ${sess.session_name}` : `session ${sessionKey}`;
      onModel(finaliseModel(built, `OpenF1 · ${label} · session ${sessionKey}`, true));
    } catch (e) {
      onError(
        "Couldn't build the matchup",
        (e instanceof Error ? e.message : "Fetch failed") +
          ". If this is the editor preview or plain file, the proxy isn't running — deploy to Vercel or use the offline demo."
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
        <select aria-label="Session" value={sessionKey} onChange={(e) => setSessionKey(e.target.value)}>
          {sessions.length === 0 && <option>Loading sessions…</option>}
          {sessions.map((s) => (
            <option key={s.session_key} value={s.session_key}>
              {(s.circuit_short_name || s.location || "?") + " · " + (s.session_name || s.session_type) + " · " + s.year}
            </option>
          ))}
        </select>
      </div>
      <div className="sel">
        <select aria-label="Driver one" value={a} disabled={!drivers.length} onChange={(e) => setA(e.target.value)}>
          {drivers.map((d) => (
            <option key={d.driver_number} value={d.driver_number}>
              {(d.name_acronym || d.driver_number) + " · " + (d.full_name || "")}
            </option>
          ))}
        </select>
      </div>
      <div className="sel">
        <select aria-label="Driver two" value={b} disabled={!drivers.length} onChange={(e) => setB(e.target.value)}>
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
