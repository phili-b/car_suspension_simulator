// Suspension explorer frontend: sliders -> /api/simulate -> animation + plots.
// Two models: "quarter" (one corner, heave only) and "half" (side view, heave + pitch).

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = (id) => document.getElementById(id);

// Slider values are kept in display units; `si` converts to SI for the server.
const SLIDERS = [
  { group: "road", key: "height", label: "Height / depth", min: 1, max: 15, step: 0.5, value: 5, unit: "cm", si: 0.01,
    hint: "Step or bump height, pothole depth, wave amplitude, roughness." },
  { group: "road", key: "speed", label: "Speed", min: 10, max: 150, step: 5, value: 50, unit: "km/h", si: 1 / 3.6,
    hint: "Faster: the bump is over sooner, so it's a sharper hit." },
  { group: "road", key: "wavelength", label: "Wavelength", min: 1, max: 40, step: 0.5, value: 8, unit: "m", si: 1,
    hint: "Waves only. Input frequency = speed / wavelength.", only: "sine" },
  { group: "car", key: "body_mass", label: "Body mass (sprung)", min: 150, max: 600, step: 10, value: 350, unit: "kg", si: 1,
    hint: "A quarter of the body. Heavier = lower bounce frequency." },
  { group: "car", key: "wheel_mass", label: "Wheel mass (unsprung)", min: 15, max: 80, step: 1, value: 40, unit: "kg", si: 1,
    hint: "Wheel, tire, brake, hub. Lighter wheels keep grip better." },
  { group: "spring", key: "spring_rate", label: "Spring rate k", min: 10, max: 120, step: 1, value: 30, unit: "kN/m", si: 1000,
    hint: "Force per metre of compression. Stiffer = firmer, faster bounce." },
  { group: "spring", key: "progression", label: "Progression", min: 0, max: 3, step: 0.1, value: 0, unit: "×", si: 1,
    hint: "Extra stiffness at 5 cm of travel. 1 = twice as stiff there." },
  { group: "spring", key: "tire_rate", label: "Tire stiffness kt", min: 100, max: 400, step: 10, value: 200, unit: "kN/m", si: 1000,
    hint: "The tire is a spring too, ~5–10× stiffer. Tire pressure changes it." },
  { group: "damper", key: "damping_compression", label: "Compression damping", min: 0.1, max: 8, step: 0.1, value: 1.5, unit: "kN·s/m", si: 1000,
    hint: "Force per m/s while the wheel moves up into the car." },
  { group: "damper", key: "damping_rebound", label: "Rebound damping", min: 0.1, max: 8, step: 0.1, value: 3.0, unit: "kN·s/m", si: 1000,
    hint: "Force per m/s while extending. Usually higher than compression." },
  { group: "control", key: "skyhook_gain", label: "Skyhook gain", min: 0, max: 20, step: 0.5, value: 0, unit: "kN·s/m", si: 1000,
    hint: "0 = ordinary damper. Above 0 the damper is soft, then stiffens only when that calms the body." },
  { group: "control", key: "damping_max", label: "Hardest damper setting", min: 2, max: 12, step: 0.5, value: 6, unit: "kN·s/m", si: 1000,
    hint: "The controller can't go harder than this. Softest = the lower of your two damping settings above." },
  { group: "pid", key: "extra_load", label: "Load added at t = 1 s", min: 0, max: 300, step: 10, value: 0, unit: "kg", si: 1,
    hint: "Luggage or passengers lowered onto the body. A spring alone just sags under it." },
  { group: "pid", key: "pid_kp", label: "P: Kp", min: 0, max: 80, step: 1, value: 0, unit: "kN/m", si: 1000,
    hint: "Pushes back in proportion to how far the body is from ride height (like a stiffer spring)." },
  { group: "pid", key: "pid_ki", label: "I: Ki", min: 0, max: 200, step: 5, value: 0, unit: "kN/(m·s)", si: 1000,
    hint: "Pushes harder the longer the error lasts. This is what finally removes the sag." },
  { group: "pid", key: "pid_kd", label: "D: Kd", min: 0, max: 10, step: 0.5, value: 0, unit: "kN·s/m", si: 1000,
    hint: "Pushes against the body's speed: calms oscillation, like an extra damper on the sky." },
  // half-car only
  { group: "half", key: "braking_g", label: "Braking (+) / accelerating (−)", min: -0.5, max: 1, step: 0.05, value: 0, unit: "g", si: 1,
    hint: "Pedal pressed from 0.5 s to 2.5 s. Braking tips the nose down (dive), accelerating the tail down (squat)." },
  { group: "half", key: "wheelbase", label: "Wheelbase", min: 2, max: 3.5, step: 0.05, value: 2.7, unit: "m", si: 1,
    hint: "Distance between axles. The rear wheel meets each bump this far (÷ speed) later." },
  { group: "half", key: "front_weight", label: "Weight on front axle", min: 40, max: 65, step: 1, value: 55, unit: "%", si: 0.01,
    hint: "Moves the centre of gravity. Each axle is tuned to its load, so ζ stays the same." },
  { group: "half", key: "cg_height", label: "CG height", min: 30, max: 80, step: 1, value: 50, unit: "cm", si: 0.01,
    hint: "Higher centre of gravity = more weight transfer = more dive and squat." },
  { group: "half", key: "gyration", label: "Pitch inertia (radius)", min: 0.8, max: 1.5, step: 0.05, value: 1.1, unit: "m", si: 1,
    hint: "Mass spread toward the ends rocks slower. Inertia = mass × radius²." },
];

