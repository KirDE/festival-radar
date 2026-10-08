import { notFound } from "next/navigation";
import { MonthContent } from "@/components/PublicCatalogPages";
import { festivalMonth } from "@/lib/catalog/public";
import { getCatalog } from "@/lib/catalog/repository";
export const dynamic = "force-dynamic";
export const dynamicParams=true;
export async function generateMetadata({params}:{params:Promise<{month:string}>}){const month=(await params).month;return{title:`European festivals in month ${month}`,alternates:{canonical:`/months/${month}/`}};}
export default async function MonthPage({params}:{params:Promise<{month:string}>}){const month=(await params).month;const {festivals}=await getCatalog();const items=festivals.filter((item)=>festivalMonth(item)===month);if(!items.length)notFound();return <MonthContent month={month} festivals={items} />;}
