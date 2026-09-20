import { notFound } from "next/navigation";
import { NotificationSettings } from "@/components/NotificationSettings";
import { supportedLanguages } from "@/data/festivals";
import { getCatalog } from "@/lib/catalog/repository";
import type { Language } from "@/components/LanguageProvider";

export const dynamic = "force-dynamic";

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
  const { festivals } = await getCatalog();
  return <NotificationSettings festivals={festivals.map(({ slug, name }) => ({ id: slug, name }))} />;
}
