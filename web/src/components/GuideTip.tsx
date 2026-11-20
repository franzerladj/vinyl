// Verweis auf eine Karte aus „Gut zu wissen“, dort wo sie gerade passt (Nadel-Stunden, Kiste, Verkaufen)
import { Link } from "react-router-dom";
import { guideCard } from "../../../shared/guide";
import { IconInfo } from "./icons";

export function GuideTip({ slug, label }: { slug: string; label?: string }) {
  const c = guideCard(slug);
  if (!c) return null;
  return (
    <Link to={`/guide/${slug}`} viewTransition className="guide-tip press">
      <span className="guide-tip-ico">
        <IconInfo />
      </span>
      <span className="guide-tip-main">
        <span className="tiny">Gut zu wissen</span>
        <b>{label ?? c.title}</b>
      </span>
      <span className="chev">›</span>
    </Link>
  );
}
