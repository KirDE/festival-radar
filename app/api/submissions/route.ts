import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
export async function POST(request: Request) {
  let data: Record<string, unknown>; try { data=await request.json(); } catch { return NextResponse.json({error:"Invalid request."},{status:400}); }
  if(data.website) return NextResponse.json({error:"Invalid submission."},{status:400});
  const name=typeof data.name==="string"?data.name.trim():""; const year=Number(data.year); let officialUrl:URL;
  try { officialUrl=new URL(String(data.officialUrl)); } catch { return NextResponse.json({error:"A valid official URL is required."},{status:400}); }
  if(name.length<2||name.length>100||!Number.isInteger(year)||year<2027||year>2100||!["http:","https:"].includes(officialUrl.protocol)) return NextResponse.json({error:"Check the festival name, year, and official URL."},{status:422});
  const reference=createHash("sha256").update(`${name}|${year}|${officialUrl.hostname}`).digest("hex").slice(0,10).toUpperCase();
  return NextResponse.json({accepted:true,reference},{status:202,headers:{"Cache-Control":"no-store"}});
}
