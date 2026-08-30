import { supportedLanguages } from "@/data/festivals";
import type { Language } from "@/components/LanguageProvider";

const descriptions: Record<Language, string> = {
  en: "European rock and metal festival dates, lineups and planning tools.",
  de: "Termine, Line-ups und Planung für europäische Rock- und Metal-Festivals.",
  ru: "Даты, лайнапы и планирование европейских рок- и метал-фестивалей.",
};

export async function GET(_: Request, { params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Language;
  if (!supportedLanguages.includes(lang)) return new Response("Not found", { status: 404 });
  return Response.json({ name: "Festival Radar", short_name: "Festival Radar", description: descriptions[lang], lang, start_url: `/${lang}/`, scope: "/", display: "standalone", background_color: "#f2efe7", theme_color: "#171712", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] }, { headers: { "content-type": "application/manifest+json" } });
}
