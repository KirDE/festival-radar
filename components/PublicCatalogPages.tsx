"use client";

import Link from "next/link";
import type { Festival } from "@/lib/domain/festival";
import type { FestivalEdition } from "@/lib/domain/edition";
import { FestivalExplorer } from "./FestivalExplorer";
import { useLanguage } from "./LanguageProvider";

// Public route bodies use the selected UI language; their server routes and SEO
// metadata remain independent of the saved preference and unchanged.
const copy = {
  en: {
    editions: "FESTIVAL EDITIONS", archiveTitle: "Archived and future records", archiveIntro: "Every row is an edition record with explicit source evidence. Archived snapshots are immutable; future editions appear only after an official edition-specific announcement.", archived: "Archived editions", future: "Future tracking", futureEmpty: "No officially announced future editions are being tracked yet.", browseCurrent: "Browse the current 2027 season →", datesTba: "Dates TBA", lineupTba: "Lineup TBA", archivedArtists: (n: number) => n + " archived artists (partial snapshot)", openEdition: "Open edition →", editionYear: "EDITION YEAR", editionHeading: (year: number) => year + " festival editions", records: (n: number) => n + " provenance-aware " + (n === 1 ? "record" : "records") + ". TBA means the official source has not yet published the field.", artistsRecorded: (n: number) => n + " artists recorded", archiveBack: "← Archive and future tracking", backEdition: (year: number) => "← " + year + " editions", states: { archived: "ARCHIVED", current: "CURRENT", tracking: "TRACKING" }, edition: "EDITION", completeRecord: "complete record", partialRecord: "partial record", officialTba: "Official dates and lineup TBA", lineupStatus: "Lineup status", noArtists: "No artists published", trackingNotice: "This is an explicit tracking state, not an empty confirmed lineup.", provenance: "Provenance", snapshot: "Immutable snapshot captured", officialSource: "Official source ↗", checked: "checked", fields: { edition: "edition", dates: "dates", lineup: "lineup" }, sharedEyebrow: "PUBLIC FESTIVAL PLAN", sharedTitle: "Shared plan", updated: "Last updated", attendance: "Festival attendance", noAttendance: "No attendance selections have been shared yet.", attendanceValues: { going: "Going", maybe: "Maybe", "not-going": "Not going" }, unspecified: "Not specified", country: (name: string) => "Festivals in " + name, month: (name: string) => "Festivals in " + name,
  },
  de: {
    editions: "FESTIVALAUSGABEN", archiveTitle: "Archivierte und künftige Ausgaben", archiveIntro: "Jede Ausgabe enthält nachvollziehbare Quellenangaben. Archivierte Stände bleiben unverändert; künftige Ausgaben erscheinen erst nach einer offiziellen Ankündigung.", archived: "Archivierte Ausgaben", future: "Künftige Ausgaben", futureEmpty: "Derzeit werden keine offiziell angekündigten künftigen Ausgaben verfolgt.", browseCurrent: "Zur aktuellen Saison 2027 →", datesTba: "Termine offen", lineupTba: "Line-up offen", archivedArtists: (n: number) => n + " archivierte Künstler (unvollständiger Stand)", openEdition: "Ausgabe öffnen →", editionYear: "AUSGABEJAHR", editionHeading: (year: number) => "Festivalausgaben " + year, records: (n: number) => n + " Ausgaben mit Quellenangaben. Offene Angaben wurden von offizieller Seite noch nicht veröffentlicht.", artistsRecorded: (n: number) => n + " erfasste Künstler", archiveBack: "← Archiv und künftige Ausgaben", backEdition: (year: number) => "← Ausgaben " + year, states: { archived: "ARCHIVIERT", current: "AKTUELL", tracking: "IN BEOBACHTUNG" }, edition: "AUSGABE", completeRecord: "vollständiger Datensatz", partialRecord: "unvollständiger Datensatz", officialTba: "Offizielle Termine und Line-up noch offen", lineupStatus: "Line-up-Status", noArtists: "Noch keine Künstler veröffentlicht", trackingNotice: "Dieser Status bedeutet, dass die Ausgabe beobachtet wird; das Line-up ist nicht als vollständig bestätigt.", provenance: "Quellenangaben", snapshot: "Unveränderlicher Stand gespeichert am", officialSource: "Offizielle Quelle ↗", checked: "geprüft", fields: { edition: "Ausgabe", dates: "Termine", lineup: "Line-up" }, sharedEyebrow: "ÖFFENTLICHER FESTIVALPLAN", sharedTitle: "Geteilter Plan", updated: "Zuletzt aktualisiert", attendance: "Festivalteilnahme", noAttendance: "Noch keine Teilnahmeangaben geteilt.", attendanceValues: { going: "Dabei", maybe: "Vielleicht", "not-going": "Nicht dabei" }, unspecified: "Nicht angegeben", country: (name: string) => "Festivals in " + name, month: (name: string) => "Festivals im " + name,
  },
  ru: {
    editions: "ВЫПУСКИ ФЕСТИВАЛЕЙ", archiveTitle: "Архивные и будущие выпуски", archiveIntro: "Для каждого выпуска указаны источники. Архивные снимки не меняются; будущие выпуски появляются только после официального объявления конкретного года.", archived: "Архивные выпуски", future: "Будущие выпуски", futureEmpty: "Пока нет официально объявленных будущих выпусков.", browseCurrent: "К текущему сезону 2027 →", datesTba: "Даты уточняются", lineupTba: "Лайнап уточняется", archivedArtists: (n: number) => "Артистов в архиве: " + n + " (неполный снимок)", openEdition: "Открыть выпуск →", editionYear: "ГОД ВЫПУСКА", editionHeading: (year: number) => "Выпуски фестивалей " + year + " года", records: (n: number) => "Записей с указанием источников: " + n + ". Неизвестные сведения ещё не опубликованы официально.", artistsRecorded: (n: number) => "Артистов в записи: " + n, archiveBack: "← Архив и будущие выпуски", backEdition: (year: number) => "← Выпуски " + year + " года", states: { archived: "АРХИВ", current: "ТЕКУЩИЙ", tracking: "ОТСЛЕЖИВАЕТСЯ" }, edition: "ВЫПУСК", completeRecord: "полная запись", partialRecord: "частичная запись", officialTba: "Официальные даты и лайнап уточняются", lineupStatus: "Состояние лайнапа", noArtists: "Артисты пока не опубликованы", trackingNotice: "Выпуск отслеживается; пустой лайнап не означает подтверждённый состав.", provenance: "Источники данных", snapshot: "Неизменяемый снимок сохранён", officialSource: "Официальный источник ↗", checked: "проверено", fields: { edition: "выпуск", dates: "даты", lineup: "лайнап" }, sharedEyebrow: "ОБЩИЙ ПЛАН ФЕСТИВАЛЕЙ", sharedTitle: "Общий план", updated: "Обновлено", attendance: "Посещение фестивалей", noAttendance: "Данные о посещении ещё не опубликованы.", attendanceValues: { going: "Пойду", maybe: "Возможно", "not-going": "Не пойду" }, unspecified: "Не указано", country: (name: string) => "Фестивали в стране: " + name, month: (name: string) => "Фестивали в " + name,
  },
} as const;

