// Logo „C mit Rillen“ (Quelle der Icons: tools/brand/logo.cjs) und Schriftzug „crate“.

/** Zwei Rillen bilden ein C, in der Mitte das Loch der Platte. animate: die Rillen drehen sich beim Einblenden ein. */
export function LogoMark({ size = 120, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg className={`logo-mark${animate ? " animate" : ""}`} width={size} height={size} viewBox="40 40 432 432" aria-hidden="true">
      <path className="logo-groove outer" d="M372 140A164 164 0 1 0 372 372" fill="none" strokeWidth="44" strokeLinecap="round" />
      <path className="logo-groove inner" d="M323 189A95 95 0 1 0 323 323" fill="none" strokeWidth="44" strokeLinecap="round" />
      <circle className="logo-hole" cx="256" cy="256" r="24" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`wordmark ${className}`}>crate</span>;
}
