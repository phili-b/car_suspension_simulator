import numpy as np
from fastapi.testclient import TestClient

from suspension.half import HalfCar, simulate_half
from suspension.physics import Car, G, simulate
from suspension.road import Road
from suspension.server import app

FLAT = Road(kind="flat")
LOAD = 100.0  # kg


def final_height(**gains):
    return simulate(Car(extra_load=LOAD, **gains), FLAT)["metrics"]["final_height"]


def test_without_a_controller_a_load_makes_the_car_sag():
    car = Car()
    expected = -LOAD * G * (1 / car.spring_rate + 1 / car.tire_rate)  # spring and tire in series
    assert np.isclose(final_height(), expected, atol=2e-3)


def test_no_load_and_no_controller_changes_nothing():
    out = simulate(Car(), FLAT)
    assert np.allclose(out["z_body"], 0)


def test_p_alone_reduces_the_sag_but_cannot_remove_it():
    passive, p_only = abs(final_height()), abs(final_height(pid_kp=30_000.0, pid_kd=2_000.0))
    assert 0.002 < p_only < passive


def test_the_integral_term_removes_it():
    with_i = abs(final_height(pid_kp=30_000.0, pid_ki=80_000.0, pid_kd=2_000.0))
    assert with_i < 0.002


def test_half_car_also_levels_itself_under_a_load():
    sag = simulate_half(HalfCar(car=Car(extra_load=LOAD)), FLAT)["metrics"]["final_height"]
    car = Car(extra_load=LOAD, pid_kp=30_000.0, pid_ki=80_000.0, pid_kd=2_000.0)
    fixed = simulate_half(HalfCar(car=car), FLAT)["metrics"]["final_height"]
    assert sag < -0.02 and abs(fixed) < 0.003


def test_api_baseline_keeps_the_load_but_drops_the_controller():
    body = {
        "road": {"kind": "flat"},
        "car": {"extra_load": LOAD, "pid_kp": 30_000, "pid_ki": 80_000},
    }
    data = TestClient(app).post("/api/simulate", json=body).json()
    assert abs(data["time"]["metrics"]["final_height"]) < abs(
        data["baseline"]["metrics"]["final_height"]
    )
    assert data["baseline"]["metrics"]["final_height"] < -0.02
