import { notFound } from "next/navigation";
import { SubmissionForm } from "@/components/SubmissionForm";
import { supportedLanguages } from "@/data/festivals";
import type { Language } from "@/components/LanguageProvider";

const copy: Record<Language, { title: string; description: string; eyebrow: string; heading: string; intro: string }> = {
  en: { title: "Submit a festival", description: "Suggest a European rock or metal festival using an official source.", eyebrow: "COMMUNITY SOURCES", heading: "Submit a festival", intro: "Every suggestion is reviewed before publication. Please link only to the festival organizer or an official ticketing partner." },
  de: { title: "Festival vorschlagen", description: "Schlage ein europäisches Rock- oder Metal-Festival mit einer offiziellen Quelle vor.", eyebrow: "QUELLEN AUS DER COMMUNITY", heading: "Festival vorschlagen", intro: "Jeder Vorschlag wird vor der Veröffentlichung geprüft. Bitte verlinke nur den Veranstalter oder einen offiziellen Ticketanbieter." },
  ru: { title: "Предложить фестиваль", description: "Предложите европейский рок- или метал-фестиваль с официальным источником.", eyebrow: "ИСТОЧНИКИ СООБЩЕСТВА", heading: "Предложить фестиваль", intro: "Каждое предложение проверяется перед публикацией. Добавляйте только сайт организатора или официального билетного партнёра." },
};

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Language;
  if (!supportedLanguages.includes(lang)) return {};
  return { title: copy[lang].title, description: copy[lang].description, alternates: { canonical: `/${lang}/submit/` } };
}

export default async function LocalizedSubmitPage({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Language;
  if (!supportedLanguages.includes(lang)) notFound();
  const text = copy[lang];
  return <div className="directoryPage"><p className="eyebrow">{text.eyebrow}</p><h1>{text.heading}</h1><p>{text.intro}</p><SubmissionForm /></div>;
}
