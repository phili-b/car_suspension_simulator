# Suspension Explorer

Interactive quarter-car model: see how springs, dampers, tires and masses shape ride and grip.

```
uv run suspension            # opens http://127.0.0.1:8000
uv run suspension --port 8100 --no-browser
```

- `src/suspension/physics.py`: quarter-car (body + wheel, spring, asymmetric damper, tire that can lift off)
- `src/suspension/half.py`: half-car side view with pitch, wheelbase delay, braking/accelerating
- `src/suspension/road.py`: road profiles (curb, bump, pothole, waves, rough road)
- `src/suspension/server.py`: FastAPI, `POST /api/simulate`
- `src/suspension/static/`: web page (canvas animation, Plotly plots)

Tests: `uv run pytest`
