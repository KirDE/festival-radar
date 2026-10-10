// One-time bounded replay of real API correction audits; idempotent tasks, no
// catalog writes and no provider/playlist action. Never bootstrap retry-only errors.
import { db } from '../lib/db.ts';
import { enqueueParserRepair } from '../lib/ingestion/parser-repairs.ts';
import { fingerprint } from '../lib/ingestion/agent-contract.ts';
try {
 const audits=await db.adminAuditEntry.findMany({where:{action:{in:['ingestion.agent.apply','ingestion.agent.dismiss']}},orderBy:{createdAt:'asc'},take:1001});
 if(audits.length>1000)throw new Error('Audit replay exceeds bound');
 let queued=0;
 for(const a of audits){const before=a.beforeValue??{},after=a.afterValue??{};
  if(!Object.keys(after.facts??{}).length&&!after.sourceChange&&!before.candidateId)continue;
  const source=before.sourceId&&await db.festivalSource.findUnique({where:{id:before.sourceId}});if(!source)continue;
  const candidate=before.candidateId?await db.ingestionCandidate.findUnique({where:{id:before.candidateId},include:{evidence:true,diffs:true}}):null;
  await enqueueParserRepair(db,{sourceId:source.id,festivalSlug:source.festivalSlug,issueId:fingerprint({historicalAudit:a.id}),
    parserKey:source.parserKey,sourceUrl:source.fetchUrl??source.url,year:source.editionYear,reason:after.reason??'Historical independently reviewed correction',
    decision:{action:a.action.endsWith('dismiss')?'dismiss':'apply',facts:after.facts??{},source:after.sourceChange??null,evidence:a.evidence??[]},
    candidate: candidate?{facts:candidate.normalized,warnings:candidate.warnings,evidence:candidate.evidence.map(e=>({field:e.field,url:e.sourceUrl,excerpt:e.excerpt}))}:null,current:before.current??{}});
  queued++;
 }
 console.log(JSON.stringify({audits:audits.length,queued}));
}catch{console.error('Parser repair bootstrap failed; existing tasks retained');process.exitCode=1;}finally{await db.$disconnect();}
