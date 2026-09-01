.runId
and (.summary.attempted > 0)
and (.readBack.attempts == .summary.attempted)
and (.summary.status == "COMPLETED" or .summary.status == "PARTIAL")
and (
  if $festival != "" then
    .summary.totalSources == 1
    and .summary.attempted == 1
    and .readBack.attempts == 1
    and .readBack.candidates == 1
    and .readBack.evidence > 0
    and .readBack.lastSuccessfulCheck
    and (.summary.results | length == 1)
    and .summary.results[0].festivalSlug == $festival
    and (.summary.results[0].extractionPath | type == "array" and length > 0)
    and (.summary.results[0].evidenceFields | type == "array" and length > 0)
  elif $force then
    .summary.totalSources == 50
    and .summary.attempted == 50
    and .readBack.candidates > 0
    and .readBack.evidence > 0
    and .readBack.diffs > 0
    and .readBack.hasPersistedFailure
    and .readBack.lastSuccessfulCheck
  else
    true
  end
)
