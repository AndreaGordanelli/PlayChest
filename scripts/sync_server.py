#!/usr/bin/env python3
"""Lightweight API server for health checks, sync control, and personal notes."""

import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import threading
import time
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
NIGHTS_PATH = DATA_DIR / "saved-nights.json"
STATUS_PATH = DATA_DIR / "sync-status.json"
USERNAMES_PATH = DATA_DIR / "bgg-usernames.json"
SYNC_LOCK = threading.Lock()
SYNC_RUNNING = False
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_ -]{1,50}$")
ADMIN_COOKIE_NAME = "playChestAdmin"
ADMIN_SESSION_TTL = 60 * 60 * 24
LOGIN_WINDOW_SECONDS = 600
LOGIN_MAX_ATTEMPTS = 20
loginAttemptState = {"startedAt": 0.0, "count": 0}
loginAttemptLock = threading.Lock()


disconnectedErrors = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)


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


def getAdminPassword():
    return os.environ.get("GAMECACHE_ADMIN_PASSWORD", "").strip()


def getAdminSecret():
    configured = os.environ.get("GAMECACHE_ADMIN_SECRET", "").strip()
    if configured:
        return configured.encode("utf-8")
    password = getAdminPassword()
    return hashlib.sha256(b"playchest-admin|" + password.encode("utf-8")).digest()


def passwordsMatch(provided, expected):
    providedHash = hashlib.sha256(provided.encode("utf-8")).digest()
    expectedHash = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(providedHash, expectedHash)


