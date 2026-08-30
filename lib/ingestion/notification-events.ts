import type { NotificationEventType } from "@prisma/client";
import type { Festival } from "../../data/festivals.ts";
import type { FestivalChange } from "./types.ts";

export type PublishedNotificationEvent = {
  dedupeKey: string;
  festivalId: string;
  type: NotificationEventType;
  title: string;
  message: string;
  url: string;
  occurredAt: string;
  payload: { editionYear: number; change: FestivalChange };
};

const eventType = (change: FestivalChange): NotificationEventType | undefined => {
  if (change.kind === "artist_added" || change.kind === "headliner_added") return "ARTIST_ADDED";
  if (change.kind === "artist_removed" || change.kind === "headliner_removed") return "ARTIST_CANCELLED";
  if (change.kind === "date_changed") return "FESTIVAL_DATE_MOVED";
  if (change.kind === "timetable_published") return "TIMETABLE_PUBLISHED";
  if (change.kind === "ticket_status_changed") {
    if (change.after === "available") return "TICKETS_ON_SALE";
    if (change.after === "unavailable") return "TICKETS_SOLD_OUT";
  }
  if (change.kind === "tickets_changed") return "TICKETS_ON_SALE";
};

const stablePart = (value?: string) => encodeURIComponent((value || "none").normalize("NFKC").trim().toLocaleLowerCase("en-US"));

export function notificationEventsForChanges(festival: Festival, changes: FestivalChange[], occurredAt: string): PublishedNotificationEvent[] {
  const editionYear = festival.editionYear ?? Number(festival.startDate?.slice(0, 4));
  if (!Number.isInteger(editionYear)) throw new Error(`Festival ${festival.slug} has no edition identity`);
  return changes.flatMap((change) => {
    let type = eventType(change);
    if (change.kind === "ticket_status_changed" && change.after === "low") type = "TICKETS_LOW";
    if (!type) return [];
    const subject = change.after || change.before || change.field;
    return [{
      dedupeKey: `festival:${festival.slug}:${editionYear}:${type}:${stablePart(subject)}`,
      festivalId: `${festival.slug}:${editionYear}`,
      type,
      title: festival.name,
      message: `${type.replaceAll("_", " ").toLocaleLowerCase()}: ${subject}`,
      url: `https://festivals.kir-it.de/festivals/${festival.slug}`,
      occurredAt,
      payload: { editionYear, change },
    }];
  });
}
