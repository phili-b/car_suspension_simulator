# Deploying Suspension Explorer

Target: an Intel NUC running Linux (Debian or Ubuntu), with Nginx Proxy Manager (NPM) in front for
the domain name and HTTPS. Pick **A (Docker, recommended)** or **B (no Docker)**. The NPM setup in
section C is the same for both.

The app listens on port **8000**, serves the web page and one API call, keeps no data and needs no
database. It has **no login**: see "Protect it" in section C before exposing it to the internet.

> These instructions were written without a NUC to test them on. If a step fails, the troubleshooting
> list at the end covers the usual causes.

---

## A. With Docker (recommended)

**Why:** nothing gets installed on the NUC besides Docker, the Python and SciPy versions are pinned,
it restarts itself after a reboot, and updating is two commands.

### 1. Install Docker (once)

Follow https://docs.docker.com/engine/install/ for your distribution, then check:

```bash
docker --version
docker compose version
```

### 2. Get the code and start it

```bash
git clone https://github.com/phili-b/car_suspension_simulator
cd car_suspension_simulator
docker compose up -d --build
```

The first build takes a few minutes (it downloads Python and SciPy). Check that it runs:

```bash
docker compose ps                    # State: running (healthy)
curl -I http://localhost:8000/       # HTTP/1.1 200 OK
docker compose logs -f               # live logs, Ctrl+C to leave
```

### 3. How NPM reaches it

Choose one:

- **Published port (simplest):** the default `docker-compose.yml` publishes port 8000 on the NUC.
  In NPM, forward to the NUC's LAN IP on port 8000 (section C).
- **Shared Docker network (no published port):** keeps the app invisible outside Docker.
  1. Find NPM's network: `docker network ls` (often `npm_default` or `<folder>_default`).
  2. In `docker-compose.yml`, delete the `ports:` lines and uncomment the `networks:` blocks,
     setting `name:` to NPM's network.
  3. `docker compose up -d`. In NPM, forward to hostname `car-suspension`, port `8000`.

### 4. Update

```bash
cd car_suspension_simulator
git pull
docker compose up -d --build
```

### 5. Stop or remove

```bash
docker compose stop                  # stop, keep the container
docker compose down                  # remove the container
docker image rm car-suspension       # also remove the image
```

---

## B. Without Docker (a folder and a service)

**Why you might want this:** nothing to learn beyond Python, and updates are a `git pull`.
**Cost:** you maintain Python and the dependencies on the NUC yourself.

### 1. Install the tools (once)

```bash
sudo apt update && sudo apt install -y git curl
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Open a new shell afterwards so `uv` is on your `PATH`. uv also downloads the right Python version
by itself, so you don't need to install Python.

### 2. Get the code

```bash
sudo mkdir -p /opt/car-suspension && sudo chown "$USER": /opt/car-suspension
git clone https://github.com/phili-b/car_suspension_simulator /opt/car-suspension
cd /opt/car-suspension
uv sync --frozen --no-dev            # creates .venv with exactly the locked versions
```

Try it by hand first:

```bash
uv run suspension --host 0.0.0.0 --no-browser
# from another computer: http://<nuc-ip>:8000   (Ctrl+C to stop)
```

### 3. Run it as a service (starts on boot, restarts on crash)

Create `/etc/systemd/system/car-suspension.service` (use `sudo nano`), replacing `youruser`
with the account that owns `/opt/car-suspension`:

```ini
[Unit]
Description=Suspension Explorer
After=network.target

[Service]
User=youruser
WorkingDirectory=/opt/car-suspension
ExecStart=/opt/car-suspension/.venv/bin/suspension --host 0.0.0.0 --no-browser
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now car-suspension
systemctl status car-suspension      # active (running)
journalctl -u car-suspension -f      # live logs
curl -I http://localhost:8000/       # HTTP/1.1 200 OK
```

`--host 0.0.0.0` is needed because NPM, when it runs in Docker, cannot reach the NUC's `127.0.0.1`.
If NPM is installed directly on the NUC (not in Docker), you can use `--host 127.0.0.1` instead and
forward NPM to `127.0.0.1`. That keeps the port private.

### 4. Update

```bash
cd /opt/car-suspension
git pull
uv sync --frozen --no-dev
sudo systemctl restart car-suspension
```

### 5. Remove

```bash
sudo systemctl disable --now car-suspension
sudo rm /etc/systemd/system/car-suspension.service
sudo rm -r /opt/car-suspension
```

---

## C. Nginx Proxy Manager (both options)

### 1. Add the proxy host

NPM web interface, **Hosts → Proxy Hosts → Add Proxy Host**:

| Field | Value |
|---|---|
| Domain Names | your name, e.g. `suspension.example.com` (its DNS record must point at your public IP, or at the NUC for LAN-only use) |
| Scheme | `http` |
| Forward Hostname / IP | the NUC's LAN IP (published port, or no Docker), or `car-suspension` (shared Docker network) |
| Forward Port | `8000` |
| Block Common Exploits | on |
| Websockets Support | not needed |

On the **SSL** tab choose *Request a new SSL Certificate* (Let's Encrypt), then turn on
**Force SSL** and **HTTP/2**. Save.

### 2. Protect it

The app has no login. Anyone who can reach the address can use it, and each slider move costs
about a second of CPU on the NUC. If it is reachable from the internet, add a password in NPM:

1. **Access Lists → Add Access List**, give it a name, add a username and password under *Authorization*.
2. Edit the Proxy Host, set **Access List** to it, save.

For LAN-only use, an access list with *Allow 192.168.0.0/16* (your network range) and *Deny all*
under *Rules* is enough.

### 3. Check

Open `https://suspension.example.com`. You should see the page, and moving a slider should redraw
the plots within a second or two.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| NPM shows **502 Bad Gateway** | NPM can't reach the app. Docker: `docker compose ps` must say running; on a shared network the hostname must be `car-suspension`. No Docker: `systemctl status car-suspension`; and use the NUC's LAN IP, not `127.0.0.1`, when NPM runs in Docker. |
| `curl localhost:8000` works on the NUC but not from NPM | Wrong forward IP, or a firewall blocks 8000 (`sudo ufw allow 8000/tcp`, or limit it to NPM's address). |
| Page loads but plots are empty | Open the browser console. `plotly.min.js` is served by the app itself, so a blocked `/plotly.min.js` usually means the proxy is filtering it. |
| Old page after an update | Hard refresh (Ctrl+Shift+R). The app sends `Cache-Control: no-cache`, but NPM or Cloudflare may add their own caching. |
| `port is already allocated` | Something else uses 8000. Change the left number in `ports: - "8000:8000"` (e.g. `"8100:8000"`) and use that port in NPM. |
| Docker build fails | Send the last 20 lines of the build output. The first suspects are the base image tag and the `uv` install step in the `Dockerfile`. |
| Slow response | Each request runs a short simulation; one or two seconds on a NUC is normal. Many people at once will queue. |
