import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { requireLocalDisposableDatabase } from './support/disposable-db.ts';
import { claimDueSources, completeSourceLease, markDeprecatedSources } from '../lib/ingestion/lease.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
test('real DB stepped retry, exact 21-day deprecation between weekly probes, successful unchanged recovery', async () => {
 const db = new PrismaClient();
 // Earlier integration steps leave enabled source fixtures in this disposable
 // DB. Global due selection must exercise THIS case, not lease an unrelated row.
 const previouslyEnabled = await db.festivalSource.findMany({where:{enabled:true},select:{id:true}});
 await db.festivalSource.updateMany({where:{id:{in:previouslyEnabled.map(row=>row.id)}},data:{enabled:false}});
 const slug='failure-policy-'+randomUUID(); const now=new Date();
 const f=await db.festival.create({data:{slug,name:'Synthetic retry',country:'Test',countryCode:'DE',officialUrl:'https://example.test',genres:[],editions:{create:{year:2027,status:'TBA',ticketStatus:'UNKNOWN',recordState:'CURRENT',completeness:'TBA',sourceUpdatedAt:now}}}});
 const e=await db.festivalEdition.findFirstOrThrow({where:{festivalId:f.id}});
 const s=await db.festivalSource.create({data:{festivalSlug:slug,festivalId:f.id,editionId:e.id,editionYear:2027,url:'https://example.test',enabled:true,strategies:['manual_review'],parserKey:'manual_review',refreshPolicy:'daily',cadenceSeconds:86400,configurationBackfilledAt:now}});
 try {
  let at=now;
  for(const seconds of [3600,21600,86400,259200,604800,604800]) {
   const owner=randomUUID(); const [claim]=await claimDueSources(db,{owner,now:at,limit:1,ttlMs:60000});assert.equal(claim.id,s.id);
   assert.equal(await completeSourceLease(db,{...claim,owner,now:at,outcome:'fetch_error'}),true);
   const row=await db.festivalSource.findUniqueOrThrow({where:{id:s.id}});
   assert.equal(row.nextRunAt!.getTime()-at.getTime(),seconds*1000);
   assert.equal(row.failureStartedAt!.getTime(),now.getTime());at=row.nextRunAt!;
  }
  // Mark even if next weekly probe is later: no fake failure attempt needed.
  const deadline=new Date(now.getTime()+21*86400000);
  await db.festivalSource.update({where:{id:s.id},data:{nextRunAt:new Date(deadline.getTime()+86400000)}});
  assert.equal(await markDeprecatedSources(db,new Date(deadline.getTime()-1)),0);
  assert.equal(await markDeprecatedSources(db,deadline),1);
  assert.equal(await markDeprecatedSources(db,deadline),0);
  assert.ok((await db.festivalSource.findUniqueOrThrow({where:{id:s.id}})).deprecatedAt);
  const { DatabaseCatalogRepository } = await import('../lib/catalog/repository.ts');
  assert.equal((await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug===slug)?.sourceDeprecated,true);
  const alternative=await db.festivalSource.create({data:{festivalSlug:slug,festivalId:f.id,editionId:e.id,editionYear:2027,url:'https://example.test/secondary',enabled:true,strategies:['manual_review'],parserKey:'manual_review',refreshPolicy:'daily',cadenceSeconds:86400}});
  assert.equal((await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug===slug)?.sourceDeprecated,false);
  await db.festivalSource.delete({where:{id:alternative.id}});
  const owner=randomUUID();const due=new Date(deadline.getTime()+86400000);const [claim]=await claimDueSources(db,{owner,now:due,limit:1,ttlMs:60000});
  assert.equal(await completeSourceLease(db,{...claim,owner,now:due,outcome:'success'}),true);
  const recovered=await db.festivalSource.findUniqueOrThrow({where:{id:s.id}});assert.equal(recovered.deprecatedAt,null);assert.equal(recovered.failureStartedAt,null);assert.equal(recovered.consecutiveFailures,0);
 } finally {await db.festivalSource.delete({where:{id:s.id}});await db.festival.delete({where:{id:f.id}});await db.festivalSource.updateMany({where:{id:{in:previouslyEnabled.map(row=>row.id)}},data:{enabled:true}});await db.$disconnect();}
});
