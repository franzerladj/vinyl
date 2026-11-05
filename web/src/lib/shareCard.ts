// Teilen-Karten im Story-Format (1080 × 1920) für Profil und Sets, direkt im Browser gezeichnet.
// Cover kommen über /api/img, weil Discogs-Bilder sonst das Canvas für den Export sperren.
import QRCode from "qrcode";
import type { CrateProfile } from "../../../shared/profile";
import { linkText, LINK_LABEL } from "../../../shared/profile";
import { LOGO_SVG } from "./logoSvg";

const W = 1080;
const H = 1920;
const ACCENT = "#ff5b14";
const INK = "#16120f";
const HEAD = "'Archivo Variable', 'Archivo', 'Inter Variable', system-ui, sans-serif";
const BODY = "'Inter Variable', 'Inter', -apple-system, system-ui, sans-serif";

export const proxied = (u?: string | null) => (u && /^https:\/\/(i|st|img)\.discogs\.com\//.test(u) ? `/api/img?u=${encodeURIComponent(u)}` : u ?? null);

function loadImg(src?: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = proxied(src)!;
  });
}

async function fonts() {
  await loadLogo();
  await Promise.all([document.fonts.load(`900 80px ${HEAD}`), document.fonts.load(`600 40px ${BODY}`), document.fonts.load(`400 40px ${BODY}`)]).catch(() => undefined);
}

function canvas() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  return { c, ctx };
}

/** Flacher Hintergrund mit einer großen Platte am Rand, wie im Logo. Kein Weichzeichner, kein Leuchten. */
function backdrop(ctx: CanvasRenderingContext2D, _img: HTMLImageElement | null) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  const cx = W + 60;
  const cy = H - 420;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(cx, cy, 520, 0, Math.PI * 2);
  ctx.fillStyle = "#0b0908";
  ctx.fill();
  ctx.strokeStyle = "#2b2420";
  ctx.lineWidth = 3;
  for (let r = 480; r > 190; r -= 26) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 170, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.restore();
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, size: number, radius = 18) {
  ctx.save();
  rr(ctx, x, y, size, size, radius);
  ctx.clip();
  if (img) {
    const r = Math.max(size / img.width, size / img.height);
    ctx.drawImage(img, x + (size - img.width * r) / 2, y + (size - img.height * r) / 2, img.width * r, img.height * r);
  } else {
    ctx.fillStyle = "#2a2a2e";
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = Math.max(2, size / 60);
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.28, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Text auf Breite umbrechen, höchstens `max` Zeilen, letzte mit … */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= width) cur = t;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
    if (lines.length === max) break;
  }
  if (lines.length < max && cur) lines.push(cur);
  if (lines.length === max && words.join(" ") !== lines.join(" ")) {
    let last = lines[max - 1];
    while (last && ctx.measureText(`${last} …`).width > width) last = last.slice(0, -1);
    lines[max - 1] = `${last.trimEnd()} …`;
  }
  return lines;
}

/** Eine Zeile kürzen, bis sie passt */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Größte Schrift, bei der der Text in höchstens `lines` Zeilen passt */
type Ctx2 = CanvasRenderingContext2D & { fontStretch?: string };
/** Schmale Markenschrift an/aus (wie die Wortmarke) */
// ctx.font setzt die Breite zurück, deshalb steht sie zusätzlich im Font-Text
let narrow = false;
const condensed = (ctx: CanvasRenderingContext2D, on: boolean) => {
  narrow = on;
  (ctx as Ctx2).fontStretch = on ? "ultra-condensed" : "normal";
};
const stretch = () => (narrow ? "ultra-condensed " : "");

function fitFont(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number, maxPx: number, minPx: number, weight = 900, family = HEAD) {
  for (let px = maxPx; px >= minPx; px -= 4) {
    ctx.font = `${weight} ${stretch()}${px}px ${family}`;
    if (wrap(ctx, text, width, lines + 1).length <= lines) return px;
  }
  return minPx;
}

/** Logo-Kiste klein plus Schriftzug, mittig */
function wordmark(ctx: CanvasRenderingContext2D, y: number, label: string) {
  const mark = 92;
  ctx.font = `900 76px ${HEAD}`;
  condensed(ctx, true);
  ctx.letterSpacing = "2px";
  const text = label.toUpperCase();
  const tw = ctx.measureText(text).width;
  const x = (W - (mark + 22 + tw)) / 2;
  if (logoImg) ctx.drawImage(logoImg, x, y - mark + 14, mark, mark * (380 / 392));
  ctx.textAlign = "left";
  ctx.fillStyle = "#f3ede2";
  ctx.fillText(text, x + mark + 22, y);
  ctx.letterSpacing = "0px";
  condensed(ctx, false);
  ctx.textAlign = "center";
}

let logoImg: HTMLImageElement | null = null;
async function loadLogo() {
  if (logoImg) return;
  logoImg = await loadImgData(`data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`).catch(() => null);
}

async function qr(text: string) {
  return loadImgData(await QRCode.toDataURL(text, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: "#0b0b0c", light: "#ffffff" } }));
}
function loadImgData(src: string): Promise<HTMLImageElement> {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.src = src;
  });
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Bild konnte nicht erstellt werden"))), "image/png"));

