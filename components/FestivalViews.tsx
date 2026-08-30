"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Festival } from "@/data/festivals";
import { calendarFile } from "@/lib/planning";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const POINTS: Record<string, [number, number]> = { AT:[57,61],BE:[42,45],CH:[48,64],CZ:[60,49],DE:[51,47],DK:[52,31],ES:[29,75],FI:[72,16],FR:[39,61],GB:[29,40],IT:[55,75],NL:[44,39],NO:[48,15],PL:[68,45],RO:[76,64],SE:[58,17],SI:[61,65] };

export function FestivalViews({ festivals }: { festivals: Festival[] }) {
  const dated = useMemo(() => festivals.filter((f) => f.startDate).sort((a,b) => a.startDate!.localeCompare(b.startDate!)), [festivals]);
  const [month, setMonth] = useState(Number(dated[0]?.startDate?.slice(5,7) || "1") - 1);
  const visible = dated.filter((f) => Number(f.startDate!.slice(5,7)) - 1 === month);
  return <>
    <section className="plannerSection" aria-labelledby="festival-calendar-title">
      <div className="viewHeading"><div><div className="eyebrow">DATES AT A GLANCE</div><h2 id="festival-calendar-title">Festival calendar</h2></div><div className="monthNav"><button onClick={() => setMonth((month + 11) % 12)} aria-label="Previous month">←</button><strong>{MONTHS[month]} 2027</strong><button onClick={() => setMonth((month + 1) % 12)} aria-label="Next month">→</button></div></div>
      <div className="calendarGrid" role="list">{visible.length ? visible.map((f) => <Link role="listitem" href={`/festivals/${f.slug}/`} key={f.slug}><time dateTime={f.startDate}>{Number(f.startDate!.slice(8,10))}</time><span><strong>{f.name}</strong><small>{f.endDate && f.endDate !== f.startDate ? `Until ${Number(f.endDate.slice(8,10))} ${MONTHS[month]}` : MONTHS[month]} · {f.city || f.country}</small></span></Link>) : <p>No confirmed dates in this month yet.</p>}</div>
      <a className="primaryButton" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile(dated))}`} download="festival-radar-2027.ics">Download full 2027 calendar</a>
    </section>
    <section className="plannerSection" aria-labelledby="festival-map-title">
      <div className="viewHeading"><div><div className="eyebrow">EUROPE-WIDE</div><h2 id="festival-map-title">Festival map</h2></div><p>Markers group festivals by country. Open a marker to choose a festival.</p></div>
      <div className="europeMap" role="img" aria-label="Map of Europe with festival markers"><div className="mapLand" aria-hidden="true">EUROPE</div>{Object.entries(POINTS).map(([code,[left,top]]) => { const items = festivals.filter((f) => f.countryCode === code && f.city); return items.length ? <details className="mapMarker" style={{left:`${left}%`,top:`${top}%`}} key={code}><summary aria-label={`${items[0].country}: ${items.length} festivals`}>{items.length}<span>{code}</span></summary><div>{items.map((f) => <Link href={`/festivals/${f.slug}/`} key={f.slug}><strong>{f.name}</strong><small>{f.city}</small></Link>)}</div></details> : null; })}</div>
    </section>
  </>;
}