def createAdminToken():
    issuedAt = str(int(time.time()))
    digest = hmac.new(getAdminSecret(), issuedAt.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{issuedAt}.{digest}"


def isAdminTokenValid(token):
    if not token or "." not in token:
        return False
    issuedAt, digest = token.split(".", 1)
    expected = hmac.new(getAdminSecret(), issuedAt.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(digest, expected):
        return False
    try:
        age = time.time() - int(issuedAt)
    except ValueError:
        return False
    return 0 <= age <= ADMIN_SESSION_TTL


def isLoginRateLimited():
    now = time.time()
    with loginAttemptLock:
        startedAt = loginAttemptState["startedAt"]
        if now - startedAt > LOGIN_WINDOW_SECONDS:
            loginAttemptState["startedAt"] = now
            loginAttemptState["count"] = 0
            return False
        return loginAttemptState["count"] >= LOGIN_MAX_ATTEMPTS


def recordLoginAttempt():
    now = time.time()
    with loginAttemptLock:
        if now - loginAttemptState["startedAt"] > LOGIN_WINDOW_SECONDS:
            loginAttemptState["startedAt"] = now
            loginAttemptState["count"] = 1
        else:
            loginAttemptState["count"] += 1


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
    server_version = "PlayChestSync/1.0"

    def handle(self):
        try:
            super().handle()
        except disconnectedErrors:
            return

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except disconnectedErrors:
            return

    def _send_json(self, status_code, payload, cookies=None):
        body = json.dumps(payload).encode("utf-8")
        try:
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            for cookie in cookies or []:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(body)
        except disconnectedErrors:
            return

    def _cookieFlags(self):
        flags = f"Path=/api; HttpOnly; SameSite=Strict; Max-Age={ADMIN_SESSION_TTL}"
        forwarded = (self.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
        if forwarded == "https":
            flags += "; Secure"
        return flags

    def _adminCookieHeader(self, token, clear=False):
        flags = self._cookieFlags()
        if clear:
            return f"{ADMIN_COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0"
        return f"{ADMIN_COOKIE_NAME}={token}; {flags}"

    def _readCookies(self):
        cookies = {}
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            if "=" not in part:
                continue
            key, value = part.strip().split("=", 1)
            cookies[key] = value
        return cookies

    def _getAdminToken(self):
        authorization = self.headers.get("Authorization", "")
        if authorization.lower().startswith("bearer "):
            return authorization.split(" ", 1)[1].strip()
        return self._readCookies().get(ADMIN_COOKIE_NAME, "")

    def _isAdminAuthenticated(self):
        if not getAdminPassword():
            return False
        return isAdminTokenValid(self._getAdminToken())

    def _requireAdmin(self):
        if not getAdminPassword():
            self._send_json(503, {"error": "Admin password is not configured"})
            return False
        if not self._isAdminAuthenticated():
            self._send_json(401, {"error": "Admin login required"})
            return False
        return True

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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
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
            if not self._requireAdmin():
                return
            self._send_json(200, get_status_payload())
            return

        if path == "/api/notes":
            self._send_json(200, read_json(NOTES_PATH, {}))
            return

        if path == "/api/nights":
            payload = read_json(NIGHTS_PATH, {"nights": []})
            nights = payload.get("nights") if isinstance(payload, dict) else payload
            if not isinstance(nights, list):
                nights = []
            self._send_json(200, {"nights": nights})
            return

        if path == "/api/admin/session":
            passwordConfigured = bool(getAdminPassword())
            self._send_json(200, {
                "authenticated": self._isAdminAuthenticated(),
                "passwordConfigured": passwordConfigured,
            })
            return

        if path == "/api/usernames":
            if not self._requireAdmin():
                return
            self._send_json(200, get_usernames_payload())
            return

        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/api/admin/login":
            if not getAdminPassword():
                self._send_json(503, {"error": "Set GAMECACHE_ADMIN_PASSWORD in .env and restart Docker"})
                return
            if isLoginRateLimited():
                self._send_json(429, {"error": "Too many login attempts. Try again later."})
                return
            payload = self._read_json_body()
            provided = str(payload.get("password", ""))
            recordLoginAttempt()
            if not passwordsMatch(provided, getAdminPassword()):
                self._send_json(401, {"error": "Wrong password"})
                return
            token = createAdminToken()
            self._send_json(200, {
                "authenticated": True,
                "sessionToken": token,
            }, cookies=[self._adminCookieHeader(token)])
            return

        if path == "/api/admin/logout":
            self._send_json(200, {"authenticated": False}, cookies=[self._adminCookieHeader("", clear=True)])
            return

        if path == "/api/sync":
            if not self._requireAdmin():
                return
            started = run_sync()
            if not started:
                self._send_json(409, {"error": "Sync already running"})
                return
            self._send_json(202, {"status": "started"})
            return

        if path == "/api/usernames":
            if not self._requireAdmin():
                return
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

        if path == "/api/nights":
            payload = self._read_json_body()
            nights = payload.get("nights") if isinstance(payload, dict) else payload
            if not isinstance(nights, list):
                self._send_json(400, {"error": "nights must be an array"})
                return
            cleaned = []
            for night in nights:
                if not isinstance(night, dict):
                    continue
                name = str(night.get("name", "")).strip()
                filters = night.get("filters")
                if not name or not isinstance(filters, dict):
                    continue
                nightId = str(night.get("id") or "").strip() or f"night-{len(cleaned) + 1}"
                cleaned.append({
                    "id": nightId,
                    "name": name[:60],
                    "filters": filters,
                })
            write_json(NIGHTS_PATH, {"nights": cleaned})
            self._send_json(200, {"saved": True, "nights": cleaned})
            return

        if path == "/api/usernames":
            if not self._requireAdmin():
                return
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
            if not self._requireAdmin():
                return
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


class SyncApiServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        error = sys.exc_info()[1]
        if isinstance(error, disconnectedErrors):
            return
        super().handle_error(request, client_address)


def main():
    host = os.environ.get("GAMECACHE_SYNC_HOST", "127.0.0.1")
    port = int(os.environ.get("GAMECACHE_SYNC_PORT", "9090"))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = SyncApiServer((host, port), SyncApiHandler)
    print(f"PlayChest sync API listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
