import { createHash } from 'node:crypto';

// Retention is evidence, never an authorization to publish. Refuse unsafe or
// oversized imports rather than silently dropping part of the original proof.
export function boundedEnrichmentEvidence(value: unknown) {
  const bytes = JSON.stringify(value);
  if (!bytes || Buffer.byteLength(bytes) > 10_000_000) throw new Error('Enrichment state exceeds publication byte bound');
  let nodes = 0;
  function check(v: unknown, depth: number) {
    if (++nodes > 200_000 || depth > 20) throw new Error('Enrichment evidence exceeds structural bound');
    if (typeof v === 'string') {
      if (v.length > 4096) throw new Error('Enrichment evidence exceeds string bound');
      // Includes URLs embedded in historical error messages. Never echo input.
      if (/https?:\/\/[^\s/]*@/i.test(v) || /[?&](?:access_token|token|api[_-]?key|password|secret|authorization|credential|signature)=/i.test(v) || /\bBearer\s+\S+/i.test(v)) throw new Error('Unsafe enrichment evidence');
    } else if (Array.isArray(v)) {
      if (v.length > 1000) throw new Error('Enrichment evidence exceeds array bound');
      v.forEach((item) => check(item, depth + 1));
    } else if (v && typeof v === 'object') {
      const entries = Object.entries(v);
      if (entries.length > 1000) throw new Error('Enrichment evidence exceeds object bound');
      for (const [key, item] of entries) {
        if (key.length > 500 || /^(?:__proto__|prototype|constructor|password|token|secret|authorization|apiKey|credentials)$/i.test(key)) throw new Error('Unsafe enrichment evidence');
        check(item, depth + 1);
      }
    }
  }
  check(value, 0);
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function migrateEnrichmentState(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_persisted_evidence');
  const payload = structuredClone(raw) as Record<string, unknown>;
  if (payload.legacyImport) {
    const legacy = payload.legacyImport as { hash?: unknown; evidence?: unknown };
    const hash = boundedEnrichmentEvidence(legacy.evidence);
    if (legacy.hash !== hash) throw new Error('legacy_import_integrity_mismatch');
  }
  if (payload.schemaVersion !== undefined && !payload.result) {
    const evidence = Object.fromEntries(['schemaVersion', 'source', 'generatedAt', 'profiles', 'manualReview'].map((key) => [key, payload[key]]));
    const hash = boundedEnrichmentEvidence(evidence);
    if (payload.legacyImport && (payload.legacyImport as { hash?: unknown }).hash !== hash) throw new Error('legacy_import_integrity_mismatch');
    payload.legacyImport ??= { hash, evidence };
    payload.result = structuredClone(evidence);
    for (const key of Object.keys(evidence)) delete payload[key];
    // A flat import is incomplete until bounded provider evidence is obtained.
    delete payload.nextRunAt;
  }
  return payload;
}
