import numpy as np
from fastapi.testclient import TestClient

from suspension.half import HalfCar, frequency_response_half, simulate_half
from suspension.physics import Car, simulate
from suspension.road import Road
from suspension.server import app


def test_flat_road_without_braking_stays_at_rest():
    out = simulate_half(HalfCar(), Road(kind="flat"))
    assert np.allclose(out["z_body"], 0) and np.allclose(out["pitch_deg"], 0)


def test_braking_dives_the_nose_and_loads_the_front():
    out = simulate_half(HalfCar(braking_g=0.5), Road(kind="flat"))
    assert out["metrics"]["pitch_peak_deg"] < -0.5  # nose down
    i = np.searchsorted(out["t"], 2.4)  # near the end of the braking pulse
    assert out["tire_load_front_pct"][i] > 105 > 95 > out["tire_load_rear_pct"][i]


def test_accelerating_squats_the_tail():
    out = simulate_half(HalfCar(braking_g=-0.3), Road(kind="flat"))
    assert out["metrics"]["pitch_peak_deg"] > 0.3  # nose up


def test_with_a_tiny_wheelbase_the_half_car_is_two_quarter_cars():
    road = Road(kind="step", height=0.05, speed=10)
    half = simulate_half(HalfCar(wheelbase=0.01, front_weight=0.5), road)
    quarter = simulate(Car(), road)
    n = min(half["t"].size, quarter["t"].size)
    assert np.allclose(half["z_body"][:n], quarter["z_body"][:n], atol=1e-3)


def test_a_bump_makes_the_car_pitch():
    out = simulate_half(HalfCar(), Road(kind="bump", height=0.05, speed=14))
    assert np.abs(out["pitch_deg"]).max() > 0.1


def test_slow_waves_just_lift_and_lower_the_body():
    fr = frequency_response_half(HalfCar(), np.array([0.01]), speed=14)
    assert np.isclose(fr["body"][0], 1.0, atol=1e-2)
    assert np.isclose(fr["nose"][0], 1.0, atol=1e-2)


def test_api_half_model():
    res = TestClient(app).post(
        "/api/simulate",
        json={"model": "half", "road": {"kind": "flat"}, "half": {"braking_g": 0.4}},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["model"] == "half"
    assert "pitch_frequency" in data["characteristics"]
    assert len(data["time"]["t"]) == len(data["time"]["pitch_deg"])
