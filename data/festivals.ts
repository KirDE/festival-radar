export type Festival = {
  slug: string;
  name: string;
  country: string;
  countryCode: string;
  city?: string;
  startDate?: string;
  endDate?: string;
  dateLabel?: string;
  headliners: string[];
  lineup: string[];
  officialUrl: string;
  ticketsUrl?: string;
  playlistUrl?: string;
  status: "confirmed" | "partial" | "tba";
  editionYear?: number;
  ticketStatus: "available" | "low" | "unavailable" | "unknown";
  updatedAt: string;
  genres: string[];
  coordinates?: { latitude: number; longitude: number };
  timetable?: { date: string; stage: string; start: string; artist: string }[];
};

export type PlaylistStatus = {
  spotifyUrl: string;
  youtubeMusicUrl?: string;
  artists: number;
  tracks: number;
  updatedAt: string;
};

const festival = (
  slug: string,
  name: string,
  country: string,
  countryCode: string,
  officialUrl: string,
  options: Partial<Festival> = {},
): Festival => ({
  slug,
  name,
  country,
  countryCode,
  officialUrl,
  headliners: [],
  lineup: [],
  status: "tba",
  ticketStatus: "unknown",
  editionYear: 2027,
  dateLabel: "Dates TBA",
  updatedAt: "2026-08-29T10:59:59.000Z",
  genres: ["rock", "metal"],
  ...options,
});

