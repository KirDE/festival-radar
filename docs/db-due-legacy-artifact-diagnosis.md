# Legacy oneshot artifact diagnosis (#210)

Manual-only, main-only protected workflow: **DB due legacy artifact read-only diagnostic**. It invokes the exact deployed SHA via the existing sudo dispatcher, with no inputs. It does not start or reset a service, change timers/mode, fetch a source, or touch fallback data. It is independent of scheduler health and explicit paused recovery workflows.

The fixed marker compares the failed legacy oneshot's trusted systemd start timestamp to two fixed files under the existing ingestion collection output directory. The final JSON is read only up to 64 KiB, solely to check matching summary and read-back status enums; the temporary response is metadata-only, capped at 1 MiB. No response content, URLs, request bodies, logs, paths, or timestamps are relayed. Symlinks, malformed or oversized files, missing systemd fields, unexpected service state, unsafe ancestors and read errors fail closed. The release reader runs as www-data, never root; the root-owned dispatcher validates its one fixed marker. A protected Actions validator independently rejects extra bytes or fields.

- **current-temp**: temporary response modified after the failed oneshot began; evidence of a current attempt, not a diagnosis of its error.
- **retained-success-no-current-artifact**: earlier successful final response remains with no post-start temp/final artifact. A new failure may have happened before output was written. This does not prove the last attempt succeeded or was harmless.
- **current-success-artifact / current-other-artifact**: final response modified after start with matching nested status enums or without an accepted status. A failed unit can still have a successful HTTP response if a later command failed.
- **no-artifact**: neither file exists. **inconclusive**: artifacts cannot be ordered/classified safely, including same-second timestamps. **unknown**: invalid/unavailable evidence.

Do not use the result alone to reset failure, resume a timer, switch schedulers or infer a safe retry. No production workflow is invoked by this PR.
