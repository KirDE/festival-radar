"""Bounded, same-origin public Roskilde documents via Python's TLS stack.

The official site accepts this browser UA with urllib/OpenSSL but returns 403
for Node's TLS client, even with identical headers. No cookies or challenges.
"""
import json
import re
import sys
import urllib.parse
import urllib.request
import urllib.error

ORIGIN = 'https://www.roskilde-festival.dk'
MAX_BYTES = 2 * 1024 * 1024
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'


def allowed(url):
    u = urllib.parse.urlsplit(url)
    return (u.scheme == 'https' and u.netloc == 'www.roskilde-festival.dk'
            and not u.query and not u.fragment
            and (u.path in ['/', '/program', '/billetter']
                 or re.fullmatch(r'/nyheder/[a-z0-9-]+', u.path) is not None))


class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed(newurl):
            raise ValueError('Roskilde redirect left approved official document paths')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def document(path, opener):
    url = ORIGIN + path
    if not allowed(url):
        raise ValueError('Invalid Roskilde document URL')
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html'})
    with opener.open(req, timeout=15) as response:
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES or 'text/html' not in response.headers.get('Content-Type', ''):
            raise ValueError('Invalid Roskilde HTML response')
        return {'url': response.url, 'html': body.decode('utf-8')}


def main():
    year = int(sys.argv[1])
    if not 2027 <= year <= 2100:
        raise ValueError('Invalid edition year')
    opener = urllib.request.build_opener(SameOriginRedirect())
    home = document('/', opener)
    # Only current-edition announcement links actually published by the homepage.
    paths = list(dict.fromkeys(re.findall(r'href=[\"\'](/nyheder/[^\"\']+)[\"\']', home['html'])))
    paths = [p for p in paths if re.search(r'(?:^|-)rf' + str(year)[-2:] + r'(?:-|$)', p.rsplit('/', 1)[-1])][:3]
    documents = [home, document('/program', opener)]
    documents.extend(document(path, opener) for path in paths)
    print(json.dumps({'kind': 'roskilde-documents-v1', 'documents': documents}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        print(json.dumps({'kind': 'roskilde-fetch-error', 'status': error.code}))
    except Exception:
        print(json.dumps({'kind': 'roskilde-fetch-error', 'status': 502}))
