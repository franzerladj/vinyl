// „Deine Kiste als DJ“ in voller Länge: Tempo-Verteilung, Camelot-Rad, Energie. Auf Start steht die Kurzfassung.
import { DjOverview } from "../components/DjOverview";
import { KisteCharts } from "../components/KisteCharts";
import { NavBar } from "../components/ui";

export default function DjPage() {
  return (
    <>
      <NavBar title="Deine Kiste als DJ" titleOnScroll backTo="/" backLabel="Start" />
      <div className="page-head" style={{ paddingTop: 0 }}>
        <h1>Deine Kiste</h1>
      </div>
      <div className="page">
        <DjOverview />
        <KisteCharts />
      </div>
    </>
  );
}
