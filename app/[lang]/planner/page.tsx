import { notFound } from "next/navigation";
import { PlannerPage } from "@/components/PlannerPage";
import { festivals, supportedLanguages } from "@/data/festivals";
import type { Language } from "@/components/LanguageProvider";

const titles: Record<Language, string> = { en: "My festival plan", de: "Mein Festivalplan", ru: "Мой фестивальный план" };

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Language;
  if (!supportedLanguages.includes(lang)) return {};
  return { title: titles[lang], alternates: { canonical: `/${lang}/planner/` } };
}

export default async function LocalizedPlanner({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Language;
  if (!supportedLanguages.includes(lang)) notFound();
  return <PlannerPage festivals={festivals} />;
}
