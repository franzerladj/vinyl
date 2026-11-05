// Logo „Die Kiste“ (Quelle der Icons: tools/brand/logo.cjs) und Wortmarke.

/** Kiste mit gezogener Platte. animate: die Platte rutscht beim Einblenden aus der Kiste. */
export function LogoMark({ size = 120, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg className={`logo-mark${animate ? " animate" : ""}`} width={size} height={size} viewBox="60 70 392 380" aria-hidden="true">
      <g className="logo-sleeves">
        <g transform="rotate(-11 200 220)">
          <rect x="104" y="112" width="196" height="196" rx="6" fill="#e9dfcc" />
        </g>
        <g transform="rotate(9 320 220)">
          <rect x="214" y="104" width="196" height="196" rx="6" fill="#c9b99c" />
        </g>
      </g>
      <g className="logo-disc">
        <circle cx="256" cy="196" r="118" fill="#0b0908" />
        <g fill="none" stroke="#2b2420" strokeWidth="3">
          <circle cx="256" cy="196" r="104" />
          <circle cx="256" cy="196" r="90" />
          <circle cx="256" cy="196" r="76" />
          <circle cx="256" cy="196" r="62" />
        </g>
        <circle cx="256" cy="196" r="40" fill="#ff5b14" />
        <circle cx="256" cy="196" r="7" fill="#0b0908" />
      </g>
      <rect x="72" y="262" width="368" height="178" rx="30" fill="#ff5b14" />
      <rect x="72" y="262" width="368" height="22" rx="11" fill="#ff7a3a" />
      <rect x="196" y="306" width="120" height="38" rx="19" fill="#16120f" />
      <rect x="104" y="384" width="304" height="8" rx="4" fill="#d9470b" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`wordmark ${className}`}>Crate</span>;
}
