"use client";
import { FormEvent, useState } from "react";
import { useLanguage } from "./LanguageProvider";
export function SubmissionForm() {
  const { t } = useLanguage();
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setMessage(t("submitting")); const form=event.currentTarget; const response=await fetch("/api/submissions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(form)))}); const result=await response.json(); setMessage(response.ok?`${t("received")} (${result.reference}).`:result.error||t("failed")); if(response.ok) form.reset(); }
  return <form className="submissionForm" onSubmit={submit}><label>{t("festivalName")}<input name="name" required minLength={2} maxLength={100}/></label><label>{t("officialSource")}<input name="officialUrl" type="url" required/></label><label>{t("editionYear")}<input name="year" type="number" min="2027" max="2100" required/></label><label>{t("notes")}<textarea name="notes" maxLength={1000}/></label><input className="honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"/><button type="submit">{t("sendReview")}</button><p role="status" aria-live="polite">{message}</p></form>;
}
