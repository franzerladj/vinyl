// Crate-Profil, wie Freunde es sehen: Name, Ort, Bio, Links, Styles, Platte des Moments
import { Link } from "react-router-dom";
import { linkText, LINK_LABEL, type CrateProfile } from "../../../shared/profile";
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
    </div>
  );
}
