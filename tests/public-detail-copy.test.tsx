import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalDetail } from "../components/FestivalDetail";
import { LanguageProvider, translate, type Language } from "../components/LanguageProvider";
import { LocalPlannerProvider } from "../components/LocalPlanner";
import { festival } from "./support/catalog";

const similar = { ...festival, slug: "similar-fest", name: "Similar Fest" };
const expectations: Record<"de" | "ru", string[]> = {
  de: ["☆ Speichern", "Teilnahme wählen", "Dabei", "Vielleicht", "Nicht dabei", "Meinen Plan öffnen →", "REISE PLANEN", "Kalender &amp; Karte", "Bühnenplan", "Noch kein bestätigter Zeitplan", "Ähnliche Festivals", "1 gemeinsame Künstler"],
  ru: ["☆ Сохранить", "Укажите участие", "Пойду", "Возможно", "Не пойду", "Открыть мой план →", "ПЛАНИРОВАНИЕ ПОЕЗДКИ", "Календарь и карта", "Расписание сцен", "Подтверждённое расписание пока не опубликовано", "Похожие фестивали", "Общих артистов: 1"],
};

for (const language of ["de", "ru"] as const) {
  test("detail renders all primary actions and trip copy in " + language, () => {
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage={language}>
        <LocalPlannerProvider>
          <FestivalDetail item={festival} festivals={[festival, similar]} artistSlugs={{ "Sample Artist": "sample-artist" }} />
        </LocalPlannerProvider>
      </LanguageProvider>,
    );
    for (const copy of expectations[language]) assert.ok(html.includes(copy), "Missing " + copy);
    for (const english of ["☆ Save", "Set attendance", "Going", "Maybe", "Not going", "Open my plan", "PLAN THE TRIP", "Calendar &amp; map", "Stage timetable", "No verified timetable", "Similar festivals", "shared act"]) {
      assert.ok(!html.includes(english), "Unexpected English copy: " + english);
    }
    assert.equal(translate(language as Language, "saved"), language === "de" ? "★ Gespeichert" : "★ Сохранено");
    assert.ok(html.includes('href="/planner"') || html.includes('href="/planner/"'));
  });
}
