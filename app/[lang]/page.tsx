import { notFound } from "next/navigation";
import { HomeContent } from "@/components/HomeContent";
import { supportedLanguages } from "@/lib/catalog/public";
import { getHomeCatalog, homeMetadata } from "@/lib/home-metadata";

export const dynamic = "force-dynamic";
import type { Language } from "@/components/LanguageProvider";
export const dynamicParams=false;
export function generateStaticParams(){return supportedLanguages.map((lang)=>({lang}));}
export async function generateMetadata({params}:{params:Promise<{lang:string}>}){const lang=(await params).lang as Language;if(!supportedLanguages.includes(lang))return{};const {festivals}=await getHomeCatalog();return{...homeMetadata(lang,festivals.length),manifest:`/${lang}/manifest.webmanifest`,alternates:{canonical:`/${lang}/`,languages:{"x-default":"/",en:"/en/",de:"/de/",ru:"/ru/"}}};}
export default async function LocalizedHome({params}:{params:Promise<{lang:string}>}){const lang=(await params).lang;if(!supportedLanguages.some((value)=>value===lang))notFound();const {festivals}=await getHomeCatalog();return <HomeContent festivals={festivals}/>;}
