FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

COPY scripts/requirements.txt scripts/requirements.txt
RUN pip install --no-cache-dir -r scripts/requirements.txt

COPY scripts/ scripts/
COPY index.html style.css app-sqlite.js features.js theme.js sw.js manifest.webmanifest favicon.ico admin.html admin.js config.ini ./
COPY vendor/ vendor/
COPY icons/ icons/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
    && mkdir -p /usr/share/nginx/html /app/data

ENV GAMECACHE_SKIP_UPDATE_CHECK=1

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
