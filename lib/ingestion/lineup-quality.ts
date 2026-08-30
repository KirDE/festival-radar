export type LineupQuality = {
  names: string[];
  warnings: string[];
};

const navigationLabel = /^(?:artists?|artistas?|artistes?|artyst(?:a|i)|artyści|line[ -]?up(?:\s+\d+)?|performers?|program(?:me|a)?|bands?|more|menu|home|news|tickets?)\s*[,.:;!\-]*$/iu;
const dateOrSchedule = /(?:\b(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lun|mar|mer|jeu|ven|sam|dim|lunes|martes|miércoles|jueves|viernes|sábado|domingo|juillet|juni|june|july|août|agosto|julio)\b|\b\d{1,2}[.:]\d{2}\b|\b\d{1,2}\s*[-–]\s*\d{1,2}\s+(?:july|juillet|julio|august|août|agosto)\b|\b(?:stage|scène|bühne|escenario)\b|\b(?:days?|hours?|minutes?|seconds?|tage|stunden|minuten|sekunden)\s*(?:left|remaining)?\b)/iu;
const trailingDate = /\s*(?:[-–—|,]\s*)?(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?|(?:lun|mar|mer|jeu|ven|sam|dim)(?:di)?|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+20\d{2})?\s*$/iu;

function normalize(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").replace(trailingDate, "").replace(/\s*[-–—|,]\s*$/, "").trim();
}

export function validateGenericLineup(values: string[], combinedFlags: boolean[] = []): LineupQuality {
  const names: string[] = [];
  const warnings = new Set<string>();
  for (const [index, raw] of values.entries()) {
    const name = normalize(raw);
    if (!name || navigationLabel.test(name)) {
      warnings.add(`Rejected lineup navigation label: ${raw.trim() || "(empty)"}`);
      continue;
    }
    if (dateOrSchedule.test(name)) {
      warnings.add(`Rejected lineup schedule/date/stage text: ${raw.trim()}`);
      continue;
    }
    if (combinedFlags[index]) {
      warnings.add(`Combined artist block requires a festival-specific trusted adapter: ${name.slice(0, 120)}`);
      continue;
    }
    if (name.length > 100) {
      warnings.add(`Ambiguous long lineup container requires review: ${name.slice(0, 120)}`);
      continue;
    }
    if (!names.some((existing) => existing.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) names.push(name);
  }
  return { names, warnings: [...warnings] };
}