const baseFestivals: Festival[] = [
  festival("rock-am-ring", "Rock am Ring", "Germany", "DE", "https://www.rock-am-ring.com/", { city: "Nürburg", startDate: "2027-06-04", endDate: "2027-06-06", headliners: ["blink-182"], status: "partial", ticketStatus: "available", ticketsUrl: "https://www.rock-am-ring.com/en/tickets" }),
  festival("rock-im-park", "Rock im Park", "Germany", "DE", "https://www.rock-im-park.com/", { city: "Nürnberg", startDate: "2027-06-04", endDate: "2027-06-06", headliners: ["blink-182"], status: "partial" }),
  festival("wacken-open-air", "Wacken Open Air", "Germany", "DE", "https://www.wacken.com/", { city: "Wacken", startDate: "2027-07-28", endDate: "2027-07-31", headliners: ["Electric Callboy", "Five Finger Death Punch", "Helloween", "Heaven Shall Burn", "Jinjer", "Knocked Loose"], lineup: ["Avatar", "Beast in Black", "Belphegor", "Between Two Worlds", "Blue Medusa", "Carnifex", "Cavalera Conspiracy", "Children of Bodom", "Creeper", "Crypta", "Dark Tranquillity", "Dethklok", "DragonForce", "Edguy", "Feuerschwanz", "Gaerea", "Halestorm", "HammerFall", "Heaven's Gate", "Hiraes", "Imminence", "John 5", "John Bush", "Kanonenfieber", "Make Them Suffer", "Malevolence", "Metal Church", "Mittel Alta", "Napalm Death", "Overkill", "Seven Blood", "Shadow of Intent", "Sylosis", "Tailgunner", "The Browning", "The New Roses", "Towards the Sinister", "Tyketto", "U.D.O.", "Victorious", "Witch Club Satan"], status: "confirmed" }),
  festival("summer-breeze", "Summer Breeze Open Air", "Germany", "DE", "https://www.summer-breeze.de/", { city: "Dinkelsbühl", startDate: "2027-08-18", endDate: "2027-08-21", headliners: ["Electric Callboy", "Halestorm", "Helloween", "HammerFall", "Lord of the Lost", "Saltatio Mortis", "Children of Bodom", "Eluveitie"], lineup: ["Wind Rose", "Edguy", "H-Blockx", "Clawfinger", "Kataklysm", "Mono Inc.", "Warkings", "Dark Funeral", "Gloryhammer", "Finntroll", "Atreyu", "Shadow of Intent", "Emil Bulls", "Equilibrium", "John Bush", "Carnifex", "The Browning", "Gaerea", "Long Distance Calling", "Make Them Suffer", "Mittel Alta", "Any Given Day", "Gutalax", "Blue Medusa", "Insomnium", "Combichrist", "PeelingFlesh", "Anaal Nathrakh", "Fleshgod Apocalypse", "Primal Fear", "Nasty", "Burning Witches", "Kupfergold", "End of Green", "Wolfheart", "Legion of the Damned", "Ellende", "Angelus Apatrida", "Abbie Falls", "Samurai Pizza Cats", "Necrotted", "Left to Suffer", "Evil Invaders", "Hiraes", "Lavina", "Asenblut", "ACCVSED", "Spitting Glass", "Ahab", "Sunborn", "The Night Eternal", "Defiance HC", "Regarde Les Hommes Tomber", "Capacopter"], status: "confirmed" }),
  festival("rockharz", "Rockharz Open Air", "Germany", "DE", "https://www.rockharz-festival.com/", { city: "Ballenstedt", startDate: "2027-07-07", endDate: "2027-07-10" }),
  festival("hurricane", "Hurricane Festival", "Germany", "DE", "https://hurricane.de/", { city: "Scheeßel", startDate: "2027-06-18", endDate: "2027-06-20" }),
  festival("southside", "Southside Festival", "Germany", "DE", "https://southside.de/", { city: "Neuhausen ob Eck", startDate: "2027-06-18", endDate: "2027-06-20" }),
  festival("full-force", "Full Force", "Germany", "DE", "https://full-force.de/", { city: "Ferropolis" }),
  festival("hellfest", "Hellfest Open Air", "France", "FR", "https://hellfest.fr/", { city: "Clisson", startDate: "2027-06-17", endDate: "2027-06-20" }),
  festival("rock-en-seine", "Rock en Seine", "France", "FR", "https://www.rockenseine.com/", { city: "Saint-Cloud" }),
  festival("motocultor", "Motocultor Festival", "France", "FR", "https://www.motocultor-festival.com/", { city: "Carhaix" }),
  festival("eurockeennes", "Eurockéennes de Belfort", "France", "FR", "https://www.eurockeennes.fr/", { city: "Belfort" }),
  festival("download", "Download Festival", "United Kingdom", "GB", "https://downloadfestival.co.uk/", { city: "Donington Park" }),
  festival("bloodstock", "Bloodstock Open Air", "United Kingdom", "GB", "https://www.bloodstock.uk.com/", { city: "Walton-on-Trent", startDate: "2027-08-05", endDate: "2027-08-08", headliners: ["Mercyful Fate", "Electric Callboy", "Motionless In White"], lineup: ["Acid Bath", "Green Lung", "Children of Bodom", "DevilDriver", "Corrosion of Conformity", "Imminence", "Wind Rose", "Sylosis", "Decapitated", "Witch Club Satan", "HammerFall", "Hypocrisy", "The Halo Effect", "Tortured Demon", "Gutalax", "Humanity's Last Breath", "Conan", "Madball", "Gaerea", "Kanonenfieber", "Dethklok", "Dool", "Pig Destroyer", "Fulci"], status: "confirmed" }),
  festival("reading", "Reading Festival", "United Kingdom", "GB", "https://www.readingfestival.com/", { city: "Reading" }),
  festival("leeds", "Leeds Festival", "United Kingdom", "GB", "https://www.leedsfestival.com/", { city: "Leeds" }),
  festival("2000trees", "2000trees", "United Kingdom", "GB", "https://www.twothousandtreesfestival.co.uk/", { city: "Cheltenham" }),
  festival("graspop", "Graspop Metal Meeting", "Belgium", "BE", "https://www.graspop.be/", { city: "Dessel" }),
  festival("rock-werchter", "Rock Werchter", "Belgium", "BE", "https://www.rockwerchter.be/", { city: "Werchter" }),
  festival("alcatraz", "Alcatraz Open Air", "Belgium", "BE", "https://www.alcatraz.be/", { city: "Kortrijk" }),
  festival("nova-rock", "Nova Rock", "Austria", "AT", "https://www.novarock.at/", { city: "Nickelsdorf", startDate: "2027-06-10", endDate: "2027-06-12", headliners: ["Die Ärzte", "Motionless In White"], lineup: ["TBS"], status: "partial" }),
  festival("frequency", "Frequency Festival", "Austria", "AT", "https://www.frequency.at/", { city: "St. Pölten" }),
  festival("rock-for-people", "Rock for People", "Czechia", "CZ", "https://rockforpeople.cz/", { city: "Hradec Králové", startDate: "2027-06-02", endDate: "2027-06-05", headliners: ["blink-182"], status: "partial" }),
  festival("brutal-assault", "Brutal Assault", "Czechia", "CZ", "https://brutalassault.cz/", { city: "Jaroměř" }),
  festival("masters-of-rock", "Masters of Rock", "Czechia", "CZ", "https://www.mastersofrock.cz/", { city: "Vizovice", startDate: "2027-07-08", endDate: "2027-07-11" }),
  festival("polandrock", "Pol'and'Rock Festival", "Poland", "PL", "https://polandrockfestival.pl/", { city: "Czaplinek" }),
  festival("mystic", "Mystic Festival", "Poland", "PL", "https://www.mysticfestival.pl/", { city: "Gdańsk", startDate: "2027-06-10", endDate: "2027-06-12" }),
  festival("rock-imperium", "Rock Imperium Festival", "Spain", "ES", "https://www.rockimperiumfestival.es/", { city: "Cartagena", startDate: "2027-07-02", endDate: "2027-07-04", headliners: ["Bruce Dickinson", "Children of Bodom", "Helloween"], status: "partial" }),
  festival("leyendas-del-rock", "Leyendas del Rock", "Spain", "ES", "https://www.leyendasdelrockfestival.com/", { city: "Villena", startDate: "2027-08-11", endDate: "2027-08-14", headliners: ["Architects", "Halestorm", "Mercyful Fate"], status: "partial" }),
  festival("resurrection-fest", "Resurrection Fest", "Spain", "ES", "https://www.resurrectionfest.es/", { city: "Viveiro" }),
  festival("mad-cool", "Mad Cool Festival", "Spain", "ES", "https://madcoolfestival.es/", { city: "Madrid" }),
  festival("barcelona-rock-fest", "Barcelona Rock Fest", "Spain", "ES", "https://www.barcelonarockfest.com/", { city: "Santa Coloma de Gramenet" }),
  festival("firenze-rocks", "Firenze Rocks", "Italy", "IT", "https://www.firenzerocks.it/", { city: "Florence" }),
  festival("idays", "I-Days Milano", "Italy", "IT", "https://www.idays.it/", { city: "Milan", headliners: ["blink-182"], status: "partial", dateLabel: "Dates TBA · preliminary announcement" }),
  festival("rock-in-roma", "Rock in Roma", "Italy", "IT", "https://rockinroma.com/", { city: "Rome" }),
  festival("alpen-flair", "Alpen Flair", "Italy", "IT", "https://www.alpen-flair.com/", { city: "Natz-Schabs", startDate: "2027-06-23", endDate: "2027-06-26" }),
  festival("pistoia-blues", "Pistoia Blues Festival", "Italy", "IT", "https://pistoiablues.com/", { city: "Pistoia" }),
  festival("pinkpop", "Pinkpop", "Netherlands", "NL", "https://www.pinkpop.nl/", { city: "Landgraaf", startDate: "2027-06-18", endDate: "2027-06-20", ticketStatus: "unavailable" }),
  festival("roadburn", "Roadburn Festival", "Netherlands", "NL", "https://roadburn.com/", { city: "Tilburg", startDate: "2027-04-15", endDate: "2027-04-18" }),
  festival("dynamo-metal-fest", "Dynamo Metal Fest", "Netherlands", "NL", "https://dynamo-metalfest.nl/", { city: "Eindhoven" }),
  festival("greenfield", "Greenfield Festival", "Switzerland", "CH", "https://greenfieldfestival.ch/", { city: "Interlaken", startDate: "2027-06-10", endDate: "2027-06-12" }),
  festival("paleo", "Paléo Festival", "Switzerland", "CH", "https://yeah.paleo.ch/", { city: "Nyon" }),
  festival("sweden-rock", "Sweden Rock Festival", "Sweden", "SE", "https://swedenrock.com/", { city: "Sölvesborg", startDate: "2027-06-09", endDate: "2027-06-12" }),
  festival("tuska", "Tuska Festival", "Finland", "FI", "https://tuska.fi/", { city: "Helsinki", startDate: "2027-07-02", endDate: "2027-07-04", headliners: ["Lorna Shore", "Children of Bodom"], lineup: ["Heaven Shall Burn", "Kanonenfieber", "Fox Lake", "Gaerea", "Avralize", "Sinizter"], status: "confirmed" }),
  festival("tons-of-rock", "Tons of Rock", "Norway", "NO", "https://www.tonsofrock.no/", { city: "Oslo" }),
  festival("inferno", "Inferno Metal Festival", "Norway", "NO", "https://www.infernofestival.net/", { city: "Oslo" }),
  festival("copenhell", "Copenhell", "Denmark", "DK", "https://www.copenhell.dk/", { city: "Copenhagen" }),
  festival("roskilde", "Roskilde Festival", "Denmark", "DK", "https://www.roskilde-festival.dk/", { city: "Roskilde" }),
  festival("rockstadt", "Rockstadt Extreme Fest", "Romania", "RO", "https://rockstadtextremefest.ro/", { city: "Râșnov", startDate: "2027-07-26", endDate: "2027-07-30" }),
  festival("metaldays", "Metaldays", "Slovenia", "SI", "https://www.metaldays.net/"),
];

