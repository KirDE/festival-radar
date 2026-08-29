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
  dateLabel: "Dates TBA",
  ...options,
});

export const festivals: Festival[] = [
  festival("rock-am-ring", "Rock am Ring", "Germany", "DE", "https://www.rock-am-ring.com/", { city: "Nürburg", startDate: "2027-06-04", endDate: "2027-06-06", headliners: ["blink-182"], status: "partial" }),
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
  festival("pinkpop", "Pinkpop", "Netherlands", "NL", "https://www.pinkpop.nl/", { city: "Landgraaf", startDate: "2027-06-18", endDate: "2027-06-20" }),
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

export const allArtists = Array.from(
  new Set(festivals.flatMap((item) => [...item.headliners, ...item.lineup])),
).sort((a, b) => a.localeCompare(b));

export function getFestival(slug: string) {
  return festivals.find((item) => item.slug === slug);
}

export function artistSlug(name: string) {
  return encodeURIComponent(name.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
}
