import type { Festival } from "@/lib/domain/festival";

export type TicketPresentation =
  | { status: "available"; href: string; label: "officialTickets" }
  | { status: "unavailable"; href?: string; label: "ticketsUnavailable" }
  | { status: "unknown"; href?: string; label: "ticketsUnknown" };

export function ticketPresentation(item: Festival): TicketPresentation {
  if (item.ticketStatus === "available" && item.ticketsUrl) {
    return { status: "available", href: item.ticketsUrl, label: "officialTickets" };
  }

  if (item.ticketStatus === "unavailable") {
    return { status: "unavailable", href: item.ticketsUrl || undefined, label: "ticketsUnavailable" };
  }

  return { status: "unknown", href: item.ticketsUrl || undefined, label: "ticketsUnknown" };
}

export function hasAvailableTickets(item: Festival) {
  return ticketPresentation(item).status === "available";
}
