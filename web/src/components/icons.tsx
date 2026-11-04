// Schlichte Linien-Icons (24px), inline, ohne externe Bibliothek
const P = (d: string) => () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
export const IconHome = P("M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z");
export const IconSearch = P("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5");
export const IconRecord = P("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 7a5 5 0 0 0-5 5");
export const IconHeart = P("M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z");
export const IconList = P("M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01");
export const IconCamera = P("M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z");
export const IconCart = P("M3 4h2l2.5 11h11L21 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z");
export const IconTag = P("M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM8 8h.01");
export const IconGear = P("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z");
export const IconPlus = P("M12 5v14M5 12h14");
export const IconBack = P("M15 18l-6-6 6-6");
export const IconSync = P("M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5");
export const IconUp = P("M12 19V5M5 12l7-7 7 7");
export const IconDown = P("M12 5v14M19 12l-7 7-7-7");
export const IconX = P("M18 6L6 18M6 6l12 12");
export const IconBarcode = P("M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14");
export const IconPlay = P("M7 4l13 8-13 8z");
