import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FestivalExplorer } from "@/components/FestivalExplorer";
import { getCatalog } from "@/lib/catalog/repository";
export const dynamic = "force-dynamic";
export const dynamicParams=true;
export async function generateMetadata({params}:{params:Promise<{code:string}>}):Promise<Metadata>{const code=(await params).code.toUpperCase();const {festivals}=await getCatalog();const items=festivals.filter((item)=>item.countryCode===code);return items.length?{title:`Rock and metal festivals in ${items[0].country}`,description:`Dates, lineups and official tickets for ${items.length} festivals in ${items[0].country}.`,alternates:{canonical:`/countries/${code.toLowerCase()}/`}}:{};}
export default async function CountryPage({params}:{params:Promise<{code:string}>}){const code=(await params).code.toUpperCase();const {festivals}=await getCatalog();const items=festivals.filter((item)=>item.countryCode===code);if(!items.length)notFound();return <div className="directoryPage"><h1>Festivals in {items[0].country}</h1><FestivalExplorer festivals={items}/></div>;}
