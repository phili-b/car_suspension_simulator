# 🚗 Suspension Explorer

**Drive a car over a bump and watch the physics happen.**

Springs, dampers, tires, pitch and even active controllers, in an interactive page you can poke at.
Drag a slider, see the car bounce, read the plots, and finally understand why a stiff car feels harsh
and a soft one feels floaty.

Python does the physics (real differential equations, not a cartoon). The browser draws it.

---
<img width="1592" height="889" alt="image" src="https://github.com/user-attachments/assets/eeb79188-74fa-4611-88fe-8ec022f3c2b3" />

## ✨ What you can play with

| | |
|---|---|
| **Two models** | *Quarter-car*: one corner, body on a spring and damper, wheel on a tire. *Half-car*: a side view with **pitch**, so you get nose dive when braking and tail squat when accelerating. |
| **Six roads** | Smooth, curb, bump, pothole, waves (tune the wavelength to hit resonance) and a rough random road. |
| **Real parts** | Different damping for compression and rebound, progressive springs, and a tire that can leave the ground. |
| **Live readouts** | Natural frequencies, damping ratio ζ, comfort (body acceleration), grip (tire load) and travel used. |
| **Plots** | Motion, pitch, acceleration and tire load over time, plus a frequency response with the resonance peaks marked. Click a plot to jump the animation to that moment. |
| **Active controls** | A **skyhook** semi-active damper and a **ride-height PID** controller, each drawn against a dashed passive baseline so you can see what it buys you. |

## 🚀 Run it

You need [uv](https://docs.astral.sh/uv/).

```
uv run suspension
```

That opens http://127.0.0.1:8000. Other options: `--port 8100`, `--no-browser`.

## 🐳 Deploy with Docker

```
docker compose up -d --build     # builds the image and starts it on port 8000
```

Then point Nginx Proxy Manager at `<host>:8000` (a Proxy Host, scheme `http`). The app has no login,
so add an NPM access list if it is reachable from outside your network.

Step-by-step instructions, with Docker **and** without it (a folder plus a systemd service),
including the Nginx Proxy Manager settings and troubleshooting, are in [DEPLOY.md](DEPLOY.md).

## 🧪 Things to try

1. **Bounce at the wrong frequency.** Pick *Waves* and sweep the wavelength until the body wobbles wildly: that is resonance. Raise the damping and watch the peak shrink.
2. **Comfort vs grip.** Use the ζ buttons (0.1 to 1.0). Very soft damping rings, very stiff damping hits you hard, and somewhere in between is the sweet spot.
3. **Pothole, with a twist.** Set rebound damping very high: the wheel can't drop in fast enough and the tire goes light.
4. **Brake hard in half-car mode.** The nose dips, the front tires load up and the rears lighten. Raise the CG height and it gets worse.
5. **Hit a bump at the wrong speed.** In half-car mode the rear wheel meets the bump later; at certain speeds that rocks the car instead of lifting it.
6. **Skyhook.** Soften the damper, switch the skyhook on and watch the ringing disappear.
7. **Add 100 kg.** A passive spring just sags. Turn up P and it sags less. Turn up **I** and it climbs all the way back. That is the I in PID.

## 🧠 How it works (short version)

```
          body (sprung mass)
             │   │
        spring   damper        <- force from position (P) and from speed (D)
             │   │
          wheel (unsprung mass)
             │
        tire (a spring too)
             │
           road
```

Each corner is two masses linked by springs and dampers. The equations are integrated with SciPy,
and the browser gets back time signals plus a linear frequency response. In the half-car, each axle is
a quarter-car scaled to carry its share of the weight, so the same tuning gives the same ζ and frequency.

A passive suspension is already a **PD controller**: the spring is P, the damper is D. The missing **I**
is why a loaded car sags. The "How it works" section on the page goes through all of this with the formulas.

## 🗂 Project layout

```
src/suspension/
  physics.py   quarter-car, forces, skyhook, PID actuator, frequency response
  half.py      half-car with pitch, wheelbase delay, braking
  road.py      road profiles
  server.py    FastAPI: POST /api/simulate + static files
  static/      the web page (canvas, Plotly, sliders)
tests/         physics sanity checks
```

## ✅ Tests

```
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
```

The tests check the physics, not just that it runs: the sag under load matches `m·g·(1/k + 1/kt)`,
braking dives the nose, a tiny wheelbase reduces to two quarter-cars, and the integral term removes the sag.

## 📝 Notes

- The model is 2D and linear in the small, with a few honest nonlinearities (asymmetric damper,
  progressive spring, tire lift-off). It ignores roll, anti-dive geometry and tire slip.
- The active controllers are ideal: no actuator delay or force limit.
- The server has no login. Locally it listens on localhost only (`--host 0.0.0.0` opens it up, which the
  Docker image does). Put authentication in front of it before exposing it.