// ---------------------------------------------------------------------------
export interface ProfileCardInput {
  username: string;
  name?: string;
  avatar?: string;
  location?: string;
  profile: CrateProfile | null;
  records?: number;
  inviteUrl: string;
}

export async function renderProfileCard(p: ProfileCardInput): Promise<Blob> {
  await fonts();
  const pr = p.profile;
  const [avatar, spot, code] = await Promise.all([loadImg(p.avatar), loadImg(pr?.spotlight?.cover), qr(p.inviteUrl)]);
  const { c, ctx } = canvas();
  backdrop(ctx, spot ?? avatar);
  wordmark(ctx, 150, "CRATE");

  // Profilbild mit Ring
  const ay = 230;
  const as = 300;
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, ay + as / 2, as / 2 + 12, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W / 2, ay + as / 2, as / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = "#0b0b0c";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W / 2, ay + as / 2, as / 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) drawCover(ctx, avatar, W / 2 - as / 2, ay, as, 0);
  else {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(W / 2 - as / 2, ay, as, as);
    ctx.fillStyle = "#fff";
    ctx.font = `900 140px ${HEAD}`;
    ctx.textAlign = "center";
    ctx.fillText(p.username[0]?.toUpperCase() ?? "?", W / 2, ay + as / 2 + 50);
  }
  ctx.restore();

  // Name
  let y = ay + as + 150;
  const title = (pr?.djName || p.name || p.username).toUpperCase();
  condensed(ctx, true);
  const px = fitFont(ctx, title, W - 160, 2, 150, 80);
  ctx.font = `900 ${stretch()}${px}px ${HEAD}`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  for (const l of wrap(ctx, title, W - 160, 2)) {
    ctx.fillText(l, W / 2, y);
    y += px * 0.92;
  }
  condensed(ctx, false);
  ctx.font = `500 38px ${BODY}`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  const sub = [pr?.djName || p.name ? `@${p.username}` : null, pr?.location || p.location, p.records ? `${p.records} Platten` : null].filter(Boolean).join("  ·  ");
  if (sub) {
    ctx.fillText(fit(ctx, sub, W - 160), W / 2, y + 6);
    y += 70;
  }

  // Bio
  if (pr?.bio) {
    ctx.font = `400 42px ${BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    for (const l of wrap(ctx, pr.bio, W - 200, 4)) {
      y += 58;
      ctx.fillText(l, W / 2, y);
    }
    y += 30;
  }

  // Styles als Chips, zentriert
  if (pr?.styles.length) {
    y += 40;
    ctx.font = `700 32px ${BODY}`;
    const chips = pr.styles.slice(0, 5).map((s) => ({ s, w: ctx.measureText(s).width + 48 }));
    const rows: (typeof chips)[] = [[]];
    for (const ch of chips) {
      const row = rows[rows.length - 1];
      if (row.reduce((a, b) => a + b.w + 14, 0) + ch.w > W - 160) rows.push([ch]);
      else row.push(ch);
    }
    for (const row of rows.slice(0, 2)) {
      let x = (W - (row.reduce((a, b) => a + b.w, 0) + (row.length - 1) * 14)) / 2;
      for (const ch of row) {
        rr(ctx, x, y - 42, ch.w, 60, 30);
        ctx.fillStyle = "rgba(255,122,26,0.22)";
        ctx.fill();
        ctx.fillStyle = "#ffb27a";
        ctx.textAlign = "left";
        ctx.fillText(ch.s, x + 24, y);
        x += ch.w + 14;
      }
      y += 76;
    }
    ctx.textAlign = "center";
  }

  // Links
  if (pr?.links.length) {
    y += 20;
    ctx.font = `600 34px ${BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const line = pr.links.slice(0, 3).map((l) => `${LINK_LABEL[l.kind]} ${linkText(l)}`).join("   ·   ");
    for (const l of wrap(ctx, line, W - 160, 2)) {
      ctx.fillText(l, W / 2, y);
      y += 50;
    }
  }

  // Platte des Moments
  const bottom = H - 400;
  if (pr?.spotlight) {
    const by = Math.max(y + 30, bottom - 280);
    rr(ctx, 80, by, W - 160, 230, 36);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fill();
    drawCover(ctx, spot, 110, by + 30, 170, 16);
    ctx.textAlign = "left";
    ctx.fillStyle = ACCENT;
    ctx.font = `800 26px ${BODY}`;
    ctx.letterSpacing = "3px";
    ctx.fillText("PLATTE DES MOMENTS", 310, by + 78);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#fff";
    ctx.font = `800 44px ${BODY}`;
    ctx.fillText(fit(ctx, pr.spotlight.title, W - 160 - 260), 310, by + 132);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `500 34px ${BODY}`;
    ctx.fillText(fit(ctx, pr.spotlight.artist, W - 160 - 260), 310, by + 180);
  }

  // Fuß: QR zum Hinzufügen
  const fy = H - 300;
  rr(ctx, 80, fy, W - 160, 220, 36);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fill();
  ctx.drawImage(code, 110, fy + 25, 170, 170);
  ctx.textAlign = "left";
  ctx.fillStyle = "#0b0b0c";
  ctx.font = `900 46px ${HEAD}`;
  ctx.fillText("Folg mir auf Crate", 310, fy + 95);
  ctx.font = `500 32px ${BODY}`;
  ctx.fillStyle = "#444";
  ctx.fillText(fit(ctx, "Code scannen, Sammlungen vergleichen", W - 160 - 260), 310, fy + 145);
  return toBlob(c);
}

