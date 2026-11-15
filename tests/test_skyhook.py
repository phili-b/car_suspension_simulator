import numpy as np
from fastapi.testclient import TestClient

from suspension.half import HalfCar, simulate_half
from suspension.physics import Car, damper_force, simulate
from suspension.road import Road
from suspension.server import app

SOFT = dict(damping_compression=800.0, damping_rebound=800.0)


def test_gain_zero_is_the_ordinary_passive_damper():
    car = Car()
    v = np.array([-0.3, 0.2])
    assert np.allclose(damper_force(car, v, np.array([0.5, 0.5])), damper_force(car, v))


def test_skyhook_only_stiffens_when_it_can_push_against_the_body():
    car = Car(skyhook_gain=4000.0, **SOFT)
    # body rising (+) while the damper extends (-): the damper can resist the body -> stiff
    stiff = damper_force(car, -0.2, 0.2)
    # body rising while the damper compresses: it would push the body up -> stay soft
    soft = damper_force(car, 0.2, 0.2)
    assert abs(stiff) > abs(soft)
    assert np.isclose(soft, car.damping_min * 0.2)
    assert abs(stiff) <= car.damping_max * 0.2 + 1e-9


def test_damper_never_pushes_the_wheel_and_body_together_or_apart():
    """Semi-active means the damper always resists relative motion (force and rate agree)."""
    car = Car(skyhook_gain=8000.0, **SOFT)
    for body_v in (-0.5, -0.1, 0.1, 0.5):
        for rate in (-0.4, -0.05, 0.05, 0.4):
            assert damper_force(car, rate, body_v) * rate >= 0


def test_skyhook_calms_the_body_on_a_bump():
    road = Road(kind="bump", height=0.06, speed=14)
    passive = simulate(Car(**SOFT), road)
    sky = simulate(Car(skyhook_gain=6000.0, **SOFT), road)
    assert sky["metrics"]["body_acc_rms"] < passive["metrics"]["body_acc_rms"]


def test_half_car_accepts_skyhook():
    out = simulate_half(HalfCar(car=Car(skyhook_gain=5000.0, **SOFT)), Road(kind="bump"))
    assert np.isfinite(out["pitch_deg"]).all()


def test_api_returns_a_passive_baseline_only_when_the_controller_is_on():
    client = TestClient(app)
    off = client.post("/api/simulate", json={}).json()
    on = client.post("/api/simulate", json={"car": {"skyhook_gain": 5000}}).json()
    assert "baseline" not in off
    assert len(on["baseline"]["z_body"]) == len(on["time"]["z_body"])
