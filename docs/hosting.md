# Hosting Math Studio on your server

Hosted Math Studio adds accounts (email and password). Each person sees only their own files,
which are stored on the server and open from the web, the Windows app or the Android app. AI
features run on each person's **own** Claude account, which they connect in the app.

## 1. Configure

```bash
cp .env.example .env
```

Fill in:

- `PUBLIC_URL`: the address people open, e.g. `https://math.example.com`.
- `ALLOWED_EMAILS`: who may create an account, comma separated. Leave it empty to let anyone
  who opens the site sign up.
- `SESSION_SECRET`: a long random string (`openssl rand -hex 32`). Never change it later: that
  signs everyone out and forgets their connected Claude accounts.

## 2. Run

The container runs as user 1000, so create its data folder first:

```bash
mkdir -p data && sudo chown 1000:1000 data
```

Behind the reverse proxy you already run (nginx, Traefik, Caddy, Nginx Proxy Manager…):

```bash
docker compose up -d --build
```

The app listens on `127.0.0.1:3001`. Point your proxy at it with WebSocket support (the app
uses `/ws`) and HTTPS, so passwords are never sent in clear text. For nginx:

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

Everything is stored in `./data`: `accounts.json` (emails and password hashes) and one folder
per user with their files. Back up that folder.

## 3. Accounts

- People open the site, choose **Create an account**, and sign in with email and password.
- Passwords are stored as scrypt hashes. After 10 wrong attempts from one address or for one
  account, sign-in is blocked for 15 minutes.
- Changing a password (**Home → Password**) signs out that account's other devices.
- Forgotten password: there is no email reset. As the server owner, set a new one:

```bash
docker compose exec math-studio node server/server.mjs reset-password person@example.com 'new password'
```

## 4. Apps

- **Web:** open `PUBLIC_URL`.
- **Windows:** on first start, choose *Your Math Studio server*, enter the address and sign in.
  Use the menu (Alt) → *Change server…* to switch.
- **Android:** type the server address and sign in, or scan the code from *Connect tablet* on a
  signed-in PC (it signs the tablet into the same account; works once, for 5 minutes).

## 5. Claude AI

In the app, open **Home → Claude AI → Connect** and paste one of:

- a Claude Code token for a Pro/Max plan: install Claude Code anywhere and run `claude setup-token`
  (starts with `sk-ant-oat`), or
- an Anthropic API key (starts with `sk-ant-api`).

The server stores it encrypted with `SESSION_SECRET` and uses it only for that person's
requests. Claude may use only Math Studio's canvas tools there, not the server's files or shell.
