import type { Release, TrackMeta } from "../../lib/db";

export interface PrintTrack {
  position: string;
  title: string;
  duration?: string;
  meta?: TrackMeta;
}

export interface PrintItem {
  r: Release;
  tracks: PrintTrack[];
  shelf?: string;
  qr?: string;
}

export interface PrintOpts {
  showBpm: boolean;
  showKey: boolean;
  showCamelot: boolean;
  showEnergy: boolean;
  showStyles: boolean;
  showShelf: boolean;
  showQr: boolean;
  showDuration: boolean;
  showCover: boolean;
}

/** Ein Druckformat: Größe eines Elements und Anordnung auf dem Blatt (alles in mm) */
export interface Layout {
  name: string;
  w: number;
  h: number;
  cols: number;
  rows: number;
  mx: number;
  my: number;
  gx: number;
  gy: number;
  page: string;
  cutMarks?: boolean;
}
