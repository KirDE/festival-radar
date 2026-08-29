import { notFound } from "next/navigation";
import { FestivalExplorer } from "@/components/FestivalExplorer";
import { festivalMonth, festivals } from "@/data/festivals";
export const dynamicParams=false;
export function generateStaticParams(){return [...new Set(festivals.map(festivalMonth).filter((value):value is string=>Boolean(value)))].map((month)=>({month}));}
export async function generateMetadata({params}:{params:Promise<{month:string}>}){const month=(await params).month;return{title:`European festivals in month ${month}`,alternates:{canonical:`/months/${month}/`}};}
export default async function MonthPage({params}:{params:Promise<{month:string}>}){const month=(await params).month;const items=festivals.filter((item)=>festivalMonth(item)===month);if(!items.length)notFound();const name=new Intl.DateTimeFormat("en",{month:"long",timeZone:"UTC"}).format(new Date(`2027-${month}-01T12:00:00Z`));return <div className="directoryPage"><h1>Festivals in {name}</h1><FestivalExplorer festivals={items}/></div>;}
