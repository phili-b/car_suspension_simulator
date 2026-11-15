"""Half-car: side view of the car with heave AND pitch.

              nose (front)  ->  direction of travel
        body  [=====o=====]        o = centre of gravity (CG), cg_height above the axle line
               |  a  |  b |
       front axle      rear axle   each axle is a quarter-car, scaled to carry its share

Positions are from static ride height. Pitch theta is positive nose UP, so braking
(weight moves forward, nose dips) gives a negative pitch.
"""

from dataclasses import dataclass, field, replace

import numpy as np
from scipy.integrate import solve_ivp
from scipy.linalg import eigh

from .physics import Car, G, characteristics, damper_force, spring_force, tire_force
from .road import Road

BRAKE_START = 0.5  # s
BRAKE_END = 2.5  # s
BRAKE_EDGE = 0.3  # s, the pedal is not a switch


def scaled(car: Car, w: float) -> Car:
    """The same suspension tuning, carrying w times the load (all masses and rates x w)."""
    return replace(
        car,
        body_mass=car.body_mass * w,
        wheel_mass=car.wheel_mass * w,
        spring_rate=car.spring_rate * w,
        damping_compression=car.damping_compression * w,
        damping_rebound=car.damping_rebound * w,
        tire_rate=car.tire_rate * w,
    )


@dataclass(frozen=True)
class HalfCar:
    """`car` holds the per-corner values (like the quarter-car), the rest is geometry."""

    car: Car = field(default_factory=Car)
    wheelbase: float = 2.7  # m
    front_weight: float = 0.55  # fraction of the weight on the front axle
    cg_height: float = 0.5  # m above the axles
    gyration: float = 1.1  # m, radius of gyration: pitch inertia I = M r^2
    braking_g: float = 0.0  # +: braking, -: accelerating

    @property
    def a(self) -> float:  # CG to front axle
        return self.wheelbase * (1 - self.front_weight)

    @property
    def b(self) -> float:  # CG to rear axle
        return self.wheelbase * self.front_weight

    @property
    def mass(self) -> float:  # two corners of body: the side view carries half the car
        return 2 * self.car.body_mass

    @property
    def inertia(self) -> float:
        return self.mass * self.gyration**2

    @property
    def front(self) -> Car:
        """Front axle, scaled by its weight share so it keeps the same ζ and frequency."""
        return scaled(self.car, 2 * self.front_weight)

    @property
    def rear(self) -> Car:
        return scaled(self.car, 2 * (1 - self.front_weight))


def _ramp(x):
    x = np.clip(x, 0.0, 1.0)
    return 0.5 * (1 - np.cos(np.pi * x))


def braking_profile(t):
    """0 -> 1 -> 0 pulse: the driver brakes (or accelerates) from BRAKE_START to BRAKE_END."""
    return _ramp((t - BRAKE_START) / BRAKE_EDGE) - _ramp((t - BRAKE_END) / BRAKE_EDGE)


def _linear_matrices(half: HalfCar, damping_scale: float = 1.0):
    """M, C, K, Kt for the linear half-car. q = [heave, pitch, front wheel, rear wheel]."""
    f, r = half.front, half.rear
    D = np.array([[-1.0, -half.a, 1.0, 0.0], [-1.0, half.b, 0.0, 1.0]])  # q -> travel
    k = np.diag([f.spring_rate, r.spring_rate])
    c = damping_scale * np.diag(
        [
            (f.damping_compression + f.damping_rebound) / 2,
            (r.damping_compression + r.damping_rebound) / 2,
        ]
    )
    kt = np.diag([0.0, 0.0, f.tire_rate, r.tire_rate])
    M = np.diag([half.mass, half.inertia, f.wheel_mass, r.wheel_mass])
    return M, D.T @ c @ D, D.T @ k @ D + kt, kt


def characteristics_half(half: HalfCar) -> dict:
    out = characteristics(half.car)
    M, _, K, _ = _linear_matrices(half)
    values, vectors = eigh(K, M)
    freqs = np.sqrt(values) / (2 * np.pi)
    # Which of the two body modes is mostly heave and which mostly pitch?
    heave = vectors[0, :2] ** 2 / (vectors[0, :2] ** 2 + (half.gyration * vectors[1, :2]) ** 2)
    bounce, pitch = (0, 1) if heave[0] >= heave[1] else (1, 0)
    out["body_frequency"] = freqs[bounce]
    out["pitch_frequency"] = freqs[pitch]
    out["wheel_frequency"] = freqs[2:].mean()
    return out


