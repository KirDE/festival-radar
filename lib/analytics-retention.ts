type AnalyticsDb = {
  analyticsDaily: {
    deleteMany(args: { where: { day: { lt: Date } } }): Promise<{ count: number }>;
  };
};

export function retentionDaysFrom(value?: string) {
  const raw = value ?? "90";
  const retentionDays = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 730) {
    throw new Error("ANALYTICS_RETENTION_DAYS must be an integer from 1 to 730");
  }
  return retentionDays;
}

export function analyticsCutoff(retentionDays: number, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff;
}

export async function pruneAnalytics(db: AnalyticsDb, retentionValue?: string, now = new Date()) {
  const retentionDays = retentionDaysFrom(retentionValue);
  const cutoff = analyticsCutoff(retentionDays, now);
  const result = await db.analyticsDaily.deleteMany({ where: { day: { lt: cutoff } } });
  return { deletedAggregateRows: result.count, cutoff: cutoff.toISOString(), retentionDays };
}
