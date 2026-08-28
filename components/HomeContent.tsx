"use client";

import type { Festival } from "@/data/festivals";
import { FestivalExplorer } from "./FestivalExplorer";
import { useLanguage } from "./LanguageProvider";

export function HomeContent({ festivals }: { festivals: Festival[] }) {
  const { t } = useLanguage();
  const announced = festivals.filter((item) => item.headliners.length > 0).length;
  const countries = new Set(festivals.map((item) => item.countryCode)).size;
  return <><section className="hero"><div className="eyebrow">{t("season")}</div><h1>{t("heroFirst")}<br/><em>{t("heroSecond")}</em></h1><p>{t("heroText")}</p><div className="heroStats"><span><strong>{festivals.length}</strong> {t("festivals")}</span><span><strong>{announced}</strong> {t("withActs")}</span><span><strong>{countries}</strong> {t("countries")}</span></div></section><FestivalExplorer festivals={festivals}/></>;
}