const ROADS = [
  { kind: "flat", label: "Smooth" },
  { kind: "step", label: "Curb" },
  { kind: "bump", label: "Bump" },
  { kind: "pothole", label: "Pothole" },
  { kind: "sine", label: "Waves" },
  { kind: "random", label: "Rough road" },
];

const state = {
  model: "quarter",
  roadKind: "bump",
  values: Object.fromEntries(SLIDERS.map((s) => [s.key, s.value])),
};
const inputs = {};

// ---------- controls ----------

function digits(step) {
  return step >= 1 ? 0 : String(step).split(".")[1].length;
}

function buildControls() {
  for (const s of SLIDERS) {
    const wrap = document.createElement("div");
    wrap.className = "slider";
    wrap.innerHTML = `
      <div class="top"><label for="s-${s.key}">${s.label}</label>
        <span class="value" id="v-${s.key}"></span></div>
      <input type="range" id="s-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">
      <div class="hint">${s.hint}</div>`;
    $(`${s.group}-sliders`).appendChild(wrap);
    const input = wrap.querySelector("input");
    inputs[s.key] = { input, wrap, spec: s };
    input.addEventListener("input", () => {
      state.values[s.key] = Number(input.value);
      showValue(s.key);
      requestSimulation();
    });
    showValue(s.key);
  }

  const models = [["quarter", "Quarter-car"], ["half", "Half-car (pitch)"]];
  for (const [id, label] of models) {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.model = id;
    b.addEventListener("click", () => setModel(id));
    $("model-kind").appendChild(b);
  }

  for (const r of ROADS) {
    const b = document.createElement("button");
    b.textContent = r.label;
    b.dataset.kind = r.kind;
    b.addEventListener("click", () => { setRoad(r.kind); requestSimulation(); });
    $("road-kind").appendChild(b);
  }

  document.querySelectorAll(".presets button[data-zeta]").forEach((b) =>
    b.addEventListener("click", () => setDampingRatio(Number(b.dataset.zeta)))
  );
  document.querySelectorAll("button[data-brake]").forEach((b) =>
    b.addEventListener("click", () => {
      setValue("braking_g", Number(b.dataset.brake));
      if (Number(b.dataset.brake) !== 0) setRoad("flat");
      requestSimulation();
    })
  );

  $("play").addEventListener("click", (e) => {
    playing = !playing;
    e.target.textContent = playing ? "Pause" : "Play";
  });
  refreshModel();
  refreshRoadButtons();
}

function showValue(key) {
  const { spec } = inputs[key];
  $(`v-${key}`).textContent = `${state.values[key].toFixed(digits(spec.step))} ${spec.unit}`;
}

