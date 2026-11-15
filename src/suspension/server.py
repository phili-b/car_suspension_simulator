"""FastAPI app: one endpoint that runs the physics, plus the static web page."""

from dataclasses import replace
from pathlib import Path
from typing import Literal

import numpy as np
import plotly
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .half import HalfCar, characteristics_half, frequency_response_half, simulate_half
from .physics import Car, characteristics, frequency_response, simulate
from .road import Road, RoadKind

STATIC = Path(__file__).parent / "static"


class CarIn(BaseModel):
    body_mass: float = Field(350.0, gt=0)
    wheel_mass: float = Field(40.0, gt=0)
    spring_rate: float = Field(30_000.0, gt=0)
    damping_compression: float = Field(1_500.0, ge=0)
    damping_rebound: float = Field(3_000.0, ge=0)
    tire_rate: float = Field(200_000.0, gt=0)
    progression: float = Field(0.0, ge=0)
    skyhook_gain: float = Field(0.0, ge=0)
    damping_max: float = Field(6_000.0, gt=0)
    pid_kp: float = Field(0.0, ge=0)
    pid_ki: float = Field(0.0, ge=0)
    pid_kd: float = Field(0.0, ge=0)
    extra_load: float = Field(0.0, ge=0)


class RoadIn(BaseModel):
    kind: RoadKind = "bump"
    height: float = Field(0.05, ge=0)
    speed: float = Field(14.0, gt=0)
    wavelength: float = Field(8.0, gt=0)


class HalfIn(BaseModel):
    wheelbase: float = Field(2.7, gt=0.1)
    front_weight: float = Field(0.55, gt=0.1, lt=0.9)
    cg_height: float = Field(0.5, ge=0)
    gyration: float = Field(1.1, gt=0.1)
    braking_g: float = Field(0.0, ge=-1.5, le=1.5)


class SimulateRequest(BaseModel):
    model: Literal["quarter", "half"] = "quarter"
    car: CarIn = CarIn()
    half: HalfIn = HalfIn()
    road: RoadIn = RoadIn()


def _jsonable(value):
    if isinstance(value, np.ndarray):
        return np.round(value, 6).tolist()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, np.floating):
        return float(value)
    return value


app = FastAPI(title="Car suspension explorer")


@app.post("/api/simulate")
def api_simulate(req: SimulateRequest) -> dict:
    car = Car(**req.car.model_dump())
    road = Road(**req.road.model_dump())
    freq = np.logspace(np.log10(0.2), np.log10(40), 400)
    # same car (and same extra load) with every controller switched off
    passive = replace(car, skyhook_gain=0.0, pid_kp=0.0, pid_ki=0.0, pid_kd=0.0)
    if req.model == "half":
        half = HalfCar(car=car, **req.half.model_dump())
        result = {
            "characteristics": characteristics_half(half),
            "time": simulate_half(half, road),
            "frequency": frequency_response_half(half, freq, road.speed),
        }
        baseline = lambda: simulate_half(replace(half, car=passive), road)  # noqa: E731
    else:
        result = {
            "characteristics": characteristics(car),
            "time": simulate(car, road),
            "frequency": frequency_response(car, freq),
        }
        baseline = lambda: simulate(passive, road)  # noqa: E731
    if car.has_controller:
        # Passive comparison: same springs and damper settings, no controller.
        base = baseline()
        result["baseline"] = {k: base[k] for k in ("z_body", "body_acc", "metrics")}
        if req.model == "half":
            result["baseline"]["pitch_deg"] = base["pitch_deg"]
    return _jsonable({"model": req.model, **result, "input_frequency": road.input_frequency})


@app.get("/plotly.min.js", include_in_schema=False)
def plotly_js() -> FileResponse:
    return FileResponse(Path(plotly.__file__).parent / "package_data" / "plotly.min.js")


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
