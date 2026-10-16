"""Logging pass-through proxy for an OpenAI-compatible server.

Point NovelCrafter's Base URL at http://127.0.0.1:8001/v1 (instead of the vLLM box);
every request is forwarded unchanged and its JSON body is appended to requests.jsonl.

    python capture_proxy.py [--listen 127.0.0.1:8001] [--upstream http://192.168.0.48:8000] [--out DIR]
"""
import argparse
import http.client
import http.server
import json
import os
import time
import urllib.parse

HOP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
               "proxy-authorization", "proxy-authenticate", "host", "content-length"}


def make_handler(upstream, out_path):
    up = urllib.parse.urlsplit(upstream)

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _forward(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            if self.command == "POST" and body:
                try:
                    payload = json.loads(body)
                except ValueError:
                    payload = body.decode("utf-8", "replace")
                with open(out_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps({"time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                        "path": self.path, "body": payload}, ensure_ascii=False) + "\n")
                print(f"captured {self.path} ({len(body)} bytes)", flush=True)

            conn_cls = http.client.HTTPSConnection if up.scheme == "https" else http.client.HTTPConnection
            conn = conn_cls(up.hostname, up.port, timeout=600)
            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_HEADERS}
            conn.request(self.command, self.path, body=body or None, headers=headers)
            resp = conn.getresponse()

            # Relay the response, streaming chunk by chunk so SSE output still arrives live.
            self.send_response(resp.status, resp.reason)
            for k, v in resp.getheaders():
                if k.lower() not in HOP_HEADERS:
                    self.send_header(k, v)
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()
            while True:
                chunk = resp.read1(65536) if hasattr(resp, "read1") else resp.read(65536)
                if not chunk:
                    break
                self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            conn.close()

        do_GET = do_POST = do_OPTIONS = do_DELETE = _forward

        def log_message(self, fmt, *args):
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--listen", default="127.0.0.1:8001")
    ap.add_argument("--upstream", default="http://192.168.0.48:8000")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "capture"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    out_path = os.path.join(a.out, "requests.jsonl")
    host, port = a.listen.rsplit(":", 1)
    srv = http.server.ThreadingHTTPServer((host, int(port)), make_handler(a.upstream, out_path))
    print(f"proxy {a.listen} -> {a.upstream}, logging to {os.path.abspath(out_path)}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
