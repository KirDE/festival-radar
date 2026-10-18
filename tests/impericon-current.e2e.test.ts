import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {catalogSeed} from './support/catalog.ts';
import {seedCatalog} from './support/seed-catalog.ts';
import {requireLocalDisposableDatabase} from './support/disposable-db.ts';
import {impericonFixture,impericonCurrentSource as source} from './support/impericon-current.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {DatabaseCatalogRepository} from '../lib/catalog/repository.ts';
import {createIngestionRun,persistAttempt} from '../lib/ingestion/repository.ts';
import {publishIngestionResult} from '../lib/catalog/publication.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db=new PrismaClient();
test.beforeEach(async()=>{
 const festival={...catalogSeed.festivals[0],slug:'impericon',name:'Synthetic Impericon',officialUrl:source.url,startDate:'2027-06-25',endDate:'2027-06-26',lineup:['Support One']};
 await seedCatalog(db,{festivals:[festival],editions:catalogSeed.editions.map(e=>({...e,slug:'impericon',...(e.recordState==='current'?festival:{})})),
  artists:[...catalogSeed.artists,{...catalogSeed.artists[0],slug:'support-one',name:'Support One'},{...catalogSeed.artists[0],slug:'beartooth',name:'Beartooth'}],playlists:{}});
 await db.festivalEdition.updateMany({where:{festival:{slug:'impericon'},year:2027},data:{status:'PARTIAL',completeness:'PARTIAL'}});
});
test.after(async()=>{await db.festivalSource.deleteMany({where:{festivalSlug:'impericon'}});await db.festival.deleteMany({where:{slug:'impericon'}});await db.$disconnect();});
async function prepare(){
 const current=(await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug==='impericon')!;
 const candidate=extractFestivalCandidate(JSON.stringify(impericonFixture()),source,new Date().toISOString());
 const result=evaluateCandidate(current,candidate);assert.deepEqual(result.changes.map(c=>[c.kind,c.after]),[['headliner_added','Beartooth']]);
 const run=await createIngestionRun(db,{trigger:'TEST',sourceCommit:'impericon-current-test',totalSources:1});
 const attempt=await persistAttempt(db,{runId:run.id,festivalSlug:'impericon',requestedUrl:source.url,httpStatus:200,durationMs:1,startedAt:new Date(),endedAt:new Date(),result});
 return{result,attempt};
}
test('persisted current-announcement import adds headliner, reuses identity and defers providers, including replay',async()=>{
 const archived=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'impericon'},year:2026},include:{lineup:true}});
 const artist=await db.artist.findUniqueOrThrow({where:{slug:'beartooth'}});
 const jobs=await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}});
 const {result,attempt}=await prepare();
 const publication=await publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-current-test'});
 assert.ok(publication);assert.equal(publication.playlistRefreshRequested,false);
 const edition=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'impericon'},year:2027},include:{lineup:true}});
 assert.equal(edition.lineup.find(l=>l.artistId===artist.id)?.billing,'HEADLINER');assert.equal(edition.lineup.length,3);assert.equal(edition.status,'PARTIAL');
 assert.equal((await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}})).reviewState,'PUBLISHED');
 assert.deepEqual(await db.festivalEdition.findUniqueOrThrow({where:{id:archived.id},include:{lineup:true}}),archived);
 const replay=await publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-current-test'});assert.equal(replay?.id,publication.id);
 assert.equal(await db.catalogPlaylistRefresh.count({where:{festivalSlug:'impericon'}}),jobs);
 const current=(await new DatabaseCatalogRepository(db).read()).festivals.find(f=>f.slug==='impericon')!;
 const unchanged=evaluateCandidate(current,result.candidate);assert.deepEqual(unchanged.changes,[]);assert.deepEqual(unchanged.reviewReasons,[]);
});
test('missing persisted official field evidence rejects and rolls back before any provider activity',async()=>{
 const {result,attempt}=await prepare();
 const candidate=await db.ingestionCandidate.findUniqueOrThrow({where:{attemptId:attempt.id}});
 await db.ingestionEvidence.deleteMany({where:{candidateId:candidate.id,field:'headliners'}});
 await assert.rejects(publishIngestionResult(db,{attemptId:attempt.id,result,sourceCommit:'impericon-current-test'}),/deferral requires matching persisted/);
 const edition=await db.festivalEdition.findFirstOrThrow({where:{festival:{slug:'impericon'},year:2027},include:{lineup:true}});assert.equal(edition.lineup.length,2);
});
