# Deploying to a GCP VM (Nginx)

This is a static site — no build server, no app process. Nginx just serves the
files directly from disk. There's no local `gcloud`/Node in this environment,
so provisioning and the first server setup need to happen on the VM itself
(over SSH) or via `gcloud` on a machine that has it installed.

## Replacing the old site on an existing VM

If the VM is already serving the old blactec site, don't just point
`deploy.sh` at it and run — check what's there first:

```bash
# on the VM
cat /etc/nginx/sites-enabled/*        # find the current server block + its root path
ls -la /var/www/                      # find where the old site's files actually live
```

`deploy.sh` runs `rsync --delete`, which removes anything in the target
directory that isn't part of this repo — fine for a directory dedicated to
this site, destructive if the old site's root is reused as-is (e.g. if it's
`/var/www/html` shared with something else). Once you know the real root:

```bash
sudo cp -r /var/www/<old-root> /var/www/<old-root>.bak-$(date +%F)   # back up the old site first
```

Then either deploy into that same path (`./deploy/deploy.sh you@vm
/var/www/<old-root>`) or point `deploy/nginx/blactec.conf`'s `root` at a new
`/var/www/blactec-site` and swap the symlink in `sites-enabled` once the new
site is synced and verified — the second option is safer since the old site
stays live and reachable until you're ready to cut over, rather than being
overwritten mid-sync.

If certbot already issued a cert for this domain on this VM, `certbot
--nginx` in step 4 will detect and reuse it — no need to reissue.

## 1. VM (Compute Engine)

If you don't already have one:

```bash
gcloud compute instances create blactec-web \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --tags=http-server,https-server

gcloud compute firewall-rules create allow-http-https \
  --allow=tcp:80,tcp:443 --target-tags=http-server,https-server
```

Point your domain's DNS (`blactec.ug`, `www.blactec.ug`) A records at the VM's
external IP (`gcloud compute instances describe blactec-web --format='get(networkInterfaces[0].accessConfigs[0].natIP)'`).

## 2. One-time server setup (SSH into the VM)

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo mkdir -p /var/www/blactec-site
sudo chown $USER:$USER /var/www/blactec-site
```

## 3. Deploy the site files

From this repo, on your machine:

```bash
./deploy/deploy.sh youruser@<vm-external-ip>
```

This rsyncs everything the site actually needs (HTML, CSS, `dist/main.js`,
`assets/`, `robots.txt`, `sitemap.xml`) and skips dev-only files (`src/`,
`node_modules/`, `cloudflare-worker/`, the marketing-kit source assets, etc).
Re-run it any time you've changed the site — it only transfers diffs.

## 4. Wire up Nginx + TLS

Still on the VM:

```bash
sudo cp deploy/nginx/blactec.conf /etc/nginx/sites-available/blactec.conf
sudo ln -s /etc/nginx/sites-available/blactec.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d blactec.ug -d www.blactec.ug
```

Certbot edits the Nginx config in place to add the HTTPS server block and the
HTTP→HTTPS redirect, and sets up auto-renewal via a systemd timer — nothing
further to do for TLS after this.

### Clean URLs

`blactec.conf` serves every page at its extension-less path — `/hosting`
rather than `/hosting.html` — by falling back to `<uri>.html` on disk when
`<uri>` alone doesn't exist as a file. Every internal link, canonical tag, and
`sitemap.xml` entry in this repo already points at the clean form. Visiting
the old `*.html` URL directly (or `/index.html`) gets a 301 redirect to the
clean one, so there's a single canonical URL per page — nothing extra to set
up, this is just how the shipped config behaves once it's live.

## Redeploying after future changes

1. Edit `src/main.ts`, hand-mirror the change into `dist/main.js` (no local
   Node to run `tsc` — see the comment at the top of `src/main.ts`), bump the
   version in `package.json` if you touched `dist/main.js` or `styles.css` so
   the `?v=` cache-buster changes.
2. `./deploy/deploy.sh youruser@<vm-external-ip>`
3. Nothing to reload — Nginx serves the new files immediately, and the cache
   headers in `nginx/blactec.conf` mean HTML is always revalidated while
   versioned CSS/JS can cache hard.
