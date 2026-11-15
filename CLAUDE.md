# Suspension Explorer

Interactive car-suspension explorer: Python physics (numpy/scipy) behind a FastAPI endpoint,
vanilla JS front end (canvas animation + Plotly plots + sliders). Built for learning how springs,
dampers, tires, pitch and controllers behave. Keep it simple and readable; ask before adding features.

## Commands

```
uv run suspension                 # serve on http://127.0.0.1:8000 and open the browser
uv run suspension --port 8765 --no-browser
uv run pytest -q                  # ~15-40 s: the ODE tests are the slow part
uv run ruff check --fix . && uv run ruff format .
```

Python changes need a server restart. Files in `src/suspension/static/` are served live: reload the page.

## Layout

- `src/suspension/physics.py`: quarter-car (body + wheel), spring/damper/tire forces, skyhook damper,
  PID ride-height actuator, load disturbance, linear frequency response.
- `src/suspension/half.py`: half-car side view (heave + pitch, wheelbase delay, braking/accelerating).
  Each axle is a quarter-car scaled by its weight share (`scaled()`), so ζ and frequencies stay the same.
- `src/suspension/road.py`: road profiles (flat, step, bump, pothole, sine, random) as height vs distance.
- `src/suspension/server.py`: `POST /api/simulate` (the only endpoint) and the static files.
  Plotly's JS is served from the `plotly` Python package at `/plotly.min.js` (no CDN, works offline).
- `src/suspension/static/{index,app.js,style.css}`: the whole UI. `SLIDERS` in `app.js` defines every slider.
- `tests/`: physics sanity checks (not just "runs"): sag = m·g·(1/k + 1/kt), braking dives the nose,
  a tiny wheelbase reduces to two quarter-cars, the integral term removes sag, and so on.

## Conventions

- Physics is SI. Positions are measured from static ride height, positive up. Suspension travel
  = wheel − body, positive = compression. Pitch is positive nose UP.
- Sliders hold display units (kN/m, cm, km/h); `si` in `SLIDERS` converts to SI before the request.
  Server field names equal `Car` / `HalfCar` / `Road` field names.
- The damper, spring and controller equations are explained in the docstrings: keep them in step with the
  "How it works" text in `index.html` when behaviour changes.
- When a controller is on, the server also runs a passive baseline (same car, controllers off) and the UI
  draws it dashed. Adding a controller means adding it to `has_controller` and to the baseline `replace(...)`.
- The tire can lift off the road (tire force is clamped so total load >= 0); keep that when touching forces.

## Working with git

- The git repository root is the home directory (`C:\Users\P.Baetens`), not this folder. Stage and commit
  with a pathspec limited to this folder (`git add -- .` and `git commit -- .` from here) so nothing else is swept in.
- No Claude co-author or "Generated with" lines in commits or PRs.
- GitHub: https://github.com/phili-b/car_suspension_simulator (renamed from `car_suspesion_simulator`).
  To publish only this folder's history from the home-directory repo:
  `git subtree split --prefix=Code/car_suspension -b tmp-split`, then
  `git push git@github.com:phili-b/car_suspension_simulator.git tmp-split:main`, then delete `tmp-split`.
  Pushing needs the user's go-ahead each time.

## Deployment

Docker container behind Nginx Proxy Manager on an Intel NUC (`Dockerfile`, `docker-compose.yml`).
The image runs `suspension --host 0.0.0.0 --no-browser` on port 8000 as a non-root user.
The Docker files were written without Docker available locally, so they have not been built here: if
a build fails, fix the Dockerfile rather than the app. The app has no authentication: use an NPM access list.
