import type { TimetableEntry } from "@/data/festivals";
import { findTimetableConflicts, groupTimetable } from "@/lib/timetables";

export function StageTimetable({ entries }: { entries?: TimetableEntry[] }) {
  if (!entries?.length) return <div className="timetable timetableEmpty"><strong>Stage timetable</strong><span>No verified timetable is published yet. Stages and local times will appear after an official schedule is checked.</span></div>;
  const days = groupTimetable(entries);
  const conflicts = findTimetableConflicts(entries);
  const newestObservation = entries.map(({ observedAt }) => observedAt).sort().at(-1)!;
  return <section className="timetable timetablePublished" aria-labelledby="stage-timetable-heading">
    <div className="timetableHeader"><div><strong id="stage-timetable-heading">Stage timetable</strong><span>{entries.length} verified performances · local festival time</span></div><span>Checked {new Date(newestObservation).toISOString().slice(0, 10)}</span></div>
    {conflicts.length > 0 && <div className="timetableWarning" role="alert">Schedule conflict detected. Check the official source before planning.</div>}
    {days.map((day) => <section className="timetableDay" key={day.date}>
      <h3><time dateTime={day.date}>{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</time></h3>
      <div className="timetableStages">{day.stages.map((stage) => <div className="timetableStage" key={stage.stage}>
        <h4>{stage.stage}</h4>
        <ol>{stage.entries.map((entry) => <li className={entry.status === "cancelled" ? "cancelled" : undefined} key={`${entry.start}-${entry.artist}`}>
          <time dateTime={`${entry.date}T${entry.start}`}>{entry.start}</time><span>{entry.artist}</span>{entry.status === "cancelled" && <em>Cancelled</em>}
        </li>)}</ol>
      </div>)}</div>
    </section>)}
    <footer><span>Timezone: {entries[0].timeZone}</span><a href={entries[0].sourceUrl} target="_blank" rel="noreferrer">Official timetable source ↗</a></footer>
  </section>;
}
