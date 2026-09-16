#!/bin/sh
set -eu

appDir="/app"
htmlDir="/usr/share/nginx/html"
dataDir="/app/data"
dbPath="${htmlDir}/gamecache.sqlite.gz"
configPath="${appDir}/config.ini"

mkdir -p "${htmlDir}" "${dataDir}"

cp "${appDir}/index.html" "${htmlDir}/index.html"
cp "${appDir}/style.css" "${htmlDir}/style.css"
cp "${appDir}/app-sqlite.js" "${htmlDir}/app-sqlite.js"
cp "${appDir}/features.js" "${htmlDir}/features.js"
cp "${appDir}/favicon.ico" "${htmlDir}/favicon.ico"
if [ -f "${appDir}/admin.html" ]; then
  cp "${appDir}/admin.html" "${htmlDir}/admin.html"
fi
if [ -f "${appDir}/admin.js" ]; then
  cp "${appDir}/admin.js" "${htmlDir}/admin.js"
fi

if [ -f "${configPath}" ]; then
  cp "${configPath}" "${htmlDir}/config.ini"
fi

export GAMECACHE_SYNC_STATUS_PATH="${dataDir}/sync-status.json"
export GAMECACHE_APP_DIR="${appDir}"
export GAMECACHE_DATA_DIR="${dataDir}"
export GAMECACHE_HTML_DIR="${htmlDir}"

python "${appDir}/scripts/sync_server.py" &
syncServerPid=$!

buildDatabase() {
  echo "Building board game database from BoardGameGeek..."
  cd "${appDir}"
  python scripts/download_and_index.py --cache_bgg
  if [ -f "${appDir}/gamecache.sqlite.gz" ]; then
    cp "${appDir}/gamecache.sqlite.gz" "${dbPath}"
    cp "${appDir}/gamecache.sqlite.gz" "${dataDir}/gamecache.sqlite.gz"
    echo "Database ready at ${dbPath}"
  fi
}

if [ ! -f "${dbPath}" ]; then
  if [ -f "${dataDir}/gamecache.sqlite.gz" ]; then
    cp "${dataDir}/gamecache.sqlite.gz" "${dbPath}"
  elif [ -f "${configPath}" ]; then
    buildDatabase || echo "Warning: initial database build failed; site will show an error until data is available."
  else
    echo "Warning: no config.ini mounted and no database found."
  fi
fi

updateInterval="${GAMECACHE_UPDATE_INTERVAL:-0}"
if [ "${updateInterval}" != "0" ] && [ -f "${configPath}" ]; then
  (
    while true; do
      sleep "${updateInterval}"
      curl -sf -X POST "http://127.0.0.1:9090/api/sync" >/dev/null 2>&1 \
        || python -c "import urllib.request; urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:9090/api/sync', method='POST'))" \
        || buildDatabase || echo "Scheduled database update failed."
    done
  ) &
fi

trap 'kill "${syncServerPid}" 2>/dev/null || true' EXIT TERM INT
exec "$@"
