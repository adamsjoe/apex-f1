"use client";

import { useEffect, useState } from "react";
import Picker from "@/components/Picker";
import Replay, { type Stage } from "@/components/Replay";
import type { Model } from "@/lib/types";
import type { Theme } from "@/lib/engine";

const THEME_KEY = "apex-theme";

const IDLE: Stage = {
  show: true,
  spinner: false,
  title: "Pick a matchup",
  msg: "Choose a session and two drivers, then Compare — the app pulls each driver's opening lap (Lap 1) from OpenF1 and races them as ghosts. Or hit All drivers for the whole field's Lap 1, or Offline demo to see it run on a bundled real lap.",
};

export default function Home() {
  const [model, setModel] = useState<Model | null>(null);
  const [stage, setStage] = useState<Stage>(IDLE);
  const [theme, setTheme] = useState<Theme>("dark");

  // pick up a previously saved theme once mounted (the inline script in
  // layout.tsx already applied it to <html> to avoid a flash)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  return (
    <div id="app">
      <div className="topbar">
        <div className="wordmark">
          Apex<span>F1 telemetry — Lap 1 head-to-head</span>
        </div>
        <Picker
          onLoading={(mode) =>
            setStage(
              mode === "field"
                ? { show: true, spinner: true, title: "Loading field", msg: "Fetching Lap 1 telemetry for every driver from OpenF1…" }
                : { show: true, spinner: true, title: "Loading matchup", msg: "Fetching Lap 1 telemetry from OpenF1…" }
            )
          }
          onModel={(m) => {
            setStage((s) => ({ ...s, show: false }));
            setModel(m);
          }}
          onError={(title, msg) => setStage({ show: true, spinner: false, title, msg, error: true })}
        />
        <button
          className="themeToggle"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title="Toggle light / dark theme"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? (
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
      <Replay model={model} stage={stage} theme={theme} />
    </div>
  );
}
