// Lokale Datenbank im Browser (IndexedDB). Discogs bleibt die Quelle, hier liegen Cache + eigene Daten.
import Dexie, { type Table } from "dexie";
import type { DLabel, DFormat, DTrack, DVideo } from "./types";
import type { Listing } from "../../../shared/optimizer";

export interface Release {
  id: number;
  title: string;
  artist: string;
  year: number;
  labels: DLabel[];
  formats: DFormat[];
  genres: string[];
  styles: string[];
  thumb: string;
  cover: string;
  country?: string;
  tracklist?: DTrack[];
  videos?: DVideo[];
  masterId?: number;
  /** Matrix/Runout, Barcode (undefined = noch nicht geladen) */
  identifiers?: { type: string; value: string; description?: string }[];
  /** Presswerk, Schnitt, Mastering, Vertrieb */
  companies?: { name: string; entity_type_name: string }[];
  detailFetchedAt?: number;
  community?: { have: number; want: number };
}

export interface CollectionItem {
  instanceId: number;
  releaseId: number;
  folderId: number;
  dateAdded: string;
  rating: number;
  /** Zustand nach Goldmine, Discogs-Wert wie „Very Good Plus (VG+)“ */
  media?: string;
  sleeve?: string;
  /** Freitext-Notiz aus Discogs */
  note?: string;
}

export interface Want {
  releaseId: number;
  dateAdded: string;
  rating: number;
  notes?: string;
}

/** Eigene Track-Daten. id = `${releaseId}:${position}` */
export interface TrackMeta {
  id: string;
  releaseId: number;
  position: string;
  title: string;
  artist: string;
  bpm?: number | null;
  key?: string | null;
  energy?: number | null;
  moods?: string[];
  stars?: number; // 0..5, eigene Bewertung
  notes?: string;
  previewUrl?: string | null;
  bpmSource?: string;
  keySource?: string;
  /** Woher Energie und Vibes stammen: "manuell", "Claude", "Styles + BPM + Audio" … */
  vibeSource?: string;
  /** Energie aus der Analyse der Hörprobe (1..10) */
  audioEnergy?: number | null;
  analyzedAt?: number;
  /** Zugeordneter Deezer-Track (für Hörprobe und Analyse des richtigen Mixes) */
  deezerId?: number | null;
  /** Fehlgeschlagene Analyse-Versuche (nach 3 wird aufgegeben) */
  analyzeTries?: number;
  lookedUpAt?: number;
  /** Cue-Punkte zum Mixen: wie reinkommen (z. B. „Intro 32 Takte“) und wie raus (z. B. „ab 5:40“) */
  cueIn?: string;
  cueOut?: string;
}

export interface RecordMeta {
  releaseId: number;
  shelf?: string; // Regalplatz, z.B. "Kallax 3 · Fach B"
  stickerPrintedAt?: number | null;
  tags?: string[];
  /** Verliehen an (Discogs-Name eines Freundes oder freier Name) */
  lentTo?: string | null;
  lentAt?: number | null;
  crates?: string[]; // Gig-Taschen
}

export interface DJSet {
  id?: number;
  name: string;
  date?: string;
  /** Beginn und Ende (HH:MM) für den Kalender */
  start?: string;
  end?: string;
  /** Wann zuletzt in einen Kalender übernommen */
  calendarAt?: number;
  venue?: string;
  curve: string;
  trackIds: string[];
  played?: string[];
  /** Nur Platten aus diesem Discogs-Ordner vorschlagen (leer = ganze Sammlung) */
  folderId?: number;
  /** Eingepackte Platten (Release-IDs): die Kiste für diesen Abend */
  crateIds?: number[];
  /** Mix-Notizen pro Übergang, Schlüssel = ID des Tracks, der reinkommt */
  mixNotes?: Record<string, string>;
  createdAt: number;
  notes?: string;
}

export interface MarketStat {
  releaseId: number;
  lowest: number | null;
  currency: string;
  numForSale: number;
  fetchedAt: number;
}

export interface PricePoint {
  id?: number;
  releaseId: number;
  at: number;
  lowest: number | null;
  numForSale: number;
}

export interface PriceSuggestion {
  releaseId: number;
  /** Discogs-Preisempfehlung je Zustand, z.B. { "VG+": 18.5, "NM": 24 } */
  values: Record<string, number>;
  currency: string;
  fetchedAt: number;
}

export interface WantMeta {
  releaseId: number;
  targetPrice?: number | null;
}

export interface Seller {
  name: string;
  favorite: boolean;
  addedAt: number;
  lastScan?: number;
  lastHits?: number;
}

export interface Friend {
  username: string;
  name?: string;
  avatar?: string;
  location?: string;
  addedAt: number;
  lastSync?: number;
  /** null = privat oder noch nicht geladen */
  numCollection?: number | null;
  numWantlist?: number | null;
  collectionPrivate?: boolean;
  wantsPrivate?: boolean;
}

/** Eine Platte in Sammlung oder Wantlist eines Freundes. key = `${username}:${kind}:${releaseId}` */
export interface FriendItem {
  key: string;
  username: string;
  kind: "coll" | "want";
  releaseId: number;
  dateAdded: string;
}

export interface StoredListing extends Listing {
  importedAt: number;
}

class CrateDB extends Dexie {
  releases!: Table<Release, number>;
  collection!: Table<CollectionItem, number>;
  wants!: Table<Want, number>;
  tracks!: Table<TrackMeta, string>;
  recordMeta!: Table<RecordMeta, number>;
  sets!: Table<DJSet, number>;
  marketStats!: Table<MarketStat, number>;
  listings!: Table<StoredListing, string>;
  kv!: Table<{ key: string; value: unknown }, string>;
  priceHistory!: Table<PricePoint, number>;
  priceSuggestions!: Table<PriceSuggestion, number>;
  wantMeta!: Table<WantMeta, number>;
  sellers!: Table<Seller, string>;
  friends!: Table<Friend, string>;
  friendItems!: Table<FriendItem, string>;

  constructor() {
    super("crate");
    this.version(1).stores({
      releases: "id, artist, title, year, *styles, *genres",
      collection: "instanceId, releaseId, folderId, dateAdded",
      wants: "releaseId, dateAdded",
      tracks: "id, releaseId, bpm, key, energy",
      recordMeta: "releaseId, shelf, stickerPrintedAt, *crates",
      sets: "++id, createdAt",
      marketStats: "releaseId, fetchedAt",
      listings: "listingId, releaseId, seller",
      kv: "key",
    });
    // v2: Preisverlauf, Preisempfehlungen, Wunschpreise, Lieblingshändler
    this.version(2).stores({
      priceHistory: "++id, releaseId, at",
      priceSuggestions: "releaseId, fetchedAt",
      wantMeta: "releaseId",
      sellers: "name, favorite",
    });
    // v3: Freunde und deren Sammlungen/Wantlists
    this.version(3).stores({
      friends: "username, addedAt",
      friendItems: "key, username, releaseId, [username+kind]",
    });
  }
}

export const db = new CrateDB();

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return (row?.value as T) ?? fallback;
}
export const setKV = (key: string, value: unknown) => db.kv.put({ key, value });

/** Vinyl-Tracks (ohne Überschriften/Index-Einträge) */
export const realTracks = (tl: DTrack[] = []) => tl.filter((t) => (t.type_ ?? "track") === "track");

/** Track-ID für eigene Metadaten */
export const trackId = (releaseId: number, position: string, index: number) => `${releaseId}:${position || `#${index + 1}`}`;
