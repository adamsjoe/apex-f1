"use client";

import { useEffect, useState } from "react";
import { getSessions, getDrivers, getLaps, getCarData, getLocation } from "@/lib/openf1";
import { firstLap, buildDriverModel, finaliseModel, fromOffline } from "@/lib/pipeline";
import { OFFLINE_SAMPLE } from "@/lib/sample";
import type { Model, DriverMeta, DriverModel, Of1Session, Of1Driver } from "@/lib/types";

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface Props {
  onLoading: (mode: "compare" | "field") => void;
  onModel: (m: Model) => void;
  onError: (title: string, msg: string) => void;
}

const FIRST_YEAR = 2023; // OpenF1 data starts here
const FIELD_CONCURRENCY = 1; // OpenF1 429s hard on *any* concurrent requests — fetch strictly one at a time
const MIN_SAMPLES = 20;

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
  const [mode, setMode] = useState<"compare" | "field" | "demo">("compare");

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
        // Sessions that haven't happened yet have no telemetry behind them and
        // would just 404 downstream, so drop anything still in the future.
        const now = Date.now();
        const happened = s.filter((sess) => !sess.date_start || Date.parse(sess.date_start) <= now);
        happened.sort((x, y2) => (y2.date_start || "").localeCompare(x.date_start || ""));
        setSessions(happened);
        setSessionKey(happened.length ? String(happened[0].session_key) : "");
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
      onError("Pick two different drivers", "Choose two distinct drivers to compare their opening lap.");
      return;
    }
    const mA = drivers.find((d) => String(d.driver_number) === a);
    const mB = drivers.find((d) => String(d.driver_number) === b);
    if (!mA || !mB) return;
    setMode("compare");
    setBusy(true);
    onLoading("compare");
    try {
      const laps = await getLaps(sessionKey);
      const built: DriverModel[] = [];
      for (const dm of [metaOf(mA), metaOf(mB)]) {
        const best = firstLap(laps, dm.number);
        if (!best) throw new Error(`No timed first lap found for ${dm.code}`);
        const t0 = Date.parse(best.date_start!);
        const t1 = t0 + best.lap_duration! * 1000;
        const iso0 = new Date(t0 - 300).toISOString();
        const iso1 = new Date(t1 + 300).toISOString();
        const [car, loc] = await Promise.all([
          getCarData(sessionKey, dm.number, iso0, iso1),
          getLocation(sessionKey, dm.number, iso0, iso1),
        ]);
        const model = buildDriverModel(car, loc, best, dm);
        if (model.samples.length < MIN_SAMPLES) throw new Error(`Sparse telemetry for ${dm.code}`);
        built.push(model);
      }
      // Teammates share a team colour, and some sessions have none — force distinct hues.
      if (built[0].colour.toLowerCase() === built[1].colour.toLowerCase()) {
        built[0].colour = "#38b6ff";
        built[1].colour = "#ff7a45";
      }
      const sess = sessions.find((s) => String(s.session_key) === sessionKey);
      const label = sess ? `${sess.circuit_short_name} · ${sess.session_name} · ${year}` : `session ${sessionKey}`;
      onModel(finaliseModel(built, `OpenF1 · ${label} · Lap 1 · session ${sessionKey}`, true));
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

  async function loadField() {
    if (!drivers.length) return;
    const sess = sessions.find((s) => String(s.session_key) === sessionKey);
    if (!sess) return;
    if (sess.session_name !== "Race") {
      onError("Race sessions only", "All drivers replays only Race sessions — the field doesn't start together in Practice/Qualifying/Sprint.");
      return;
    }
    setMode("field");
    setBusy(true);
    onLoading("field");
    try {
      const laps = await getLaps(sessionKey);
      // Each driver's own first timed lap, not a fixed clock window — so the
      // replay covers everyone's actual lap 1 in full, however long it took.
      const firsts = drivers
        .map((d) => ({ dm: metaOf(d), lap: firstLap(laps, d.driver_number) }))
        .filter((x): x is { dm: DriverMeta; lap: NonNullable<ReturnType<typeof firstLap>> } => x.lap !== null);
      if (!firsts.length) throw new Error("No driver in this session has a timed first lap");
      const t0Ms = Math.min(...firsts.map((x) => Date.parse(x.lap.date_start!)));
      const endMs = Math.max(...firsts.map((x) => Date.parse(x.lap.date_start!) + x.lap.lap_duration! * 1000));
      const iso0 = new Date(t0Ms - 300).toISOString();
      const iso1 = new Date(endMs + 300).toISOString();
      const results = await mapLimit(firsts, FIELD_CONCURRENCY, async ({ dm }) => {
        try {
          // Sequential, not Promise.all: OpenF1 429s aggressively on *any*
          // simultaneous requests, so we never want more than one in flight.
          const car = await getCarData(sessionKey, dm.number, iso0, iso1);
          const loc = await getLocation(sessionKey, dm.number, iso0, iso1);
          const model = buildDriverModel(car, loc, null, dm, t0Ms);
          return model.samples.length < MIN_SAMPLES ? null : model;
        } catch {
          return null;
        }
      });
      const built = results.filter((m): m is DriverModel => m !== null);
      if (!built.length) throw new Error("No usable telemetry for any driver's first lap");
      const label = `${sess.circuit_short_name} · ${sess.session_name} · ${year}`;
      onModel(finaliseModel(built, `OpenF1 · ${label} · Lap 1 · all drivers`, true));
    } catch (e) {
      onError(
        "Couldn't build the field replay",
        (e instanceof Error ? e.message : "Fetch failed") + ". Try a different (busier) session, or retry."
      );
    } finally {
      setBusy(false);
    }
  }

  function demo() {
    setMode("demo");
    onModel(fromOffline(OFFLINE_SAMPLE));
  }

  const isRaceSession = sessions.find((s) => String(s.session_key) === sessionKey)?.session_name === "Race";

  return (
    <div className="picker">
      <div className="sel">
        <select aria-label="Year" title="Season" value={year} disabled={mode === "demo"} onChange={(e) => setYear(Number(e.target.value))}>
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
          disabled={mode === "demo" || loadingSessions || !sessions.length}
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
        <select aria-label="Driver one" title="First driver" value={a} disabled={mode === "demo" || !drivers.length} onChange={(e) => setA(e.target.value)}>
          {drivers.map((d) => (
            <option key={d.driver_number} value={d.driver_number}>
              {(d.name_acronym || d.driver_number) + " · " + (d.full_name || "")}
            </option>
          ))}
        </select>
      </div>
      <div className="sel">
        <select aria-label="Driver two" title="Second driver" value={b} disabled={mode === "demo" || !drivers.length} onChange={(e) => setB(e.target.value)}>
          {drivers.map((d) => (
            <option key={d.driver_number} value={d.driver_number}>
              {(d.name_acronym || d.driver_number) + " · " + (d.full_name || "")}
            </option>
          ))}
        </select>
      </div>
      <button className={"btn " + (mode === "compare" ? "primary" : "ghost")} disabled={!drivers.length || busy} onClick={compare}>
        {busy && mode === "compare" ? "Loading…" : "Compare"}
      </button>
      <button
        className={"btn " + (mode === "field" ? "primary" : "ghost")}
        disabled={!drivers.length || busy || !isRaceSession}
        onClick={loadField}
        title={
          isRaceSession
            ? "Replay Lap 1 with every driver on track"
            : "Only available for Race sessions — the field doesn't start together in Practice/Qualifying/Sprint"
        }
      >
        {busy && mode === "field" ? "Loading…" : "All drivers"}
      </button>
      <button className={"btn " + (mode === "demo" ? "primary" : "ghost")} onClick={demo}>
        Offline demo
      </button>
    </div>
  );
}
