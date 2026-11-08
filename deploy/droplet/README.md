# Deploying Tasa to a DigitalOcean droplet

Render/Railway host Tasa for now; this is the production setup for later. The workflow
`.github/workflows/deploy-droplet.yml` is **manual** (Actions → Deploy to droplet → Run workflow)
until you add a `push` trigger. Each run:

1. Typechecks and tests the API, contracts, admin and web. If anything fails, nothing deploys.
2. Builds the admin's static files, and the API and web images (`ghcr.io/<owner>/tasa-api`, `tasa-web`).
3. Copies this folder and the admin files to `/opt/tasa`, then runs `deploy.sh <commit>`, which pulls
   the images, restarts, and waits for the API's `/health`.

The droplet never builds anything or holds source.

## One-time setup

**1. Droplet.** Ubuntu 24.04, at least 2 GB RAM (4 GB is more comfortable with Mongo + Next).

```sh
# as root
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
mkdir -p /opt/tasa/backups /opt/tasa/admin && chown -R deploy:deploy /opt/tasa
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

**2. DNS.** `A` records for `api.tasa.ng`, `tasa.ng` and `admin.tasa.ng` → the droplet's IP. Caddy
gets certificates on first start.

**3. Deploy key.** `ssh-keygen -t ed25519 -f tasa_deploy -N "" && ssh-copy-id -i tasa_deploy.pub deploy@<ip>`

**4. GitHub.** Secrets: `DROPLET_HOST`, `DROPLET_USER` (`deploy`), `DROPLET_SSH_KEY` (private key).
Variables: `API_DOMAIN` (`api.tasa.ng`), `WEB_DOMAIN` (`tasa.ng`) — baked into the admin and web builds.

**5. Registry login** (images are private): as `deploy`,
`echo <PAT with read:packages> | docker login ghcr.io -u <github-user> --password-stdin`

**6. Settings.** As `deploy`: `cp .env.example /opt/tasa/.env` and fill in domains and image names.
Create `/opt/tasa/api.env` from `apps/api/.env.example`, leaving out `MONGODB_URI`, `REDIS_URL`,
`PORT` and `NODE_ENV` (compose sets them). Set `CORS_ORIGINS=https://admin.tasa.ng,https://tasa.ng`.
`chmod 600 /opt/tasa/api.env`.

**7. First deploy.** Run the workflow, then seed:
`docker compose exec api node dist/seed.js`

**8. Providers.** Whitelist the droplet IP with SaySwitch/VTpass if required and point their webhooks
at `https://api.tasa.ng/...` (see `apps/api/docs/api.md`).

## Moving data from Atlas

`mongodump --uri "<atlas uri>" --archive=tasa.gz --gzip`, copy it to `/opt/tasa/backups`, then
`docker compose exec -T mongo mongorestore --archive=/backups/tasa.gz --gzip`.

## Day to day

```sh
cd /opt/tasa
docker compose ps
docker compose logs -f api
./deploy.sh <older-commit-sha>        # roll back
docker compose up -d api              # after editing api.env
```

## Backups

`crontab -e` as `deploy`:

```cron
30 2 * * * cd /opt/tasa && docker compose exec -T mongo mongodump --archive=/backups/tasa-$(date +\%F).gz --gzip && find backups -name '*.gz' -mtime +14 -delete
```

Copy `/opt/tasa/backups` off the droplet (e.g. to Spaces) and turn on droplet backups.