// ---------------------------------------------------------------------------
export interface SetCardTrack {
  title: string;
  artist: string;
  bpm?: number | null;
  key?: string | null;
  cover?: string;
}
export interface SetCardInput {
  name: string;
  date?: string;
  venue?: string;
  dj?: string;
  tracks: SetCardTrack[];
  stats?: string;
}

export async function renderSetCard(s: SetCardInput): Promise<Blob> {
  await fonts();
  const covers = await Promise.all([...new Map(s.tracks.filter((t) => t.cover).map((t) => [t.cover, t])).values()].slice(0, 5).map((t) => loadImg(t.cover)));
  const { c, ctx } = canvas();
  backdrop(ctx, covers.find(Boolean) ?? null);
  wordmark(ctx, 150, "Crate");

  // Cover-Fächer
  const size = 230;
  const n = covers.length;
  if (n) {
    const step = Math.min(170, (W - 160 - size) / Math.max(1, n - 1));
    const x0 = (W - (size + step * (n - 1))) / 2;
    covers.forEach((img, i) => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 40;
      drawCover(ctx, img, x0 + i * step, 220 + Math.abs(i - (n - 1) / 2) * 18, size, 16);
      ctx.restore();
    });
  }

  let y = n ? 600 : 300;
  ctx.textAlign = "center";
  const setTitle = s.name.toUpperCase();
  condensed(ctx, true);
  const px = fitFont(ctx, setTitle, W - 160, 2, 140, 76);
  ctx.font = `900 ${stretch()}${px}px ${HEAD}`;
  ctx.fillStyle = "#fff";
  for (const l of wrap(ctx, setTitle, W - 160, 2)) {
    ctx.fillText(l, W / 2, y);
    y += px * 0.92;
  }
  condensed(ctx, false);
  const meta = [s.date ? new Date(s.date).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : null, s.venue, s.dj ? `mit ${s.dj}` : null].filter(Boolean).join("  ·  ");
  if (meta) {
    ctx.font = `500 36px ${BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(fit(ctx, meta, W - 160), W / 2, y + 4);
    y += 60;
  }

  // Tracklist
  y += 30;
  const rowH = 84;
  const maxRows = Math.max(4, Math.floor((H - 220 - y) / rowH));
  const shown = s.tracks.slice(0, s.tracks.length > maxRows ? maxRows - 1 : maxRows);
  ctx.textAlign = "left";
  shown.forEach((t, i) => {
    const ry = y + i * rowH;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `700 30px ${BODY}`;
    ctx.fillText(String(i + 1).padStart(2, "0"), 80, ry + 48);
    // Rechts: BPM und Tonart
    ctx.textAlign = "right";
    let right = W - 80;
    if (t.key) {
      ctx.font = `800 28px ${BODY}`;
      const kw = ctx.measureText(t.key).width + 28;
      rr(ctx, right - kw, ry + 18, kw, 42, 21);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(t.key, right - 14, ry + 48);
      right -= kw + 16;
    }
    if (t.bpm) {
      ctx.font = `800 32px ${BODY}`;
      ctx.fillStyle = "#fff";
      ctx.fillText(String(Math.round(t.bpm)), right, ry + 50);
      right -= ctx.measureText("000").width + 22;
    }
    ctx.textAlign = "left";
    const textW = right - 150;
    ctx.font = `700 34px ${BODY}`;
    ctx.fillStyle = "#fff";
    const titleText = fit(ctx, t.title, textW);
    ctx.fillText(titleText, 150, ry + 34);
    ctx.font = `500 26px ${BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(fit(ctx, t.artist, textW), 150, ry + 70);
  });
  y += shown.length * rowH;
  if (s.tracks.length > shown.length) {
    ctx.font = `600 30px ${BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(`+ ${s.tracks.length - shown.length} weitere Tracks`, 150, y + 40);
  }

  // Fuß
  ctx.textAlign = "center";
  if (s.stats) {
    ctx.font = `600 32px ${BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(fit(ctx, s.stats, W - 160), W / 2, H - 150);
  }
  ctx.font = `800 26px ${BODY}`;
  ctx.fillStyle = ACCENT;
  ctx.letterSpacing = "4px";
  ctx.fillText("KURATIERT MIT CRATE", W / 2, H - 90);
  ctx.letterSpacing = "0px";
  return toBlob(c);
}

/** Bild teilen (Teilen-Menü des Handys) oder herunterladen */
export async function shareImage(blob: Blob, filename: string, text?: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "downloaded";
}
