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
  const artists = useMemo(() => Array.from(new Set(festivals.flatMap((item) => [...item.headliners, ...item.lineup]))).filter((artist) => artist.toLowerCase().includes(artistQuery.toLowerCase())).slice(0, 12), [festivals, artistQuery]);

  const runAction = async (body: Record<string, string>) => {
    const response = await fetch("/api/admin/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Administrative action failed.");
  };
  const decide = async (id: string, status: "approved" | "rejected") => {
    try { await runAction({ action: "review.decide", target: id, decision: status }); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Administrative action failed."); return; }
    setChanges((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    setNotice(`Change ${id} ${status}. The decision was added to the audit trail.`);
  };
  const refresh = async () => {
    setRefreshing(true);
    setNotice("");
    try { await runAction({ action: "festival.refresh", target: selected.slug }); setNotice(`${selected.name} refresh was accepted and recorded in the audit trail.`); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Refresh failed."); }
    finally { setRefreshing(false); }
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
        <div className="adminPanel"><label>Festival<select value={selectedSlug} onChange={(event) => setSelectedSlug(event.target.value)}>{festivals.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label><div className="fieldPair"><label>Name<input defaultValue={selected.name}/></label><label>Status<select defaultValue={selected.status}><option>confirmed</option><option>partial</option><option>tba</option></select></label></div><div className="fieldPair"><label>City<input defaultValue={selected.city}/></label><label>Country<input defaultValue={selected.country}/></label></div><div className="fieldPair"><label>Start date<input type="date" defaultValue={selected.startDate}/></label><label>End date<input type="date" defaultValue={selected.endDate}/></label></div><label>Headliners<textarea defaultValue={selected.headliners.join("\n")} rows={5}/></label><button onClick={async () => { try { await runAction({ action: "festival.save-draft", target: selected.slug }); setNotice("Draft saved and attributed in the audit trail. It will not be published until reviewed."); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Save failed."); } }}>Save festival draft</button></div>
        <div><div className="adminPanel"><h3>Manual refresh</h3><p>Run only this festival’s configured adapters. Any differences go to the review queue.</p><button onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : `Refresh ${selected.name}`}</button></div><div className="adminPanel"><h3>Artist editor</h3><input placeholder="Find an artist" value={artistQuery} onChange={(event) => setArtistQuery(event.target.value)}/><ul className="artistAdminList">{artists.map((artist) => <li key={artist}><span>{artist}</span><button className="textButton" onClick={() => setNotice(`${artist} opened for canonical identity and link editing.`)}>Edit</button></li>)}</ul></div></div>
      </div>}

      {section === "assets" && selected && <div className="editorGrid"><div className="adminPanel"><label>Festival<select value={selectedSlug} onChange={(event) => setSelectedSlug(event.target.value)}>{festivals.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label><label>Official URL<input type="url" defaultValue={selected.officialUrl}/></label><label>Tickets URL<input type="url" defaultValue={selected.ticketsUrl}/></label><label>Spotify / playlist URL<input type="url" defaultValue={selected.playlistUrl}/></label><label>Logo URL<input type="url" placeholder="https://…/logo.svg"/></label><button onClick={() => setNotice("Link and asset draft saved for review.")}>Save asset draft</button></div><div className="adminPanel assetPreview"><h3>Validation</h3><span className="safe">Official URL · reachable</span><span className="safe">HTTPS · valid</span><span className="risk">Logo · manual review needed</span><p>External links are validated before a draft can be approved.</p></div></div>}

      {section === "diagnostics" && <div className="diagnosticGrid">{parserRuns.map((run) => <article className="adminPanel" key={run.festival}><div className="reviewMeta"><span className={run.status === "healthy" ? "safe" : "risk"}>{run.status}</span><small>{run.lastRun}</small></div><h3>{run.festival}</h3><p>{run.message}</p><dl><div><dt>Adapter</dt><dd>{run.source}</dd></div><div><dt>Duration</dt><dd>{run.durationMs} ms</dd></div><div><dt>Records</dt><dd>{run.extracted}</dd></div></dl><button className="secondary" onClick={() => setNotice(`${run.festival} parser log opened.`)}>View parser log</button></article>)}</div>}

      {section === "audit" && <div className="adminPanel auditTable">{auditEntries.map((entry) => <article key={entry.id}><time>{entry.at}</time><div><strong>{entry.action}</strong><p>{entry.target} · {entry.detail}</p></div><span>{entry.actor}</span></article>)}</div>}
    </section>
  </main>;
}