function setValue(key, value) {
  const { input, spec } = inputs[key];
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  state.values[key] = Number(clamped.toFixed(digits(spec.step)));
  input.value = state.values[key];
  showValue(key);
}

function setRoad(kind) {
  state.roadKind = kind;
  simT = 0;
  refreshRoadButtons();
}

function setModel(model) {
  state.model = model;
  simT = 0;
  refreshModel();
  refreshRoadButtons();
  requestSimulation();
}

function refreshModel() {
  document.querySelectorAll("#model-kind button").forEach((b) =>
    b.classList.toggle("active", b.dataset.model === state.model)
  );
  $("half-section").hidden = state.model !== "half";
  if (state.model === "half") $("half-section").open = true; // show the new controls
  inputs.body_mass.wrap.querySelector(".hint").textContent =
    state.model === "half"
      ? "A quarter of the body: this side view carries two of these. Heavier = lower bounce frequency."
      : "A quarter of the body. Heavier = lower bounce frequency.";
}

function refreshRoadButtons() {
  document.querySelectorAll("#road-kind button").forEach((b) =>
    b.classList.toggle("active", b.dataset.kind === state.roadKind)
  );
  for (const { wrap, spec } of Object.values(inputs)) {
    wrap.classList.toggle("disabled", spec.only !== undefined && spec.only !== state.roadKind);
  }
}

// Compression and rebound both set to zeta * critical damping: c = zeta * 2 sqrt(k m).
function setDampingRatio(zeta) {
  const k = state.values.spring_rate * 1000;
  const m = state.values.body_mass;
  const c = (zeta * 2 * Math.sqrt(k * m)) / 1000; // kN*s/m
  setValue("damping_compression", c);
  setValue("damping_rebound", c);
  requestSimulation();
}

function requestBody() {
  const groups = { car: {}, half: {}, road: { kind: state.roadKind } };
  for (const s of SLIDERS) {
    const target = s.group === "road" || s.group === "half" ? groups[s.group] : groups.car;
    target[s.key] = state.values[s.key] * s.si;
  }
  return { model: state.model, ...groups };
}

// ---------- simulation requests ----------

let sim = null;
let pending = null;
let inFlight = false;

function requestSimulation() {
  clearTimeout(pending);
  pending = setTimeout(runSimulation, 80);
}

async function runSimulation() {
  if (inFlight) { requestSimulation(); return; }
  inFlight = true;
  try {
    const body = requestBody();
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    sim = await res.json();
    sim.speed = body.road.speed;
    sim.brakingG = body.half.braking_g;
    sim.extraLoad = body.car.extra_load;
    sim.pidOn = body.car.pid_kp > 0 || body.car.pid_ki > 0 || body.car.pid_kd > 0;
    sim.duration = sim.time.t[sim.time.t.length - 1];
    if (simT > sim.duration) simT = 0;
    renderReadouts();
    renderPlots();
  } catch (err) {
    console.error(err);
  } finally {
    inFlight = false;
  }
}

// ---------- readouts ----------

const fmtHz = (f, d = 2) => `${f.toFixed(d)} Hz`;
const cm = (m) => (m * 100).toFixed(1);

