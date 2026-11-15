import numpy as np
from fastapi.testclient import TestClient

from suspension.physics import Car, characteristics, frequency_response, simulate
from suspension.road import Road
from suspension.server import app


def test_flat_road_stays_at_rest():
    out = simulate(Car(), Road(kind="bump", height=0.0))
    assert np.allclose(out["z_body"], 0) and np.allclose(out["z_wheel"], 0)


def test_step_settles_at_the_new_height():
    out = simulate(Car(), Road(kind="step", height=0.05, speed=10))
    assert abs(out["z_body"][-1] - 0.05) < 2e-3
    assert abs(out["z_wheel"][-1] - 0.05) < 2e-3


def test_more_damping_means_less_overshoot():
    road = Road(kind="step", height=0.05, speed=10)
    soft = simulate(Car(damping_compression=300, damping_rebound=300), road)
    firm = simulate(Car(damping_compression=4000, damping_rebound=4000), road)
    assert soft["z_body"].max() > firm["z_body"].max()


def test_tire_never_pulls_on_the_road():
    out = simulate(Car(), Road(kind="bump", height=0.15, speed=40))
    assert out["tire_load_pct"].min() >= 0
    assert out["metrics"]["airborne_pct"] > 0


def test_critical_damping_gives_zeta_one():
    car = Car()
    c = car.critical_damping
    ch = characteristics(Car(damping_compression=c, damping_rebound=c))
    assert np.isclose(ch["zeta_mean"], 1.0)


def test_frequency_response_follows_road_slowly_and_filters_fast():
    fr = frequency_response(Car(), np.array([0.01, 1.2, 30.0]))
    assert np.isclose(fr["body"][0], 1.0, atol=1e-3)
    assert fr["body"][1] > 1.0  # resonance amplifies
    assert fr["body"][2] < 0.1  # isolation


def test_api_returns_all_parts():
    res = TestClient(app).post("/api/simulate", json={"road": {"kind": "random"}})
    assert res.status_code == 200
    data = res.json()
    assert {"characteristics", "time", "frequency", "input_frequency"} <= data.keys()
    assert len(data["time"]["t"]) == len(data["time"]["z_body"])
