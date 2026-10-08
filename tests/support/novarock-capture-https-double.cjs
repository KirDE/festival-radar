// Test subprocess only. Production transport has no injectable URL/response seam.
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { readFileSync, existsSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const original = https.request;
https.request = function(url, options, ...rest) {
  if (url !== 'https://www.novarock.at/lineup/') return original.call(this, url, options, ...rest);
  if (options?.method !== 'GET' || options?.agent !== false || options?.servername !== 'www.novarock.at' ||
      options?.rejectUnauthorized !== true || Object.keys(options.headers).sort().join(',') !== 'Accept,Accept-Encoding')
    throw new Error('Test transport attempted altered host/credentials/headers');
  const body = readFileSync(process.env.NOVA_CAPTURE_TEST_FIXTURE);
  const req = new EventEmitter();
  req.destroy = () => req;
  req.end = () => {
    const deliver = () => {
      const barrier = process.env.NOVA_CAPTURE_TEST_BARRIER_DIR;
      if (barrier && existsSync(join(barrier, 'arm'))) {
        writeFileSync(join(barrier, 'started'), '1');
        const interval = setInterval(() => { if (existsSync(join(barrier, 'release'))) { clearInterval(interval); emit(); } }, 10);
      } else emit();
    };
    const emit = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.rawHeaders = ['Content-Type', 'text/html; charset=UTF-8', 'Content-Length', String(body.length)];
      res.rawTrailers = [];
      res.complete = true;
      res.aborted = false;
      res.socket = { encrypted: true, authorized: true };
      res.destroy = () => res;
      req.emit('response', res);
      res.emit('data', body);
      res.emit('end');
    };
    queueMicrotask(deliver);
    return req;
  };
  return req;
};
