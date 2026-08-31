# Verified stage timetables

Timetables are published only from a reviewed official-festival source. The
catalog intentionally stays empty until a schedule exists for the tracked
edition; the UI states that no verified timetable is published instead of
guessing times from posters or third-party listings.

Prepare an input document outside the repository:

```json
{
  "festivalSlug": "wacken-open-air",
  "entries": [{
    "date": "2027-07-28",
    "stage": "Faster",
    "start": "18:30",
    "artist": "Artist name",
    "timeZone": "Europe/Berlin",
    "status": "scheduled",
    "sourceUrl": "https://www.wacken.com/...official-schedule...",
    "observedAt": "2027-07-01T10:00:00.000Z"
  }]
}
```

Validate without changing tracked data, then import atomically:

```bash
npm run timetables:import -- --input=/path/to/reviewed.json --check
npm run timetables:import -- --input=/path/to/reviewed.json
npm run test:data
npm run build
```

The importer rejects invalid calendar dates and IANA timezones, non-official
source hosts, entries outside announced festival dates, duplicate rows, and
two scheduled artists assigned to the same stage slot. A cancellation is kept
as an explicit row so the public timetable does not silently erase a change.
All entries for one festival must use the same timezone.

After import, visually compare every date, stage, local time, artist and
cancellation with the official source. Production verification is complete
only after the merged deployment displays a populated representative festival
and its source link returns successfully.
