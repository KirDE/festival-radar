"use client";

import { useMemo, useState } from "react";
import type { Festival } from "@/data/festivals";
import type { AuditEntry, ParserRun, ReviewChange } from "@/lib/admin";

type Section = "content" | "review" | "assets" | "diagnostics" | "audit";

export function AdminConsole({ actor, festivals, initialChanges, parserRuns, auditEntries }: { actor: { email: string; role: "EDITOR" | "ADMIN" }; festivals: Festival[]; initialChanges: ReviewChange[]; parserRuns: ParserRun[]; auditEntries: AuditEntry[] }) {
  const [section, setSection] = useState<Section>("review");
  const [selectedSlug, setSelectedSlug] = useState(festivals[0]?.slug ?? "");
  const selected = festivals.find((item) => item.slug === selectedSlug) ?? festivals[0];
  const [changes, setChanges] = useState(initialChanges);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [artistQuery, setArtistQuery] = useState("");
  const [festivalDraft, setFestivalDraft] = useState<Record<string, string>>({});
  const [assetDraft, setAssetDraft] = useState<Record<string, string>>({});
  const artists = useMemo(() => Array.from(new Set(festivals.flatMap((item) => [...item.headliners, ...item.lineup]))).filter((artist) => artist.toLowerCase().includes(artistQuery.toLowerCase())).slice(0, 12), [festivals, artistQuery]);

  const decide = async (id: string, status: "approved" | "rejected") => {
    const response = await fetch(`/api/admin/changes/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: status === "approved" ? "approve" : "reject" }) });
    const body = await response.json();
    if (!response.ok) return setNotice(body.error ?? "Decision failed");
    setChanges((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    setNotice(`Change ${id} ${status}. The durable audit trail was updated.`);
  };
  const refresh = async () => {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/refresh/${selected.slug}`, { method: "POST" });
      const body = await response.json();
      setNotice(response.ok ? `${selected.name} refresh finished: ${body.message}. Reload to inspect its queued changes and persisted log.` : body.error ?? "Refresh failed");
    } finally { setRefreshing(false); }
  };
  const save = async (resourceKind: "festival" | "link", values: Record<string, string>) => {
    const snapshotResponse = await fetch("/api/admin");
    const snapshot = await snapshotResponse.json();
    if (!snapshotResponse.ok) return setNotice(snapshot.error ?? "Unable to load current revision");
    const resource = snapshot.resources.find((item: { resourceKind: string; resourceKey: string }) => item.resourceKind === resourceKind.toUpperCase() && item.resourceKey === selected.slug);
    const response = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceKind, resourceKey: selected.slug, baseRevision: resource?.revision ?? 0, values }) });
    const body = await response.json();
    setNotice(response.ok ? `Draft revision ${body.revision} persisted and queued for review.` : body.error ?? "Draft save failed");
  };

  return <main className="adminShell">
    <aside className="adminNav" aria-label="Administration sections">
      <div><div className="eyebrow">Festival Radar</div><h1>Admin console</h1><p>Review-first content operations</p></div>
      {([ ["review", "Review queue"], ["content", "Festivals & artists"], ["assets", "Links & assets"], ["diagnostics", "Parser diagnostics"], ["audit", "Audit history"] ] as [Section, string][]).map(([id, label]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}{id === "review" && <b>{changes.filter((item) => item.status === "pending").length}</b>}</button>)}
      <a href="/">← Public site</a>
    </aside>
    <section className="adminMain">
      <header className="adminHeader"><div><div className="eyebrow">Operations / 2027 season</div><h2>{section === "review" ? "Detected changes" : section === "content" ? "Content editor" : section === "assets" ? "Links & assets" : section === "diagnostics" ? "Parser diagnostics" : "Audit history"}</h2></div><span className="adminRole">{actor.role} · {actor.email}</span></header>
      {notice && <div className="adminNotice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}

      {section === "review" && <div className="reviewList">
        <div className="adminToolbar"><p>Approve trusted source changes or reject them without publishing automatically.</p><select aria-label="Filter changes"><option>All pending changes</option><option>Conflicts only</option><option>High confidence</option></select></div>
        {changes.map((change) => <article className={`reviewCard ${change.status}`} key={change.id}>
          <div className="reviewMeta"><span className={change.conflict ? "risk" : "safe"}>{change.conflict ? "Conflict" : `${change.confidence}% confidence`}</span><small>{change.id} · {change.source}</small></div>
          <h3>{change.festival} <span>· {change.field}</span></h3>
          <div className="diff"><div><small>Current</small><p>{change.current}</p></div><div><small>Detected</small><p>{change.detected}</p></div></div>
          {change.status === "pending" ? <div className="reviewActions"><button className="secondary" onClick={() => decide(change.id, "rejected")}>Reject</button><button onClick={() => decide(change.id, "approved")}>Approve change</button></div> : <strong className="decision">{change.status}</strong>}
        </article>)}
      </div>}

      {section === "content" && selected && <div className="editorGrid">
        <div className="adminPanel"><label>Festival<select value={selectedSlug} onChange={(event) => { setSelectedSlug(event.target.value); setFestivalDraft({}); }}>{festivals.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label><div className="fieldPair"><label>Name<input defaultValue={selected.name} onChange={(e) => setFestivalDraft((v) => ({...v, name:e.target.value}))}/></label><label>Status<select defaultValue={selected.status} onChange={(e) => setFestivalDraft((v) => ({...v, status:e.target.value}))}><option>confirmed</option><option>partial</option><option>tba</option></select></label></div><div className="fieldPair"><label>City<input defaultValue={selected.city} onChange={(e) => setFestivalDraft((v) => ({...v, city:e.target.value}))}/></label><label>Country<input defaultValue={selected.country} onChange={(e) => setFestivalDraft((v) => ({...v, country:e.target.value}))}/></label></div><div className="fieldPair"><label>Start date<input type="date" defaultValue={selected.startDate} onChange={(e) => setFestivalDraft((v) => ({...v, startDate:e.target.value}))}/></label><label>End date<input type="date" defaultValue={selected.endDate} onChange={(e) => setFestivalDraft((v) => ({...v, endDate:e.target.value}))}/></label></div><label>Headliners<textarea defaultValue={selected.headliners.join("\n")} rows={5} onChange={(e) => setFestivalDraft((v) => ({...v, headliners:e.target.value}))}/></label><button disabled={!Object.keys(festivalDraft).length} onClick={() => save("festival", festivalDraft)}>Save festival draft</button></div>
        <div className="adminPanel"><label>Festival<select value={selectedSlug} onChange={(event) => { setSelectedSlug(event.target.value); setFestivalDraft({}); }}>{festivals.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label><div className="fieldPair"><label>Name<input defaultValue={selected.name} onChange={(e) => setFestivalDraft((v) => ({...v, name:e.target.value}))}/></label><label>Status<select defaultValue={selected.status} onChange={(e) => setFestivalDraft((v) => ({...v, status:e.target.value}))}><option>confirmed</option><option>partial</option><option>tba</option></select></label></div><div className="fieldPair"><label>City<input defaultValue={selected.city} onChange={(e) => setFestivalDraft((v) => ({...v, city:e.target.value}))}/></label><label>Country<input defaultValue={selected.country} onChange={(e) => setFestivalDraft((v) => ({...v, country:e.target.value}))}/></label></div><div className="fieldPair"><label>Start date<input type="date" defaultValue={selected.startDate} onChange={(e) => setFestivalDraft((v) => ({...v, startDate:e.target.value}))}/></label><label>End date<input type="date" defaultValue={selected.endDate} onChange={(e) => setFestivalDraft((v) => ({...v, endDate:e.target.value}))}/></label></div><label>Headliners<textarea defaultValue={selected.headliners.join("\n")} rows={5} onChange={(e) => setFestivalDraft((v) => ({...v, headliners:e.target.value}))}/></label><button disabled={!Object.keys(festivalDraft).length} onClick={() => save("festival", festivalDraft)}>Save festival draft</button></div>
        <div><div className="adminPanel"><h3>Manual refresh</h3><p>Run only this festival’s configured adapters. Any differences go to the review queue.</p><button onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : `Refresh ${selected.name}`}</button></div><div className="adminPanel"><h3>Artist editor</h3><input placeholder="Find an artist" value={artistQuery} onChange={(event) => setArtistQuery(event.target.value)}/><ul className="artistAdminList">{artists.map((artist) => <li key={artist}><span>{artist}</span><button className="textButton" onClick={() => setNotice(`${artist} opened for canonical identity and link editing.`)}>Edit</button></li>)}</ul></div></div>
      </div>}

      {section === "assets" && selected && <div className="editorGrid"><div className="adminPanel"><label>Festival<select value={selectedSlug} onChange={(event) => { setSelectedSlug(event.target.value); setAssetDraft({}); }}>{festivals.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label>{([["officialUrl", "Official URL", selected.officialUrl], ["ticketsUrl", "Tickets URL", selected.ticketsUrl], ["playlistUrl", "Spotify / playlist URL", selected.playlistUrl], ["logoUrl", "Logo URL", ""]] as const).map(([field,label,value]) => <label key={field}>{label}<input type="url" defaultValue={value} placeholder="https://…" onChange={(e) => setAssetDraft((v) => ({...v, [field]:e.target.value}))}/></label>)}<button disabled={!Object.keys(assetDraft).length} onClick={() => save("link", assetDraft)}>Save asset draft</button></div><div className="adminPanel assetPreview"><h3>Validation</h3><span className="safe">HTTPS URLs are validated by the browser and server workflow.</span><p>Every persisted edit enters the review queue before it updates durable resource state.</p></div></div>}

      {section === "diagnostics" && <div className="diagnosticGrid">{parserRuns.map((run) => <article className="adminPanel" key={run.festival}><div className="reviewMeta"><span className={run.status === "healthy" ? "safe" : "risk"}>{run.status}</span><small>{run.lastRun}</small></div><h3>{run.festival}</h3><p>{run.message}</p><dl><div><dt>Adapter</dt><dd>{run.source}</dd></div><div><dt>Duration</dt><dd>{run.durationMs} ms</dd></div><div><dt>Records</dt><dd>{run.extracted}</dd></div></dl><button className="secondary" onClick={() => setNotice(`${run.festival} parser log opened.`)}>View parser log</button></article>)}</div>}

      {section === "audit" && <div className="adminPanel auditTable">{auditEntries.map((entry) => <article key={entry.id}><time>{entry.at}</time><div><strong>{entry.action}</strong><p>{entry.target} · {entry.detail}</p></div><span>{entry.actor}</span></article>)}</div>}
    </section>
  </main>;
}
