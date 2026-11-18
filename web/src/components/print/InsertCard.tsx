// Einleger für die transparente Außenhülle: von außen lesbar, verdeckt das Cover nicht.
// Dazu der Obi-Streifen. Alle Maße in mm, damit Vorschau und Druck exakt gleich aussehen.
// Gestaltung wie ein Plattenlabel: Katalognummer oben, große schmale Überschrift, Seiten als Kästchen,
// Zahlen in Mono. Weiß braucht kaum Tinte; Farbe sitzt nur in kleinen Flächen.
import { splitVersion } from "../../../../shared/trackTitle";
import { FONTS, headStyle, MONO, stars, type PrintItem, type PrintOpts, type PrintTrack } from "./types";
import { Bars, bpmRange, bpmText, capsLine, catnoOf, clamp, cleanLabel, groupSides, InlineVersion, KeyTag, mm, palette, SideTag, Stamp, TitleLines, VERSION_SCALE, type CardTheme, type Pal } from "./kit";

export { DEFAULT_ACCENT, InlineVersion, VERSION_SCALE, type CardTheme } from "./kit";

/** Überschrift so groß wie möglich: längstes Wort passt in eine Zeile, das Ganze in zwei */
function fitHead(text: string, width: number, cw: number, max: number, min: number) {
  const longest = Math.max(3, ...text.split(/\s+/).map((w) => w.length));
  const size = Math.max(min, Math.min(max, width / (longest * cw), (width * 2) / (Math.max(4, text.length) * cw)));
  return { size, lines: text.length * cw * size > width ? 2 : 1 };
}

const conditionLine = (s: PrintItem) => [s.media ? `Platte ${s.media}` : null, s.sleeve ? `Hülle ${s.sleeve}` : null].filter(Boolean).join(" · ");

