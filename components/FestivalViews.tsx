"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Festival } from "@/data/festivals";
import { calendarFile } from "@/lib/planning";
import { useLanguage, type Language } from "./LanguageProvider";

const labels: Record<Language, { months: string[]; dates: string; calendar: string; previous: string; next: string; until: string; noDates: string; download: string; area: string; map: string; mapHelp: string; mapLabel: string; europe: string; marker: (country: string, count: number) => string }> = {
  en: { months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], dates: "DATES AT A GLANCE", calendar: "Festival calendar", previous: "Previous month", next: "Next month", until: "Until", noDates: "No confirmed dates in this month yet.", download: "Download full 2027 calendar", area: "EUROPE-WIDE", map: "Festival map", mapHelp: "Markers group festivals by country. Open a marker to choose a festival.", mapLabel: "Map of Europe with festival markers", europe: "EUROPE", marker: (country, count) => `${country}: ${count} festivals` },
  de: { months: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"], dates: "TERMINE AUF EINEN BLICK", calendar: "Festivalkalender", previous: "Vorheriger Monat", next: "Nächster Monat", until: "Bis", noDates: "Für diesen Monat gibt es noch keine bestätigten Termine.", download: "Vollständigen Kalender 2027 herunterladen", area: "EUROPAWEIT", map: "Festivalkarte", mapHelp: "Die Markierungen gruppieren Festivals nach Ländern. Öffne eine Markierung, um ein Festival auszuwählen.", mapLabel: "Europakarte mit Festival-Markierungen", europe: "EUROPA", marker: (country, count) => `${country}: ${count} Festivals` },
  ru: { months: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"], dates: "ДАТЫ ОДНИМ ВЗГЛЯДОМ", calendar: "Календарь фестивалей", previous: "Предыдущий месяц", next: "Следующий месяц", until: "До", noDates: "На этот месяц пока нет подтверждённых дат.", download: "Скачать полный календарь на 2027 год", area: "ПО ВСЕЙ ЕВРОПЕ", map: "Карта фестивалей", mapHelp: "Метки объединяют фестивали по странам. Откройте метку, чтобы выбрать фестиваль.", mapLabel: "Карта Европы с метками фестивалей", europe: "ЕВРОПА", marker: (country, count) => `${country}: фестивалей — ${count}` },
};
const POINTS: Record<string, [number, number]> = { AT:[57,61],BE:[42,45],CH:[48,64],CZ:[60,49],DE:[51,47],DK:[52,31],ES:[29,75],FI:[72,16],FR:[39,61],GB:[29,40],IT:[55,75],NL:[44,39],NO:[48,15],PL:[68,45],RO:[76,64],SE:[58,17],SI:[61,65] };

export function FestivalViews({ festivals }: { festivals: Festival[] }) {
  const { language } = useLanguage();
  const t = labels[language];
  const dated = useMemo(() => festivals.filter((f) => f.startDate).sort((a,b) => a.startDate!.localeCompare(b.startDate!)), [festivals]);
  const [month, setMonth] = useState(Number(dated[0]?.startDate?.slice(5,7) || "1") - 1);
  const visible = dated.filter((f) => Number(f.startDate!.slice(5,7)) - 1 === month);
  return <>
    <section className="plannerSection" aria-labelledby="festival-calendar-title">
      <div className="viewHeading"><div><div className="eyebrow">{t.dates}</div><h2 id="festival-calendar-title">{t.calendar}</h2></div><div className="monthNav"><button onClick={() => setMonth((month + 11) % 12)} aria-label={t.previous}>←</button><strong>{t.months[month]} 2027</strong><button onClick={() => setMonth((month + 1) % 12)} aria-label={t.next}>→</button></div></div>
      <div className="calendarGrid" role="list">{visible.length ? visible.map((f) => <Link role="listitem" href={`/festivals/${f.slug}/`} key={f.slug}><time dateTime={f.startDate}>{Number(f.startDate!.slice(8,10))}</time><span><strong>{f.name}</strong><small>{f.endDate && f.endDate !== f.startDate ? `${t.until} ${Number(f.endDate.slice(8,10))} ${t.months[month]}` : t.months[month]} · {f.city || f.country}</small></span></Link>) : <p>{t.noDates}</p>}</div>
      <a className="primaryButton" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile(dated))}`} download="festival-radar-2027.ics">{t.download}</a>
    </section>
    <section className="plannerSection" aria-labelledby="festival-map-title">
      <div className="viewHeading"><div><div className="eyebrow">{t.area}</div><h2 id="festival-map-title">{t.map}</h2></div><p>{t.mapHelp}</p></div>
      <div className="europeMap" role="img" aria-label={t.mapLabel}><div className="mapLand" aria-hidden="true">{t.europe}</div>{Object.entries(POINTS).map(([code,[left,top]]) => { const items = festivals.filter((f) => f.countryCode === code && f.city); return items.length ? <details className="mapMarker" style={{left:`${left}%`,top:`${top}%`}} key={code}><summary aria-label={t.marker(items[0].country, items.length)}>{items.length}<span>{code}</span></summary><div>{items.map((f) => <Link href={`/festivals/${f.slug}/`} key={f.slug}><strong>{f.name}</strong><small>{f.city}</small></Link>)}</div></details> : null; })}</div>
    </section>
  </>;
}
