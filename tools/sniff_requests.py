"""Passive HTTP request capture for the vLLM container (read-only, no restart).

Run inside the container's network namespace with CAP_NET_RAW, e.g.:
  docker run -d --rm --name nc-sniffer --net container:vllm-glm53-cmp --cap-add NET_RAW \
    -v /tmp/nc-capture:/out -v $PWD/sniff_requests.py:/sniff.py:ro \
    --entrypoint python3 <vllm image> /sniff.py
Every POST to port 8000 is saved as /out/<time>_<n>.json (request JSON body + path).
The Authorization header is never written.
"""
import json
import os
import socket
import struct
import time

PORT = int(os.environ.get("PORT", "8000"))
OUT = os.environ.get("OUT", "/out")
os.makedirs(OUT, exist_ok=True)

sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.ntohs(0x0003))
streams = {}   # (src, sport) -> {"isn": seq of first byte, "segs": {offset: bytes}, "t": last seen}
count = 0


def try_emit(key):
    global count
    st = streams[key]
    buf, pos = bytearray(), 0
    while pos in st["segs"]:
        seg = st["segs"][pos]
        buf += seg
        pos += len(seg)
    head_end = buf.find(b"\r\n\r\n")
    if head_end < 0:
        return
    head = buf[:head_end].decode("latin-1")
    lines = head.split("\r\n")
    method, path = (lines[0].split(" ") + ["", ""])[:2]
    headers = {l.split(":", 1)[0].strip().lower(): l.split(":", 1)[1].strip() for l in lines[1:] if ":" in l}
    need = int(headers.get("content-length", "0"))
    body = bytes(buf[head_end + 4:head_end + 4 + need])
    if len(body) < need:
        return
    if method == "POST":
        count += 1
        try:
            payload = json.loads(body)
        except ValueError:
            payload = body.decode("utf-8", "replace")
        rec = {"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "method": method, "path": path,
               "origin": headers.get("origin"), "user_agent": headers.get("user-agent"), "body": payload}
        name = os.path.join(OUT, f"{time.strftime('%Y%m%d-%H%M%S')}_{count}.json")
        with open(name, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=2)
        print("captured", path, len(body), "bytes ->", name, flush=True)
    # Keep-alive: drop the consumed request and keep any following bytes.
    rest = bytes(buf[head_end + 4 + need:])
    st["isn"] += head_end + 4 + need
    st["segs"] = {0: rest} if rest else {}


print(f"sniffing tcp/{PORT} -> {OUT}", flush=True)
while True:
    frame = sock.recv(65535)
    if struct.unpack("!H", frame[12:14])[0] != 0x0800:
        continue
    ip = frame[14:]
    ihl = (ip[0] & 0x0F) * 4
    if ip[9] != 6:
        continue
    total = struct.unpack("!H", ip[2:4])[0]
    src = socket.inet_ntoa(ip[12:16])
    tcp = ip[ihl:total]
    sport, dport, seq = struct.unpack("!HHI", tcp[:8])
    if dport != PORT:
        continue
    flags = tcp[13]
    data = tcp[(tcp[12] >> 4) * 4:]
    key = (src, sport)
    if flags & 0x02:  # SYN: new connection
        streams[key] = {"isn": (seq + 1) & 0xFFFFFFFF, "segs": {}, "t": time.time()}
        continue
    if key not in streams and data[:5] == b"POST ":  # keep-alive connection opened before we started
        streams[key] = {"isn": seq, "segs": {}, "t": time.time()}
    if key not in streams or not data:
        if flags & 0x05 and key in streams:  # FIN/RST
            streams.pop(key, None)
        continue
    st = streams[key]
    st["segs"][(seq - st["isn"]) & 0xFFFFFFFF] = data
    st["t"] = time.time()
    try_emit(key)
    for k in [k for k, v in streams.items() if time.time() - v["t"] > 900]:
        streams.pop(k, None)
