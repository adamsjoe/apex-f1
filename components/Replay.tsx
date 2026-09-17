"use client";

import { useEffect, useRef, useState } from "react";
import { ReplayEngine, VMAX, KPH_TO_MPH, type Snapshot, type Theme, type SpeedUnit } from "@/lib/engine";
import type { Model } from "@/lib/types";

export interface Stage {
  show: boolean;
  spinner: boolean;
  title: string;
  msg: string;
  error?: boolean;
}

const CHECKS: [keyof ChecksState, string][] = [
  ["sessions", "Sessions loaded"],
  ["drivers", "Drivers loaded"],
  ["laps", "Fastest laps found"],
  ["telemetry", "Telemetry fetched"],
  ["join", "Join within tolerance"],
];
type CheckState = "ok" | "wait" | "bad";
interface ChecksState {
  sessions: CheckState;
  drivers: CheckState;
  laps: CheckState;
  telemetry: CheckState;
  join: CheckState;
}

const SPEEDS = [0.5, 1, 2, 4];
const RPM_MAX = 13000;

function fmtLap(s: number) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(3).padStart(6, "0");
}

export default function Replay({ model, stage, theme }: { model: Model | null; stage: Stage; theme: Theme }) {
  const trackRef = useRef<HTMLCanvasElement>(null);
  const tracesRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ReplayEngine | null>(null);
  const lastApplied = useRef(0);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [spi, setSpi] = useState(1);
  const [zoomOn, setZoomOn] = useState(true);
  const [unit, setUnit] = useState<SpeedUnit>("kph");

  // mount engine once
  useEffect(() => {
    if (!trackRef.current || !tracesRef.current) return;
    const eng = new ReplayEngine(trackRef.current, tracesRef.current);
    engineRef.current = eng;
    const unsub = eng.subscribe((s) => {
      const now = performance.now();
      if (now - lastApplied.current > 55) {
        lastApplied.current = now;
        setSnap(s);
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && (e.target as HTMLElement).tagName !== "SELECT") {
        e.preventDefault();
        eng.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unsub();
      eng.destroy();
      engineRef.current = null;
    };
  }, []);

  // feed model
  useEffect(() => {
    if (model && engineRef.current) engineRef.current.setModel(model);
  }, [model]);

  // theme
  useEffect(() => {
    engineRef.current?.setTheme(theme);
  }, [theme]);

  // speed unit (affects the trace chart's axis labels; the driver cards convert locally)
  useEffect(() => {
    engineRef.current?.setSpeedUnit(unit);
  }, [unit]);

  // detect gear changes to retrigger the flash animation (via element key)
  const gearPrev = useRef<Record<string, number>>({});
  const [gearFlash, setGearFlash] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!snap) return;
    let changed = false;
    const next: Record<string, number> = { ...gearFlash };
    for (const d of snap.drivers) {
      const prev = gearPrev.current[d.code];
      if (prev !== undefined && prev !== d.gear) {
        next[d.code] = (next[d.code] || 0) + 1;
        changed = true;
      }
      gearPrev.current[d.code] = d.gear;
    }
    if (changed) setGearFlash(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  // self-check states derived from stage/model
  const checks: ChecksState = {
    sessions: model ? "ok" : "wait",
    drivers: model ? "ok" : "wait",
    laps: model ? "ok" : "wait",
    telemetry: model ? "ok" : stage.error ? "bad" : "wait",
    join: model ? "ok" : "wait",
  };

  const engine = engineRef.current;
  const online = snap?.online ?? false;

  return (
    <>
      <div className="main">
        <canvas className="track" ref={trackRef} tabIndex={0} aria-label="Circuit with animated telemetry replay" />

        <div className="hud" role="status" aria-live="off">
          <div className="top">
            <span className="l">Data pipeline</span>
            <span className={"src " + (online ? "online" : "offline")}>
              <span className="dot" />
              {snap ? (online ? "LIVE · OPENF1" : "OFFLINE SAMPLE") : "NO DATA"}
            </span>
          </div>
          <div className="hgrid">
            <span className="k">FPS</span>
            <span className="v">{snap ? Math.round(snap.fps) : "–"}</span>
            <span className="k">Frame</span>
            <span className="v">{snap ? snap.ft.toFixed(1) + " ms" : "– ms"}</span>
            <span className="k">Join</span>
            <span className="v" title="Location joined onto car data by nearest timestamp within this tolerance">{snap?.join ?? "–"}</span>
            <span className="k">Points</span>
            <span className="v" title="Merged telemetry samples per driver for this lap">{snap?.points ?? "–"}</span>
            <span className="k">Playback</span>
            <span className="v" title="~3.7 Hz source data, Catmull-Rom interpolated to 60fps">{snap ? "Catmull→60fps" : "–"}</span>
          </div>
          <div className="hsrc">
            <span className="k">Source</span>
            <span className="v">{snap?.source ?? "–"}</span>
          </div>
          <div className="hchecks">
            {CHECKS.map(([k, label]) => (
              <div key={k} className={"hchk " + checks[k]}>
                <svg className="m" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12.5l4.5 4.5L19 7" stroke="#48506a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {stage.show && (
          <div className="stage-msg show">
            <div className="box">
              {stage.spinner && <div className="spinner" />}
              <h2>{stage.title}</h2>
              <p>{stage.msg}</p>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="drivers">
            {snap?.drivers.map((d) => (
              <div className="drv" key={d.code}>
                <span className="swatch" style={{ color: d.colour, background: d.colour }} />
                <div className="dmeta">
                  <div className="dtop">
                    <span className="code">{d.code}</span>
                    <span className="lap">{d.lapTime ? fmtLap(d.lapTime) : "—"}</span>
                  </div>
                  <div className="dbot">
                    <span className="name">{d.name}</span>
                    {d.team && <span className="team">{d.team}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="delta" title="How far the trailing car is behind the leader at the leader's current track position.">
            <div className="lbl">Gap to leader</div>
            <div
              className="val"
              style={{
                color:
                  snap?.delta && !snap.delta.level
                    ? snap.drivers.find((d) => d.code === snap.delta!.leader)?.colour
                    : "var(--text)",
              }}
            >
              {snap?.delta ? "+" + snap.delta.value.toFixed(3) + "s" : "—"}
            </div>
            <div className="who">
              {snap?.delta
                ? snap.delta.level
                  ? "level"
                  : snap.delta.leader + " ahead"
                : "single-lap demo — deploy for head-to-head"}
            </div>
          </div>

          <div className="traceWrap" title="Speed of each driver across the lap, plotted by distance. Dashed line marks the current position.">
            <div className="h">
              <button
                className="unitToggle"
                onClick={() => setUnit((u) => (u === "kph" ? "mph" : "kph"))}
                title="Toggle km/h / mph"
              >
                Speed · {unit === "kph" ? "km/h" : "mph"}
              </button>
              <span>by distance</span>
            </div>
            <canvas className="traces" ref={tracesRef} />
          </div>

          <div className="live">
            {snap?.drivers.map((d) => {
              const f = Math.max(0, Math.min(1, d.rpm / RPM_MAX));
              const fs = Math.max(0, Math.min(1, d.speed / VMAX));
              const shownSpeed = Math.round(unit === "mph" ? d.speed * KPH_TO_MPH : d.speed);
              return (
                <div className="gauge" key={d.code} title={d.name}>
                  <div className="t" style={{ color: d.colour }}>{d.code}</div>
                  <div className="dials">
                    <div className="dialUnit">
                      <div className="dial" title={"RPM " + Math.round(d.rpm) + " · gear " + d.gear}>
                        <svg viewBox="0 0 64 64">
                          <g transform="rotate(135 32 32)">
                            <circle cx="32" cy="32" r="26" fill="none" pathLength={100} stroke="rgba(150,168,205,0.14)" strokeWidth="5" strokeDasharray="75 100" strokeLinecap="round" />
                            <circle cx="32" cy="32" r="26" fill="none" pathLength={100} stroke="rgba(255,77,77,0.55)" strokeWidth="5" strokeDasharray="9 100" strokeDashoffset={-66} strokeLinecap="round" />
                            <circle cx="32" cy="32" r="26" fill="none" pathLength={100} stroke={d.colour} strokeWidth="5" strokeDasharray={`${(75 * f).toFixed(2)} 100`} strokeLinecap="round" />
                          </g>
                        </svg>
                        <div className="gearbig" key={d.code + "-" + (gearFlash[d.code] || 0)} style={{ color: d.colour }}>
                          {d.gear}
                        </div>
                      </div>
                      <div className="rpmnum">{Math.round(d.rpm).toLocaleString()} rpm</div>
                    </div>
                    <div className="dialUnit">
                      <div className="dial" title={"Speed " + shownSpeed + " " + (unit === "mph" ? "mph" : "km/h")}>
                        <svg viewBox="0 0 64 64">
                          <g transform="rotate(135 32 32)">
                            <circle cx="32" cy="32" r="26" fill="none" pathLength={100} stroke="rgba(150,168,205,0.14)" strokeWidth="5" strokeDasharray="75 100" strokeLinecap="round" />
                            <circle cx="32" cy="32" r="26" fill="none" pathLength={100} stroke={d.colour} strokeWidth="5" strokeDasharray={`${(75 * fs).toFixed(2)} 100`} strokeLinecap="round" />
                          </g>
                        </svg>
                        <div className="speedBig">{shownSpeed}</div>
                      </div>
                      <div className="rpmnum">{unit === "mph" ? "mph" : "km/h"}</div>
                    </div>
                  </div>
                  <div className="barwrap" title="Throttle — percent of full throttle">
                    <span className="t">T</span>
                    <div className="bar"><i style={{ width: Math.round(d.throttle) + "%", background: d.colour }} /></div>
                    <span className="num">{Math.round(d.throttle)}</span>
                  </div>
                  <div className="barwrap" title="Brake — on or off">
                    <span className="t">B</span>
                    <div className="bar"><i style={{ width: (d.brake ? 100 : 0) + "%", background: "#ff6b6b" }} /></div>
                    <span className="num">{d.brake ? 100 : 0}</span>
                  </div>
                  <div className="chips">
                    <span className={"chip" + (d.drs ? " drson" : "")} title="DRS — Drag Reduction System (green = open)">DRS</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="transport">
        <button
          className="play"
          aria-label={snap?.playing ? "Pause" : "Play"}
          onClick={() => engine?.toggle()}
        >
          {snap?.playing ? (
            <svg viewBox="0 0 24 24">
              <rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
              <rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <input
          className="scrub"
          type="range"
          min={0}
          max={1000}
          value={snap && snap.maxT ? Math.round((snap.T / snap.maxT) * 1000) : 0}
          aria-label="Timeline"
          onChange={(e) => {
            if (engine && snap) engine.seek((Number(e.target.value) / 1000) * snap.maxT);
          }}
        />
        <span className="clock">
          {snap ? snap.T.toFixed(2) + " / " + snap.maxT.toFixed(2) + "s" : "0.00 / 0.00s"}
        </span>
        <button
          className="spd"
          aria-label="Toggle zoom inset"
          title="Zoom inset — a close-up that follows the two cars"
          onClick={() => {
            const n = !zoomOn;
            setZoomOn(n);
            engine?.setZoom(n);
          }}
        >
          {zoomOn ? "Zoom ✓" : "Zoom"}
        </button>
        <button
          className="spd"
          aria-label="Playback speed"
          title="Playback speed — click to cycle"
          onClick={() => {
            const n = (spi + 1) % SPEEDS.length;
            setSpi(n);
            engine?.setSpeed(SPEEDS[n]);
          }}
        >
          {SPEEDS[spi].toFixed(1)}×
        </button>
      </div>
    </>
  );
}
