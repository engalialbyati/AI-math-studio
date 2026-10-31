# Deploy Math Studio to mstudio.liquid1611.com

Instructions for an AI agent (or a person) with shell access to the server. The server already
runs Docker. Goal: Math Studio served at **https://mstudio.liquid1611.com** with HTTPS, accounts
(email + password), files stored on the server, and WebSocket support.

Work through the steps in order. Stop and ask the owner where this file says **Ask the owner**.

## Rules

- Never print, log or commit the contents of `.env` (it holds `SESSION_SECRET`).
- Never change `SESSION_SECRET` once set: that signs everyone out and erases their stored Claude logins.
- Never publish port 3001 to the internet. Only the reverse proxy (or Caddy) may reach it.
- Never delete or overwrite `./data` (all accounts and files). Back it up before upgrades.
- Do not stop, restart or reconfigure other containers or sites on this server without asking the owner.

## 1. Check the server

```bash
docker --version && docker compose version
```

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

Note which reverse proxy already owns ports 80/443, from the image names:

- `nginx` → section 4A
- `jc21/nginx-proxy-manager` (Nginx Proxy Manager) → section 4B
- `traefik` → section 4C
- `caddy` → section 4D
- nothing on 80/443 → section 4E (bundled Caddy)

Check that DNS points at this server:

```bash
getent hosts mstudio.liquid1611.com; curl -s https://api.ipify.org; echo
```

The two IPs must match. If not, **ask the owner** to add an `A` record `mstudio` → this server's
public IP at the DNS provider for `liquid1611.com`, and wait until it resolves.

## 2. Get the code

```bash
sudo mkdir -p /opt/math-studio && sudo chown "$USER" /opt/math-studio
```

```bash
git clone https://github.com/engalialbyati/AI-math-studio.git /opt/math-studio
```

```bash
cd /opt/math-studio
```

## 3. Configure

**Ask the owner** which emails may create accounts. Leaving the list empty lets anyone on the
internet sign up.

