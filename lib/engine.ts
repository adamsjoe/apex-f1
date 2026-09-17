import type { Model } from "./types";
import { sampleAt, tAtDistance, indexAtT, JOIN_TOL_MS, type SamplePt } from "./pipeline";

export const VMAX = 340; // km/h, trace scaling
export const KPH_TO_MPH = 0.621371;

export type Theme = "light" | "dark";
export type SpeedUnit = "kph" | "mph";

interface Palette {
  trackOuter: string;
  trackInner: string;
  startDot: string;
  reticle: string;
  connector: string;
  zoomBg: string;
  zoomTrackOuter: string;
  zoomTrackInner: string;
  zoomLabel: string;
  zoomBorder: string;
  zoomBadge: string;
  leaderLine: string;
  axisGrid: string;
  axisLabel: string;
}
const PALETTES: Record<Theme, Palette> = {
  dark: {
    trackOuter: "rgba(120,135,170,0.14)",
    trackInner: "rgba(150,168,205,0.28)",
    startDot: "rgba(233,237,246,0.6)",
    reticle: "rgba(233,237,246,0.5)",
    connector: "rgba(233,237,246,0.16)",
    zoomBg: "#0a0f18",
    zoomTrackOuter: "rgba(120,135,170,0.16)",
    zoomTrackInner: "rgba(150,168,205,0.22)",
    zoomLabel: "#e9edf6",
    zoomBorder: "rgba(150,168,205,0.3)",
    zoomBadge: "rgba(124,134,156,0.9)",
    leaderLine: "rgba(233,237,246,0.4)",
    axisGrid: "rgba(150,168,205,0.1)",
    axisLabel: "rgba(150,168,205,0.55)",
  },
  light: {
    trackOuter: "rgba(60,72,110,0.10)",
    trackInner: "rgba(60,72,110,0.32)",
    startDot: "rgba(18,21,28,0.55)",
    reticle: "rgba(18,21,28,0.45)",
    connector: "rgba(18,21,28,0.14)",
    zoomBg: "#eef1f7",
    zoomTrackOuter: "rgba(60,72,110,0.12)",
    zoomTrackInner: "rgba(60,72,110,0.28)",
    zoomLabel: "#12151c",
    zoomBorder: "rgba(60,72,110,0.3)",
    zoomBadge: "rgba(91,100,120,0.9)",
    leaderLine: "rgba(18,21,28,0.35)",
    axisGrid: "rgba(20,30,55,0.09)",
    axisLabel: "rgba(20,30,55,0.55)",
  },
};

export interface DriverSnap {
  code: string;
  name: string;
  team: string;
  colour: string;
  lapTime: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: number;
}
export interface Snapshot {
  T: number;
  maxT: number;
  playing: boolean;
  fps: number;
  ft: number;
  source: string;
  online: boolean;
  join: string;
  points: string;
  drivers: DriverSnap[];
  delta: { value: number; leader: string; level: boolean } | null;
}

type Pt = [number, number];

/**
 * Imperative render + playback loop. Kept out of React so the 60fps loop never
 * triggers re-renders; the chrome subscribes for throttled snapshots.
 */
export class ReplayEngine {
  private track: HTMLCanvasElement;
  private traces: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;
  private xctx: CanvasRenderingContext2D;
  private model: Model | null = null;
  private raf = 0;
  private last = 0;
  private T = 0;
  private playing = false;
  private speed = 1;
  private zoom = true;
  private dpr = 1;
  private TW = 0;
  private TH = 0;
  private subs = new Set<(s: Snapshot) => void>();
  private fpsAcc = 0;
  private fpsN = 0;
  private fps = 0;
  private ft = 0;
  private lastHud = 0;
  private heads: SamplePt[] = [];
  private palette = PALETTES.dark;
  private speedUnit: SpeedUnit = "kph";
  readonly join = `±${JOIN_TOL_MS}ms nearest`;

