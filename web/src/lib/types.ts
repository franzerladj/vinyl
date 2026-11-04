// Discogs-Antworttypen (nur die Felder, die die App nutzt)
export interface DArtist { name: string; anv?: string; join?: string; id?: number }
export interface DLabel { name: string; catno: string; id?: number }
export interface DFormat { name: string; qty?: string; descriptions?: string[] }
export interface DTrack { position: string; title: string; duration?: string; type_?: string; artists?: DArtist[] }
export interface DVideo { uri: string; title: string; duration?: number }

export interface BasicInformation {
  id: number;
  title: string;
  year: number;
  thumb: string;
  cover_image: string;
  artists: DArtist[];
  labels: DLabel[];
  formats: DFormat[];
  genres?: string[];
  styles?: string[];
}

export interface DRelease extends BasicInformation {
  country?: string;
  tracklist: DTrack[];
  videos?: DVideo[];
  images?: { uri: string; uri150: string; type: string }[];
  identifiers?: { type: string; value: string }[];
  uri: string;
  master_id?: number;
  lowest_price?: number | null;
  num_for_sale?: number;
  notes?: string;
  community?: { have: number; want: number; rating?: { average: number; count: number } };
}

export interface Pagination { page: number; pages: number; per_page: number; items: number }

export interface SearchResult {
  id: number;
  type: "release" | "master" | "artist" | "label";
  title: string;
  thumb: string;
  cover_image: string;
  year?: string;
  country?: string;
  format?: string[];
  label?: string[];
  catno?: string;
  genre?: string[];
  style?: string[];
  master_id?: number;
  community?: { have: number; want: number };
}
