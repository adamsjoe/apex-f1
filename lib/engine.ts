import type { Model } from "./types";
import { sampleAt, tAtDistance, indexAtT } from "./pipeline";

const VMAX = 340; // km/h, trace scaling

export interface DriverSnap {
  code: string;
  name: string;
  team: string;
  colour: string;
  lapTime: number;
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
  private loop = true;
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
  readonly join = "±500ms nearest";

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
    ctx.strokeStyle = "rgba(120,135,170,0.14)";
    ctx.lineWidth = Math.max(9, W.s * 90);
    ctx.stroke();
    ctx.strokeStyle = "rgba(150,168,205,0.28)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
    const p0 = pts[0];
    ctx.fillStyle = "rgba(233,237,246,0.6)";
    ctx.beginPath();
    ctx.arc(W.tx(p0), W.ty(p0), 3.2, 0, 7);
    ctx.fill();
  }

  private drawGhost(W: ReturnType<ReplayEngine["worldT"]>, di: number) {
    const ctx = this.tctx;
    const d = this.model!.drivers[di];
    const s = d.samples;
    const head = sampleAt(d, this.T);
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
    for (const d of m.drivers) {
      ctx.beginPath();
      for (let i = 0; i < d.samples.length; i++) {
        const p = d.samples[i];
        const x = (p.d / L) * w;
        const y = h - (Math.min(p.speed, VMAX) / VMAX) * h;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = d.colour;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const lead = m.drivers.reduce((a, b) =>
      sampleAt(a, this.T).d >= sampleAt(b, this.T).d ? a : b
    );
    const dx = (sampleAt(lead, this.T).d / L) * w;
    ctx.strokeStyle = "rgba(233,237,246,0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(dx, 0);
    ctx.lineTo(dx, h);
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
    const heads = m.drivers.map((d) => sampleAt(d, this.T));
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
    ctx.strokeStyle = "rgba(233,237,246,0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(rL, rT, rWd, rHt);
    ctx.setLineDash([]);
    // connector lines pointing from the reticle to the inset
    ctx.strokeStyle = "rgba(233,237,246,0.16)";
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
    ctx.fillStyle = "#0a0f18";
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
    ctx.strokeStyle = "rgba(120,135,170,0.16)";
    ctx.lineWidth = Math.max(6, z * 90);
    ctx.stroke();
    ctx.strokeStyle = "rgba(150,168,205,0.22)";
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
      ctx.fillStyle = "#e9edf6";
      ctx.font = "600 11px 'Space Grotesk', sans-serif";
      ctx.fillText(d.code, ztx([h.x, h.y]) + 9, zty([h.x, h.y]) - 8);
    }
    ctx.restore();

    // inset border + label
    ctx.save();
    this.rr(rx, ry, Zw, Zh, 8);
    ctx.strokeStyle = "rgba(150,168,205,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(124,134,156,0.9)";
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.fillText("ZOOM ×" + (z / W.s).toFixed(1), rx + 8, ry + 13);
    ctx.restore();
  }

  private emit() {
    const m = this.model!;
    const T = this.T;
    const drivers: DriverSnap[] = m.drivers.map((d) => {
      const s = sampleAt(d, T);
      return {
        code: d.code,
        name: d.name,
        team: d.team,
        colour: d.colour,
        lapTime: d.lapTime,
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
      const sA = sampleAt(A, T), sB = sampleAt(B, T);
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
        this.T = this.loop ? 0 : this.model.maxT;
        if (!this.loop) this.playing = false;
      }
    }
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