def simulate_half(half: HalfCar, road: Road, sample_rate: float = 200.0) -> dict:
    """Drive over the road (rear wheel meets it later) and optionally brake or accelerate."""
    front, rear = half.front, half.rear
    a, b, L, h = half.a, half.b, half.wheelbase, half.cg_height
    M, inertia = half.mass, half.inertia

    duration = road.duration + L / road.speed
    if half.braking_g != 0:
        duration = max(duration, BRAKE_END + 2.5)
    road_x = np.arange(0.0, road.speed * duration + 6.0, 0.01)
    road_z = road.height_at(road_x)

    def road_front(t):
        return np.interp(road.speed * t, road_x, road_z)

    def road_rear(t):
        return np.interp(road.speed * t - L, road_x, road_z)

    def forces(t, y):
        z, vz, th, vth, zf, vf, zr, vr = y
        tf, tr = zf - (z + a * th), zr - (z - b * th)  # travel, + = compressed
        vtf, vtr = vf - (vz + a * vth), vr - (vz - b * vth)
        Ff = spring_force(front, tf) + damper_force(front, vtf)  # force on body, + = up
        Fr = spring_force(rear, tr) + damper_force(rear, vtr)
        Tf = tire_force(front, road_front(t) - zf)
        Tr = tire_force(rear, road_rear(t) - zr)
        return Ff, Fr, Tf, Tr, tf, tr

    def derivatives(t, y):
        Ff, Fr, Tf, Tr, _, _ = forces(t, y)
        # Braking: the car's inertia pushes forward at the CG, above the axle line,
        # which tips the nose down (negative pitch moment).
        decel = half.braking_g * G * braking_profile(t)
        pitch_moment = a * Ff - b * Fr - M * decel * h
        return [
            y[1],
            (Ff + Fr) / M,
            y[3],
            pitch_moment / inertia,
            y[5],
            (Tf - Ff) / front.wheel_mass,
            y[7],
            (Tr - Fr) / rear.wheel_mass,
        ]

    t = np.arange(0.0, duration, 1.0 / sample_rate)
    sol = solve_ivp(
        derivatives, (0.0, duration), np.zeros(8), t_eval=t, max_step=2e-3, rtol=1e-6, atol=1e-9
    )
    z, vz, th, vth, zf, vf, zr, vr = sol.y
    Ff, Fr, Tf, Tr, tf, tr = (np.empty_like(t) for _ in range(6))
    for i in range(t.size):
        Ff[i], Fr[i], Tf[i], Tr[i], tf[i], tr[i] = forces(t[i], sol.y[:, i])
    body_acc = (Ff + Fr) / M
    load_f = 100 * (front.static_tire_load + Tf) / front.static_tire_load
    load_r = 100 * (rear.static_tire_load + Tr) / rear.static_tire_load
    pitch_deg = np.degrees(th)

    metrics = {
        "body_acc_rms": float(np.sqrt(np.mean(body_acc**2))),
        "body_acc_peak": float(np.max(np.abs(body_acc))),
        "max_compression_front": float(max(tf.max(), 0.0)),
        "max_compression_rear": float(max(tr.max(), 0.0)),
        "max_extension_front": float(max(-tf.min(), 0.0)),
        "max_extension_rear": float(max(-tr.min(), 0.0)),
        "tire_load_min_pct": float(min(load_f.min(), load_r.min())),
        "airborne_pct": float(100 * np.mean((load_f <= 0) | (load_r <= 0))),
        "pitch_peak_deg": float(pitch_deg[np.argmax(np.abs(pitch_deg))]),
    }
    return {
        "t": t,
        "z_body": z,
        "z_nose": z + a * th,
        "z_tail": z - b * th,
        "pitch_deg": pitch_deg,
        "z_wheel_front": zf,
        "z_wheel_rear": zr,
        "z_road_front": road_front(t),
        "z_road_rear": road_rear(t),
        "travel_front": tf,
        "travel_rear": tr,
        "travel_rate_front": vf - (vz + a * vth),
        "travel_rate_rear": vr - (vz - b * vth),
        "body_acc": body_acc,
        "tire_load_front_pct": load_f,
        "tire_load_rear_pct": load_r,
        "road_x": road_x[::2],
        "road_z": road_z[::2],
        "geometry": {"a": a, "b": b, "wheelbase": L, "cg_height": h},
        "metrics": metrics,
    }


def frequency_response_half(half: HalfCar, freq: np.ndarray, speed: float) -> dict:
    """Gain from a sinusoidal road to heave and to the nose and tail of the body (linear).

    The front wheel meets the road first; the rear meets the same wave L/speed later,
    so at some frequencies the two ends are pushed in opposite directions: that is pitch.
    """
    omega = 2 * np.pi * np.asarray(freq, dtype=float)
    a, b, L = half.a, half.b, half.wheelbase

    def solve(damping_scale):
        M, C, K, Kt = _linear_matrices(half, damping_scale)
        A = -(omega**2)[:, None, None] * M + 1j * omega[:, None, None] * C + K
        rhs = np.zeros((omega.size, 4), dtype=complex)
        rhs[:, 2] = Kt[2, 2]
        rhs[:, 3] = Kt[3, 3] * np.exp(-1j * omega * L / speed)
        return np.linalg.solve(A, rhs[..., None])[..., 0]

    q = solve(1.0)
    return {
        "freq": np.asarray(freq),
        "body": np.abs(q[:, 0]),
        "nose": np.abs(q[:, 0] + a * q[:, 1]),
        "tail": np.abs(q[:, 0] - b * q[:, 1]),
        "wheel": np.abs(q[:, 2]),
        "body_half_damping": np.abs(solve(0.5)[:, 0]),
        "body_double_damping": np.abs(solve(2.0)[:, 0]),
    }
