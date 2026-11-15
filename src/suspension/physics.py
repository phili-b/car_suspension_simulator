"""Quarter-car suspension model.

One corner of the car, two masses:

    body (sprung mass, ms)       <- what you sit on
       |  spring k  ||  damper c
    wheel (unsprung mass, mu)    <- wheel, tire, brake, hub
       |  tire spring kt
    road  z_road(t)

Positions are measured from static ride height, positive = up.
Suspension travel = z_wheel - z_body, positive = compression.
"""

from dataclasses import dataclass

import numpy as np
from scipy.integrate import solve_ivp

from .road import Road

G = 9.81
REF_TRAVEL = 0.05  # m, the travel at which `progression` is defined


@dataclass(frozen=True)
class Car:
    body_mass: float = 350.0  # kg, a quarter of the body
    wheel_mass: float = 40.0  # kg
    spring_rate: float = 30_000.0  # N/m
    damping_compression: float = 1_500.0  # N*s/m, damper closing
    damping_rebound: float = 3_000.0  # N*s/m, damper extending
    tire_rate: float = 200_000.0  # N/m
    progression: float = 0.0  # extra stiffness at REF_TRAVEL: 1.0 = twice as stiff
    skyhook_gain: float = 0.0  # N*s/m, 0 = ordinary passive damper
    damping_max: float = 6_000.0  # N*s/m, hardest the semi-active damper can get

    @property
    def damping_min(self) -> float:
        """Softest the semi-active damper gets: the lower of the two passive settings."""
        return min(self.damping_compression, self.damping_rebound)

    @property
    def static_tire_load(self) -> float:
        return (self.body_mass + self.wheel_mass) * G

    @property
    def critical_damping(self) -> float:
        """Damping that just stops the body from overshooting: c_crit = 2 sqrt(k ms)."""
        return 2 * np.sqrt(self.spring_rate * self.body_mass)


def spring_force(car: Car, travel):
    """Spring pushes body and wheel apart. Progressive: stiffer as it compresses further."""
    return car.spring_rate * travel * (1 + car.progression * (travel / REF_TRAVEL) ** 2)


def damper_force(car: Car, travel_rate, body_velocity=0.0):
    """Force of the damper on the body (+ = up).

    Passive: F = c * v, with different c for compression and rebound.

    Semi-active "skyhook" (skyhook_gain > 0): the ideal is a damper hooked to the sky that
    pushes against the body's ABSOLUTE velocity, F = -gain * v_body. A real damper can only
    resist the RELATIVE motion between body and wheel, so it can do this only when the two
    point the same way (v_body and travel_rate have opposite signs: body rising while the
    damper extends). Then the controller stiffens the damper to c = gain * |v_body| / |v_rel|,
    limited to [damping_min, damping_max]. Otherwise it goes as soft as it can.
    """
    c = np.where(travel_rate > 0, car.damping_compression, car.damping_rebound)
    if car.skyhook_gain > 0:
        wanted = car.skyhook_gain * np.abs(body_velocity) / np.maximum(np.abs(travel_rate), 1e-3)
        c = np.where(
            body_velocity * travel_rate < 0,
            np.clip(wanted, car.damping_min, car.damping_max),
            car.damping_min,
        )
    return c * travel_rate


def tire_force(car: Car, deflection):
    """Change in tire load from static. The tire can push on the road but never pull:
    when the total load reaches zero the wheel leaves the ground."""
    total = np.maximum(car.static_tire_load + car.tire_rate * deflection, 0.0)
    return total - car.static_tire_load


def characteristics(car: Car) -> dict:
    """Numbers that explain the behaviour before running anything."""
    k, kt, ms, mu = car.spring_rate, car.tire_rate, car.body_mass, car.wheel_mass
    ride_rate = k * kt / (k + kt)  # spring and tire in series
    c_crit = car.critical_damping
    return {
        "body_frequency": np.sqrt(ride_rate / ms) / (2 * np.pi),
        "wheel_frequency": np.sqrt((k + kt) / mu) / (2 * np.pi),
        "critical_damping": c_crit,
        "zeta_compression": car.damping_compression / c_crit,
        "zeta_rebound": car.damping_rebound / c_crit,
        "zeta_mean": (car.damping_compression + car.damping_rebound) / 2 / c_crit,
        "static_sag": ms * G / k,
        "static_tire_load": car.static_tire_load,
    }


