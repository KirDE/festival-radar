import { FestivalExplorer } from "@/components/FestivalExplorer";
import { festivals } from "@/data/festivals";

export default function Home() {
  const announced = festivals.filter((item) => item.headliners.length > 0).length;
  const countries = new Set(festivals.map((item) => item.countryCode)).size;
  return (
    <>
      <section className="hero">
        <div className="eyebrow">THE 2027 EUROPEAN SEASON</div>
        <h1>Find your next<br/><em>loud weekend.</em></h1>
        <p>Dates, lineups, tickets, playlists and setlists for Europe&apos;s essential rock and metal festivals.</p>
        <div className="heroStats"><span><strong>{festivals.length}</strong> festivals</span><span><strong>{announced}</strong> with announced acts</span><span><strong>{countries}</strong> countries</span></div>
      </section>
      <FestivalExplorer festivals={festivals} />
    </>
  );
}
