// Versand-Schätzung, verständlich: woher kommt die Platte, was kostet die erste, was jede weitere.
import { money } from "../lib/format";
import { countryName, DEFAULT_SHIP, HOME_COUNTRIES, type ShipConfig, type ShipRegion } from "../../../shared/shipping";

const num = (v: string) => Math.max(0, Number(v.replace(",", ".")) || 0);

export function ShippingEditor({ value, onChange }: { value: ShipConfig; onChange: (v: ShipConfig) => void }) {
  const home = countryName(value.home);
  const rows: [ShipRegion, string, string][] = [
    ["home", `Händler aus ${home}`, "Inland"],
    ["eu", "Händler aus der EU", value.home === "Switzerland" || value.home === "UK" ? "mit Zoll" : "z. B. Niederlande, Frankreich"],
    ["world", "Rest der Welt", "UK, USA, Japan, oft mit Zoll"],
  ];
  const set = (r: ShipRegion, k: "first" | "extra", v: string) => onChange({ ...value, rates: { ...value.rates, [r]: { ...value.rates[r], [k]: num(v) } } });
  const ex = (r: ShipRegion) => value.rates[r].first + 2 * value.rates[r].extra;
  const isDefault = JSON.stringify(value.rates) === JSON.stringify(DEFAULT_SHIP.rates);

  return (
    <div className="ship">
      <p className="sub" style={{ margin: 0 }}>
        Viele Angebote nennen keinen Versand. Dann schätzt Crate ihn nach dem Land des Händlers. Mehrere Platten vom selben Händler kommen in ein Paket, deshalb kostet jede weitere nur wenig.
      </p>
      <label className="ship-home">
        <span>Ich wohne in</span>
        <select className="input" value={value.home} onChange={(e) => onChange({ ...value, home: e.target.value })}>
          {HOME_COUNTRIES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {rows.map(([r, label, hint]) => (
        <div key={r} className="ship-row">
          <div className="ship-label">
            <b>{label}</b>
            <small>{hint}</small>
          </div>
          <label className="ship-field">
            <small>1. Platte</small>
            <span>
              <input className="input" inputMode="decimal" value={String(value.rates[r].first).replace(".", ",")} onChange={(e) => set(r, "first", e.target.value)} aria-label={`${label}: Versand erste Platte in Euro`} />€
            </span>
          </label>
          <label className="ship-field">
            <small>jede weitere</small>
            <span>
              +<input className="input" inputMode="decimal" value={String(value.rates[r].extra).replace(".", ",")} onChange={(e) => set(r, "extra", e.target.value)} aria-label={`${label}: Aufschlag je weitere Platte in Euro`} />€
            </span>
          </label>
        </div>
      ))}
      <div className="ship-example">
        <b>Beispiel:</b> 3 Platten von einem Händler kosten etwa {money(ex("home"))} Versand aus {home}, {money(ex("eu"))} aus der EU und {money(ex("world"))} aus dem Rest der Welt.
      </div>
      {!isDefault && (
        <button className="btn small ghost" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => onChange({ ...value, rates: DEFAULT_SHIP.rates })}>
          Typische Werte wiederherstellen
        </button>
      )}
      <p className="tiny" style={{ margin: 0 }}>Nur eine Schätzung für den Vergleich. Den echten Betrag zeigt Discogs im Warenkorb.</p>
    </div>
  );
}