def simulate(car: Car, road: Road, sample_rate: float = 200.0) -> dict:
    """Drive over the road and return time signals plus summary metrics."""
    duration = road.duration
    # Sample the road once on a fine grid; the solver interpolates (fast and exact enough).
    road_x = np.arange(0.0, road.speed * duration + 6.0, 0.01)
    road_z = road.height_at(road_x)

    def road_at(t):
        return np.interp(road.speed * t, road_x, road_z)

    def derivatives(t, y):
        z_body, v_body, z_wheel, v_wheel = y
        f_susp = spring_force(car, z_wheel - z_body) + damper_force(car, v_wheel - v_body, v_body)
        f_tire = tire_force(car, road_at(t) - z_wheel)
        return [v_body, f_susp / car.body_mass, v_wheel, (f_tire - f_susp) / car.wheel_mass]

    t = np.arange(0.0, duration, 1.0 / sample_rate)
    sol = solve_ivp(
        derivatives, (0.0, duration), [0, 0, 0, 0], t_eval=t, max_step=2e-3, rtol=1e-6, atol=1e-9
    )
    z_body, v_body, z_wheel, v_wheel = sol.y
    z_road = road_at(t)
    travel = z_wheel - z_body
    travel_rate = v_wheel - v_body
    f_susp = spring_force(car, travel) + damper_force(car, travel_rate, v_body)
    f_tire = tire_force(car, z_road - z_wheel)
    body_acc = f_susp / car.body_mass
    tire_load_pct = 100 * (car.static_tire_load + f_tire) / car.static_tire_load

    metrics = {
        "body_acc_rms": float(np.sqrt(np.mean(body_acc**2))),
        "body_acc_peak": float(np.max(np.abs(body_acc))),
        "max_compression": float(max(travel.max(), 0.0)),
        "max_extension": float(max(-travel.min(), 0.0)),
        "tire_load_min_pct": float(tire_load_pct.min()),
        "tire_load_rms_pct": float(np.sqrt(np.mean((tire_load_pct - 100) ** 2))),
        "airborne_pct": float(100 * np.mean(tire_load_pct <= 0)),
    }
    return {
        "t": t,
        "z_road": z_road,
        "z_body": z_body,
        "z_wheel": z_wheel,
        "travel": travel,
        "travel_rate": travel_rate,
        "body_acc": body_acc,
        "tire_load_pct": tire_load_pct,
        "road_x": road_x[::2],
        "road_z": road_z[::2],
        "metrics": metrics,
    }


def frequency_response(car: Car, freq: np.ndarray) -> dict:
    """How much of a sinusoidal road motion reaches the body and the wheel (linear model).

    Uses the mean of compression and rebound damping and ignores progression and lift-off.
    Gain 1 = moves exactly with the road; > 1 = amplified (resonance); < 1 = isolated.
    """
    s = 2j * np.pi * np.asarray(freq, dtype=float)
    k, kt, ms, mu = car.spring_rate, car.tire_rate, car.body_mass, car.wheel_mass
    c = (car.damping_compression + car.damping_rebound) / 2

    def gains(c):
        link = k + c * s  # spring + damper as one complex stiffness
        body_side = ms * s**2 + link
        wheel = kt / (mu * s**2 + link + kt - link**2 / body_side)
        body = link * wheel / body_side
        return body, wheel

    body, wheel = gains(c)
    return {
        "freq": np.asarray(freq),
        "body": np.abs(body),
        "wheel": np.abs(wheel),
        "travel": np.abs(wheel - body),
        "body_half_damping": np.abs(gains(c / 2)[0]),
        "body_double_damping": np.abs(gains(2 * c)[0]),
    }
