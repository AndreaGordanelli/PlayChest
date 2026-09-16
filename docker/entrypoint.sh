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
cp "${appDir}/favicon.ico" "${htmlDir}/favicon.ico"

if [ -f "${configPath}" ]; then
  cp "${configPath}" "${htmlDir}/config.ini"
fi

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
      buildDatabase || echo "Scheduled database update failed."
    done
  ) &
fi

exec "$@"
