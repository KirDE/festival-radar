"use client";

import { useEffect, useMemo, useState } from "react";
import type { Festival } from "@/data/festivals";
import type { AuditEntry, ParserRun, ReviewChange } from "@/lib/admin";
import { useLanguage, type Language } from "./LanguageProvider";

type Section = "content" | "review" | "submissions" | "assets" | "diagnostics" | "audit";
type Submission = { reference:string; name:string; year:number; officialUrl:string; notes:string|null; status:"pending"|"approved"|"rejected"; submittedAt:string; audit:{action:string;at:string}[] };
type Operator = { email: string; role: "USER" | "EDITOR" | "ADMIN" };

export function AdminConsole({ festivals, initialChanges, parserRuns, auditEntries, submissions: initialSubmissions }: { festivals: Festival[]; initialChanges: ReviewChange[]; parserRuns: ParserRun[]; auditEntries: AuditEntry[]; submissions: Submission[] }) {
  const [section, setSection] = useState<Section>("review");
  const [selectedSlug, setSelectedSlug] = useState(festivals[0]?.slug ?? "");
  const selected = festivals.find((item) => item.slug === selectedSlug) ?? festivals[0];
  const [changes, setChanges] = useState(initialChanges);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [artistQuery, setArtistQuery] = useState("");
  const [selectedArtist, setSelectedArtist] = useState("");
  const [artistDraft, setArtistDraft] = useState<Record<string, string>>({});
  const [festivalDraft, setFestivalDraft] = useState<Record<string, string>>({});
  const [assetDraft, setAssetDraft] = useState<Record<string, string>>({});
  const [operator, setOperator] = useState<Operator | null>(null);
  const [playlistDraft, setPlaylistDraft] = useState<Record<string, string>>({});
  const [openLog, setOpenLog] = useState<string | null>(null);
  const { language, setLanguage, ta } = useLanguage();
  const artists = useMemo(() => Array.from(new Set(festivals.flatMap((item) => [...item.headliners, ...item.lineup]))).filter((artist) => artist.toLowerCase().includes(artistQuery.toLowerCase())).slice(0, 12), [festivals, artistQuery]);
  useEffect(() => {
    fetch("/api/auth/me", { headers: { accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        const user = body?.user;
        if (user && (user.role === "ADMIN" || user.role === "EDITOR" || user.role === "USER")) setOperator({ email: user.email, role: user.role });
      })
      .catch(() => undefined);
  }, []);

  const decide = async (id: string, status: "approved" | "rejected") => {
    const response = await fetch(`/api/admin/changes/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: status === "approved" ? "approve" : "reject" }) });
    const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? "Decision failed");
    setChanges((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    setNotice(`${id}: ${ta(status)}. ${ta("decisionNotice")}`);
  };
  const decideSubmission = async (reference:string,status:"approved"|"rejected") => { const response=await fetch(`/api/admin/submissions/${reference}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision:status==="approved"?"approve":"reject"})}); const body=await response.json(); if(!response.ok)return setNotice(body.error??"Submission decision failed"); setSubmissions((items)=>items.map((item)=>item.reference===reference?{...item,status}:item)); setNotice(`Submission ${reference} ${status}; append-only audit updated.`); };
  const refresh = async () => {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/refresh/${selected.slug}`, { method: "POST" });
      const body = await response.json();
      setNotice(response.ok ? `${selected.name}: ${ta("refreshFinished")} ${body.message}` : body.error ?? "Refresh failed");
    } finally { setRefreshing(false); }
  };
  const save = async (resourceKind: "festival" | "artist" | "link" | "asset" | "playlist", resourceKey: string, values: Record<string, string>) => {
    const snapshotResponse = await fetch("/api/admin");
    const snapshot = await snapshotResponse.json();
    if (!snapshotResponse.ok) return setNotice(snapshot.error ?? "Unable to load current revision");
    const resource = snapshot.resources.find((item: { resourceKind: string; resourceKey: string }) => item.resourceKind === resourceKind.toUpperCase() && item.resourceKey === resourceKey);
    const response = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceKind, resourceKey, baseRevision: resource?.revision ?? 0, values }) });
    const body = await response.json();
    setNotice(response.ok ? `Draft revision ${body.revision} persisted and queued for review.` : body.error ?? "Draft save failed");
  };

  const pending = changes.filter((item) => item.status === "pending").length;
  const pendingSubmissions = submissions.filter((item) => item.status === "pending").length;
  return <div className="adminShell">
    <nav className="adminNav" aria-label={ta("navigation")}>
      <div><div className="eyebrow">Festival Radar</div><h1>{ta("console")}</h1><p>{ta("subtitle")}</p></div>
      {(["review", "submissions", "content", "assets", "diagnostics", "audit"] as Section[]).map((id) => <button type="button" key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>{ta(id)}{id === "review" && <b aria-label={`${pending} ${ta("pendingCount")}`}>{pending}</b>}{id === "submissions" && <b>{pendingSubmissions}</b>}</button>)}
      <label className="adminLanguage"><span>{ta("language")}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)}><option value="en">English</option><option value="de">Deutsch</option><option value="ru">Русский</option></select></label>
      <a href="/">← {ta("publicSite")}</a>
    </nav>
    <section className="adminMain">
      <header className="adminHeader"><div><div className="eyebrow">{ta("operations")}</div><h2>{section === "review" ? ta("detectedChanges") : section === "content" ? ta("contentEditor") : ta(section)}</h2></div>{operator && <span className="adminRole"><strong>{ta(operator.role === "ADMIN" ? "roleAdmin" : operator.role === "EDITOR" ? "roleEditor" : "roleUser")}</strong><small>{operator.email}</small></span>}</header>
      {notice && <div className="adminNotice" role="status" aria-live="polite">{notice}<button onClick={() => setNotice("")} aria-label={ta("dismiss")}>×</button></div>}

      {section === "review" && <div className="reviewList">
        <div className="adminToolbar"><p>{ta("reviewHelp")}</p><select aria-label={ta("filter")}><option>{ta("allPending")}</option><option>{ta("conflicts")}</option><option>{ta("highConfidence")}</option></select></div>
        {changes.map((change) => <article className={`reviewCard ${change.status}`} key={change.id}>
          <div className="reviewMeta"><span className={change.conflict ? "risk" : "safe"}>{change.conflict ? ta("conflict") : `${change.confidence}% ${ta("confidence")}`}</span><small>{change.id} · {change.source}</small></div>
          <h3>{change.festival} <span>· {change.field}</span></h3>
          <div className="diff"><div><small>{ta("current")}</small><p>{change.current}</p></div><div><small>{ta("detected")}</small><p>{change.detected}</p></div></div>
          {change.status === "pending" ? <div className="reviewActions"><button className="secondary" onClick={() => decide(change.id, "rejected")}>{ta("reject")}</button><button onClick={() => decide(change.id, "approved")}>{ta("approve")}</button></div> : <strong className="decision">{ta(change.status)}</strong>}
        </article>)}
      </div>}

      {section === "submissions" && <div className="reviewList">{submissions.map((item)=><article className={`reviewCard ${item.status}`} key={item.reference}><div className="reviewMeta"><span className={item.status==="pending"?"risk":"safe"}>{item.status}</span><small>{item.reference} · {item.submittedAt}</small></div><h3>{item.name} <span>· {item.year}</span></h3><p><a href={item.officialUrl} rel="noreferrer" target="_blank">{item.officialUrl}</a></p><p>{item.notes||"No notes supplied."}</p><p>History: {item.audit.map((entry)=>`${entry.action} ${entry.at}`).join(" · ")}</p>{item.status==="pending"&&<div className="reviewActions"><button className="secondary" onClick={()=>decideSubmission(item.reference,"rejected")}>Reject</button><button onClick={()=>decideSubmission(item.reference,"approved")}>Approve submission</button></div>}</article>)}</div>}

      {section === "content" && selected && <div className="editorGrid">
        <div className="adminPanel"><label>Festival<select value={selectedSlug} onChange={(event) => { setSelectedSlug(event.target.value); setFestivalDraft({}); }}>{festivals.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label><div className="fieldPair"><label>Name<input defaultValue={selected.name} onChange={(e) => setFestivalDraft((v) => ({...v, name:e.target.value}))}/></label><label>Status<select defaultValue={selected.status} onChange={(e) => setFestivalDraft((v) => ({...v, status:e.target.value}))}><option>confirmed</option><option>partial</option><option>tba</option></select></label></div><div className="fieldPair"><label>City<input defaultValue={selected.city} onChange={(e) => setFestivalDraft((v) => ({...v, city:e.target.value}))}/></label><label>Country<input defaultValue={selected.country} onChange={(e) => setFestivalDraft((v) => ({...v, country:e.target.value}))}/></label></div><div className="fieldPair"><label>Start date<input type="date" defaultValue={selected.startDate} onChange={(e) => setFestivalDraft((v) => ({...v, startDate:e.target.value}))}/></label><label>End date<input type="date" defaultValue={selected.endDate} onChange={(e) => setFestivalDraft((v) => ({...v, endDate:e.target.value}))}/></label></div><label>Headliners<textarea defaultValue={selected.headliners.join("\n")} rows={5} onChange={(e) => setFestivalDraft((v) => ({...v, headliners:e.target.value}))}/></label><button disabled={!Object.keys(festivalDraft).length} onClick={() => save("festival", selected.slug, festivalDraft)}>Save festival draft</button></div>
        <div>{operator?.role === "ADMIN" && <div className="adminPanel"><h3>Manual refresh</h3><p>Run only this festival’s configured adapters. Any differences go to the review queue.</p><button onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : `Refresh ${selected.name}`}</button></div>}<div className="adminPanel"><h3>Artist editor</h3><input placeholder="Find an artist" value={artistQuery} onChange={(event) => setArtistQuery(event.target.value)}/><ul className="artistAdminList">{artists.map((artist) => <li key={artist}><span>{artist}</span><button className="textButton" onClick={() => { setSelectedArtist(artist); setArtistDraft({}); }}>Edit</button></li>)}</ul>{selectedArtist && <div><strong>{selectedArtist}</strong><label>Canonical name<input defaultValue={selectedArtist} onChange={(event) => setArtistDraft((value) => ({ ...value, canonicalName: event.target.value }))}/></label><label>Official URL<input type="url" placeholder="https://…" onChange={(event) => setArtistDraft((value) => ({ ...value, officialUrl: event.target.value }))}/></label><button disabled={!Object.keys(artistDraft).length} onClick={() => save("artist", selectedArtist, artistDraft)}>Save artist draft</button></div>}</div></div>
      </div>}

      {section === "assets" && selected && <div className="editorGrid"><div className="adminPanel"><label>Festival<select value={selectedSlug} onChange={(event) => { setSelectedSlug(event.target.value); setAssetDraft({}); setPlaylistDraft({}); }}>{festivals.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label>{([["officialUrl", "Official URL", selected.officialUrl], ["ticketsUrl", "Tickets URL", selected.ticketsUrl], ["logoUrl", "Logo URL", ""]] as const).map(([field,label,value]) => <label key={field}>{label}<input type="url" defaultValue={value} placeholder="https://…" onChange={(e) => setAssetDraft((v) => ({...v, [field]:e.target.value}))}/></label>)}<button disabled={!Object.keys(assetDraft).some((field) => field !== "logoUrl")} onClick={() => save("link", selected.slug, Object.fromEntries(Object.entries(assetDraft).filter(([field]) => field !== "logoUrl")))}>Save links draft</button><button disabled={!assetDraft.logoUrl} onClick={() => save("asset", selected.slug, { logoUrl: assetDraft.logoUrl })}>Save asset draft</button></div><div><div className="adminPanel"><h3>Playlist editor</h3><label>Playlist URL<input type="url" defaultValue={selected.playlistUrl} placeholder="https://open.spotify.com/playlist/…" onChange={(event) => setPlaylistDraft((value) => ({ ...value, url: event.target.value }))}/></label><label>Platform<select defaultValue="spotify" onChange={(event) => setPlaylistDraft((value) => ({ ...value, platform: event.target.value }))}><option value="spotify">Spotify</option><option value="youtube_music">YouTube Music</option></select></label><label>Publication status<select defaultValue="published" onChange={(event) => setPlaylistDraft((value) => ({ ...value, status: event.target.value }))}><option value="published">Published</option><option value="draft">Draft</option><option value="disabled">Disabled</option></select></label><button disabled={!Object.keys(playlistDraft).length} onClick={() => save("playlist", selected.slug, playlistDraft)}>Save playlist draft</button></div><div className="adminPanel assetPreview"><h3>Validation</h3><span className="safe">HTTPS URLs are validated by the browser and server workflow.</span><p>Every persisted edit enters the review queue before it updates durable resource state.</p></div></div></div>}

      {section === "diagnostics" && <div className="diagnosticGrid">{parserRuns.map((run, index) => { const logId = `parser-log-${index}`; return <article className="adminPanel" key={`${run.festival}-${run.lastRun}`}><div className="reviewMeta"><span className={run.status === "healthy" ? "safe" : "risk"}>{run.status}</span><small>{run.lastRun}</small></div><h3>{run.festival}</h3><p>{run.message}</p><dl><div><dt>{ta("adapter")}</dt><dd>{run.source}</dd></div><div><dt>{ta("duration")}</dt><dd>{run.durationMs} ms</dd></div><div><dt>{ta("records")}</dt><dd>{run.extracted}</dd></div></dl><button className="secondary" aria-expanded={openLog === logId} aria-controls={logId} onClick={() => setOpenLog((value) => value === logId ? null : logId)}>{ta("viewLog")}</button>{openLog === logId && <pre id={logId} tabIndex={0} aria-label={`${run.festival} parser log`}>{JSON.stringify(run.log, null, 2)}</pre>}</article>; })}</div>}

      {section === "audit" && <div className="adminPanel auditTable">{auditEntries.map((entry) => <article key={entry.id}><time>{entry.at}</time><div><strong>{entry.action}</strong><p>{entry.target} · {entry.detail}</p></div><span>{entry.actor}</span></article>)}</div>}
    </section>
  </div>;
}