function renderReadouts() {
  const c = sim.characteristics;
  const m = sim.time.metrics;
  const half = sim.model === "half";
  const grip = m.airborne_pct > 0 ? "bad" : m.tire_load_min_pct > 40 ? "good" : "";
  const zeta = ["Damping ratio ζ", `${c.zeta_compression.toFixed(2)} / ${c.zeta_rebound.toFixed(2)}`,
    `comp / reb · critical ${(c.critical_damping / 1000).toFixed(1)} kN·s/m`];
  const b = sim.baseline;
  const comfort = ["Comfort", `${m.body_acc_rms.toFixed(2)} m/s²`,
    b ? `RMS body accel · passive ${b.metrics.body_acc_rms.toFixed(2)}` : `RMS body accel · peak ${m.body_acc_peak.toFixed(1)}`,
    b ? (m.body_acc_rms < b.metrics.body_acc_rms ? "good" : "bad") : ""];
  const gripCard = ["Grip", `${m.tire_load_min_pct.toFixed(0)} %`,
    m.airborne_pct > 0 ? `min tire load · airborne ${m.airborne_pct.toFixed(1)} % of time` : "minimum tire load", grip];
  const sag = ["Static sag", `${cm(c.static_sag)} cm`, "spring compression at rest"];

  const cards = half
    ? [
        ["Body bounce", fmtHz(c.body_frequency), "up and down"],
        ["Body pitch", fmtHz(c.pitch_frequency), "nose up and down"],
        ["Wheel hop", fmtHz(c.wheel_frequency, 1), "wheel between spring and tire"],
        zeta, comfort, gripCard,
        ["Pitch peak", `${m.pitch_peak_deg.toFixed(2)}°`, "nose up (+) / down (−)"],
        ["Travel used", `${cm(m.max_compression_front)} / ${cm(m.max_compression_rear)} cm`, "compression front / rear"],
        sag,
      ]
    : [
        ["Body bounce", fmtHz(c.body_frequency), "natural frequency"],
        ["Wheel hop", fmtHz(c.wheel_frequency, 1), "wheel between spring and tire"],
        zeta, comfort, gripCard,
        ["Travel used", `${cm(m.max_compression)} / ${cm(m.max_extension)} cm`, "compression / extension"],
        sag,
      ];
  if (sim.extraLoad > 0 || sim.pidOn) {
    const level = Math.abs(m.final_height) < 0.005; // within 5 mm of where it started
    const sign = Math.abs(m.final_height) < 0.0005 ? "" : m.final_height > 0 ? "+" : "−";
    cards.push(["Body height at end", `${sign}${cm(Math.abs(m.final_height))} cm`,
      b ? `vs. start · passive ${cm(b.metrics.final_height)} cm` : "vs. start", level ? "good" : "bad"]);
  }
  if (sim.pidOn) {
    cards.push(["Actuator force", `${(m.actuator_peak / 1000).toFixed(1)} kN`, "peak (an active system burns energy)"]);
  }
  $("readouts").innerHTML = cards
    .map(([name, num, sub, cls = ""]) =>
      `<div class="readout ${cls}"><div class="name">${name}</div><div class="num">${num}</div><div class="sub">${sub}</div></div>`)
    .join("");
}

// ---------- plots ----------

function axis(extra = {}) {
  return { gridcolor: css("--line"), zerolinecolor: css("--line"), linecolor: css("--line"), ...extra };
}

function layout(extra) {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: css("--text"), size: 12, family: "system-ui, sans-serif" },
    margin: { l: 55, r: 55, t: 10, b: 40 },
    legend: { orientation: "h", y: 1.15, x: 0 },
    hovermode: "x unified",
    ...extra,
  };
}

function cursor(t) {
  return { type: "line", xref: "x", yref: "paper", x0: t, x1: t, y0: 0, y1: 1,
           line: { color: css("--muted"), width: 1, dash: "dot" } };
}

const plotConfig = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] };
const line = (color, width = 2, dash) => ({ color, width, dash });
const timeAxes = { xaxis: () => axis({ title: { text: "time (s)" } }) };