// Venue/city centres are used for planning distances, not turn-by-turn navigation.
// Coordinates are decimal WGS84 and are maintained with the canonical festival record.
const festivalLocationData: Record<string, [number, number]> = {
  "rock-am-ring": [50.3356, 6.9475], "rock-im-park": [49.4268, 11.1257], "wacken-open-air": [54.0206, 9.3750],
  "summer-breeze": [49.0690, 10.3190], rockharz: [51.7204, 11.2327], hurricane: [53.1667, 9.4833], southside: [47.9667, 8.9333],
  "full-force": [51.7580, 12.4480], hellfest: [47.0879, -1.2827], "rock-en-seine": [48.8374, 2.2140], motocultor: [48.2759, -3.5733],
  eurockeennes: [47.6847, 6.8074], download: [52.8298, -1.3747], bloodstock: [52.7585, -1.6866], reading: [51.4543, -0.9781],
  leeds: [53.8008, -1.5491], "2000trees": [51.8994, -2.0783], graspop: [51.2382, 5.1146], "rock-werchter": [50.9716, 4.6947],
  alcatraz: [50.8195, 3.2577], "nova-rock": [47.9404, 17.0690], frequency: [48.2047, 15.6256], "rock-for-people": [50.2092, 15.8328],
  "brutal-assault": [50.3562, 15.9214], "masters-of-rock": [49.2229, 17.8546], polandrock: [53.5570, 16.2335], mystic: [54.3520, 18.6466],
  "rock-imperium": [37.6257, -0.9966], "leyendas-del-rock": [38.6373, -0.8657], "resurrection-fest": [43.6614, -7.5945], "mad-cool": [40.4168, -3.7038],
  "barcelona-rock-fest": [41.4515, 2.2081], "firenze-rocks": [43.7696, 11.2558], idays: [45.4642, 9.1900], "rock-in-roma": [41.9028, 12.4964],
  "alpen-flair": [46.7684, 11.6656], "pistoia-blues": [43.9333, 10.9167], pinkpop: [50.9080, 6.0190], roadburn: [51.5555, 5.0913],
  "dynamo-metal-fest": [51.4416, 5.4697], greenfield: [46.6863, 7.8632], paleo: [46.3833, 6.2396], "sweden-rock": [56.0521, 14.5754],
  tuska: [60.1699, 24.9384], "tons-of-rock": [59.9139, 10.7522], inferno: [59.9139, 10.7522], copenhell: [55.6761, 12.5683],
  roskilde: [55.6419, 12.0878], rockstadt: [45.5930, 25.4600], metaldays: [46.0569, 14.5058],
};

