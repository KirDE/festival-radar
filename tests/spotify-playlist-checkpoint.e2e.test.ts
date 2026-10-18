import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {requireLocalDisposableDatabase} from './support/disposable-db.ts';
import {publishSpotifyCheckpoint} from '../lib/catalog/playlist-worker.ts';
import {claimPlaylistRefresh,stagePlaylistPlan,spotifyCreationState,finishPlaylistRefresh,PlaylistLeaseLostError} from '../lib/catalog/playlist-queue.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db=new PrismaClient();
const spotifyUrl='https://open.spotify.com/playlist/'+'a'.repeat(22);
const uris=['spotify:track:'+'b'.repeat(22),'spotify:track:'+'c'.repeat(22)];
async function fixture(run:(value:{slug:string;editionId:string;jobId:string;claim:NonNullable<Awaited<ReturnType<typeof claimPlaylistRefresh>>['claim']>})=>Promise<void>){
 const slug='checkpoint-'+randomUUID();
 const festival=await db.festival.create({data:{slug,name:'Synthetic',country:'Test',countryCode:'DE',genres:[],officialUrl:'https://example.test/',editions:{create:{year:2027,status:'PARTIAL',ticketStatus:'UNKNOWN',recordState:'CURRENT',completeness:'PARTIAL',sourceUpdatedAt:new Date()}}},include:{editions:true}});
 const publication=await db.catalogPublication.create({data:{source:'ADMIN',sourceId:slug,festivalSlug:slug,editionYear:2027,actorLabel:'test',fields:['lineup'],lineupChanged:true}});
 const job=await db.catalogPlaylistRefresh.create({data:{publicationId:publication.id,festivalSlug:slug,requestedAt:new Date('1900-01-01')}});
 try{
  const {claim}=await claimPlaylistRefresh(db,{owner:randomUUID(),ttlMs:120000});assert.ok(claim);assert.equal(claim.id,job.id);
  await stagePlaylistPlan(db,claim,{edition_year:2027,playlist_url:'',playlist_id:'',track_uris:uris,track_count:2,artists_count:1});
  await run({slug,editionId:festival.editions[0].id,jobId:job.id,claim});
 }finally{
  await db.catalogPlaylistRefresh.updateMany({where:{festivalSlug:slug},data:{status:'SUCCEEDED',leaseOwner:null,leaseExpiresAt:null}});
  await db.festival.delete({where:{id:festival.id}});
 }
}
test.after(async()=>{await db.$disconnect();});
test('verified Spotify publishes before a YouTube failure; retry reuses the same binding and immutable track plan',async()=>fixture(async({editionId,jobId,claim})=>{
 await spotifyCreationState(db,claim,'reserve','');await spotifyCreationState(db,claim,'bind','','a'.repeat(22));
 const output=await publishSpotifyCheckpoint(db,claim,{url:spotifyUrl,expectedUrl:'',artists:1,tracks:2});assert.equal(output.expectedUrl,spotifyUrl);
 await finishPlaylistRefresh(db,claim,'FAILED');
 const failed=await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id:jobId}});assert.equal(failed.status,'FAILED');assert.equal(failed.completedAt instanceof Date,true);
 assert.equal(await db.festivalPlaylist.count({where:{editionId,provider:'youtube_music'}}),0);
 const binding=await db.festivalPlaylist.findUniqueOrThrow({where:{editionId_provider:{editionId,provider:'spotify'}}});assert.equal(binding.trackCount,2);
 const plan=failed.desiredPlan as {playlist_url:string;track_uris:string[]};assert.equal(plan.playlist_url,spotifyUrl);assert.deepEqual(plan.track_uris,uris);
 await db.catalogPlaylistRefresh.update({where:{id:jobId},data:{retryAt:new Date('1900-01-01')}});
 const retry=(await claimPlaylistRefresh(db,{owner:randomUUID(),ttlMs:120000})).claim;assert.ok(retry);assert.equal(retry.id,jobId);
 await publishSpotifyCheckpoint(db,retry,{url:spotifyUrl,expectedUrl:spotifyUrl,artists:1,tracks:2});
 assert.equal(await db.festivalPlaylist.count({where:{editionId,provider:'spotify'}}),1);
 assert.equal((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id:jobId}})).status,'RUNNING');
 assert.deepEqual((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id:jobId}})).desiredPlan,failed.desiredPlan);
}));
test('missing creation confirmation or mismatched read-back counts cannot publish',async()=>fixture(async({editionId,claim})=>{
 await assert.rejects(publishSpotifyCheckpoint(db,claim,{url:spotifyUrl,expectedUrl:'',artists:1,tracks:2}),/Unverified/);
 await spotifyCreationState(db,claim,'reserve','');await spotifyCreationState(db,claim,'bind','','a'.repeat(22));
 await assert.rejects(publishSpotifyCheckpoint(db,claim,{url:spotifyUrl,expectedUrl:'',artists:1,tracks:3}),/plan mismatch/);
 assert.equal(await db.festivalPlaylist.count({where:{editionId}}),0);
}));
test('concurrent binding insertion is never overwritten',async()=>fixture(async({editionId,claim})=>{
 await spotifyCreationState(db,claim,'reserve','');await spotifyCreationState(db,claim,'bind','','a'.repeat(22));
 const other='https://open.spotify.com/playlist/'+'d'.repeat(22);
 await db.festivalPlaylist.create({data:{editionId,provider:'spotify',url:other}});
 await assert.rejects(publishSpotifyCheckpoint(db,claim,{url:spotifyUrl,expectedUrl:'',artists:1,tracks:2}),/binding changed/);
 assert.equal((await db.festivalPlaylist.findUniqueOrThrow({where:{editionId_provider:{editionId,provider:'spotify'}}})).url,other);
}));
test('expired lease fences both binding publication and plan normalization',async()=>fixture(async({editionId,jobId,claim})=>{
 await spotifyCreationState(db,claim,'reserve','');await spotifyCreationState(db,claim,'bind','','a'.repeat(22));
 await db.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "leaseExpiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=${jobId}`;
 await assert.rejects(publishSpotifyCheckpoint(db,claim,{url:spotifyUrl,expectedUrl:'',artists:1,tracks:2}),PlaylistLeaseLostError);
 assert.equal(await db.festivalPlaylist.count({where:{editionId}}),0);
 assert.equal(((await db.catalogPlaylistRefresh.findUniqueOrThrow({where:{id:jobId}})).desiredPlan as {playlist_url:string}).playlist_url,'');
}));
