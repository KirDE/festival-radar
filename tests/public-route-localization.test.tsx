import assert from "node:assert/strict";
import test from "node:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArchiveContent, CountryContent, EditionYearContent, FestivalEditionContent, MonthContent, SharedPlanContent } from "../components/PublicCatalogPages";
import { LanguageProvider, type Language } from "../components/LanguageProvider";
import { LocalPlannerProvider } from "../components/LocalPlanner";
import { catalogSeed, festival } from "./support/catalog";

const archived = catalogSeed.editions[0];
const current = catalogSeed.editions[1];
const tracking = { ...archived, editionYear: 2028, recordState: "tracking" as const, completeness: "tba" as const, status: "tba" as const, startDate: undefined, endDate: undefined, headliners: [], lineup: [] };
function render(language: Language, content: ReactNode) {
  return renderToStaticMarkup(<LanguageProvider initialLanguage={language}><LocalPlannerProvider>{content}</LocalPlannerProvider></LanguageProvider>);
}

const expected = {
  de: { archive: "Archivierte und künftige Ausgaben", future: "Künftige Ausgaben", edition: "Festivalausgaben 2027", detail: "Line-up-Status", status: "vollständiger Datensatz", empty: "Offizielle Termine und Line-up noch offen", share: "Geteilter Plan", attendance: "Dabei", country: "Festivals in Deutschland", month: "Festivals im Juni" },
  ru: { archive: "Архивные и будущие выпуски", future: "Будущие выпуски", edition: "Выпуски фестивалей 2027 года", detail: "Состояние лайнапа", status: "полная запись", empty: "Официальные даты и лайнап уточняются", share: "Общий план", attendance: "Пойду", country: "Фестивали в стране: Германия", month: "Фестивали в июне" },
};

for (const language of ["de", "ru"] as const) {
  test("public archive, edition, share, country and month pages render in " + language, () => {
    const t = expected[language];
    const archive = render(language, <ArchiveContent archived={[archived]} future={[tracking]} />);
    assert.ok(archive.includes(t.archive) && archive.includes(t.future));
    assert.ok(!archive.includes("Archived and future records") && !archive.includes("Open edition"));
    assert.ok(archive.includes('href="/editions/2027"') || archive.includes('href="/editions/2027/"'));

    const year = render(language, <EditionYearContent year={2027} items={[current]} />);
    assert.ok(year.includes(t.edition) && !year.includes("provenance-aware"));
    const detail = render(language, <FestivalEditionContent item={current} />);
    assert.ok(detail.includes(t.detail) && detail.includes(t.status));
    assert.ok(!detail.includes("Lineup status") && !detail.includes("complete record"));
    const unannounced = render(language, <FestivalEditionContent item={tracking} />);
    assert.ok(unannounced.includes(t.empty));
    assert.ok(!unannounced.includes("Official dates and lineup TBA"));

    const share = render(language, <SharedPlanContent attendance={{ "Synthetic Fest": "going", "Other Fest": "unknown" }} updatedAt="2026-01-01T12:00:00Z" />);
    assert.ok(share.includes(t.share) && share.includes(t.attendance));
    assert.ok(!share.includes("Shared plan") && !share.includes("Last updated"));
    const country = render(language, <CountryContent countryCode="DE" country="Germany" festivals={[festival]} />);
    assert.ok(country.includes(t.country), country.slice(0, 300));
    const month = render(language, <MonthContent month="06" festivals={[festival]} />);
    assert.ok(month.includes(t.month), month.slice(0, 300));
    assert.ok(!month.includes("Festivals in June"));
  });
}