function usePublicCopy() {
  const { language, locale } = useLanguage();
  const t = copy[language];
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value));
  const dateTime = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  const range = (item: FestivalEdition) => item.startDate ? date(item.startDate) + (item.endDate && item.endDate !== item.startDate ? " — " + date(item.endDate) : "") : t.datesTba;
  return { t, date, dateTime, range, locale };
}

function EditionRow({ item, archive = false }: { item: FestivalEdition; archive?: boolean }) {
  const { t, range } = usePublicCopy();
  const count = item.headliners.length + item.lineup.length;
  const summary = archive ? (count ? t.archivedArtists(count) : t.lineupTba) : (item.status === "tba" ? t.lineupTba : t.artistsRecorded(count));
  return <article className="directoryRow"><div><strong>{item.name} {item.editionYear}</strong><span>{range(item)} · {summary}</span></div><Link className="textLink" href={"/festivals/" + item.slug + "/" + item.editionYear + "/"}>{t.openEdition}</Link></article>;
}

export function ArchiveContent({ archived, future }: { archived: FestivalEdition[]; future: FestivalEdition[] }) {
  const { t } = usePublicCopy();
  return <div className="directoryPage"><p className="eyebrow">{t.editions}</p><h1>{t.archiveTitle}</h1><p>{t.archiveIntro}</p><section><h2>{t.archived}</h2>{archived.map((item) => <EditionRow item={item} archive key={item.slug + "-" + item.editionYear} />)}</section><section><h2>{t.future}</h2>{future.length ? future.map((item) => <EditionRow item={item} key={item.slug + "-" + item.editionYear} />) : <p>{t.futureEmpty}</p>}</section><Link className="textLink" href="/editions/2027/">{t.browseCurrent}</Link></div>;
}

