"use client";

import { useEffect, useRef, useState } from "react";
import { ReplayEngine, type Snapshot } from "@/lib/engine";
import type { Model } from "@/lib/types";

export interface Stage {
  show: boolean;
  spinner: boolean;
  title: string;
  msg: string;
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

function fmtLap(s: number) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ":" + sec.toFixed(3).padStart(6, "0");
}

export default function Replay({ model, stage }: { model: Model | null; stage: Stage }) {
  const trackRef = useRef<HTMLCanvasElement>(null);
  const tracesRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ReplayEngine | null>(null);
  const lastApplied = useRef(0);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [spi, setSpi] = useState(1);

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

  // self-check states derived from stage/model
  const checks: ChecksState = {
    sessions: model || !stage.show ? "ok" : "wait",
    drivers: model ? "ok" : "wait",
    laps: model ? "ok" : "wait",
    telemetry: model ? "ok" : stage.spinner ? "wait" : "wait",
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
            <span className="k">Source</span>
            <span className="v" title={snap?.source}>{snap?.source ?? "–"}</span>
            <span className="k">Join</span>
            <span className="v">{snap?.join ?? "–"}</span>
            <span className="k">Points</span>
            <span className="v">{snap?.points ?? "–"}</span>
            <span className="k">Playback</span>
            <span className="v">{snap ? "Catmull→60fps" : "–"}</span>
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
                <span className="code">{d.code}</span>
                <span className="name">{d.name}</span>
                <span className="lap">{d.lapTime ? fmtLap(d.lapTime) : "—"}</span>
              </div>
            ))}
          </div>

          <div className="delta">
            <div className="lbl">Delta at track position</div>
            <div
              className="val"
              style={{
                color:
                  snap?.delta && !snap.delta.level
                    ? snap.drivers.find((d) => d.code === snap.delta!.leader)?.colour
                    : "var(--text)",
              }}
            >
              {snap?.delta ? (snap.delta.value >= 0 ? "+" : "") + snap.delta.value.toFixed(3) + "s" : "—"}
            </div>
            <div className="who">
              {snap?.delta
                ? snap.delta.level
                  ? "level"
                  : snap.delta.leader + " ahead"
                : "single-lap demo — deploy for head-to-head"}
            </div>
          </div>

          <div className="traceWrap">
            <div className="h">
              <span>Speed · km/h</span>
              <span>by distance</span>
            </div>
            <canvas className="traces" ref={tracesRef} />
          </div>

          <div className="live">
            {snap?.drivers.map((d) => (
              <div className="gauge" key={d.code}>
                <div className="t" style={{ color: d.colour }}>{d.code}</div>
                <div className="barwrap">
                  <span className="t">T</span>
                  <div className="bar"><i style={{ width: Math.round(d.throttle) + "%", background: d.colour }} /></div>
                  <span className="num">{Math.round(d.throttle)}</span>
                </div>
                <div className="barwrap">
                  <span className="t">B</span>
                  <div className="bar"><i style={{ width: (d.brake ? 100 : 0) + "%", background: "#ff6b6b" }} /></div>
                  <span className="num">{d.brake ? 100 : 0}</span>
                </div>
                <div className="chips">
                  <span className="chip">G{d.gear}</span>
                  <span className={"chip" + (d.drs ? " drson" : "")}>DRS</span>
                </div>
              </div>
            ))}
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
          aria-label="Playback speed"
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
