// Sticker für die Außenhülle. Alles in mm, damit Vorschau und Druck identisch sind.
// Bewusst Schwarz auf Weiß: Etikettendrucker können nichts anderes, und auf dem Bogen spart es Tinte.
// Farbe gibt es nur für die Tonart-Etiketten (abschaltbar über „Schwarz-Weiß-Drucker“).
import { FONTS, headStyle, MONO, stars, type PrintItem, type PrintOpts } from "./types";
import { bpmText, capsLine, catnoOf, cleanLabel, groupSides, InlineVersion, KeyTag, mm, palette, SideTag, keyGuess } from "./kit";

export function Sticker({ s, w, h, o, thermal }: { s: PrintItem; w: number; h: number; o: PrintOpts; thermal?: boolean }) {
  // Thermodrucker: nie Farbe, auch wenn sie eingeschaltet ist
  const opt = thermal ? { ...o, mono: true } : o;
  const pal = palette("light", opt);
  const F = FONTS[o.font ?? "schmal"] ?? FONTS.schmal;
  const { r } = s;
  const label = r.labels[0];
  const sides = groupSides(s.tracks);
  const padX = 2.6, padY = 2.2;
  const inner = w - padX * 2;
  const qrSize = o.showQr && s.qr ? Math.min(10.5, h * 0.28) : 0;
  const headW = inner - (qrSize ? qrSize + 2 : 0);
  const big = o.headline === "title" ? r.title : r.artist;
  const small = o.headline === "title" ? r.artist : r.title;
  // Überschrift einzeilig: so groß, wie der Name erlaubt
  const headSize = Math.max(2.9, Math.min(F.upper && F.cw < 0.5 ? 5.4 : 3.9, headW / (Math.max(6, big.length) * F.cw)));
  const headerH = Math.max(qrSize, headSize * 0.98 + 3.3 + 2.9) + 1.2;
  const avail = h - padY * 2 - headerH - 1.4;

  const hasBpm = o.showBpm && s.tracks.some((t) => t.meta?.bpm);
  const hasKey = (o.showCamelot || o.showKey) && s.tracks.some((t) => t.meta?.key);
  let hasEnergy = o.showEnergy && s.tracks.some((t) => t.meta?.energy != null);
  let hasDur = o.showDuration && s.tracks.some((t) => t.duration);
  const multi = sides.length > 1;

  // Schriftgröße so wählen, dass alle Tracks passen; viele Tracks kommen in zwei Spalten
  const gapPerSide = 0.5;
  const fits = (lh: number, cols: number) => {
    const per = Math.ceil(sides.length / cols);
    let tallest = 0;
    for (let c = 0; c < cols; c++) tallest = Math.max(tallest, sides.slice(c * per, (c + 1) * per).reduce((a, [, ts]) => a + ts.length * lh + gapPerSide, 0));
    return tallest <= avail;
  };
  let cols = 1;
  let lineH = 3.5;
  while (lineH > 2.35 && !fits(lineH, 1)) lineH -= 0.05;
  if (!fits(lineH, 1) && multi && w >= 60) {
    cols = 2;
    lineH = 3.2;
    while (lineH > 1.8 && !fits(lineH, 2)) lineH -= 0.05;
  } else if (!fits(lineH, 1)) {
    while (lineH > 1.8 && !fits(lineH, 1)) lineH -= 0.05;
  }
  const fs = lineH * 0.8;
  // Schmale Etiketten in zwei Spalten: lieber lesbare Titel als Energie und Länge
  if (cols === 2 && (inner - 3) / 2 < 40) {
    hasEnergy = false;
    hasDur = false;
  }
  const per = Math.ceil(sides.length / cols);
  const columns = Array.from({ length: cols }, (_, c) => sides.slice(c * per, (c + 1) * per));
  const posLen = Math.max(1, ...s.tracks.map((x) => x.position.length));
  const bpmLen = Math.max(3, ...s.tracks.map((t) => bpmText(t).length));
  const tag = lineH * 0.92;

  return (
    <div style={{ width: mm(w), height: mm(h), padding: `${mm(padY)} ${mm(padX)}`, boxSizing: "border-box", color: pal.fg, background: pal.bg, fontFamily: F.body, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: mm(2), height: mm(headerH), flex: "none", boxSizing: "border-box", borderBottom: `0.5mm solid ${pal.fg}`, marginBottom: mm(1.4) }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...headStyle(o.font), fontSize: mm(headSize), lineHeight: 0.98, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{big}</div>
          <div style={{ fontSize: mm(2.75), lineHeight: mm(3.3), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{small}</div>
          <div style={{ ...capsLine(1.95, pal.muted), lineHeight: mm(2.9), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {[[cleanLabel(label?.name), catnoOf(label)].filter(Boolean).join(" "), r.year || null, o.showStyles ? r.styles.slice(0, 2).join(" / ") : null, o.showCondition && s.media ? s.media : null, o.showShelf ? s.shelf : null, o.showRating ? stars(s.rating) : null, o.footer || null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {qrSize > 0 && <img src={s.qr} style={{ width: mm(qrSize), height: mm(qrSize), flex: "none" }} alt="" />}
      </div>
      <div style={{ display: "flex", gap: mm(3), flex: 1, minHeight: 0 }}>
        {columns.map((blocks, ci) => (
          <div key={ci} style={{ flex: 1, minWidth: 0 }}>
            {blocks.map(([side, ts]) => (
              <div key={side} style={{ marginBottom: mm(gapPerSide) }}>
                {ts.map((t, i) => (
                  <div key={t.position} style={{ display: "flex", alignItems: "center", gap: mm(1), height: mm(lineH), fontSize: mm(fs), whiteSpace: "nowrap" }}>
                    {multi && <span style={{ width: mm(tag), flex: "none", display: "flex" }}>{i === 0 ? <SideTag side={side} size={tag} pal={pal} /> : null}</span>}
                    <span style={{ width: mm(posLen * fs * 0.6 + 0.4), flex: "none", fontFamily: MONO, fontWeight: 700, fontSize: mm(fs * 0.92), color: pal.muted }}>{t.position}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                      {t.meta?.artist && t.meta.artist !== r.artist ? `${t.meta.artist} – ` : ""}
                      <InlineVersion title={t.title} />
                    </span>
                    {hasDur && <span style={{ flex: "none", fontFamily: MONO, fontSize: mm(fs * 0.86), color: pal.muted }}>{t.duration}</span>}
                    {hasBpm && <span style={{ flex: "none", width: mm(bpmLen * fs * 0.6), textAlign: "right", fontFamily: MONO, fontWeight: 800 }}>{bpmText(t)}</span>}
                    {hasKey && (
                      <span style={{ flex: "none", width: mm(fs * 2.25), textAlign: "right", lineHeight: 1 }}>
                        <KeyTag k={t.meta?.key} size={fs} pal={pal} o={opt} unsure={keyGuess(t.meta)} />
                      </span>
                    )}
                    {hasEnergy && <span style={{ flex: "none", width: mm(fs * 1.5), textAlign: "right", fontFamily: MONO, fontSize: mm(fs * 0.86), color: pal.muted }}>{t.meta?.energy != null ? `E${t.meta.energy}` : ""}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