function renderPlots() {
  const T = sim.time;
  const half = sim.model === "half";
  const scale = (a) => a.map((v) => v * 100);
  const base = sim.baseline; // passive comparison, only when the skyhook controller is on
  const dashed = (y, name, color = css("--body")) =>
    ({ x: T.t, y, name, line: line(color, 1.5, "dash") });
  $("card-pitch").hidden = !half;
  $("freq-half-note").hidden = !half;
  $("freq-skyhook-note").hidden = !base;

  // Motion
  const motion = half
    ? [
        { x: T.t, y: scale(T.z_road_front), name: "Road (front)", line: line(css("--road"), 1.5) },
        { x: T.t, y: scale(T.z_wheel_front), name: "Front wheel", line: line(css("--wheel"), 2) },
        { x: T.t, y: scale(T.z_wheel_rear), name: "Rear wheel", line: line(css("--wheel2"), 2) },
        { x: T.t, y: scale(T.z_body), name: "Body (CG)", line: line(css("--body"), 2.5) },
      ]
    : [
        { x: T.t, y: scale(T.z_road), name: "Road", line: line(css("--road"), 1.5) },
        { x: T.t, y: scale(T.z_wheel), name: "Wheel", line: line(css("--wheel"), 2) },
        { x: T.t, y: scale(T.z_body), name: "Body", line: line(css("--body"), 2.5) },
      ];
  if (base) motion.push(dashed(scale(base.z_body), "Body, passive damper"));
  Plotly.react("plot-motion", motion, layout({
    xaxis: timeAxes.xaxis(),
    yaxis: axis({ title: { text: "height (cm)" } }),
    shapes: [cursor(simT)],
  }), plotConfig);

  // Pitch
  if (half) {
    Plotly.react("plot-pitch", [
      { x: T.t, y: T.pitch_deg, name: "Pitch", line: line(css("--body"), 2.5) },
      ...(base ? [dashed(base.pitch_deg, "Pitch, passive damper")] : []),
    ], layout({
      margin: { l: 55, r: 20, t: 10, b: 40 },
      showlegend: Boolean(base),
      xaxis: timeAxes.xaxis(),
      yaxis: axis({ title: { text: "pitch (° nose up)" } }),
      shapes: [cursor(simT)],
    }), plotConfig);
  }

  // Comfort and grip
  const load = half
    ? [
        { x: T.t, y: T.tire_load_front_pct, name: "Tire load, front", yaxis: "y2", line: line(css("--wheel"), 2) },
        { x: T.t, y: T.tire_load_rear_pct, name: "Tire load, rear", yaxis: "y2", line: line(css("--wheel2"), 2) },
      ]
    : [{ x: T.t, y: T.tire_load_pct, name: "Tire load", yaxis: "y2", line: line(css("--wheel"), 2) }];
  Plotly.react("plot-feel", [
    { x: T.t, y: T.body_acc, name: "Body acceleration", line: line(css("--body"), 2) },
    ...(base ? [dashed(base.body_acc, "Body accel, passive damper")] : []),
    ...load,
  ], layout({
    xaxis: timeAxes.xaxis(),
    yaxis: axis({ title: { text: "body accel (m/s²)" } }),
    yaxis2: axis({ title: { text: "tire load (% of static)" }, overlaying: "y", side: "right", showgrid: false }),
    shapes: [
      cursor(simT),
      { type: "line", xref: "paper", yref: "y2", x0: 0, x1: 1, y0: 0, y1: 0,
        line: { color: css("--bad"), width: 1, dash: "dash" } },
    ],
  }), plotConfig);

  // Frequency response
  const F = sim.frequency;
  const c = sim.characteristics;
  const vline = (f, label, color) => ({
    shape: { type: "line", xref: "x", yref: "paper", x0: f, x1: f, y0: 0, y1: 1, line: { color, width: 1, dash: "dot" } },
    note: { x: Math.log10(f), xref: "x", y: 1, yref: "paper", text: label, showarrow: false,
            yanchor: "bottom", font: { color, size: 11 } },
  });
  const marks = [vline(c.body_frequency, "bounce", css("--body")), vline(c.wheel_frequency, "wheel hop", css("--wheel"))];
  if (half) marks.push(vline(c.pitch_frequency, "pitch", css("--good")));
  if (sim.input_frequency) marks.push(vline(sim.input_frequency, "your waves", css("--text")));
  const traces = half
    ? [
        { x: F.freq, y: F.body, name: "Body (CG)", line: line(css("--body"), 2.5) },
        { x: F.freq, y: F.nose, name: "Nose", line: line(css("--good"), 1.5) },
        { x: F.freq, y: F.tail, name: "Tail", line: line(css("--wheel2"), 1.5) },
        { x: F.freq, y: F.wheel, name: "Front wheel", line: line(css("--wheel"), 2) },
      ]
    : [
        { x: F.freq, y: F.body, name: "Body", line: line(css("--body"), 2.5) },
        { x: F.freq, y: F.wheel, name: "Wheel", line: line(css("--wheel"), 2) },
      ];
  traces.push(
    { x: F.freq, y: F.body_half_damping, name: "Body, ½ damping", line: line(css("--body"), 1, "dash") },
    { x: F.freq, y: F.body_double_damping, name: "Body, 2× damping", line: line(css("--body"), 1, "dot") },
  );
  Plotly.react("plot-freq", traces, layout({
    margin: { l: 55, r: 20, t: 24, b: 80 },
    legend: { orientation: "h", y: -0.32, x: 0 },
    xaxis: axis({ type: "log", title: { text: "road frequency (Hz)" } }),
    yaxis: axis({ type: "log", title: { text: "gain (output / road)" } }),
    shapes: [
      { type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--muted"), width: 1 } },
      ...marks.map((m) => m.shape),
    ],
    annotations: marks.map((m) => m.note),
  }), plotConfig);
  wirePlotClicks();
}

// Click a time plot to jump the animation to that moment.
function wirePlotClicks() {
  for (const id of ["plot-motion", "plot-pitch", "plot-feel"]) {
    const div = $(id);
    if (div.on && !div.dataset.wired) {
      div.dataset.wired = "1";
      div.on("plotly_click", (ev) => { simT = ev.points[0].x; });
    }
  }
}

let lastCursor = 0;
function updateCursors(now) {
  if (!sim || now - lastCursor < 100) return;
  lastCursor = now;
  const ids = sim.model === "half" ? ["plot-motion", "plot-pitch", "plot-feel"] : ["plot-motion", "plot-feel"];
  for (const id of ids) {
    if ($(id).data) Plotly.relayout(id, { "shapes[0].x0": simT, "shapes[0].x1": simT });
  }
}

// ---------- animation ----------

let simT = 0;
let playing = true;
let lastFrame = null;

const canvas = $("scene");
const ctx = canvas.getContext("2d");
const H = 320;
const WHEEL_R = 0.32; // m
const STATIC_LENGTH = 0.45; // m, hub to body at ride height
const BODY_H = 0.3; // m
const BODY_W = 1.4; // m, quarter-car body

function sample(arr, t) {
  const f = t * 200; // server samples at 200 Hz
  const i = Math.min(Math.floor(f), arr.length - 2);
  const a = f - i;
  return arr[i] * (1 - a) + arr[i + 1] * a;
}

function roadAt(x) {
  const X = sim.time.road_x;
  const dx = X[1] - X[0];
  const f = Math.max(0, x / dx);
  const i = Math.min(Math.floor(f), X.length - 2);
  const a = f - i;
  return sim.time.road_z[i] * (1 - a) + sim.time.road_z[i + 1] * a;
}

function drawSpring(x, yBottom, yTop, width, coils) {
  ctx.beginPath();
  ctx.moveTo(x, yBottom);
  const lead = 6;
  ctx.lineTo(x, yBottom - lead);
  const len = yBottom - yTop - 2 * lead;
  for (let i = 0; i <= coils * 2; i++) {
    const y = yBottom - lead - (len * i) / (coils * 2);
    const dx = i === 0 || i === coils * 2 ? 0 : (i % 2 ? -1 : 1) * width / 2;
    ctx.lineTo(x + dx, y);
  }
  ctx.lineTo(x, yTop);
  ctx.stroke();
}

// Road surface under the car. worldX(px) maps a screen column to metres along the road.
function drawRoad(W, ppm, groundY, ex, worldX) {
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let px = 0; px <= W; px += 2) ctx.lineTo(px, groundY - roadAt(worldX(px)) * ppm * ex);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = css("--ground");
  ctx.fill();
  ctx.strokeStyle = css("--road");
  ctx.lineWidth = 2;
  ctx.stroke();
}