Create `.env` (replace the `ALLOWED_EMAILS` value with the owner's answer):

```bash
cat > .env <<EOF
PUBLIC_URL=https://mstudio.liquid1611.com
DOMAIN=mstudio.liquid1611.com
ALLOWED_EMAILS=owner@example.com
SESSION_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 .env
```

The container runs as user 1000; give it the data folder:

```bash
mkdir -p data && sudo chown 1000:1000 data
```

Build and start the app (the first build downloads ~120 MB for handwriting recognition and takes
a few minutes):

```bash
docker compose up -d --build math-studio
```

```bash
curl -s http://127.0.0.1:3001/api/config
```

Expected: `{"hosted":true,"user":null}`. If not, see *Troubleshooting*.

### Downloads on the landing page (optional)

The landing page offers the Windows installer and the Android app when these files exist:

```
/opt/math-studio/downloads/MathStudio-Setup.exe
/opt/math-studio/downloads/MathStudio-Tablet.apk
```

**Ask the owner** to upload them (for example with `scp`); they are built on the owner's PC.
Without them, the landing page shows those downloads as not published yet.

```bash
mkdir -p downloads
```

## 4. HTTPS and the domain

The app listens on `127.0.0.1:3001`. The proxy must forward `mstudio.liquid1611.com` to it with
**WebSocket upgrade** (path `/ws`), pass `X-Forwarded-For`, and allow request bodies up to 50 MB.

### 4A. nginx on the host

Create `/etc/nginx/sites-available/mstudio.liquid1611.com`:

```nginx
server {
    server_name mstudio.liquid1611.com;
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
    }
    listen 80;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mstudio.liquid1611.com /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

```bash
sudo certbot --nginx -d mstudio.liquid1611.com
```

If nginx runs **in a container**, `127.0.0.1` is the container itself. Instead, attach Math Studio
to the proxy's Docker network (see 4C's override file, without the labels) and use
`proxy_pass http://math-studio:3001;`.

### 4B. Nginx Proxy Manager

The proxy runs in a container, so it reaches Math Studio over a shared Docker network. Find the
network NPM uses (`docker inspect <npm container> -f '{{json .NetworkSettings.Networks}}'`), then
create `docker-compose.override.yml` as in 4C (without the `labels`), and run
`docker compose up -d math-studio`.

**Ask the owner** to add a Proxy Host in the NPM web UI (or do it if you have UI access):
domain `mstudio.liquid1611.com`, scheme `http`, forward host `math-studio`, port `3001`,
**Websockets Support on**. On the SSL tab: request a Let's Encrypt certificate and turn on
Force SSL. In Advanced, add `client_max_body_size 50m;`.

### 4C. Traefik

Find Traefik's Docker network and certificate resolver name:

```bash
docker inspect $(docker ps -qf ancestor=traefik) -f '{{json .NetworkSettings.Networks}}'; docker inspect $(docker ps -qf ancestor=traefik) -f '{{.Args}}'
```

Create `docker-compose.override.yml` (replace `PROXY_NETWORK` and `letsencrypt`):

```yaml
services:
  math-studio:
    networks: [default, proxy]
    labels:
      - traefik.enable=true
      - traefik.http.routers.mstudio.rule=Host(`mstudio.liquid1611.com`)
      - traefik.http.routers.mstudio.entrypoints=websecure
      - traefik.http.routers.mstudio.tls.certresolver=letsencrypt
      - traefik.http.services.mstudio.loadbalancer.server.port=3001
networks:
  proxy:
    external: true
    name: PROXY_NETWORK
```

```bash
docker compose up -d math-studio
```

### 4D. Caddy already running

Add a site block to the existing Caddyfile, then reload Caddy:

```
mstudio.liquid1611.com {
	reverse_proxy 127.0.0.1:3001
}
```

If Caddy runs in a container, join its network as in 4C (without labels) and use
`reverse_proxy math-studio:3001`.

### 4E. No proxy yet

Ports 80 and 443 must be free. The bundled Caddy gets the certificate automatically:

```bash
docker compose --profile caddy up -d --build
```

## 5. Verify

```bash
curl -sI https://mstudio.liquid1611.com | head -1
```

```bash
curl -s https://mstudio.liquid1611.com/api/config
```

Expected: `HTTP/2 200` (or `HTTP/1.1 200`) and `{"hosted":true,"user":null}`. The landing page
is at `/`, the app at `/app`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mstudio.liquid1611.com/mcp
```

Expected `403` or `404` (the AI endpoint must not be reachable from outside).

Then tell the owner to open https://mstudio.liquid1611.com, choose **Create an account**, and
check that a drawing survives a page reload (the WebSocket works if the status shows connected
and files save).

## 6. Operate

Logs:

```bash
cd /opt/math-studio && docker compose logs --tail=100 math-studio
```

Reset a forgotten password (there is no email reset):

```bash
docker compose exec math-studio node server/server.mjs reset-password person@example.com 'new-password-here'
```

Add or remove allowed emails: edit `ALLOWED_EMAILS` in `.env`, then:

```bash
docker compose up -d math-studio
```

Back up (accounts + files):

```bash
tar czf ~/math-studio-backup-$(date +%F).tgz -C /opt/math-studio data .env
```

Update to the latest version (back up first):

```bash
cd /opt/math-studio && git pull && docker compose up -d --build math-studio
```

## Troubleshooting

- `Hosted mode needs PUBLIC_URL`: `.env` missing or not in `/opt/math-studio`.
- Sign-in answers `Forbidden origin`: `PUBLIC_URL` must be exactly `https://mstudio.liquid1611.com`
  (https, no trailing slash) and the proxy must keep the `Host` header.
- Canvas never says connected / changes don't sync: the proxy is not passing WebSocket upgrades
  for `/ws`.
- Saving large files fails (413): raise the proxy's body size limit to 50 MB.
- `EACCES` writing `/data`: `sudo chown -R 1000:1000 /opt/math-studio/data`.
- AI says not connected: each user connects their own Claude in **Home → Claude AI**; nothing
  to configure on the server.
