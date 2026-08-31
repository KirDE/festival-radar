import type { Festival } from "@/data/festivals";

export type TicketPresentation =
  | { status: "available"; href: string; label: "officialTickets" }
  | { status: "unavailable"; href?: never; label: "ticketsUnavailable" }
  | { status: "unknown"; href?: never; label: "ticketsUnknown" };

export function ticketPresentation(item: Festival): TicketPresentation {
  if (item.ticketStatus === "available" && item.ticketsUrl) {
    return { status: "available", href: item.ticketsUrl, label: "officialTickets" };
  }

  if (item.ticketStatus === "unavailable") {
    return { status: "unavailable", label: "ticketsUnavailable" };
  }

  return { status: "unknown", label: "ticketsUnknown" };
}

export function hasAvailableTickets(item: Festival) {
  return ticketPresentation(item).status === "available";
}
