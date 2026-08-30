"use client";

import Link from "next/link";
import type { Festival } from "@/data/festivals";
import { calendarUrls, similarFestivals } from "@/lib/planning";
import { StageTimetable } from "./StageTimetable";

export function PlanningTools({ item, festivals }: { item: Festival; festivals: Festival[] }) {
  const calendar = calendarUrls(item);
  const map = `https://www.openstreetmap.org/search?query=${encodeURIComponent([item.city, item.country].filter(Boolean).join(", "))}`;
  const similar = similarFestivals(item, festivals);
  return <section className="planningSection">
    <div className="sectionHeading"><div><div className="eyebrow">PLAN THE TRIP</div><h2>Calendar & map</h2></div></div>
    <div className="planningActions">
      {calendar ? <><a href={calendar.ics} download={`${item.slug}-2027.ics`}>Download .ics</a><a href={calendar.google} target="_blank" rel="noreferrer">Google Calendar ↗</a></> : <span>Calendar export unlocks when dates are announced.</span>}
      <a href={map} target="_blank" rel="noreferrer">Open European map ↗</a>
    </div>
    <StageTimetable entries={item.timetable} />
    {similar.length > 0 && <div className="recommendations"><h3>Similar festivals</h3>{similar.map(({ festival, shared }) => <Link href={`/festivals/${festival.slug}/`} key={festival.slug}><strong>{festival.name}</strong><span>{shared} shared act{shared === 1 ? "" : "s"}</span></Link>)}</div>}
  </section>;
}
