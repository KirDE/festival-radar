"use client";

import { useLanguage } from "./LanguageProvider";
import { SubmissionForm } from "./SubmissionForm";

export function SubmissionIntro() {
  const { t } = useLanguage();
  return <div className="directoryPage">
    <p className="eyebrow">{t("submitEyebrow")}</p>
    <h1>{t("submitFestival")}</h1>
    <p>{t("submitIntro")}</p>
    <SubmissionForm />
  </div>;
}
