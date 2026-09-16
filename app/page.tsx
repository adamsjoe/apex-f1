"use client";

import { useState } from "react";
import Picker from "@/components/Picker";
import Replay, { type Stage } from "@/components/Replay";
import type { Model } from "@/lib/types";

const IDLE: Stage = {
  show: true,
  spinner: false,
  title: "Pick a matchup",
  msg: "Choose a session and two drivers, then Compare — the app pulls each driver's fastest lap from OpenF1 and races them as ghosts. Or hit Offline demo to see it run on a bundled real lap.",
};

export default function Home() {
  const [model, setModel] = useState<Model | null>(null);
  const [stage, setStage] = useState<Stage>(IDLE);

  return (
    <div id="app">
      <div className="topbar">
        <div className="wordmark">
          Apex<span>F1 telemetry — fastest-lap head-to-head</span>
        </div>
        <Picker
          onLoading={() =>
            setStage({ show: true, spinner: true, title: "Loading matchup", msg: "Fetching laps and telemetry from OpenF1…" })
          }
          onModel={(m) => {
            setStage((s) => ({ ...s, show: false }));
            setModel(m);
          }}
          onError={(title, msg) => setStage({ show: true, spinner: false, title, msg })}
        />
      </div>
      <Replay model={model} stage={stage} />
    </div>
  );
}
