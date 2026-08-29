import { notFound } from "next/navigation";
import { HomeContent } from "@/components/HomeContent";
import { festivals, supportedLanguages } from "@/data/festivals";
export const dynamicParams=false;
export function generateStaticParams(){return supportedLanguages.map((lang)=>({lang}));}
export async function generateMetadata({params}:{params:Promise<{lang:string}>}){const lang=(await params).lang;return{alternates:{canonical:`/${lang}/`,languages:{en:"/en/",de:"/de/",ru:"/ru/"}}};}
export default async function LocalizedHome({params}:{params:Promise<{lang:string}>}){const lang=(await params).lang;if(!supportedLanguages.some((value)=>value===lang))notFound();return <HomeContent festivals={festivals}/>;}
