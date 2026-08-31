"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Language = "en" | "de" | "ru";
type TranslationKey = keyof typeof translations.en;

const translations = {
  en: {
    festivals: "Festivals", aboutData: "About data", footerNote: "Always confirm dates and tickets with the official festival.", language: "Language",
    season: "THE 2027 EUROPEAN SEASON", heroFirst: "Find your next", heroSecond: "loud weekend.", heroText: "Dates, lineups, tickets, playlists and setlists for Europe’s essential rock and metal festivals.", withActs: "with announced acts", countries: "countries",
    search: "Festival, artist or city", allCountries: "All countries", lineupAnnounced: "Lineup announced", lastReview: "Last dataset review · 28 Aug 2026", noMatches: "No matching festivals. Try a different artist or country.",
    datesTba: "Dates TBA", tba: "TBA", confirmed: "confirmed", partial: "partial", lineupNotAnnounced: "Lineup not announced", announcedActs: "announced acts", followUpdates: "Follow for updates", explore: "Explore",
    allFestivals: "All festivals", datesLineupTba: "Dates / lineup TBA", confirmedLineup: "confirmed lineup", partialLineup: "partial lineup", official: "Official", festivalWebsite: "Festival website ↗", passes: "Passes", officialTickets: "Official tickets ↗", ticketsInfo: "Tickets & info ↗", ticketsUnavailable: "Tickets not available", ticketsUnknown: "Availability not verified", listen: "Listen", artists: "artists", tracks: "tracks", spotifyPlaylist: "Spotify playlist ↗", youtubeMusicPlaylist: "YouTube Music playlist ↗", playlistSoon: "Playlist coming soon", liveHistory: "Live history",
    discoverBill: "DISCOVER THE BILL", lineup2027: "2027 lineup", announced: "announced", headliners: "Headliners & highlights", viewArtist: "View artist →", noArtists: "No artists announced yet.", noArtistsText: "We will update this page when the official festival publishes its first names.", alsoAnnounced: "Also announced", transparency: "Data transparency", sourceText: "Seed data reviewed on 28 August 2026. Announcements can change; official festival information always takes priority.", primarySource: "Check primary source ↗",
    festivalDirectory: "Festival directory", artist: "ARTIST", europeanFestival: "European festival", europeanFestivals: "European festivals", announcedFor: "announced for 2027", appearances: "2027 APPEARANCES", myPlan: "My plan", skip: "Skip to content", privacy: "Privacy-first: no cookies or cross-site tracking.", submitFestival: "Submit a festival", submitEyebrow: "COMMUNITY SOURCES", submitIntro: "Every suggestion is reviewed before publication. Please link only to the festival organizer or an official ticketing partner.", festivalName: "Festival name", officialSource: "Official source URL", editionYear: "Edition year", notes: "Notes", sendReview: "Send for editorial review", submitting: "Submitting…", received: "Received for review", failed: "Submission failed.",
  },
  de: {
    festivals: "Festivals", aboutData: "Über die Daten", footerNote: "Termine und Tickets immer auf der offiziellen Festival-Seite prüfen.", language: "Sprache",
    season: "DIE EUROPÄISCHE SAISON 2027", heroFirst: "Finde dein nächstes", heroSecond: "lautes Wochenende.", heroText: "Termine, Line-ups, Tickets, Playlists und Setlists der wichtigsten Rock- und Metal-Festivals Europas.", withActs: "mit angekündigten Acts", countries: "Länder",
    search: "Festival, Künstler oder Stadt", allCountries: "Alle Länder", lineupAnnounced: "Line-up angekündigt", lastReview: "Letzte Datenprüfung · 28. Aug. 2026", noMatches: "Keine passenden Festivals. Versuche einen anderen Künstler oder ein anderes Land.",
    datesTba: "Termine offen", tba: "OFFEN", confirmed: "bestätigt", partial: "teilweise", lineupNotAnnounced: "Line-up noch nicht angekündigt", announcedActs: "angekündigte Acts", followUpdates: "Updates folgen", explore: "Entdecken",
    allFestivals: "Alle Festivals", datesLineupTba: "Termine / Line-up offen", confirmedLineup: "bestätigtes Line-up", partialLineup: "teilweises Line-up", official: "Offiziell", festivalWebsite: "Festival-Webseite ↗", passes: "Tickets", officialTickets: "Offizielle Tickets ↗", ticketsInfo: "Tickets & Infos ↗", ticketsUnavailable: "Tickets nicht verfügbar", ticketsUnknown: "Verfügbarkeit nicht bestätigt", listen: "Anhören", artists: "Künstler", tracks: "Titel", spotifyPlaylist: "Spotify-Playlist ↗", youtubeMusicPlaylist: "YouTube-Music-Playlist ↗", playlistSoon: "Playlist folgt", liveHistory: "Live-Historie",
    discoverBill: "DAS LINE-UP ENTDECKEN", lineup2027: "Line-up 2027", announced: "angekündigt", headliners: "Headliner & Highlights", viewArtist: "Künstler ansehen →", noArtists: "Noch keine Künstler angekündigt.", noArtistsText: "Wir aktualisieren diese Seite, sobald das Festival die ersten Namen veröffentlicht.", alsoAnnounced: "Außerdem angekündigt", transparency: "Datentransparenz", sourceText: "Ausgangsdaten geprüft am 28. August 2026. Ankündigungen können sich ändern; die offizielle Festival-Information hat immer Vorrang.", primarySource: "Primärquelle prüfen ↗",
    festivalDirectory: "Festival-Verzeichnis", artist: "KÜNSTLER", europeanFestival: "europäisches Festival", europeanFestivals: "europäische Festivals", announcedFor: "für 2027 angekündigt", appearances: "AUFTRITTE 2027", myPlan: "Mein Plan", skip: "Zum Inhalt springen", privacy: "Datenschutzfreundlich: keine Cookies oder websiteübergreifende Verfolgung.", submitFestival: "Festival vorschlagen", submitEyebrow: "QUELLEN AUS DER COMMUNITY", submitIntro: "Jeder Vorschlag wird vor der Veröffentlichung geprüft. Bitte verlinke nur den Veranstalter oder einen offiziellen Ticketanbieter.", festivalName: "Festivalname", officialSource: "Offizielle Quell-URL", editionYear: "Ausgabejahr", notes: "Anmerkungen", sendReview: "Zur redaktionellen Prüfung senden", submitting: "Wird gesendet…", received: "Zur Prüfung eingegangen", failed: "Senden fehlgeschlagen.",
  },
  ru: {
    festivals: "Фестивали", aboutData: "О данных", footerNote: "Всегда проверяйте даты и билеты на официальном сайте фестиваля.", language: "Язык",
    season: "ЕВРОПЕЙСКИЙ СЕЗОН 2027", heroFirst: "Найди свои следующие", heroSecond: "громкие выходные.", heroText: "Даты, лайнапы, билеты, плейлисты и сетлисты главных рок- и метал-фестивалей Европы.", withActs: "с объявленными участниками", countries: "стран",
    search: "Фестиваль, артист или город", allCountries: "Все страны", lineupAnnounced: "Лайнап объявлен", lastReview: "Последняя проверка · 28 авг. 2026", noMatches: "Ничего не найдено. Попробуйте другого артиста или страну.",
    datesTba: "Даты уточняются", tba: "УТОЧНЯЕТСЯ", confirmed: "подтверждено", partial: "частично", lineupNotAnnounced: "Лайнап ещё не объявлен", announcedActs: "объявлено участников", followUpdates: "Следить за обновлениями", explore: "Подробнее",
    allFestivals: "Все фестивали", datesLineupTba: "Даты / лайнап уточняются", confirmedLineup: "подтверждённый лайнап", partialLineup: "частичный лайнап", official: "Официально", festivalWebsite: "Сайт фестиваля ↗", passes: "Билеты", officialTickets: "Официальные билеты ↗", ticketsInfo: "Билеты и информация ↗", ticketsUnavailable: "Билеты недоступны", ticketsUnknown: "Доступность не подтверждена", listen: "Слушать", artists: "артистов", tracks: "треков", spotifyPlaylist: "Плейлист Spotify ↗", youtubeMusicPlaylist: "Плейлист YouTube Music ↗", playlistSoon: "Плейлист скоро появится", liveHistory: "История концертов",
    discoverBill: "ИЗУЧИТЬ ЛАЙНАП", lineup2027: "Лайнап 2027", announced: "объявлено", headliners: "Хедлайнеры и главные имена", viewArtist: "Об артисте →", noArtists: "Участники пока не объявлены.", noArtistsText: "Мы обновим страницу, когда фестиваль опубликует первые имена.", alsoAnnounced: "Также объявлены", transparency: "Прозрачность данных", sourceText: "Исходные данные проверены 28 августа 2026 года. Анонсы могут меняться; официальный сайт фестиваля всегда является приоритетным источником.", primarySource: "Проверить первоисточник ↗",
    festivalDirectory: "Каталог фестивалей", artist: "АРТИСТ", europeanFestival: "европейский фестиваль", europeanFestivals: "европейских фестивалей", announcedFor: "объявлено на 2027 год", appearances: "ВЫСТУПЛЕНИЯ В 2027", myPlan: "Мой план", skip: "Перейти к содержимому", privacy: "Без ущерба для приватности: без cookies и межсайтового отслеживания.", submitFestival: "Предложить фестиваль", submitEyebrow: "ИСТОЧНИКИ СООБЩЕСТВА", submitIntro: "Каждое предложение проверяется перед публикацией. Добавляйте только сайт организатора или официального билетного партнёра.", festivalName: "Название фестиваля", officialSource: "Официальный URL источника", editionYear: "Год проведения", notes: "Примечания", sendReview: "Отправить редакции", submitting: "Отправка…", received: "Получено на проверку", failed: "Не удалось отправить.",
  },
} as const;

