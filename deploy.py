#!/usr/bin/env python3
"""Deploy 29Court Convert to convert.29court.com: modules worker, DNS, route."""
import sys, json, uuid, urllib.request, urllib.error
sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request

ALLOWED = ["api.cloudflare.com"]
BASE = "https://api.cloudflare.com"
ACCT = "df3c35b2bb75d5acafb15572064f41c0"
HOST = "convert.29court.com"
SCRIPT = "convert-site"

def api(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method)
    if body:
        req.add_header("Content-Type", "application/json")
    add_surrogate_to_request(req, "custom.cloudflare", allowed_hosts=ALLOWED)
    try:
        r = urllib.request.urlopen(req, timeout=90)
        return json.load(r)
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} on {method} {path}\n{e.read().decode('utf-8','replace')[:600]}", file=sys.stderr)
        sys.exit(2)

# 1. multipart modules upload (no bindings needed: fully client-side)
with open("/home/hatch/workspace/convert-site/worker.mjs", "rb") as f:
    code = f.read()
print(f"worker.mjs: {len(code)} bytes")
boundary = "----b" + uuid.uuid4().hex
D1_DB_ID = "21013edc-b35c-4836-a5e5-d6697d1b1239"  # convert-capture
meta = json.dumps({
    "main_module": "worker.mjs",
    "compatibility_date": "2026-10-01",
    "bindings": [
        {"type": "d1", "name": "DB", "id": D1_DB_ID},
    ],
})
body = b""
def part(headers, data):
    global body
    body += ("--" + boundary + "\r\n" + headers + "\r\n\r\n").encode() + data + b"\r\n"
part('Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json', meta.encode())
part('Content-Disposition: form-data; name="worker.mjs"; filename="worker.mjs"\r\nContent-Type: application/javascript+module', code)
body += ("--" + boundary + "--\r\n").encode()
req = urllib.request.Request(f"{BASE}/client/v4/accounts/{ACCT}/workers/scripts/{SCRIPT}", data=body, method="PUT")
req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
add_surrogate_to_request(req, "custom.cloudflare", allowed_hosts=ALLOWED)
try:
    r = urllib.request.urlopen(req, timeout=120)
    d = json.loads(r.read().decode())
    assert d.get("success"), d
    print("worker upload: 200, id:", d["result"]["id"])
except urllib.error.HTTPError as e:
    print(f"upload HTTP {e.code}\n{e.read().decode()[:600]}", file=sys.stderr)
    sys.exit(2)

# 2. DNS
zone = api("GET", f"/client/v4/zones?name=29court.com")["result"][0]["id"]
recs = api("GET", f"/client/v4/zones/{zone}/dns_records?name={HOST}&type=A")["result"]
if not recs:
    r = api("POST", f"/client/v4/zones/{zone}/dns_records",
            {"type": "A", "name": HOST, "content": "192.0.2.1", "proxied": True, "ttl": 1})
    print("dns created:", r["result"]["id"])
else:
    print("dns exists:", recs[0]["id"])

# 3. route
routes = api("GET", f"/client/v4/zones/{zone}/workers/routes")["result"]
if not [r for r in routes if r.get("pattern") == f"{HOST}/*"]:
    r = api("POST", f"/client/v4/zones/{zone}/workers/routes",
            {"pattern": f"{HOST}/*", "script": SCRIPT})
    print("route created:", r["result"]["id"])
else:
    print("route exists")
print("DEPLOY DONE")