export function EditionYearContent({ year, items }: { year: number; items: FestivalEdition[] }) {
  const { t } = usePublicCopy();
  return <div className="directoryPage"><p className="eyebrow">{t.editionYear}</p><h1>{t.editionHeading(year)}</h1><p>{t.records(items.length)}</p><section>{items.map((item) => <EditionRow item={item} key={item.slug} />)}</section><Link className="textLink" href="/archive/">{t.archiveBack}</Link></div>;
}

export function FestivalEditionContent({ item }: { item: FestivalEdition }) {
  const { t, date, dateTime, range } = usePublicCopy();
  const artists = [...item.headliners, ...item.lineup];
  const status = item.completeness !== "tba" ? (item.completeness === "complete" ? t.completeRecord : t.partialRecord) : (item.startDate || item.endDate || artists.length ? t.partialRecord : t.officialTba);
  return <div className="detailPage"><Link className="back" href={"/editions/" + item.editionYear + "/"}>{t.backEdition(item.editionYear)}</Link><section className="detailHero"><div><div className="eyebrow">{t.states[item.recordState]} {t.edition} · {item.countryCode}</div><h1>{item.name} {item.editionYear}</h1><p className="detailDate">{range(item)}</p><span className={"status " + item.status}>{status}</span></div></section><section className="lineupSection"><h2>{t.lineupStatus}</h2>{artists.length ? <div className="lineupGrid">{artists.map((artist) => <span key={artist}>{artist}</span>)}</div> : <div className="lineupEmpty"><strong>{t.noArtists}</strong><span>{t.trackingNotice}</span></div>}</section><section className="sourceNote"><strong>{t.provenance}</strong>{item.snapshotAt && <p>{t.snapshot} {dateTime(item.snapshotAt)} UTC.</p>}{item.provenance.map((source) => <p key={source.field + "-" + source.url}><b>{t.fields[source.field]}:</b> {source.note} <a href={source.url} target="_blank" rel="noreferrer">{t.officialSource}</a> <small>{t.checked} {date(source.checkedAt)}</small></p>)}</section></div>;
}

export function SharedPlanContent({ attendance, updatedAt }: { attendance: Record<string, string>; updatedAt: string }) {
  const { t, dateTime } = usePublicCopy();
  const status = (value: string) => value === "going" || value === "maybe" || value === "not-going" ? t.attendanceValues[value] : t.unspecified;
  return <div className="plannerPage"><div className="plannerHero"><div><div className="eyebrow">{t.sharedEyebrow}</div><h1>{t.sharedTitle}</h1><p>{t.updated} {dateTime(updatedAt)} UTC</p></div></div><section className="plannerSection"><h2>{t.attendance}</h2>{Object.keys(attendance).length ? <ul>{Object.entries(attendance).map(([festival, value]) => <li key={festival}><strong>{festival}</strong> — {status(value)}</li>)}</ul> : <p>{t.noAttendance}</p>}</section></div>;
}

export function CountryContent({ countryCode, country, festivals }: { countryCode: string; country: string; festivals: Festival[] }) {
  const { t, locale } = usePublicCopy();
  const name = new Intl.DisplayNames([locale], { type: "region" }).of(countryCode) || country;
  return <div className="directoryPage"><h1>{t.country(name)}</h1><FestivalExplorer festivals={festivals}/></div>;
}

export function MonthContent({ month, festivals }: { month: string; festivals: Festival[] }) {
  const { t, locale } = usePublicCopy();
  const russianMonths = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
  const name = locale === "ru-RU" ? russianMonths[Number(month) - 1] : new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date("2027-" + month + "-01T12:00:00Z"));
  return <div className="directoryPage"><h1>{t.month(name || month)}</h1><FestivalExplorer festivals={festivals}/></div>;
}
