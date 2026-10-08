"use client";

import Link from "next/link";
import type { Festival } from "@/lib/domain/festival";
import { calendarUrls, similarFestivals } from "@/lib/planning";
import { StageTimetable } from "./StageTimetable";
import { useLanguage, type Language } from "./LanguageProvider";

const copy: Record<Language, { eyebrow: string; calendar: string; download: string; apple: string; pending: string; map: string; similar: string; shared: (count: number) => string }> = {
  en: { eyebrow: "PLAN THE TRIP", calendar: "Calendar & map", download: "Download .ics", apple: "Add to Apple Calendar", pending: "Calendar export unlocks when dates are announced.", map: "Open European map ↗", similar: "Similar festivals", shared: (count) => `${count} shared act${count === 1 ? "" : "s"}` },
  de: { eyebrow: "REISE PLANEN", calendar: "Kalender & Karte", download: ".ics herunterladen", apple: "Zu Apple Kalender hinzufügen", pending: "Der Kalenderexport ist verfügbar, sobald die Termine bekannt sind.", map: "Europakarte öffnen ↗", similar: "Ähnliche Festivals", shared: (count) => `${count} gemeinsame Künstler` },
  ru: { eyebrow: "ПЛАНИРОВАНИЕ ПОЕЗДКИ", calendar: "Календарь и карта", download: "Скачать .ics", apple: "Добавить в Apple Calendar", pending: "Экспорт в календарь появится после объявления дат.", map: "Открыть карту Европы ↗", similar: "Похожие фестивали", shared: (count) => `Общих артистов: ${count}` },
};

export function PlanningTools({ item, festivals }: { item: Festival; festivals: Festival[] }) {
  const { language } = useLanguage();
  const t = copy[language];
  const calendar = calendarUrls(item);
  const map = `https://www.openstreetmap.org/search?query=${encodeURIComponent([item.city, item.country].filter(Boolean).join(", "))}`;
  const similar = similarFestivals(item, festivals);
  return <section className="planningSection">
    <div className="sectionHeading"><div><div className="eyebrow">{t.eyebrow}</div><h2>{t.calendar}</h2></div></div>
    <div className="planningActions">
      {calendar ? <><a href={calendar.ics} download={`${item.slug}-2027.ics`}>{t.download}</a><a href={calendar.google} target="_blank" rel="noreferrer">Google Calendar ↗</a><a href={calendar.apple} download={`${item.slug}-apple-calendar-2027.ics`}>{t.apple}</a></> : <span>{t.pending}</span>}
      <a href={map} target="_blank" rel="noreferrer">{t.map}</a>
    </div>
    <StageTimetable entries={item.timetable} />
    {similar.length > 0 && <div className="recommendations"><h3>{t.similar}</h3>{similar.map(({ festival, shared }) => <Link href={`/festivals/${festival.slug}/`} key={festival.slug}><strong>{festival.name}</strong><span>{t.shared(shared)}</span></Link>)}</div>}
  </section>;
}