// One corner: axle bar, spring (left), damper (right), wheel.
function drawCorner(x, hubY, bodyY, rate, ppm, angle, rim, labels) {
  const springX = x - 0.13 * ppm;
  const damperX = x + 0.13 * ppm;
  ctx.strokeStyle = css("--text");
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(springX, hubY);
  ctx.lineTo(damperX, hubY);
  ctx.stroke();

  ctx.lineWidth = 2.5;
  drawSpring(springX, hubY, bodyY, 0.09 * ppm, 7);

  const rodLen = 0.32 * ppm, cylLen = 0.28 * ppm, cylW = 0.07 * ppm;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(damperX, hubY);
  ctx.lineTo(damperX, hubY - rodLen);
  ctx.stroke();
  const moving = Math.abs(rate) > 0.02;
  ctx.fillStyle = !moving ? css("--muted") : rate > 0 ? css("--wheel") : css("--body");
  ctx.fillRect(damperX - cylW / 2, bodyY, cylW, cylLen);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(damperX - cylW / 2, bodyY, cylW, cylLen);
  if (labels) {
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = css("--text");
    ctx.fillText("damper", damperX + cylW, bodyY + 14);
    if (moving) {
      ctx.fillStyle = rate > 0 ? css("--wheel") : css("--body");
      ctx.fillText(rate > 0 ? "compression" : "rebound", damperX + cylW, bodyY + 30);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = css("--text");
    ctx.fillText("spring", springX - 0.07 * ppm, (hubY + bodyY) / 2);
  }

  const r = WHEEL_R * ppm;
  ctx.fillStyle = "#2b2b29";
  ctx.beginPath();
  ctx.arc(x, hubY, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(x, hubY, r * 0.62, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = "#2b2b29";
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const a = angle + (i * 2 * Math.PI) / 5;
    ctx.beginPath();
    ctx.moveTo(x, hubY);
    ctx.lineTo(x + Math.cos(a) * r * 0.6, hubY + Math.sin(a) * r * 0.6);
    ctx.stroke();
  }
  ctx.fillStyle = "#2b2b29";
  ctx.beginPath();
  ctx.arc(x, hubY, 5, 0, 2 * Math.PI);
  ctx.fill();
}

function drawGauge(gx, load, label) {
  const gTop = 30, gH = 200;
  const frac = Math.min(Math.max(load, 0), 200) / 200;
  ctx.fillStyle = css("--line");
  ctx.fillRect(gx, gTop, 14, gH);
  ctx.fillStyle = load <= 0 ? css("--bad") : css("--wheel");
  ctx.fillRect(gx, gTop + gH * (1 - frac), 14, gH * frac);
  ctx.strokeStyle = css("--text");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gx - 4, gTop + gH / 2);
  ctx.lineTo(gx + 18, gTop + gH / 2);
  ctx.stroke();
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = css("--text");
  ctx.fillText(label, gx + 7, gTop - 10);
  ctx.fillText(`${load.toFixed(0)}%`, gx + 7, gTop + gH + 16);
}

function airborneWarning(W, cx) {
  ctx.textAlign = "center";
  ctx.fillStyle = css("--bad");
  ctx.font = "600 15px system-ui, sans-serif";
  ctx.fillText("wheel in the air: no grip!", cx, H - 16);
}

function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  if (canvas.width !== Math.round(W * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css("--sky");
  ctx.fillRect(0, 0, W, H);
  return W;
}

function drawQuarter(W) {
  const T = sim.time;
  const ex = Number($("exaggerate").value);
  const ppm = Math.min(170, W / 4); // pixels per metre
  const groundY = H - 50;
  const cx = W * 0.45;
  const xCar = sim.speed * simT;
  const y = (z) => groundY - z * ppm;

  drawRoad(W, ppm, groundY, ex, (px) => xCar + (px - cx) / ppm);

  const zw = sample(T.z_wheel, simT) * ex;
  const zb = sample(T.z_body, simT) * ex;
  const rate = sample(T.travel_rate, simT);
  const load = sample(T.tire_load_pct, simT);
  const hubY = y(WHEEL_R + zw);
  const bodyY = y(WHEEL_R + STATIC_LENGTH + zb);

  ctx.fillStyle = css("--body");
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.roundRect(cx - (BODY_W / 2) * ppm, bodyY - BODY_H * ppm, BODY_W * ppm, BODY_H * ppm, 10);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("body (sprung mass)", cx, bodyY - (BODY_H / 2) * ppm + 5);

  drawCorner(cx, hubY, bodyY, rate, ppm, xCar / WHEEL_R, css("--wheel"), true);
  drawGauge(W - 40, load, "tire load");
  if (load <= 0) airborneWarning(W, cx);
  return cx;
}

function drawHalf(W) {
  const T = sim.time;
  const { a, b } = T.geometry;
  const ex = Number($("exaggerate").value);
  const ppm = Math.min(105, W / 6.4);
  const groundY = H - 50;
  const cx = W * 0.4; // centre of gravity
  const xf = cx + a * ppm;
  const xr = cx - b * ppm;
  const xCar = sim.speed * simT; // road position under the front wheel
  const y = (z) => groundY - z * ppm;

  drawRoad(W, ppm, groundY, ex, (px) => xCar + (px - xf) / ppm);

  const hubF = y(WHEEL_R + sample(T.z_wheel_front, simT) * ex);
  const hubR = y(WHEEL_R + sample(T.z_wheel_rear, simT) * ex);
  const mountF = y(WHEEL_R + STATIC_LENGTH + sample(T.z_nose, simT) * ex);
  const mountR = y(WHEEL_R + STATIC_LENGTH + sample(T.z_tail, simT) * ex);
  const loadF = sample(T.tire_load_front_pct, simT);
  const loadR = sample(T.tire_load_rear_pct, simT);
  const pitch = sample(T.pitch_deg, simT);

  // Body: a slab along the line between the two mounts, overhanging both axles.
  const len = Math.hypot(xf - xr, mountF - mountR);
  const ux = (xf - xr) / len, uy = (mountF - mountR) / len; // along the body, rear -> front
  const nx = uy, ny = -ux; // perpendicular, pointing up on screen
  const over = 0.55 * ppm, thick = BODY_H * ppm;
  const corner = (along, up) => [xr + ux * along + nx * up, mountR + uy * along + ny * up];
  const pts = [corner(-over, 0), corner(len + over, 0), corner(len + over, thick), corner(-over, thick)];
  ctx.fillStyle = css("--body");
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // centre of gravity marker
  const [gx, gy] = corner(b * ppm, thick / 2);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(gx, gy, 6, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = css("--text");
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.fillText("CG", gx, gy - 12);

  drawCorner(xr, hubR, mountR, sample(T.travel_rate_rear, simT), ppm, xCar / WHEEL_R, css("--wheel2"), false);
  drawCorner(xf, hubF, mountF, sample(T.travel_rate_front, simT), ppm, xCar / WHEEL_R, css("--wheel"), true);

  // readouts on the picture
  ctx.textAlign = "left";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillStyle = css("--text");
  ctx.fillText(`pitch ${pitch >= 0 ? "+" : "−"}${Math.abs(pitch).toFixed(2)}° ${pitch >= 0 ? "(nose up)" : "(nose down)"}`, 14, 24);
  const pedal = ramp((simT - 0.5) / 0.3) - ramp((simT - 2.5) / 0.3);
  const pushG = sim.brakingG * pedal;
  if (Math.abs(pushG) > 0.03) {
    ctx.fillStyle = pushG > 0 ? css("--bad") : css("--good");
    ctx.fillText(`${pushG > 0 ? "BRAKING" : "ACCELERATING"} ${Math.abs(pushG).toFixed(2)} g`, 14, 44);
  }

  drawGauge(W - 90, loadF, "front");
  drawGauge(W - 40, loadR, "rear");
  if (Math.min(loadF, loadR) <= 0) airborneWarning(W, cx);
  return cx;
}

function ramp(u) {
  u = Math.min(1, Math.max(0, u));
  return 0.5 * (1 - Math.cos(Math.PI * u));
}

function draw() {
  const W = setupCanvas();
  if (!sim) return;
  if (sim.model === "half") drawHalf(W);
  else drawQuarter(W);
  if (sim.extraLoad > 0 && simT > 1) {
    ctx.textAlign = "left";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillStyle = css("--text");
    ctx.fillText(`+${sim.extraLoad} kg on the body`, 14, H - 14);
  }
  $("clock").textContent = `t = ${simT.toFixed(2)} s / ${sim.duration.toFixed(1)} s`;
}

function frame(now) {
  if (sim && playing && lastFrame !== null) {
    simT += ((now - lastFrame) / 1000) * Number($("playback").value);
    if (simT >= sim.duration) simT = 0;
  }
  lastFrame = now;
  try {
    draw();
    updateCursors(now);
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}

// ---------- start ----------

buildControls();
runSimulation();
requestAnimationFrame(frame);
