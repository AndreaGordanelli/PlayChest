#!/usr/bin/env python3
"""Lightweight API server for health checks, sync control, and personal notes."""

import json
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

APP_DIR = Path(os.environ.get("GAMECACHE_APP_DIR", "/app"))
DATA_DIR = Path(os.environ.get("GAMECACHE_DATA_DIR", "/app/data"))
HTML_DIR = Path(os.environ.get("GAMECACHE_HTML_DIR", "/usr/share/nginx/html"))
DB_PATH = HTML_DIR / "gamecache.sqlite.gz"
NOTES_PATH = DATA_DIR / "personal-notes.json"
STATUS_PATH = DATA_DIR / "sync-status.json"
USERNAMES_PATH = DATA_DIR / "bgg-usernames.json"
SYNC_LOCK = threading.Lock()
SYNC_RUNNING = False
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_ -]{1,50}$")


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


def _cleanUsernameList(usernames):
    cleaned = []
    for name in usernames or []:
        value = str(name).strip()
        if not value:
            continue
        if not USERNAME_PATTERN.match(value):
            raise ValueError(f"Invalid BoardGameGeek username: {value}")
        if value not in cleaned:
            cleaned.append(value)
    return cleaned


def get_config_usernames():
    sys.path.insert(0, str(APP_DIR / "scripts"))
    from gamecache.config import parse_config_file
    from gamecache.collection_loader import get_bgg_usernames, get_extra_usernames, get_disabled_usernames

    configPath = APP_DIR / "config.ini"
    extraUsernames = get_extra_usernames()
    disabledUsernames = get_disabled_usernames()
    if not configPath.exists():
        return [], extraUsernames, disabledUsernames
    config = parse_config_file(str(configPath))
    return (
        get_bgg_usernames(config, includeExtras=False, includeDisabled=True),
        extraUsernames,
        disabledUsernames,
    )


def get_usernames_payload():
    configUsernames, extraUsernames, disabledUsernames = get_config_usernames()
    disabledLower = {name.lower() for name in disabledUsernames}
    usernames = []
    for name in configUsernames + extraUsernames:
        if name.lower() in disabledLower:
            continue
        if name not in usernames:
            usernames.append(name)
    return {
        "usernames": usernames,
        "configUsernames": configUsernames,
        "extraUsernames": extraUsernames,
        "disabledUsernames": disabledUsernames,
    }


def save_usernames_file(extraUsernames, disabledUsernames=None):
    current = get_usernames_payload()
    extraCleaned = _cleanUsernameList(extraUsernames)
    disabledCleaned = _cleanUsernameList(
        current["disabledUsernames"] if disabledUsernames is None else disabledUsernames
    )
    extraLower = {name.lower() for name in extraCleaned}
    disabledCleaned = [name for name in disabledCleaned if name.lower() not in extraLower]
    write_json(USERNAMES_PATH, {
        "extraUsernames": extraCleaned,
        "disabledUsernames": disabledCleaned,
    })
    return get_usernames_payload()


def save_extra_usernames(extraUsernames):
    return save_usernames_file(extraUsernames)


def get_status_payload():
    payload = read_json(STATUS_PATH, {})
    payload["databaseReady"] = DB_PATH.exists() and DB_PATH.stat().st_size > 0
    payload["syncRunning"] = SYNC_RUNNING
    payload["notesCount"] = len(read_json(NOTES_PATH, {}))
    payload["usernames"] = get_usernames_payload()["usernames"]
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
            if result.stdout:
                print(result.stdout, end="")
            if result.stderr:
                print(result.stderr, end="", file=sys.stderr)
            if result.returncode != 0:
                previous = read_json(STATUS_PATH, {})
                errorText = (
                    (result.stderr or "").strip()
                    or (result.stdout or "").strip()
                    or previous.get("error")
                    or "Sync failed"
                )[-2000:]
                write_json(STATUS_PATH, {
                    "status": "failed",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "error": errorText,
                    "gameCount": previous.get("gameCount", 0),
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
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

        if path == "/api/usernames":
            self._send_json(200, get_usernames_payload())
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

        if path == "/api/usernames":
            payload = self._read_json_body()
            username = str(payload.get("username", "")).strip()
            if not username:
                self._send_json(400, {"error": "username is required"})
                return
            try:
                current = get_usernames_payload()
                extraUsernames = list(current["extraUsernames"])
                disabledUsernames = [
                    name for name in current["disabledUsernames"]
                    if name.lower() != username.lower()
                ]
                existing = {name.lower() for name in current["configUsernames"] + extraUsernames}
                if username.lower() not in existing:
                    extraUsernames.append(username)
                result = save_usernames_file(extraUsernames, disabledUsernames)
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
                return
            if payload.get("sync"):
                run_sync()
                result["syncStarted"] = True
            self._send_json(200, result)
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

        if path == "/api/usernames":
            payload = self._read_json_body()
            extraUsernames = payload.get("extraUsernames")
            if not isinstance(extraUsernames, list):
                self._send_json(400, {"error": "extraUsernames must be an array"})
                return
            try:
                disabledUsernames = payload.get("disabledUsernames")
                self._send_json(200, save_usernames_file(extraUsernames, disabledUsernames))
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
            return

        self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/usernames":
            username = (parse_qs(parsed.query).get("username") or [""])[0].strip()
            if not username:
                self._send_json(400, {"error": "username is required"})
                return
            current = get_usernames_payload()
            activeLower = {name.lower() for name in current["usernames"]}
            if username.lower() not in activeLower:
                self._send_json(200, current)
                return
            if len(current["usernames"]) <= 1:
                self._send_json(400, {"error": "Keep at least one BoardGameGeek collection"})
                return
            extraUsernames = [
                name for name in current["extraUsernames"]
                if name.lower() != username.lower()
            ]
            disabledUsernames = list(current["disabledUsernames"])
            isConfig = any(name.lower() == username.lower() for name in current["configUsernames"])
            if isConfig and username.lower() not in {name.lower() for name in disabledUsernames}:
                configName = next(
                    name for name in current["configUsernames"]
                    if name.lower() == username.lower()
                )
                disabledUsernames.append(configName)
            try:
                self._send_json(200, save_usernames_file(extraUsernames, disabledUsernames))
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
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
