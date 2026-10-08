"use client";

import type { TimetableEntry } from "@/lib/domain/festival";
import { useLanguage, type Language } from "./LanguageProvider";
import { findTimetableConflicts, groupTimetable } from "@/lib/timetables";

const copy: Record<Language, { title: string; empty: string; performances: (count: number) => string; checked: string; conflict: string; cancelled: string; timezone: string; source: string }> = {
  en: { title: "Stage timetable", empty: "No verified timetable is published yet. Stages and local times will appear after an official schedule is checked.", performances: (count) => `${count} verified performances · local festival time`, checked: "Checked", conflict: "Schedule conflict detected. Check the official source before planning.", cancelled: "Cancelled", timezone: "Timezone", source: "Official timetable source ↗" },
  de: { title: "Bühnenplan", empty: "Noch kein bestätigter Zeitplan veröffentlicht. Bühnen und Ortszeiten erscheinen nach Prüfung des offiziellen Plans.", performances: (count) => `${count} bestätigte Auftritte · Ortszeit des Festivals`, checked: "Geprüft", conflict: "Terminkonflikt erkannt. Prüfe vor der Planung die offizielle Quelle.", cancelled: "Abgesagt", timezone: "Zeitzone", source: "Offizieller Zeitplan ↗" },
  ru: { title: "Расписание сцен", empty: "Подтверждённое расписание пока не опубликовано. Сцены и местное время появятся после проверки официального расписания.", performances: (count) => `Подтверждённых выступлений: ${count} · местное время фестиваля`, checked: "Проверено", conflict: "Обнаружено пересечение выступлений. Перед планированием проверьте официальный источник.", cancelled: "Отменено", timezone: "Часовой пояс", source: "Официальное расписание ↗" },
};

export function StageTimetable({ entries }: { entries?: TimetableEntry[] }) {
  const { language, locale } = useLanguage();
  const t = copy[language];
  if (!entries?.length) return <div className="timetable timetableEmpty"><strong>{t.title}</strong><span>{t.empty}</span></div>;
  const days = groupTimetable(entries);
  const conflicts = findTimetableConflicts(entries);
  const newestObservation = entries.map(({ observedAt }) => observedAt).sort().at(-1)!;
  return <section className="timetable timetablePublished" aria-labelledby="stage-timetable-heading">
    <div className="timetableHeader"><div><strong id="stage-timetable-heading">{t.title}</strong><span>{t.performances(entries.length)}</span></div><span>{t.checked} {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(newestObservation))}</span></div>
    {conflicts.length > 0 && <div className="timetableWarning" role="alert">{t.conflict}</div>}
    {days.map((day) => <section className="timetableDay" key={day.date}>
      <h3><time dateTime={day.date}>{new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</time></h3>
      <div className="timetableStages">{day.stages.map((stage) => <div className="timetableStage" key={stage.stage}>
        <h4>{stage.stage}</h4>
        <ol>{stage.entries.map((entry) => <li className={entry.status === "cancelled" ? "cancelled" : undefined} key={`${entry.start}-${entry.artist}`}>
          <time dateTime={`${entry.date}T${entry.start}`}>{entry.start}</time><span>{entry.artist}</span>{entry.status === "cancelled" && <em>{t.cancelled}</em>}
        </li>)}</ol>
      </div>)}</div>
    </section>)}
    <footer><span>{t.timezone}: {entries[0].timeZone}</span><a href={entries[0].sourceUrl} target="_blank" rel="noreferrer">{t.source}</a></footer>
  </section>;
}