const localeMap: Record<Language, string> = { en: "en-US", de: "de-DE", ru: "ru-RU" };
const LanguageContext = createContext<{ language: Language; locale: string; setLanguage: (language: Language) => void; t: (key: TranslationKey) => string } | null>(null);

function browserLanguage(): Language {
  for (const value of navigator.languages || [navigator.language]) {
    const code = value.toLowerCase().split("-")[0];
    if (code === "de" || code === "ru" || code === "en") return code;
  }
  return "en";
}

export function LanguageProvider({ children, initialLanguage }: { children: React.ReactNode; initialLanguage?: Language }) {
  const [language, updateLanguage] = useState<Language>(initialLanguage ?? "en");
  useEffect(() => {
    if (initialLanguage) {
      localStorage.setItem("festival-radar-language", initialLanguage);
      document.documentElement.lang = initialLanguage;
      return;
    }
    const stored = localStorage.getItem("festival-radar-language");
    const selected = stored === "de" || stored === "ru" || stored === "en" ? stored : browserLanguage();
    updateLanguage(selected);
    document.documentElement.lang = selected;
  }, [initialLanguage]);
  const setLanguage = (selected: Language) => { localStorage.setItem("festival-radar-language", selected); window.location.assign(`/${selected}/`); };
  const value = useMemo(() => ({ language, locale: localeMap[language], setLanguage, t: (key: TranslationKey) => translations[language][key] }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}