/** Hochformat- oder Quadrat-Karte (A6, 100 × 100 mm, A5) */
export function InsertCard({ s, w, h, o, theme }: { s: PrintItem; w: number; h: number; o: PrintOpts; theme: CardTheme }) {
  const pal = palette(theme, o);
  const F = FONTS[o.font ?? "schmal"] ?? FONTS.schmal;
  const { r } = s;
  const scale = w / 105; // A5 etwas größer setzen als A6
  const pad = Math.max(5, w * 0.058);
  const inner = w - pad * 2;
  const label = r.labels[0];
  const sides = groupSides(s.tracks);
  const cover = o.showCover ? r.cover || r.thumb : undefined;
  const big = o.headline === "title" ? r.title : r.artist;
  const small = o.headline === "title" ? r.artist : r.title;
  /** Kopf in voller oder verkleinerter Größe (hs): bei vielen Tracks auf kleiner Karte rückt er zusammen */
  const header = (hs: number) => {
    const coverSize = cover ? Math.min(30 * scale, inner * 0.3) * hs : 0;
    const textW = inner - coverSize - (coverSize ? 4 : 0);
    const head = fitHead(big, textW, F.cw, F.max * scale * hs, 4);
    const smallSize = Math.max(3.1, Math.min(5 * scale, head.size * 0.42));
    const smallLines = small.length * smallSize * 0.5 > textW ? 2 : 1;
    return { coverSize, head, smallSize, headerH: Math.max(coverSize, head.lines * head.size * 0.94 + 1.4 + smallLines * smallSize * 1.2) };
  };

  const cond = o.showCondition ? conditionLine(s) : "";
  const note = o.showNote ? (s.note ?? "").trim() : "";
  const stamp = o.stamp && o.footer ? o.footer : "";
  const footLines = [
    [cleanLabel(label?.name), r.country, o.showStyles ? r.styles.slice(0, 3).join(" / ") : null].filter(Boolean).join(" · "),
    [cond, o.showShelf && s.shelf ? `Regal ${s.shelf}` : null, o.showAdded && s.added ? `seit ${s.added}` : null].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const qrSize = o.showQr && s.qr ? 13 * Math.min(1.2, scale) : 0;
  const footTextH = footLines.length * 3.3 + (note ? 6.6 : 0) + (o.footer && !stamp ? 3.6 : 0) + (stamp ? 7.5 : 0);
  const footerH = Math.max(qrSize, footTextH) + 3.2;
  const topH = 5.6;
  const availFor = (hs: number) => h - pad * 2 - topH - header(hs).headerH - 6.6 - footerH;

  // Nur Spalten zeigen, zu denen es Daten gibt
  const hasBpm = o.showBpm && s.tracks.some((t) => t.meta?.bpm);
  const hasKey = (o.showCamelot || o.showKey) && s.tracks.some((t) => t.meta?.key);
  let hasEnergy = o.showEnergy && s.tracks.some((t) => t.meta?.energy != null);
  let hasDur = o.showDuration && s.tracks.some((t) => t.duration);
  const posLen = Math.max(1, ...s.tracks.map((t) => t.position.length));
  const bpmLen = Math.max(3, ...s.tracks.map((t) => bpmText(t).length));
  const fullTitle = (t: PrintTrack) => `${t.meta?.artist && t.meta.artist !== r.artist ? `${t.meta.artist} – ` : ""}${t.title}`;

  // Größte Zeilenhöhe suchen, bei der alle Titel (höchstens 2 Zeilen) hineinpassen.
  // Lange LPs (Doppel-LP, Compilations): Seiten auf zwei Spalten verteilen.
  const measure = (lh: number, cols: number) => {
    const f = lh * 0.62;
    const colW = (inner - (cols - 1) * 5) / cols;
    const posW = posLen * f * 0.6 + 1.6;
    const bpmW = hasBpm ? bpmLen * f * 0.6 + 1.6 : 0;
    const keyW = hasKey ? f * 2.3 + 1.6 : 0;
    const nrgW = hasEnergy ? f * 1.25 + 1.6 : 0;
    const durW = hasDur ? f * 0.6 * 5 + 1.6 : 0;
    const titleW = Math.max(6, colW - posW - bpmW - keyW - nrgW - durW);
    const perLine = titleW / (f * 0.53);
    // Version in Klammern steht immer in eigener Zeile, etwas kleiner (VERSION_SCALE)
    const lines = (t: PrintTrack) => {
      const { main, version } = splitVersion(fullTitle(t));
      const m = Math.min(2, Math.ceil(main.length / perLine));
      return version ? m + Math.min(2, Math.ceil(version.length / (perLine / VERSION_SCALE))) * VERSION_SCALE : m;
    };
    const headH = sides.length > 1 ? lh * 1.5 : 0;
    const sideH = sides.map(([, ts]) => headH + ts.reduce((a, t) => a + lines(t) * lh * 0.94 + lh * 0.1, 0) + lh * 0.45);
    // Seiten der Reihe nach auf Spalten verteilen, höchste Spalte zählt
    const per = Math.ceil(sides.length / cols);
    let total = 0;
    for (let c = 0; c < cols; c++) total = Math.max(total, sideH.slice(c * per, (c + 1) * per).reduce((a, b) => a + b, 0));
    return { f, posW, bpmW, keyW, nrgW, durW, titleW, total, per };
  };
  // Der Reihe nach probieren: großer Kopf mit einer Spalte, kleinerer Kopf, dann zwei Spalten
  const tryFit = (hs: number, c: number): number | null => {
    // Etwas Luft lassen: die Rechnung schätzt Umbrüche, der Browser setzt sie
    const avail = availFor(hs) - 2.5;
    let lh = (c === 1 ? 7.4 : 5.2) * scale;
    const min = (c === 1 ? 3.5 : 2.8) * Math.min(1.25, scale);
    while (lh > min && measure(lh, c).total > avail) lh -= 0.1;
    return measure(lh, c).total <= avail ? lh : null;
  };
  const twoOk = sides.length > 1;
  // Bringt der kleinere Kopf deutlich größere Titel, ist er die bessere Wahl (Tracks sind das, was man beim Auflegen liest)
  const full = tryFit(1, 1);
  const tight = tryFit(0.78, 1);
  const first: [number, number][] = full != null && tight != null && full < 4.8 * scale && tight - full > 0.5 ? [[0.78, 1], [1, 1]] : [[1, 1], [0.78, 1]];
  const plans: [number, number][] = [...first, ...(twoOk ? ([[1, 2], [0.78, 2], [0.6, 2]] as [number, number][]) : ([[0.6, 1]] as [number, number][]))];
  let hs = plans[plans.length - 1][0];
  let cols = plans[plans.length - 1][1];
  let lineH = cols === 1 ? 3.5 : 2.8;
  for (const [phs, pc] of plans) {
    if (pc === 2) {
      // In zwei Spalten ist wenig Platz: lieber ganze Titel als Energie-Balken und Längen
      if (measure(4, 2).titleW < 20) hasEnergy = false;
      if (measure(4, 2).titleW < 20) hasDur = false;
    }
    const lh = tryFit(phs, pc);
    if (lh != null) {
      hs = phs;
      cols = pc;
      lineH = lh;
      break;
    }
  }
  const { coverSize, head, smallSize, headerH } = header(hs);
  const m = measure(lineH, cols);
  const fs = m.f;
  const columns = Array.from({ length: cols }, (_, c) => sides.slice(c * m.per, (c + 1) * m.per));
  const year = [r.year || null, o.showRating ? stars(s.rating) : null].filter(Boolean).join("  ");

  return (
    <div style={{ position: "relative", width: mm(w), height: mm(h), background: pal.bg, color: pal.fg, overflow: "hidden", fontFamily: F.body, boxSizing: "border-box" }}>
      {o.frame && <div style={{ position: "absolute", inset: mm(pad * 0.45), border: `0.25mm solid ${pal.fg}`, pointerEvents: "none" }} />}
      <div style={{ position: "relative", height: "100%", padding: mm(pad), boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        {/* Katalognummer und Jahr, dazwischen eine Linie: wie die Kopfzeile eines Labels */}
        <div style={{ display: "flex", alignItems: "center", gap: mm(2), height: mm(topH - 2.6), marginBottom: mm(2.6), ...capsLine(2.5 * Math.min(1.15, scale), pal.fg) }}>
          <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{catnoOf(label) || cleanLabel(label?.name)}</span>
          <span style={{ flex: 1, height: "0.25mm", background: pal.fg }} />
          {year && <span style={{ whiteSpace: "nowrap" }}>{year}</span>}
        </div>

        {/* Kopf */}
        <div style={{ display: "flex", gap: mm(4), minHeight: mm(headerH), alignItems: "flex-start" }}>
          {cover && <img src={cover} alt="" style={{ width: mm(coverSize), height: mm(coverSize), objectFit: "cover", flex: "none", filter: o.mono ? "grayscale(1) contrast(1.1)" : undefined }} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ ...headStyle(o.font), fontSize: mm(head.size), lineHeight: 0.94, letterSpacing: F.upper ? "-0.005em" : "-0.01em", ...clamp(2) }}>{big}</div>
            <div style={{ fontWeight: 600, fontSize: mm(smallSize), lineHeight: 1.2, marginTop: mm(1.4), ...clamp(2) }}>{small}</div>
          </div>
        </div>

        <div style={{ height: "0.6mm", background: pal.fg, margin: `${mm(3.2)} 0 ${mm(2.8)}`, flex: "none" }} />

        {/* Tracks nach Seiten */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: mm(5), overflow: "hidden" }}>
          {columns.map((colSides, ci) => (
            <div key={ci} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: mm(lineH * 0.45) }}>
              {colSides.map(([side, ts]) => (
                <div key={side}>
                  {sides.length > 1 && (
                    <div style={{ display: "flex", alignItems: "center", gap: mm(1.6), height: mm(lineH * 1.15), marginBottom: mm(lineH * 0.35) }}>
                      <SideTag side={side} size={lineH * 1.05} pal={pal} />
                      <span style={{ ...capsLine(Math.max(2, fs * 0.62), pal.muted), whiteSpace: "nowrap" }}>Seite {side}</span>
                      <span style={{ flex: 1, height: "0.2mm", background: pal.hair }} />
                      {hasBpm && bpmRange(ts) && cols === 1 && <span style={{ ...capsLine(Math.max(2, fs * 0.62), pal.muted), whiteSpace: "nowrap" }}>{bpmRange(ts)} BPM</span>}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: mm(lineH * 0.1) }}>
                    {ts.map((tr) => (
                      <div key={tr.position} style={{ display: "flex", alignItems: "flex-start", minHeight: mm(lineH * 0.94), fontSize: mm(fs), lineHeight: mm(lineH * 0.94) }}>
                        <span style={{ width: mm(m.posW), flex: "none", fontFamily: MONO, fontWeight: 700, fontSize: mm(fs * 0.92), color: pal.muted, whiteSpace: "nowrap" }}>{tr.position}</span>
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 500, overflowWrap: "break-word" }}>
                          <TitleLines artist={tr.meta?.artist && tr.meta.artist !== r.artist ? tr.meta.artist : null} title={tr.title} muted={pal.muted} lineH={lineH * 0.94} />
                        </span>
                        {hasDur && <span style={{ width: mm(m.durW), flex: "none", textAlign: "right", fontFamily: MONO, fontSize: mm(fs * 0.86), color: pal.muted, whiteSpace: "nowrap" }}>{tr.duration}</span>}
                        {hasBpm && <span style={{ width: mm(m.bpmW), flex: "none", textAlign: "right", fontFamily: MONO, fontWeight: 800, whiteSpace: "nowrap" }}>{bpmText(tr)}</span>}
                        {hasKey && (
                          <span style={{ width: mm(m.keyW), flex: "none", textAlign: "right" }}>
                            <KeyTag k={tr.meta?.key} size={fs} pal={pal} o={o} />
                          </span>
                        )}
                        {hasEnergy && (
                          <span style={{ width: mm(m.nrgW), flex: "none", textAlign: "right", paddingTop: mm(fs * 0.12) }}>
                            <Bars v={tr.meta?.energy} size={fs} pal={pal} />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Fuß */}
        <div style={{ flex: "none", height: mm(footerH), boxSizing: "border-box", borderTop: `0.25mm solid ${pal.fg}`, paddingTop: mm(2), marginTop: mm(1.2), display: "flex", alignItems: "flex-end", gap: mm(3) }}>
          <div style={{ flex: 1, minWidth: 0, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: mm(0.5) }}>
            {note && <div style={{ fontSize: mm(2.7), lineHeight: 1.22, fontStyle: "italic", ...clamp(2) }}>{note}</div>}
            {footLines.map((l, i) => (
              <div key={i} style={{ ...capsLine(2.2, i ? pal.muted : pal.fg), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
            ))}
            {o.footer && !stamp && <div style={{ fontSize: mm(2.6), fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.footer}</div>}
            {stamp && (
              <div style={{ marginTop: mm(1.2), paddingLeft: mm(0.6) }}>
                <Stamp text={stamp} size={2.5} pal={pal} />
              </div>
            )}
          </div>
          {qrSize > 0 && <img src={s.qr} alt="" style={{ width: mm(qrSize), height: mm(qrSize), flex: "none" }} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Obi-Streifen: schmal und hoch, steckt seitlich in der Hülle wie bei japanischen Pressungen.
 * Aufbau wie das Vorbild: oben Streifen und Katalognummer im Kasten, in der Mitte der Name senkrecht,
 * unten ein Kasten mit dem Tempo (beim Original steht dort der Preis), dann Tracks oder Kurzfassung.
 */
export function ObiStrip({ s, w, h, o, theme, front }: { s: PrintItem; w: number; h: number; o: PrintOpts; theme: CardTheme; front?: boolean }) {
  const pal = palette(theme, o);
  const F = FONTS[o.font ?? "schmal"] ?? FONTS.schmal;
  const { r } = s;
  const label = r.labels[0];
  const pad = 4.2;
  const inner = w - pad * 2;
  const fs = 2.5;
  const lineH = 3.95;
  const sides = groupSides(s.tracks);
  const posLen = Math.max(1, ...s.tracks.map((x) => x.position.length));
  const bpmLen = o.showBpm ? Math.max(0, ...s.tracks.map((x) => bpmText(x).length)) : 0;
  const hasKey = (o.showCamelot || o.showKey) && s.tracks.some((x) => x.meta?.key);
  // Lange Titel dürfen zweizeilig werden (der Streifen ist schmal, in der Höhe ist Platz)
  const titleW = inner - (posLen * fs * 0.6 + 0.6) - (bpmLen ? bpmLen * fs * 0.6 + 1.1 : 0) - (hasKey ? fs * 2.1 + 1.1 : 0) - 1.1;
  const rowLines = (x: PrintTrack) => (x.title.length * fs * 0.5 > titleW ? 2 : 1);
  const rowH = (x: PrintTrack) => (rowLines(x) === 2 ? lineH * 1.62 : lineH);
  const sideRowH = sides.length > 1 ? 4.4 : 0;
  const tracksH = front ? 0 : s.tracks.reduce((a, x) => a + rowH(x), 0) + sides.length * (1.6 + sideRowH);
  const range = bpmRange(s.tracks);
  const keys = [...new Set(s.tracks.map((x) => x.meta?.key).filter(Boolean) as string[])].slice(0, 6);
  const boxH = front ? (range && o.showBpm ? 15 : 0) + (keys.length && (o.showCamelot || o.showKey) ? 6 : 0) : 0;
  const footH = 12 + (o.showQr && !front ? 4 : 0);
  // Platz für den senkrechten Text: Höhe minus Kopf, Tracks, Fuß
  const availH = Math.max(40, h - pad * 2 - 22 - tracksH - boxH - footH - 10);
  const big = o.headline === "title" ? r.title : r.artist;
  const small = o.headline === "title" ? r.artist : r.title;
  const head = fitHead(big, availH, F.cw, Math.min(inner * 0.46, 19), 5);
  const smallSize = Math.max(3.2, Math.min(head.size * 0.4, (availH * 2) / (Math.max(4, small.length) * 0.5)));

  return (
    <div style={{ position: "relative", width: mm(w), height: mm(h), background: pal.bg, color: pal.fg, overflow: "hidden", fontFamily: F.body }}>
      <div style={{ position: "relative", height: "100%", padding: mm(pad), boxSizing: "border-box", display: "flex", flexDirection: "column", gap: mm(2.6) }}>
        {/* Drei Streifen: das Erkennungszeichen eines Obi, kostet kaum Tinte */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.7mm", flex: "none" }}>
          <i style={{ height: "1.6mm", background: pal.mark }} />
          <i style={{ height: "0.5mm", background: pal.mark }} />
          <i style={{ height: "0.25mm", background: pal.mark }} />
        </div>
        <div style={{ flex: "none", border: `0.3mm solid ${pal.fg}`, padding: `${mm(1.3)} ${mm(1.6)}`, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: mm(1), ...capsLine(2.35, pal.fg) }}>
          <span style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{catnoOf(label) || cleanLabel(label?.name)}</span>
          <span style={{ whiteSpace: "nowrap" }}>{r.year || ""}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: mm(1.6), writingMode: "vertical-rl", overflow: "hidden" }}>
          <div style={{ ...headStyle(o.font), fontSize: mm(head.size), lineHeight: 0.92, letterSpacing: "-0.005em", maxHeight: "100%", overflow: "hidden" }}>{big}</div>
          <div style={{ fontWeight: 600, fontSize: mm(smallSize), lineHeight: 1.1, maxHeight: "100%", overflow: "hidden" }}>{small}</div>
        </div>
        {front ? (
          <ObiSummary range={o.showBpm ? range : ""} keys={o.showCamelot || o.showKey ? keys : []} count={s.tracks.length} pal={pal} o={o} />
        ) : (
          <div style={{ flex: "none", borderTop: `0.5mm solid ${pal.fg}`, paddingTop: mm(1.8) }}>
            {sides.map(([side, ts]) => (
              <div key={side} style={{ marginBottom: mm(1.6) }}>
                {sides.length > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: mm(1.2), height: mm(sideRowH - 0.8), marginBottom: mm(0.8) }}>
                    <SideTag side={side} size={3.3} pal={pal} />
                    <span style={{ flex: 1, height: "0.2mm", background: pal.hair }} />
                    {bpmLen > 0 && bpmRange(ts) && <span style={capsLine(1.9, pal.muted)}>{bpmRange(ts)}</span>}
                  </div>
                )}
                {ts.map((tr) => (
                  <div key={tr.position} style={{ display: "flex", alignItems: "flex-start", gap: mm(1.1), height: mm(rowH(tr)), fontSize: mm(fs), lineHeight: mm(lineH * 0.78), paddingTop: mm(lineH * 0.11), boxSizing: "border-box" }}>
                    <span style={{ width: mm(posLen * fs * 0.6 + 0.6), flex: "none", fontFamily: MONO, fontWeight: 700, fontSize: mm(fs * 0.9), color: pal.muted, whiteSpace: "nowrap" }}>{tr.position}</span>
                    <span style={{ flex: 1, minWidth: 0, ...clamp(rowLines(tr)), overflowWrap: "break-word" }}>
                      <InlineVersion title={tr.title} />
                    </span>
                    {bpmLen > 0 && <span style={{ flex: "none", fontFamily: MONO, fontWeight: 800, whiteSpace: "nowrap" }}>{bpmText(tr)}</span>}
                    {hasKey && (
                      <span style={{ flex: "none", width: mm(fs * 2.1), textAlign: "right" }}>
                        <KeyTag k={tr.meta?.key} size={fs} pal={pal} o={o} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div style={{ flex: "none", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: mm(2), borderTop: `0.25mm solid ${pal.fg}`, paddingTop: mm(1.6) }}>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: mm(0.4) }}>
            <div style={{ ...capsLine(2.1, pal.fg), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cleanLabel(label?.name)}</div>
            {o.showStyles && r.styles.length > 0 && <div style={{ ...capsLine(2, pal.muted), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.styles.slice(0, 2).join(" / ")}</div>}
            {o.showCondition && conditionLine(s) && <div style={{ ...capsLine(2, pal.muted), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{conditionLine(s)}</div>}
            {o.showShelf && s.shelf && <div style={capsLine(2, pal.muted)}>Regal {s.shelf}</div>}
            {o.showRating && s.rating ? <div style={{ fontSize: mm(2.4) }}>{stars(s.rating)}</div> : null}
            {front && o.footer && (o.stamp ? <div style={{ marginTop: mm(1), paddingLeft: mm(0.4) }}><Stamp text={o.footer} size={2.1} pal={pal} /></div> : <div style={{ fontSize: mm(2.3), fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.footer}</div>)}
          </div>
          {!front && o.showQr && s.qr && <img src={s.qr} alt="" style={{ width: mm(12), height: mm(12), flex: "none" }} />}
        </div>
      </div>
    </div>
  );
}

/** Vorderseite des Knick-Obis: Tempo im Kasten (beim japanischen Vorbild steht dort der Preis), darunter die Tonarten */
function ObiSummary({ range, keys, count, pal, o }: { range: string; keys: string[]; count: number; pal: Pal; o: PrintOpts }) {
  if (!range && !keys.length) return <div style={{ ...capsLine(2.2, pal.muted), flex: "none" }}>{count} Tracks</div>;
  return (
    <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: mm(1.8) }}>
      {range && (
        <div style={{ border: `0.5mm solid ${pal.fg}`, padding: `${mm(1.4)} ${mm(1.6)} ${mm(1.6)}`, textAlign: "center" }}>
          <div style={capsLine(2, pal.muted)}>Tempo</div>
          <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: mm(range.length > 5 ? 5.4 : 6.6), lineHeight: 1.05, letterSpacing: "-0.03em" }}>{range}</div>
          <div style={capsLine(2, pal.muted)}>BPM</div>
        </div>
      )}
      {keys.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: mm(1) }}>
          {keys.map((k) => (
            <KeyTag key={k} k={k} size={2.7} pal={pal} o={o} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Knick-Obi: Rückseite | Falz | Vorderseite. Wird um die linke Kante der Hülle gelegt.
 * Der Falz läuft senkrecht, deshalb stehen beide Hälften nach dem Knicken richtig herum.
 */
export function ObiFold({ s, w, h, o, theme }: { s: PrintItem; w: number; h: number; o: PrintOpts; theme: CardTheme }) {
  const pal = palette(theme, o);
  const spine = 4;
  const panel = (w - spine) / 2;
  const label = s.r.labels[0];
  return (
    <div style={{ position: "relative", display: "flex", width: mm(w), height: mm(h), background: pal.bg, overflow: "hidden" }}>
      <ObiStrip s={s} w={panel} h={h} o={o} theme={theme} />
      <div style={{ position: "relative", width: mm(spine), height: "100%", background: pal.bg, borderLeft: `0.2mm dashed ${pal.hair}`, borderRight: `0.2mm dashed ${pal.hair}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ writingMode: "vertical-rl", ...capsLine(1.9, pal.fg), fontWeight: 800, letterSpacing: "0.16em", whiteSpace: "nowrap" }}>{[catnoOf(label), s.r.artist, s.r.title].filter(Boolean).join("  ·  ")}</span>
      </div>
      <ObiStrip s={s} w={panel} h={h} o={o} theme={theme} front />
    </div>
  );
}
