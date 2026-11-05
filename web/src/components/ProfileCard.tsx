// Crate-Profil, wie Freunde es sehen: Name, Ort, Bio, Links, Styles, Platte des Moments, Setup
import { Link } from "react-router-dom";
import { GEAR, linkText, LINK_LABEL, PLAY_LABEL, type CrateProfile } from "../../../shared/profile";
import { Avatar, Cover } from "./bits";

const LINK_COLOR: Record<string, string> = {
  instagram: "#e1306c",
  soundcloud: "#ff5500",
  mixcloud: "#5000ff",
  bandcamp: "#1da0c3",
  spotify: "#1db954",
  youtube: "#ff0000",
  tiktok: "#111111",
  residentadvisor: "#111111",
  discogs: "#333333",
  web: "var(--accent)",
};

export function ProfileHeader({ username, avatar, discogsName, location, profile, children }: { username: string; avatar?: string; discogsName?: string; location?: string; profile: CrateProfile | null; children?: React.ReactNode }) {
  const title = profile?.djName || discogsName || username;
  const sub = [profile?.djName || discogsName ? username : null, profile?.location || location].filter(Boolean).join(" · ");
  return (
    <div className="pcard">
      <Avatar src={avatar} name={username} size={96} />
      <h1>{title}</h1>
      {sub && <div className="sub">{sub}</div>}
      {profile?.bio && <p className="pcard-bio">{profile.bio}</p>}
      {profile?.links.length ? (
        <div className="pcard-links">
          {profile.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="pcard-link press" title={LINK_LABEL[l.kind]}>
              <i style={{ background: LINK_COLOR[l.kind] }}>{LINK_LABEL[l.kind][0]}</i>
              {linkText(l)}
            </a>
          ))}
        </div>
      ) : null}
      {profile?.styles.length ? (
        <div className="pcard-styles">
          {profile.styles.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      ) : null}
      {children}
      {profile?.spotlight && (
        <Link to={`/release/${profile.spotlight.id}`} viewTransition className="pcard-spot press">
          <Cover src={profile.spotlight.cover} />
          <span>
            <small>Platte des Moments</small>
            <b>{profile.spotlight.title}</b>
            <span>{profile.spotlight.artist}</span>
          </span>
        </Link>
      )}
      {(profile?.setup || profile?.plays) && <SetupRider profile={profile} />}
    </div>
  );
}

/** Setup wie ein Technical Rider: Platz in Mono, Gerät daneben */
export function SetupRider({ profile }: { profile: CrateProfile }) {
  const rows = GEAR.filter((g) => profile.setup?.[g.id]);
  return (
    <div className="rider">
      <div className="rider-head">
        <span>Setup</span>
        {profile.plays && <b className={profile.plays === "vinyl" ? "on" : ""}>{PLAY_LABEL[profile.plays]}</b>}
      </div>
      {rows.length > 0 && (
        <dl>
          {rows.map((g) => (
            <div key={g.id}>
              <dt>{g.short}</dt>
              <dd>{profile.setup![g.id]}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
