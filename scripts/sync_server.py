#!/usr/bin/env python3
"""Lightweight API server for health checks, sync control, and personal notes."""

import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

APP_DIR = Path(os.environ.get("GAMECACHE_APP_DIR", "/app"))
DATA_DIR = Path(os.environ.get("GAMECACHE_DATA_DIR", "/app/data"))
HTML_DIR = Path(os.environ.get("GAMECACHE_HTML_DIR", "/usr/share/nginx/html"))
DB_PATH = HTML_DIR / "gamecache.sqlite.gz"
NOTES_PATH = DATA_DIR / "personal-notes.json"
STATUS_PATH = DATA_DIR / "sync-status.json"
SYNC_LOCK = threading.Lock()
SYNC_RUNNING = False


def read_json(path, default):
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def get_status_payload():
    payload = read_json(STATUS_PATH, {})
    payload["databaseReady"] = DB_PATH.exists() and DB_PATH.stat().st_size > 0
    payload["syncRunning"] = SYNC_RUNNING
    payload["notesCount"] = len(read_json(NOTES_PATH, {}))
    return payload


def run_sync():
    global SYNC_RUNNING
    with SYNC_LOCK:
        if SYNC_RUNNING:
            return False
        SYNC_RUNNING = True

    write_json(STATUS_PATH, {
        "status": "running",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "error": None,
    })

    def worker():
        global SYNC_RUNNING
        try:
            command = [
                sys.executable,
                str(APP_DIR / "scripts" / "download_and_index.py"),
                "--cache_bgg",
            ]
            result = subprocess.run(
                command,
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                write_json(STATUS_PATH, {
                    "status": "failed",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "error": (result.stderr or result.stdout or "Sync failed").strip()[-500:],
                })
                return

            generated_db = APP_DIR / "gamecache.sqlite.gz"
            if generated_db.exists():
                DATA_DIR.mkdir(parents=True, exist_ok=True)
                db_bytes = generated_db.read_bytes()
                DB_PATH.write_bytes(db_bytes)
                (DATA_DIR / "gamecache.sqlite.gz").write_bytes(db_bytes)
        finally:
            SYNC_RUNNING = False

    threading.Thread(target=worker, daemon=True).start()
    return True


class SyncApiHandler(BaseHTTPRequestHandler):
    server_version = "GameCacheSync/1.0"

    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/health":
            self._send_json(200, {"status": "ok"})
            return

        if path == "/ready":
            ready = DB_PATH.exists() and DB_PATH.stat().st_size > 0
            self._send_json(200 if ready else 503, {
                "ready": ready,
                "databasePath": str(DB_PATH),
            })
            return

        if path == "/api/status":
            self._send_json(200, get_status_payload())
            return

        if path == "/api/notes":
            self._send_json(200, read_json(NOTES_PATH, {}))
            return

        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/api/sync":
            started = run_sync()
            if not started:
                self._send_json(409, {"error": "Sync already running"})
                return
            self._send_json(202, {"status": "started"})
            return

        self._send_json(404, {"error": "Not found"})

    def do_PUT(self):
        path = urlparse(self.path).path

        if path == "/api/notes":
            payload = self._read_json_body()
            if not isinstance(payload, dict):
                self._send_json(400, {"error": "Notes payload must be an object"})
                return
            write_json(NOTES_PATH, payload)
            self._send_json(200, {"saved": True, "notesCount": len(payload)})
            return

        self._send_json(404, {"error": "Not found"})

    def log_message(self, format, *args):
        return


def main():
    host = os.environ.get("GAMECACHE_SYNC_HOST", "127.0.0.1")
    port = int(os.environ.get("GAMECACHE_SYNC_PORT", "9090"))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((host, port), SyncApiHandler)
    print(f"GameCache sync API listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
