# Hosting Math Studio on your server

Hosted Math Studio adds Google sign-in. Each person sees only their own files, which are stored
on the server and open from the web, the Windows app or the Android app. AI features run on each
person's **own** Claude account, which they connect in the app.

## 1. Google sign-in

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Open **APIs & Services → OAuth consent screen**. Choose *External*, fill in the app name and
   your email, and add yourself under *Test users*. While the app is in *Testing*, only test users
   can sign in.
3. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**, type *Web application*.
   - Authorized redirect URI: `https://<your domain>/auth/google/callback`
4. Copy the client ID and secret.

## 2. Configure

```bash
cp .env.example .env
```

Fill in `PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS` and
`SESSION_SECRET` (`openssl rand -hex 32`). Only the emails in `ALLOWED_EMAILS` can sign in;
edit the list and restart to add or remove people.

## 3. Run

Behind the reverse proxy you already run (nginx, Traefik, Caddy, Nginx Proxy Manager…):

```bash
docker compose up -d --build
```

The app listens on `127.0.0.1:3001`. Point your proxy at it, with WebSocket support
(the app uses `/ws`). For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 50m;
}
```

If you have no proxy, the bundled Caddy gets an HTTPS certificate for `DOMAIN` (ports 80 and
443 must be free):

```bash
docker compose --profile caddy up -d --build
```

Files are stored in `./data` (one folder per user). Back up that folder.

## 4. Apps

- **Web:** open `PUBLIC_URL`.
- **Windows:** on first start, choose *Your Math Studio server* and enter the address. Sign-in
  opens in your browser and returns to the app. Use the menu (Alt) → *Change server…* to switch.
- **Android:** type the server address and sign in, or scan the code from *Connect tablet* on a
  signed-in PC.

## 5. Claude AI

In the app, open **Home → Claude AI → Connect** and paste one of:

- a Claude Code token for a Pro/Max plan: install Claude Code anywhere and run `claude setup-token`
  (starts with `sk-ant-oat`), or
- an Anthropic API key (starts with `sk-ant-api`).

The server stores it encrypted with `SESSION_SECRET` and uses it only for that person's
requests. Claude may use only Math Studio's canvas tools there, not the server's files or shell.

## Notes

- MCP for an external Claude client is not exposed on a hosted server; connected accounts use
  the built-in chat and AI helper.
- Testing locally without Google: set `MATH_STUDIO_DEV_LOGIN=1` and open `/auth/dev?email=...`
  from the same machine. Never set it on a public server.
