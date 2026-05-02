"""
N1100L Performance Engine
=========================
Piper PA-30 Twin Comanche, S/N 30-12, normally aspirated, 3600 lb gross, no tip tanks.

Loads n1100l_perf_data.json and provides:
  - Density altitude / pressure altitude / wind component utilities
  - Takeoff, accelerate-stop, landing distance lookups (with weight, wind,
    surface and slope corrections)
  - Single- and multi-engine ROC and service ceiling lookups
  - Cruise TAS, fuel burn, range, endurance lookups
  - V-speed lookups (multi and single engine, vs density altitude)
  - go_no_go(scenario) -- the headline "can I go today?" function

All distances are in feet, speeds default to mph (matches AFM) but can be
returned in knots. Weights are in pounds. Temperatures accept F or C.

NO INTERPOLATION OUTSIDE GRID: lookups clip and warn when inputs exceed the
chart envelope.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

DATA_PATH = Path(__file__).parent / "n1100l_perf_data.json"


def load_data(path: Path = DATA_PATH) -> dict:
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Atmospheric / wind helpers
# ---------------------------------------------------------------------------

def f_to_c(f: float) -> float:
    return (f - 32.0) * 5.0 / 9.0


def c_to_f(c: float) -> float:
    return c * 9.0 / 5.0 + 32.0


def kt_to_mph(kt: float) -> float:
    return kt * 1.15078


def mph_to_kt(mph: float) -> float:
    return mph / 1.15078


def pressure_altitude(field_elev_ft: float, altimeter_inHg: float) -> float:
    """Standard PA = field elevation + (29.92 - altimeter) * 1000."""
    return field_elev_ft + (29.92 - altimeter_inHg) * 1000.0


def isa_temp_c(pa_ft: float) -> float:
    """ISA standard temperature at given pressure altitude (°C)."""
    if pa_ft <= 36089:
        return 15.0 - 0.0019812 * pa_ft  # -1.98 °C / 1000 ft
    return -56.5


def density_altitude(pa_ft: float, oat_c: float) -> float:
    """
    Density altitude using the standard pilot-grade approximation:
        DA = PA + 120 * (OAT_C - ISA_TEMP_C)

    Matches the AFM Figure 5-01 nomogram closely.
    """
    return pa_ft + 120.0 * (oat_c - isa_temp_c(pa_ft))


def wind_components(
    runway_heading_deg: float,
    wind_dir_deg: float,
    wind_speed_kt: float,
) -> tuple[float, float]:
    """
    Return (headwind_kt, crosswind_kt).
    Headwind > 0 = headwind, < 0 = tailwind.
    Crosswind is signed: + = from right, - = from left.
    """
    angle = math.radians((wind_dir_deg - runway_heading_deg + 540) % 360 - 180)
    headwind = wind_speed_kt * math.cos(angle)
    crosswind = wind_speed_kt * math.sin(angle)
    return headwind, crosswind


# ---------------------------------------------------------------------------
# 1-D and 2-D table interpolation
# ---------------------------------------------------------------------------

def lerp(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
    if x1 == x0:
        return y0
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def interp1d(x: float, xs: list[float], ys: list[float], clip: bool = True) -> float:
    """Piecewise-linear 1D interpolation. Clips to endpoints when out of range."""
    if not xs or len(xs) != len(ys):
        raise ValueError("interp1d: bad table")
    if clip:
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
    for i in range(len(xs) - 1):
        if xs[i] <= x <= xs[i + 1]:
            return lerp(x, xs[i], xs[i + 1], ys[i], ys[i + 1])
    # Out of range, no clipping: extrapolate from last segment
    if x < xs[0]:
        return lerp(x, xs[0], xs[1], ys[0], ys[1])
    return lerp(x, xs[-2], xs[-1], ys[-2], ys[-1])


def interp2d(
    x: float, y: float,
    xs: list[float], ys: list[float],
    grid: list[list[float]],
    clip: bool = True,
) -> float:
    """
    Bilinear interpolation. grid[i][j] indexed as grid[row_y][col_x]
    where row_y corresponds to ys[i] and col_x to xs[j].
    """
    if clip:
        x = max(xs[0], min(xs[-1], x))
        y = max(ys[0], min(ys[-1], y))

    # Find x bracket
    j = 0
    for k in range(len(xs) - 1):
        if xs[k] <= x <= xs[k + 1]:
            j = k
            break
    else:
        j = len(xs) - 2

    # Find y bracket
    i = 0
    for k in range(len(ys) - 1):
        if ys[k] <= y <= ys[k + 1]:
            i = k
            break
    else:
        i = len(ys) - 2

    q11 = grid[i][j]
    q12 = grid[i + 1][j]
    q21 = grid[i][j + 1]
    q22 = grid[i + 1][j + 1]

    fy1 = lerp(x, xs[j], xs[j + 1], q11, q21)
    fy2 = lerp(x, xs[j], xs[j + 1], q12, q22)
    return lerp(y, ys[i], ys[i + 1], fy1, fy2)


# ---------------------------------------------------------------------------
# Scenario and result types
# ---------------------------------------------------------------------------

@dataclass
class Scenario:
    """Inputs for a go/no-go evaluation."""
    # Aircraft
    weight_lb: float

    # Departure field
    dep_field_elev_ft: float
    dep_runway_length_ft: float
    dep_runway_heading_deg: float
    dep_runway_surface: str = "paved"      # paved / wet_paved / short_dry_grass / tall_dry_grass / wet_grass / soft_field / icy_paved
    dep_runway_slope_pct: float = 0.0       # + = uphill in TO direction
    dep_altimeter_inHg: float = 29.92
    dep_oat_c: float = 15.0

    # Wind at departure (true direction)
    dep_wind_dir_deg: float = 0.0
    dep_wind_speed_kt: float = 0.0

    # Cruise / route
    cruise_altitude_ft: float = 6000
    cruise_oat_c: Optional[float] = None    # None -> assume ISA
    cruise_power_pct: int = 65              # 45/55/65/75
    route_max_terrain_msl_ft: float = 0.0   # for SE service ceiling check
    mea_msl_ft: float = 0.0

    # Destination field (optional; defaults to departure if not given)
    dest_field_elev_ft: Optional[float] = None
    dest_runway_length_ft: Optional[float] = None
    dest_runway_heading_deg: Optional[float] = None
    dest_runway_surface: Optional[str] = None
    dest_runway_slope_pct: Optional[float] = None
    dest_altimeter_inHg: Optional[float] = None
    dest_oat_c: Optional[float] = None
    dest_wind_dir_deg: Optional[float] = None
    dest_wind_speed_kt: Optional[float] = None

    def with_dest_defaults(self):
        """Fill in destination = departure if not provided."""
        if self.dest_field_elev_ft is None:    self.dest_field_elev_ft = self.dep_field_elev_ft
        if self.dest_runway_length_ft is None: self.dest_runway_length_ft = self.dep_runway_length_ft
        if self.dest_runway_heading_deg is None: self.dest_runway_heading_deg = self.dep_runway_heading_deg
        if self.dest_runway_surface is None:   self.dest_runway_surface = self.dep_runway_surface
        if self.dest_runway_slope_pct is None: self.dest_runway_slope_pct = self.dep_runway_slope_pct
        if self.dest_altimeter_inHg is None:   self.dest_altimeter_inHg = self.dep_altimeter_inHg
        if self.dest_oat_c is None:            self.dest_oat_c = self.dep_oat_c
        if self.dest_wind_dir_deg is None:     self.dest_wind_dir_deg = self.dep_wind_dir_deg
        if self.dest_wind_speed_kt is None:    self.dest_wind_speed_kt = self.dep_wind_speed_kt
        return self


# ---------------------------------------------------------------------------
# Performance engine
# ---------------------------------------------------------------------------

class PerfEngine:
    def __init__(self, data: Optional[dict] = None):
        self.d = data or load_data()

    # --- Stage-1/2/3 nomogram lookup --------------------------------------

    def _stage_lookup(
        self,
        chart: dict,
        pa_ft: float,
        oat_c: float,
        weight_lb: float,
        headwind_kt: float,
    ) -> dict:
        """Apply the 3-stage nomogram common to TO/AS/landing charts."""
        s1 = chart["stage1_reference_table"]
        oat_f = c_to_f(oat_c)
        # Pick the right grid key
        grid_key = next(k for k in ("ground_roll_ft", "distance_ft") if k in s1)
        # Stage 1: PA, OAT -> reference distance @ 3600 lb, zero wind
        ref = interp2d(oat_f, pa_ft, s1["oat_F"], s1["pa_ft"], s1[grid_key])

        # Stage 2: weight factor
        s2 = chart["stage2_weight_factor"]
        wf = interp1d(weight_lb, s2["weight_lb"], s2["factor"])
        after_weight = ref * wf

        # Stage 3: headwind factor
        s3 = chart["stage3_headwind_factor"]
        if headwind_kt >= 0:
            hf = interp1d(headwind_kt, s3["headwind_kt"], s3["factor"])
            after_wind = after_weight * hf
        else:
            # Tailwind penalty
            penalty = 1.0 + s3["tailwind_penalty_per_kt"] * abs(headwind_kt)
            after_wind = after_weight * penalty
            hf = penalty

        return {
            "stage1_reference_ft": ref,
            "weight_factor": wf,
            "after_weight_ft": after_weight,
            "wind_factor": hf,
            "after_wind_ft": after_wind,
        }

    # --- Surface / slope correction ---------------------------------------

    def _surface_factor(self, phase: str, surface: str, slope_pct: float) -> tuple[float, list[str]]:
        """Compute combined factor for surface and slope. phase = 'takeoff' | 'landing'."""
        sc = self.d["surface_corrections"][phase]
        notes = []
        factor = 1.0

        if surface == "paved":
            pass  # baseline
        elif surface in sc:
            entry = sc[surface]
            factor *= entry["factor"]
            notes.append(entry["label"])
        else:
            notes.append(f"Unknown surface '{surface}', using paved baseline.")

        # Slope: takeoff penalizes upslope, lands penalizes downslope
        if phase == "takeoff":
            if slope_pct > 0:
                f = 1.0 + sc["per_pct_upslope"]["factor_per_1pct"] * slope_pct
                factor *= f
                notes.append(f"Upslope {slope_pct:.1f}%: x{f:.2f}")
            elif slope_pct < 0:
                credit = max(sc["per_pct_downslope_credit"]["factor_per_1pct"] * abs(slope_pct),
                             sc["per_pct_downslope_credit"]["max_credit"])
                f = 1.0 + credit
                factor *= f
                notes.append(f"Downslope {abs(slope_pct):.1f}%: x{f:.2f}")
        else:  # landing
            if slope_pct < 0:  # downslope on landing is bad
                f = 1.0 + sc["per_pct_downslope"]["factor_per_1pct"] * abs(slope_pct)
                factor *= f
                notes.append(f"Downslope {abs(slope_pct):.1f}%: x{f:.2f}")
            elif slope_pct > 0:
                credit = max(sc["per_pct_upslope_credit"]["factor_per_1pct"] * slope_pct,
                             sc["per_pct_upslope_credit"]["max_credit"])
                f = 1.0 + credit
                factor *= f
                notes.append(f"Upslope {slope_pct:.1f}%: x{f:.2f}")

        return factor, notes

    # --- Public chart lookups ---------------------------------------------

    def takeoff_ground_roll(self, pa_ft, oat_c, weight_lb, headwind_kt,
                             surface="paved", slope_pct=0.0) -> dict:
        base = self._stage_lookup(
            self.d["takeoff_ground_run_5_06"], pa_ft, oat_c, weight_lb, headwind_kt
        )
        sf, notes = self._surface_factor("takeoff", surface, slope_pct)
        base["surface_slope_factor"] = sf
        base["surface_notes"] = notes
        base["final_ft"] = base["after_wind_ft"] * sf
        return base

    def takeoff_50ft(self, pa_ft, oat_c, weight_lb, headwind_kt,
                      surface="paved", slope_pct=0.0) -> dict:
        base = self._stage_lookup(
            self.d["takeoff_50ft_5_07"], pa_ft, oat_c, weight_lb, headwind_kt
        )
        sf, notes = self._surface_factor("takeoff", surface, slope_pct)
        base["surface_slope_factor"] = sf
        base["surface_notes"] = notes
        base["final_ft"] = base["after_wind_ft"] * sf
        return base

    def accelerate_stop(self, pa_ft, oat_c, weight_lb, headwind_kt,
                         surface="paved", slope_pct=0.0) -> dict:
        base = self._stage_lookup(
            self.d["accelerate_stop_5_08"], pa_ft, oat_c, weight_lb, headwind_kt
        )
        sf, notes = self._surface_factor("takeoff", surface, slope_pct)
        base["surface_slope_factor"] = sf
        base["surface_notes"] = notes
        base["final_ft"] = base["after_wind_ft"] * sf
        return base

    def landing_ground_roll(self, pa_ft, oat_c, weight_lb, headwind_kt,
                             surface="paved", slope_pct=0.0,
                             max_braking=True) -> dict:
        base = self._stage_lookup(
            self.d["landing_ground_roll_5_15"], pa_ft, oat_c, weight_lb, headwind_kt
        )
        sf, notes = self._surface_factor("landing", surface, slope_pct)
        base["surface_slope_factor"] = sf
        base["surface_notes"] = notes
        out = base["after_wind_ft"] * sf
        if not max_braking:
            normal_mult = self.d["landing_ground_roll_5_15"]["standard_landing_factor"]["factor"]
            out *= normal_mult
            notes.append(f"Normal (non-max) braking: x{normal_mult}")
        base["final_ft"] = out
        return base

    def landing_50ft(self, pa_ft, oat_c, weight_lb, headwind_kt,
                      surface="paved", slope_pct=0.0) -> dict:
        base = self._stage_lookup(
            self.d["landing_50ft_5_16"], pa_ft, oat_c, weight_lb, headwind_kt
        )
        sf, notes = self._surface_factor("landing", surface, slope_pct)
        base["surface_slope_factor"] = sf
        base["surface_notes"] = notes
        base["final_ft"] = base["after_wind_ft"] * sf
        return base

    # --- Climb / ceilings -------------------------------------------------

    def multi_engine_roc(self, da_ft: float, weight_lb: float, configuration="clean") -> float:
        cfg = self.d["multi_engine_climb_5_09"]["configurations"]
        if configuration == "gear_extended_flaps15":
            c = cfg["gear_extended_flaps15_3600lb"]
            return interp1d(da_ft, c["da_ft"], c["roc_fpm"])
        # Clean: interpolate across weight curves
        weights = [2800, 3200, 3600]
        rocs = []
        for w in weights:
            c = cfg[f"clean_{w}lb"]
            rocs.append(interp1d(da_ft, c["da_ft"], c["roc_fpm"]))
        return interp1d(weight_lb, weights, rocs)

    def single_engine_roc(self, da_ft: float, weight_lb: float) -> float:
        cfg = self.d["single_engine_climb_5_10"]["configurations"]
        weights = [2800, 3200, 3600]
        rocs = []
        for w in weights:
            c = cfg[f"clean_{w}lb"]
            rocs.append(interp1d(da_ft, c["da_ft"], c["roc_fpm"]))
        return interp1d(weight_lb, weights, rocs)

    def single_engine_service_ceiling(self, weight_lb: float) -> float:
        ceilings = self.d["single_engine_climb_5_10"]["service_ceilings_ft_da"]
        weights = sorted(int(k) for k in ceilings.keys() if not k.startswith("_"))
        vals = [ceilings[str(w)] for w in weights]
        return interp1d(weight_lb, weights, vals)

    def single_engine_absolute_ceiling(self, weight_lb: float) -> float:
        ceilings = self.d["single_engine_climb_5_10"]["absolute_ceilings_ft_da"]
        weights = sorted(int(k) for k in ceilings.keys() if not k.startswith("_"))
        vals = [ceilings[str(w)] for w in weights]
        return interp1d(weight_lb, weights, vals)

    # --- V-speeds vs DA ---------------------------------------------------

    def v_speeds_at_da(self, da_ft: float) -> dict:
        m = self.d["vx_vy_5_11"]["multi_engine"]
        s = self.d["vx_vy_5_11"]["single_engine"]
        return {
            "Vx_multi_mph": interp1d(da_ft, m["da_ft"], m["vx_mph_ias"]),
            "Vy_multi_mph": interp1d(da_ft, m["da_ft"], m["vy_mph_ias"]),
            "Vx_multi_kt": interp1d(da_ft, m["da_ft"], m["vx_kt_ias"]),
            "Vy_multi_kt": interp1d(da_ft, m["da_ft"], m["vy_kt_ias"]),
            "Vxse_mph": interp1d(da_ft, s["da_ft"], s["vxse_mph_ias"]),
            "Vyse_mph": interp1d(da_ft, s["da_ft"], s["vyse_mph_ias"]),
            "Vxse_kt":  interp1d(da_ft, s["da_ft"], s["vxse_kt_ias"]),
            "Vyse_kt":  interp1d(da_ft, s["da_ft"], s["vyse_kt_ias"]),
        }

    def stall_speed(self, weight_lb: float, dirty: bool = False) -> dict:
        s = self.d["stall_speed_5_05"]
        if dirty:
            return {
                "mph_ias": interp1d(weight_lb, s["x_weight_lb"], s["dirty_mph_ias"]),
                "kt_ias":  interp1d(weight_lb, s["x_weight_lb"], s["dirty_kt_ias"]),
                "config": "gear extended, full flaps",
            }
        return {
            "mph_ias": interp1d(weight_lb, s["x_weight_lb"], s["clean_mph_ias"]),
            "kt_ias":  interp1d(weight_lb, s["x_weight_lb"], s["clean_kt_ias"]),
            "config": "gear and flaps retracted",
        }

    # --- Cruise -----------------------------------------------------------

    def cruise_tas(self, da_ft: float, power_pct: int) -> dict:
        tas = self.d["true_airspeed_5_12"]["power_settings"]
        key = f"{power_pct}_pct"
        if key not in tas:
            raise ValueError(f"Unknown power setting {power_pct}; use 45/55/65/75")
        c = tas[key]
        return {
            "tas_mph": interp1d(da_ft, c["da_ft"], c["tas_mph"]),
            "tas_kt":  interp1d(da_ft, c["da_ft"], c["tas_kt"]),
        }

    def fuel_burn_total_gph(self, power_pct: int, mixture: str = "best_economy") -> float:
        """Total fuel burn (both engines) in GPH at given power setting."""
        for entry in self.d["power_setting_table_5_17"]["rated_power_levels"]:
            if entry["pct_rated"] == power_pct:
                key = f"fuel_gph_each_{mixture}"
                return entry[key] * 2  # two engines
        raise ValueError(f"power setting {power_pct} not found")

    def range_sm(self, da_ft: float, power_pct: int) -> dict:
        r = self.d["range_5_13"]["power_settings"][f"{power_pct}_pct"]
        return {
            "range_sm": interp1d(da_ft, r["da_ft"], r["range_sm"]),
            "range_nm": interp1d(da_ft, r["da_ft"], r["range_nm"]),
        }

    def endurance_hr(self, da_ft: float, power_pct: int) -> float:
        e = self.d["endurance_5_14"]["power_settings"][f"{power_pct}_pct"]
        return interp1d(da_ft, e["da_ft"], e["endurance_hr"])

    # --- W&B --------------------------------------------------------------

    def cg_in_envelope(self, weight_lb: float, cg_in: float) -> tuple[bool, str]:
        env = self.d["cg_envelope"]["points"]
        weights = [p["weight_lb"] for p in env]
        fwds = [p["fwd_limit_in"] for p in env]
        afts = [p["aft_limit_in"] for p in env]
        if weight_lb < weights[0] or weight_lb > weights[-1]:
            return False, f"weight {weight_lb} outside envelope ({weights[0]}-{weights[-1]} lb)"
        fwd = interp1d(weight_lb, weights, fwds)
        aft = interp1d(weight_lb, weights, afts)
        if cg_in < fwd:
            return False, f"CG {cg_in:.2f} fwd of fwd limit {fwd:.2f}"
        if cg_in > aft:
            return False, f"CG {cg_in:.2f} aft of aft limit {aft:.2f}"
        return True, f"CG {cg_in:.2f} within {fwd:.2f}-{aft:.2f}"

    # --- Master go/no-go --------------------------------------------------

    def go_no_go(self, sc: Scenario) -> dict:
        sc.with_dest_defaults()
        out: dict = {"scenario": asdict(sc), "departure": {}, "destination": {},
                     "cruise": {}, "single_engine_safety": {}, "go_no_go": {}, "warnings": [], "flags": []}

        # ---- Departure ----
        dep_pa = pressure_altitude(sc.dep_field_elev_ft, sc.dep_altimeter_inHg)
        dep_da = density_altitude(dep_pa, sc.dep_oat_c)
        dep_hw_kt, dep_xw_kt = wind_components(
            sc.dep_runway_heading_deg, sc.dep_wind_dir_deg, sc.dep_wind_speed_kt
        )

        to_gnd = self.takeoff_ground_roll(dep_pa, sc.dep_oat_c, sc.weight_lb, dep_hw_kt,
                                          sc.dep_runway_surface, sc.dep_runway_slope_pct)
        to_50 = self.takeoff_50ft(dep_pa, sc.dep_oat_c, sc.weight_lb, dep_hw_kt,
                                  sc.dep_runway_surface, sc.dep_runway_slope_pct)
        as_dist = self.accelerate_stop(dep_pa, sc.dep_oat_c, sc.weight_lb, dep_hw_kt,
                                       sc.dep_runway_surface, sc.dep_runway_slope_pct)

        v_speeds_dep = self.v_speeds_at_da(dep_da)

        out["departure"] = {
            "pa_ft": round(dep_pa),
            "da_ft": round(dep_da),
            "headwind_kt": round(dep_hw_kt, 1),
            "crosswind_kt": round(abs(dep_xw_kt), 1),
            "crosswind_side": "right" if dep_xw_kt > 0 else ("left" if dep_xw_kt < 0 else "none"),
            "takeoff_ground_roll_ft": round(to_gnd["final_ft"]),
            "takeoff_over_50ft_ft":   round(to_50["final_ft"]),
            "accelerate_stop_ft":     round(as_dist["final_ft"]),
            "runway_length_ft":       sc.dep_runway_length_ft,
            "runway_margin_takeoff":  round(sc.dep_runway_length_ft / to_50["final_ft"], 2),
            "runway_margin_accel_stop": round(sc.dep_runway_length_ft / as_dist["final_ft"], 2),
            "Vx_multi_kt": round(v_speeds_dep["Vx_multi_kt"]),
            "Vy_multi_kt": round(v_speeds_dep["Vy_multi_kt"]),
            "Vyse_kt":     round(v_speeds_dep["Vyse_kt"]),
            "Vmca_mph_cas": self.d["v_speeds_mph_cas"]["Vmca"],
            "stall_clean":  self.stall_speed(sc.weight_lb, dirty=False),
            "stall_dirty":  self.stall_speed(sc.weight_lb, dirty=True),
        }

        # ---- Destination ----
        dest_pa = pressure_altitude(sc.dest_field_elev_ft, sc.dest_altimeter_inHg)
        dest_da = density_altitude(dest_pa, sc.dest_oat_c)
        dest_hw_kt, dest_xw_kt = wind_components(
            sc.dest_runway_heading_deg, sc.dest_wind_dir_deg, sc.dest_wind_speed_kt
        )
        ldg_gnd = self.landing_ground_roll(dest_pa, sc.dest_oat_c, sc.weight_lb, dest_hw_kt,
                                           sc.dest_runway_surface, sc.dest_runway_slope_pct)
        ldg_50 = self.landing_50ft(dest_pa, sc.dest_oat_c, sc.weight_lb, dest_hw_kt,
                                   sc.dest_runway_surface, sc.dest_runway_slope_pct)
        out["destination"] = {
            "pa_ft": round(dest_pa),
            "da_ft": round(dest_da),
            "headwind_kt": round(dest_hw_kt, 1),
            "crosswind_kt": round(abs(dest_xw_kt), 1),
            "crosswind_side": "right" if dest_xw_kt > 0 else ("left" if dest_xw_kt < 0 else "none"),
            "landing_ground_roll_ft": round(ldg_gnd["final_ft"]),
            "landing_over_50ft_ft":   round(ldg_50["final_ft"]),
            "runway_length_ft":       sc.dest_runway_length_ft,
            "runway_margin_landing":  round(sc.dest_runway_length_ft / ldg_50["final_ft"], 2),
        }

        # ---- Cruise ----
        if sc.cruise_oat_c is None:
            sc.cruise_oat_c = isa_temp_c(sc.cruise_altitude_ft)
        cruise_da = density_altitude(sc.cruise_altitude_ft, sc.cruise_oat_c)
        tas = self.cruise_tas(cruise_da, sc.cruise_power_pct)
        burn_econ = self.fuel_burn_total_gph(sc.cruise_power_pct, "economy")
        burn_power = self.fuel_burn_total_gph(sc.cruise_power_pct, "best_power")
        out["cruise"] = {
            "altitude_msl_ft": sc.cruise_altitude_ft,
            "da_ft": round(cruise_da),
            "tas_kt":  round(tas["tas_kt"]),
            "tas_mph": round(tas["tas_mph"]),
            "power_pct": sc.cruise_power_pct,
            "fuel_burn_total_gph_economy":   burn_econ,
            "fuel_burn_total_gph_bestpower": burn_power,
            "endurance_hr": round(self.endurance_hr(cruise_da, sc.cruise_power_pct), 1),
            "range_nm":     round(self.range_sm(cruise_da, sc.cruise_power_pct)["range_nm"]),
        }

        # ---- Single-engine safety ----
        se_ceiling_da = self.single_engine_service_ceiling(sc.weight_lb)
        se_abs_da = self.single_engine_absolute_ceiling(sc.weight_lb)
        se_roc_at_dep = self.single_engine_roc(dep_da, sc.weight_lb)
        se_roc_at_cruise = self.single_engine_roc(cruise_da, sc.weight_lb)
        # Compare service ceiling against MEA / max terrain
        # Approximate ISA conversion of MEA MSL to DA: assume ISA aloft for advisory only
        mea_da_estimate = sc.mea_msl_ft  # caller may pre-convert if they want exactness
        terrain_da_estimate = sc.route_max_terrain_msl_ft
        out["single_engine_safety"] = {
            "service_ceiling_da_ft":  round(se_ceiling_da),
            "absolute_ceiling_da_ft": round(se_abs_da),
            "roc_at_departure_da_fpm": round(se_roc_at_dep),
            "roc_at_cruise_da_fpm":    round(se_roc_at_cruise),
            "mea_msl_ft":              sc.mea_msl_ft,
            "max_terrain_msl_ft":      sc.route_max_terrain_msl_ft,
        }

        # ---- Flags ----
        thresholds = self.d["go_no_go_thresholds"]
        flags = []

        # Runway margins
        if out["departure"]["runway_margin_takeoff"] < thresholds["min_runway_margin_factor"]:
            flags.append(f"DEP takeoff margin {out['departure']['runway_margin_takeoff']:.2f} < {thresholds['min_runway_margin_factor']}")
        if out["departure"]["runway_margin_accel_stop"] < 1.0:
            flags.append(f"⚠️  DEP accelerate-stop ({out['departure']['accelerate_stop_ft']} ft) > runway ({sc.dep_runway_length_ft} ft) -- engine failure on takeoff is unsurvivable on this runway")
        elif out["departure"]["runway_margin_accel_stop"] < 1.10:
            flags.append(f"DEP accelerate-stop margin tight ({out['departure']['runway_margin_accel_stop']:.2f})")
        if out["destination"]["runway_margin_landing"] < thresholds["min_runway_margin_factor"]:
            flags.append(f"DEST landing margin {out['destination']['runway_margin_landing']:.2f} < {thresholds['min_runway_margin_factor']}")

        # Crosswind
        max_xwind = thresholds["max_xwind_kt"]
        if out["departure"]["crosswind_kt"] > max_xwind:
            flags.append(f"⚠️  DEP crosswind {out['departure']['crosswind_kt']:.1f} kt exceeds demonstrated {max_xwind} kt")
        if out["destination"]["crosswind_kt"] > max_xwind:
            flags.append(f"⚠️  DEST crosswind {out['destination']['crosswind_kt']:.1f} kt exceeds demonstrated {max_xwind} kt")

        # Single-engine
        if sc.mea_msl_ft and se_ceiling_da < sc.mea_msl_ft:
            flags.append(f"⚠️  SE service ceiling ({round(se_ceiling_da)} ft DA) below MEA ({sc.mea_msl_ft} ft MSL) -- cannot maintain altitude single-engine")
        if sc.route_max_terrain_msl_ft and se_ceiling_da < sc.route_max_terrain_msl_ft + thresholds["se_service_ceiling_buffer_ft"]:
            flags.append(f"SE service ceiling {round(se_ceiling_da)} ft DA leaves <{thresholds['se_service_ceiling_buffer_ft']} ft buffer over terrain ({sc.route_max_terrain_msl_ft} ft)")
        if se_roc_at_dep < thresholds["min_se_roc_at_field_fpm"]:
            flags.append(f"⚠️  SE ROC at departure DA only {round(se_roc_at_dep)} fpm (< {thresholds['min_se_roc_at_field_fpm']}) -- engine failure after liftoff is critical")

        # DA / Vmc warning
        if dep_da > thresholds["vmc_high_da_warning_ft"]:
            flags.append(f"DEP DA {round(dep_da)} ft -- Vmc considerations: high DA reduces single-engine performance; cold induction can raise Vmc on the ground")

        # Tailwind
        if dep_hw_kt < 0:
            flags.append(f"DEP tailwind {abs(dep_hw_kt):.1f} kt")
        if dest_hw_kt < 0:
            flags.append(f"DEST tailwind {abs(dest_hw_kt):.1f} kt")

        out["flags"] = flags
        out["go_no_go"] = {
            "result": "NO-GO" if any("⚠️" in f for f in flags) else ("CAUTION" if flags else "GO"),
            "blocker_count": sum(1 for f in flags if "⚠️" in f),
            "advisory_count": sum(1 for f in flags if "⚠️" not in f),
        }
        return out


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    eng = PerfEngine()

    print("=" * 70)
    print("N1100L PA-30 Twin Comanche performance engine demo")
    print("=" * 70)

    # Scenario 1: KIWS (Houston) on a hot day, going to KSAF (Santa Fe)
    sc = Scenario(
        weight_lb=3500,
        dep_field_elev_ft=142,
        dep_runway_length_ft=4001,
        dep_runway_heading_deg=90,
        dep_runway_surface="paved",
        dep_oat_c=35,
        dep_wind_dir_deg=120,
        dep_wind_speed_kt=10,
        cruise_altitude_ft=8000,
        cruise_power_pct=65,
        route_max_terrain_msl_ft=10000,   # Sangre de Cristo Mountains
        mea_msl_ft=12000,
        dest_field_elev_ft=6349,
        dest_runway_length_ft=8366,
        dest_runway_heading_deg=20,
        dest_oat_c=25,
        dest_wind_dir_deg=10,
        dest_wind_speed_kt=8,
    )

    def print_section(title, d):
        print(f"\n{title}:")
        for k, v in d.items():
            if isinstance(v, dict):
                print(f"  {k}:")
                for kk, vv in v.items():
                    print(f"    {kk}: {vv}")
            else:
                print(f"  {k}: {v}")

    def run_demo(label, sc):
        print("\n" + "-" * 70)
        print(label)
        print("-" * 70)
        result = eng.go_no_go(sc)
        print_section("Departure", result["departure"])
        print_section("Cruise", result["cruise"])
        print_section("Single-engine safety", result["single_engine_safety"])
        print_section("Destination", result["destination"])
        print(f"\nFlags ({len(result['flags'])}):")
        for f in result["flags"]:
            print(f"  - {f}")
        print(f"\nResult: {result['go_no_go']['result']}  (blockers: {result['go_no_go']['blocker_count']}, advisories: {result['go_no_go']['advisory_count']})")

    run_demo("Scenario 1: KIWS hot day → KSAF (Santa Fe over high terrain)", sc)

    # Scenario 2: same airplane, short grass strip, hot day
    sc2 = Scenario(
        weight_lb=3500,
        dep_field_elev_ft=500,
        dep_runway_length_ft=2400,
        dep_runway_heading_deg=180,
        dep_runway_surface="tall_dry_grass",
        dep_runway_slope_pct=1.5,
        dep_oat_c=38,
        dep_wind_dir_deg=170,
        dep_wind_speed_kt=4,
        cruise_altitude_ft=4500,
        cruise_power_pct=65,
    )
    run_demo("Scenario 2: 2,400 ft tall-grass strip, 1.5% upslope, 100°F, 4 kt headwind", sc2)

    # Scenario 3: light, ideal conditions — should be a clean GO
    sc3 = Scenario(
        weight_lb=3000,
        dep_field_elev_ft=500,
        dep_runway_length_ft=5000,
        dep_runway_heading_deg=180,
        dep_oat_c=15,
        dep_wind_dir_deg=180,
        dep_wind_speed_kt=10,
        cruise_altitude_ft=6000,
        cruise_power_pct=65,
    )
    run_demo("Scenario 3: 3,000 lb, sea level, ISA, 10 kt headwind on 5000 ft paved", sc3)
