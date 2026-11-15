"""Road profiles: road height as a function of distance travelled.

The car drives at constant speed, so the road becomes a time signal
z_road(t) = profile(speed * t) that pushes on the tire from below.
"""

from dataclasses import dataclass
from typing import Literal

import numpy as np

RoadKind = Literal["flat", "step", "bump", "pothole", "sine", "random"]

START = 3.0  # m, flat road before the first feature
SETTLE = 3.0  # s, time to watch the car settle after a single event
BUMP_LENGTH = 0.6  # m
POTHOLE_LENGTH = 0.8  # m
EDGE = 0.05  # m, an edge is smoothed over this length (the tire is not a point)
PERIODIC_DURATION = 6.0  # s, for sine and random roads
FLAT_DURATION = 5.0  # s, smooth road (for watching braking and accelerating)


def _ramp(u: np.ndarray) -> np.ndarray:
    """Smooth 0 -> 1 as u goes 0 -> 1 (half cosine)."""
    u = np.clip(u, 0.0, 1.0)
    return 0.5 * (1.0 - np.cos(np.pi * u))


@dataclass(frozen=True)
class Road:
    kind: RoadKind = "bump"
    height: float = 0.05  # m: step/bump height, pothole depth, sine amplitude, random scale
    speed: float = 14.0  # m/s
    wavelength: float = 8.0  # m, sine road only
    seed: int = 1  # random road only

    @property
    def duration(self) -> float:
        if self.kind in ("sine", "random"):
            return PERIODIC_DURATION
        if self.kind == "flat":
            return FLAT_DURATION
        return (START + 1.0) / self.speed + SETTLE

    @property
    def input_frequency(self) -> float | None:
        """Excitation frequency in Hz for the sine road (speed / wavelength)."""
        return self.speed / self.wavelength if self.kind == "sine" else None

    def height_at(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=float)
        d = x - START
        h = self.height
        match self.kind:
            case "flat":
                return np.zeros_like(x)
            case "step":
                return h * _ramp(d / EDGE)
            case "bump":
                inside = (d >= 0) & (d <= BUMP_LENGTH)
                return np.where(inside, h * 0.5 * (1 - np.cos(2 * np.pi * d / BUMP_LENGTH)), 0.0)
            case "pothole":
                return -h * (_ramp(d / EDGE) - _ramp((d - POTHOLE_LENGTH) / EDGE))
            case "sine":
                return np.where(d > 0, h * np.sin(2 * np.pi * d / self.wavelength), 0.0)
            case "random":
                return self._random(x)
        raise ValueError(f"unknown road kind {self.kind!r}")

    def _random(self, x: np.ndarray) -> np.ndarray:
        """Rough road: many sine waves, long waves larger than short ones.

        Amplitudes follow a road spectrum that falls as 1/n^2 (n = cycles per metre),
        the shape used by the ISO 8608 road roughness classes. Scaled to RMS = height / 2.
        """
        rng = np.random.default_rng(self.seed)
        n = np.logspace(np.log10(0.05), np.log10(5.0), 150)  # cycles per metre
        amplitude = n**-0.5  # sqrt(PSD * dn) with PSD ~ n^-2 and dn ~ n on a log grid
        phase = rng.uniform(0, 2 * np.pi, n.size)
        z = (amplitude * np.sin(2 * np.pi * np.outer(x, n) + phase)).sum(axis=1)
        rms = np.sqrt((amplitude**2).sum() / 2)
        return (self.height / 2) * (z / rms) * _ramp(x / START)