  constructor(track: HTMLCanvasElement, traces: HTMLCanvasElement) {
    this.track = track;
    this.traces = traces;
    this.tctx = track.getContext("2d")!;
    this.xctx = traces.getContext("2d")!;
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  subscribe(cb: (s: Snapshot) => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }
  setModel(m: Model) {
    this.model = m;
    this.T = 0;
    this.playing = true;
  }
  play() {
    if (this.model) this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  toggle() {
    if (this.model) this.playing = !this.playing;
  }
  seek(t: number) {
    if (this.model) this.T = Math.max(0, Math.min(this.model.maxT, t));
  }
  setSpeed(s: number) {
    this.speed = s;
  }
  setZoom(on: boolean) {
    this.zoom = on;
  }
  setTheme(t: Theme) {
    this.palette = PALETTES[t];
  }
  setSpeedUnit(u: SpeedUnit) {
    this.speedUnit = u;
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.subs.clear();
  }

  private resize() {
    this.dpr = Math.min(2, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
    const tw = this.track.clientWidth, th = this.track.clientHeight;
    if (tw !== this.TW || th !== this.TH) {
      this.TW = tw;
      this.TH = th;
      this.track.width = tw * this.dpr;
      this.track.height = th * this.dpr;
      this.tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    const xw = this.traces.clientWidth, xh = this.traces.clientHeight;
    if (this.traces.width !== xw * this.dpr || this.traces.height !== xh * this.dpr) {
      this.traces.width = xw * this.dpr;
      this.traces.height = xh * this.dpr;
      this.xctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  private worldT() {
    const b = this.model!.bounds;
    const pad = Math.min(this.TW, this.TH) * 0.1;
    const s = Math.min(
      (this.TW - 2 * pad) / ((b.maxX - b.minX) || 1),
      (this.TH - 2 * pad) / ((b.maxY - b.minY) || 1)
    );
    const ox = (this.TW - (b.maxX - b.minX) * s) / 2;
    const oy = (this.TH - (b.maxY - b.minY) * s) / 2;
    return {
      s,
      tx: (p: Pt) => ox + (p[0] - b.minX) * s,
      ty: (p: Pt) => this.TH - (oy + (p[1] - b.minY) * s), // flip Y
    };
  }

  private drawTrack(W: ReturnType<ReplayEngine["worldT"]>) {
    const ctx = this.tctx;
    const pts = this.model!.track;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = W.tx(pts[i]), y = W.ty(pts[i]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = this.palette.trackOuter;
    ctx.lineWidth = Math.max(9, W.s * 90);
    ctx.stroke();
    ctx.strokeStyle = this.palette.trackInner;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    const p0 = pts[0];
    ctx.fillStyle = this.palette.startDot;
    ctx.beginPath();
    ctx.arc(W.tx(p0), W.ty(p0), 3.2, 0, 7);
    ctx.fill();
  }

  private drawGhost(W: ReturnType<ReplayEngine["worldT"]>, di: number) {
    const ctx = this.tctx;
    const d = this.model!.drivers[di];
    const s = d.samples;
    const head = this.heads[di];
    const upto = indexAtT(s, Math.min(this.T, d.lapTime || Infinity));
    const start = Math.max(0, upto - 70);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = start; i <= upto; i++) {
      const x = W.tx([s[i].x, s[i].y]), y = W.ty([s[i].x, s[i].y]);
      i === start ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(W.tx([head.x, head.y]), W.ty([head.x, head.y]));
    ctx.strokeStyle = d.colour;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = d.colour;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(W.tx([head.x, head.y]), W.ty([head.x, head.y]), 4.4, 0, 7);
    ctx.fillStyle = d.colour;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private drawTraces() {
    const ctx = this.xctx;
    const w = this.traces.clientWidth, h = this.traces.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const m = this.model!;
    const L = m.trackLen;
    const padL = 28; // left gutter for speed axis labels
    const padB = 13; // bottom gutter for distance axis labels
    const pw = w - padL;
    const ph = h - padB;
    const toDisplay = this.speedUnit === "mph" ? KPH_TO_MPH : 1;

    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = this.palette.axisLabel;
    ctx.strokeStyle = this.palette.axisGrid;
    ctx.lineWidth = 1;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const y = ph - f * ph;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(String(Math.round((f * VMAX * toDisplay) / 5) * 5), padL - 5, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const f of [0, 0.5, 1]) {
      const x = padL + f * pw;
      ctx.fillText((((f * L) / 1000).toFixed(1)) + " km", Math.min(w - 14, Math.max(padL + 14, x)), ph + 2);
    }

    for (const d of m.drivers) {
      ctx.beginPath();
      for (let i = 0; i < d.samples.length; i++) {
        const p = d.samples[i];
        const x = padL + (p.d / L) * pw;
        const y = ph - (Math.min(p.speed, VMAX) / VMAX) * ph;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = d.colour;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    let leadIdx = 0;
    for (let i = 1; i < m.drivers.length; i++) {
      if (this.heads[i].d > this.heads[leadIdx].d) leadIdx = i;
    }
    const dx = padL + (this.heads[leadIdx].d / L) * pw;
    ctx.strokeStyle = this.palette.leaderLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(dx, 0);
    ctx.lineTo(dx, ph);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private render() {
    this.tctx.clearRect(0, 0, this.TW, this.TH);
    const W = this.worldT();
    this.drawTrack(W);
    for (let i = 0; i < this.model!.drivers.length; i++) this.drawGhost(W, i);
    this.drawTraces();
    if (this.zoom && this.model!.drivers.length) this.drawZoom(W);
  }

  private rr(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.tctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  private drawZoom(W: ReturnType<ReplayEngine["worldT"]>) {
    const ctx = this.tctx;
    const m = this.model!;
    const heads = this.heads;
    let cx = 0, cy = 0;
    for (const h of heads) {
      cx += h.x;
      cy += h.y;
    }
    cx /= heads.length;
    cy /= heads.length;
    const gap = heads.length >= 2 ? Math.hypot(heads[0].x - heads[1].x, heads[0].y - heads[1].y) : 0;
    const bw = m.bounds.maxX - m.bounds.minX;
    const spanWorld = Math.max(gap * 2.8, bw * 0.12, 300); // world units (~1/10 m); floor ~30 m

    const pad = 14;
    const Zw = Math.min(this.TW, this.TH) * 0.36;
    const Zh = Zw * 0.7;
    const rx = this.TW - Zw - pad;
    const ry = this.TH - Zh - pad;
    const z = Zw / spanWorld;
    const halfX = spanWorld / 2;
    const halfY = (Zh / Zw) * spanWorld / 2;
    const minWx = cx - halfX, minWy = cy - halfY;
    const ztx = (p: Pt) => rx + (p[0] - minWx) * z;
    const zty = (p: Pt) => ry + Zh - (p[1] - minWy) * z;

    // reticle on the main view (the world region being magnified)
    const bl = W.tx([minWx, 0]), br = W.tx([cx + halfX, 0]);
    const bt = W.ty([0, cy + halfY]), bb = W.ty([0, minWy]);
    const rL = Math.min(bl, br), rT = Math.min(bt, bb), rWd = Math.abs(br - bl), rHt = Math.abs(bb - bt);
    ctx.save();
    ctx.strokeStyle = this.palette.reticle;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(rL, rT, rWd, rHt);
    ctx.setLineDash([]);
    // connector lines pointing from the reticle to the inset
    ctx.strokeStyle = this.palette.connector;
    ctx.beginPath();
    ctx.moveTo(rL + rWd, rT);
    ctx.lineTo(rx, ry);
    ctx.moveTo(rL + rWd, rT + rHt);
    ctx.lineTo(rx, ry + Zh);
    ctx.stroke();
    ctx.restore();

    // inset
    ctx.save();
    this.rr(rx, ry, Zw, Zh, 8);
    ctx.clip();
    ctx.fillStyle = this.palette.zoomBg;
    ctx.fillRect(rx, ry, Zw, Zh);
    const pts = m.track;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = ztx(pts[i]), y = zty(pts[i]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = this.palette.zoomTrackOuter;
    ctx.lineWidth = Math.max(6, z * 90);
    ctx.stroke();
    ctx.strokeStyle = this.palette.zoomTrackInner;
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let i = 0; i < m.drivers.length; i++) {
      const d = m.drivers[i];
      const s = d.samples;
      const upto = indexAtT(s, Math.min(this.T, d.lapTime || Infinity));
      const start = Math.max(0, upto - 45);
      const h = heads[i];
      ctx.beginPath();
      for (let k = start; k <= upto; k++) {
        const x = ztx([s[k].x, s[k].y]), y = zty([s[k].x, s[k].y]);
        k === start ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.lineTo(ztx([h.x, h.y]), zty([h.x, h.y]));
      ctx.strokeStyle = d.colour;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 3;
      ctx.shadowColor = d.colour;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(ztx([h.x, h.y]), zty([h.x, h.y]), 6, 0, 7);
      ctx.fillStyle = d.colour;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = this.palette.zoomLabel;
      ctx.font = "600 11px 'Space Grotesk', sans-serif";
      ctx.fillText(d.code, ztx([h.x, h.y]) + 9, zty([h.x, h.y]) - 8);
    }
    ctx.restore();

    // inset border + label
    ctx.save();
    this.rr(rx, ry, Zw, Zh, 8);
    ctx.strokeStyle = this.palette.zoomBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = this.palette.zoomBadge;
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillText("ZOOM ×" + (z / W.s).toFixed(1), rx + 8, ry + 13);
    ctx.restore();
  }

  private emit() {
    const m = this.model!;
    const T = this.T;
    const drivers: DriverSnap[] = m.drivers.map((d, i) => {
      const s = this.heads[i];
      return {
        code: d.code,
        name: d.name,
        team: d.team,
        colour: d.colour,
        lapTime: d.lapTime,
        speed: s.speed,
        throttle: s.throttle,
        brake: s.brake,
        gear: s.gear,
        rpm: s.rpm,
        drs: s.drs,
      };
    });
    let delta: Snapshot["delta"] = null;
    if (m.drivers.length >= 2) {
      const [A, B] = m.drivers;
      const [sA, sB] = this.heads;
      const leaderIsA = sA.d >= sB.d; // whoever is physically further along the lap
      const refD = leaderIsA ? sA.d : sB.d;
      const trailer = leaderIsA ? B : A;
      const gap = Math.max(0, tAtDistance(trailer, refD) - T);
      delta = { value: gap, leader: (leaderIsA ? A : B).code, level: gap < 0.02 };
    }
    const snap: Snapshot = {
      T,
      maxT: m.maxT,
      playing: this.playing,
      fps: this.fps,
      ft: this.ft,
      source: m.sourceLabel,
      online: m.online,
      join: this.join,
      points: m.drivers.map((d) => d.samples.length).join(" / "),
      drivers,
      delta,
    };
    this.subs.forEach((cb) => cb(snap));
  }

  private frame(now: number) {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000) || 1 / 60;
    this.last = now;
    if (!this.model) return;
    this.resize();
    if (this.playing) {
      this.T += dt * this.speed;
      if (this.T >= this.model.maxT) {
        this.T = 0;
      }
    }
    this.heads = this.model.drivers.map((d) => sampleAt(d, this.T));
    this.render();
    this.fpsAcc += dt;
    this.fpsN++;
    if (now - this.lastHud > 200) {
      this.fps = this.fpsN / this.fpsAcc;
      this.ft = (this.fpsAcc / this.fpsN) * 1000;
      this.fpsN = 0;
      this.fpsAcc = 0;
      this.lastHud = now;
    }
    this.emit();
  }
}
