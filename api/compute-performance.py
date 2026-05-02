import json
import sys
import os
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'perf-engine'))

from n1100l_perf import PerfEngine, Scenario


# Engine instantiated once at module load (cold-start cost amortizes across warm calls)
ENGINE = PerfEngine()


def f_to_c(f):
    return (f - 32.0) * 5.0 / 9.0


def wind_component_to_dir_speed(wind_component_kt, runway_heading_deg):
    speed_kt = abs(wind_component_kt)
    if wind_component_kt >= 0:
        direction_deg = runway_heading_deg % 360
    else:
        direction_deg = (runway_heading_deg + 180) % 360
    return direction_deg, speed_kt


def adapt_scenario(react_input):
    weight_lbs = react_input.get("weight_lbs", 2800)
    field_elevation_ft = react_input.get("field_elevation_ft", 3282)
    oat_f = react_input.get("oat_f", 75)
    wind_component_kt = react_input.get("wind_component_kt", 0)
    runway_length_ft = react_input.get("runway_length_ft", 11500)
    runway_slope_pct = react_input.get("runway_slope_pct", 0.0)
    runway_heading_deg = react_input.get("runway_heading_deg", 170)

    oat_c = f_to_c(oat_f)
    wind_dir_deg, wind_speed_kt = wind_component_to_dir_speed(wind_component_kt, runway_heading_deg)

    sc = Scenario(
        weight_lb=weight_lbs,
        dep_field_elev_ft=field_elevation_ft,
        dep_oat_c=oat_c,
        dep_wind_dir_deg=wind_dir_deg,
        dep_wind_speed_kt=wind_speed_kt,
        dep_runway_heading_deg=runway_heading_deg,
        dep_runway_length_ft=runway_length_ft,
        dep_runway_slope_pct=runway_slope_pct,
    )
    return sc


def compute(react_input):
    """Compute go/no-go for the given React-shaped scenario.
    Returns (status_code, body_dict)."""
    required = ["weight_lbs", "field_elevation_ft", "oat_f"]
    missing = [f for f in required if f not in react_input]
    if missing:
        return 400, {"error": f"Missing required fields: {missing}"}

    try:
        sc = adapt_scenario(react_input)
        result = ENGINE.go_no_go(sc)
        if hasattr(result, '__dataclass_fields__'):
            from dataclasses import asdict
            return 200, asdict(result)
        if isinstance(result, dict):
            return 200, result
        return 200, {"raw": str(result)}
    except Exception as e:
        import traceback
        return 500, {
            "error": f"Engine error: {str(e)}",
            "trace": traceback.format_exc(),
        }


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status, body):
        body_bytes = json.dumps(body, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            body = json.loads(raw) if raw else {}
        except Exception as e:
            self._send_json(400, {"error": f"Bad request body: {str(e)}"})
            return
        scenario = body.get("scenario", {})
        status, payload = compute(scenario)
        self._send_json(status, payload)

    def do_GET(self):
        self._send_json(405, {"error": "Method not allowed. Use POST."})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