const festivalGenreData: Record<string, string[]> = {
  hurricane: ["rock", "alternative"], southside: ["rock", "alternative"], "rock-en-seine": ["rock", "alternative"], eurockeennes: ["rock", "alternative"],
  reading: ["rock", "alternative"], leeds: ["rock", "alternative"], "2000trees": ["rock", "alternative"], "rock-werchter": ["rock", "alternative"],
  frequency: ["rock", "alternative"], polandrock: ["rock", "alternative"], "mad-cool": ["rock", "alternative"], idays: ["rock", "alternative"],
  "rock-in-roma": ["rock", "alternative"], "pistoia-blues": ["rock", "blues"], pinkpop: ["rock", "alternative"], paleo: ["rock", "alternative"], roskilde: ["rock", "alternative"],
  roadburn: ["metal", "doom metal", "experimental"], inferno: ["metal", "black metal"], "brutal-assault": ["metal", "extreme metal"],
  motocultor: ["metal", "extreme metal"], hellfest: ["rock", "metal", "extreme metal"], metaldays: ["metal", "extreme metal"],
};

import publications from "./ingestion-publications.json" with { type: "json" };
const publicationOverlays = publications.festivals as Record<string, Partial<Festival>>;
export const festivals: Festival[] = baseFestivals.map((item) => ({ ...item, ...(publicationOverlays[item.slug] || {}) }));

for (const item of festivals) {
  const location = festivalLocationData[item.slug];
  if (location) item.coordinates = { latitude: location[0], longitude: location[1] };
  item.genres = [...new Set(festivalGenreData[item.slug] || item.genres.map((genre) => genre.toLocaleLowerCase()))];
}

export const allArtists = Array.from(
  new Set(festivals.flatMap((item) => [...item.headliners, ...item.lineup])),
).sort((a, b) => a.localeCompare(b));

export function getFestival(slug: string) {
  return festivals.find((item) => item.slug === slug);
}

export function artistSlug(name: string) {
  return encodeURIComponent(name.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
}

export const supportedLanguages = ["en", "de", "ru"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
export function festivalMonth(item: Festival) { return item.startDate?.slice(5, 7); }
export const archiveYears = [2026] as const;
export const plannedEditionYears = [2028] as const;
