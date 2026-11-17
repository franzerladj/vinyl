/** Tonarm: schwenkt beim Abspielen auf die Platte (Platten-Seite, Platte des Tages) */
export function ToneArm({ down }: { down: boolean }) {
  return (
    <svg className={`tonearm${down ? " down" : ""}`} viewBox="0 0 60 260" aria-hidden="true">
      {/* Lager mit Gegengewicht */}
      <circle cx="30" cy="30" r="22" className="ta-base" />
      <rect x="21" y="2" width="18" height="22" rx="4" className="ta-weight" />
      <circle cx="30" cy="30" r="7" className="ta-pivot" />
      {/* Rohr mit Knick zum Headshell */}
      <path d="M30 30 L30 196 L18 226" className="ta-tube" />
      <rect x="4" y="220" width="22" height="34" rx="3" transform="rotate(24 15 237)" className="ta-head" />
    </svg>
  );
}
