import { pathToFileURL } from 'node:url';

// Exact order and spelling reject duplicate keys, extra fields, lines and any
// raw transport output. Reconstruct only after the whole record is validated.
export function validateSchedulerHealth(input, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha) || !Buffer.isBuffer(input) || input.length > 2048) {
    throw new Error('scheduler diagnostic rejected');
  }
  const text = input.toString('utf8');
  const enabled = '(enabled|disabled|missing|error)';
  const active = '(inactive|active|failed|missing|error)';
  const legacyActive = '(inactive|active|failed|missing|unknown|error)';
  const result = '(success|resources|protocol|timeout|exit-code|signal|core-dump|watchdog|start-limit-hit|oom-kill|exec-condition|unknown|error)';
  const exitStatus = '(0|[1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5]|"unknown"|"error")';
  const pattern = new RegExp('^DB_DUE_SCHEDULER_HEALTH \\{"modeLegacy":([01]),"modeDbDue":([01]),"modeMissing":([01]),"tickMissing":([01]),"tickStale":([01]),"fetchError":([01]),"drainError":([01]),' +
    '"legacyTimerEnabled":"' + enabled + '","legacyTimerActive":"' + active +
    '","dueTimerEnabled":"' + enabled + '","dueTimerActive":"' + active +
    '","legacyServiceActive":"' + legacyActive + '","dueServiceActive":"' + active +
    '","legacyServiceResult":"' + result + '","legacyServiceExitStatus":' + exitStatus + '\\}\\n$');
  const match = pattern.exec(text);
  // JS $ can match before a final newline; byte equality also rules out invalid
  // UTF-8 replacement, trailing data, or a second final newline.
  if (!match || match[0] !== text || !Buffer.from(text).equals(input)) throw new Error('scheduler diagnostic rejected');
  const record = JSON.parse(text.slice('DB_DUE_SCHEDULER_HEALTH '.length));
  if (record.modeLegacy + record.modeDbDue + record.modeMissing !== 1 ||
      (record.tickMissing === 1 && (record.tickStale !== 1 || record.fetchError !== 0 || record.drainError !== 0))) {
    throw new Error('scheduler diagnostic rejected');
  }
  const legacyState = record.legacyServiceActive;
  if ((legacyState === 'error' && (record.legacyServiceResult !== 'error' || record.legacyServiceExitStatus !== 'error')) ||
      (['missing', 'unknown'].includes(legacyState) && (record.legacyServiceResult !== 'unknown' || record.legacyServiceExitStatus !== 'unknown')) ||
      (!['error', 'missing', 'unknown'].includes(legacyState) && (record.legacyServiceResult === 'error' || record.legacyServiceExitStatus === 'error')) ||
      (record.legacyServiceResult === 'unknown' && record.legacyServiceExitStatus !== 'unknown')) {
    throw new Error('scheduler diagnostic rejected');
  }
  for (const prefix of ['legacy', 'due']) {
    if ((record[prefix + 'TimerEnabled'] === 'missing') !== (record[prefix + 'TimerActive'] === 'missing')) {
      throw new Error('scheduler diagnostic rejected');
    }
  }
  return 'DB_DUE_SCHEDULER_HEALTH ' + JSON.stringify(record) + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 2048) throw new Error();
      chunks.push(chunk);
    }
    if (process.argv.length !== 3) throw new Error();
    process.stdout.write(validateSchedulerHealth(Buffer.concat(chunks), process.argv[2]));
  } catch {
    process.stderr.write('scheduler diagnostic rejected\n');
    process.exitCode = 1;
  }
}
