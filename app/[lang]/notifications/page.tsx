import { notFound } from "next/navigation";
import { NotificationSettings } from "@/components/NotificationSettings";
import { festivals, supportedLanguages } from "@/data/festivals";
import type { Language } from "@/components/LanguageProvider";

const titles: Record<Language, string> = {
  en: "Notification settings",
  de: "Benachrichtigungen",
  ru: "Настройки уведомлений",
};

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Language;
  if (!supportedLanguages.includes(lang)) return {};
  return { title: titles[lang], alternates: { canonical: `/${lang}/notifications/` } };
}

export default async function LocalizedNotifications({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Language;
  if (!supportedLanguages.includes(lang)) notFound();
  return <NotificationSettings festivals={festivals.map(({ slug, name }) => ({ id: slug, name }))} />;
}
