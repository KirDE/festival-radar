import { notFound } from "next/navigation";
import { HomeContent } from "@/components/HomeContent";
import { festivals, supportedLanguages } from "@/data/festivals";
import type { Language } from "@/components/LanguageProvider";
export const dynamicParams=false;
export function generateStaticParams(){return supportedLanguages.map((lang)=>({lang}));}
const seo: Record<Language, {title:string;description:string}> = {
  en:{title:"Festival Radar 2027",description:"Europe's rock and metal festivals: dates, lineups, tickets, playlists and setlists."},
  de:{title:"Festival Radar 2027",description:"Europas Rock- und Metal-Festivals: Termine, Line-ups, Tickets, Playlists und Setlists."},
  ru:{title:"Festival Radar 2027",description:"Рок- и метал-фестивали Европы: даты, лайнапы, билеты, плейлисты и сетлисты."},
};
export async function generateMetadata({params}:{params:Promise<{lang:string}>}){const lang=(await params).lang as Language;if(!supportedLanguages.includes(lang))return{};return{...seo[lang],manifest:`/${lang}/manifest.webmanifest`,alternates:{canonical:`/${lang}/`,languages:{"x-default":"/",en:"/en/",de:"/de/",ru:"/ru/"}}};}
export default async function LocalizedHome({params}:{params:Promise<{lang:string}>}){const lang=(await params).lang;if(!supportedLanguages.some((value)=>value===lang))notFound();return <HomeContent festivals={festivals}/>;}
