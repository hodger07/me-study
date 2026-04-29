import React, { useState, useMemo, useEffect, useRef } from "react";
import { Plane, BookOpen, Target, ChevronRight, Check, X, RotateCcw, ArrowLeft, AlertTriangle, Wind, Settings, ClipboardCheck, Gauge, Wrench, Radio, MapPin, FileText, Award, ListChecks, BarChart3 } from "lucide-react";

// =====================================================================
// MULTI-ENGINE STUDY APP — Private Pilot AMEL Add-On
// Calibrated to FAA Private Pilot AMEL ACS, PA-30 Twin Comanche
// Built around Raider Aviation's 5-day syllabus
// =====================================================================

// ---------- Vmc Factor Table (from your handwritten notes) ----------
const VMC_TABLE = [
  { factor: "Critical engine inop (windmilling)",   perf: "↓",  perfNote: "+ Drag",                ctrl: "↓",  ctrlNote: "− Rudder",            vmc: "↑" },
  { factor: "Operating engine at max power",        perf: "↑",  perfNote: "+ Rate of Climb",       ctrl: "↓",  ctrlNote: "+ PAST",              vmc: "↑" },
  { factor: "Max gross weight",                     perf: "↓",  perfNote: "− Rate of Climb",       ctrl: "↑",  ctrlNote: "+ Inertia",           vmc: "↓",
    deeper: {
      title: "Why 'inertia' and not 'horizontal lift' for weight?",
      body: "These are TWO different effects of weight, and the distinction matters:\n\n• Weight ALONE → inertia. A heavier airplane resists changing direction in any axis — including the yaw asymmetric thrust is trying to create. More mass = more resistance to being yawed off heading.\n\n• Weight WHEN BANKED → horizontal lift component. Once you bank toward the operating engine (the zero-sideslip technique), a heavier airplane generates a larger horizontal lift component, which physically opposes the asymmetric-thrust yaw.\n\nBoth effects lower Vmc. The CFI's table calls out 'inertia' under controllability because that's the cleaner framing for weight as a STANDALONE factor — bank gets its own row in the table for the horizontal-lift effect.\n\nCROSS-CONCEPT: Same physics drives why MANEUVERING SPEED (Va) DECREASES at lighter weight. Lighter airplane = less inertia = changes direction more aggressively for the same control input = stresses the airframe more = lower Va to compensate. If the examiner asks 'why does Va decrease with weight reduction?' — same answer.",
    },
  },
  { factor: "Bank up to 5° (ball ½ split toward op engine)", perf: "↑", perfNote: "− Reducing Sideslip", ctrl: "↑", ctrlNote: "Horizontal Lift", vmc: "↓",
    deeper: {
      title: "Why bank gets its own row even though it's just 'more horizontal lift'",
      body: "Banking toward the operating engine produces a horizontal lift component that opposes the asymmetric-thrust yaw — true at any weight. The reason it gets its own row in the table is that it's the ONE factor that helps BOTH performance and Vmc simultaneously:\n\n• Performance ↑ because reducing sideslip lowers drag\n• Controllability ↑ because horizontal lift opposes yaw\n• Vmc ↓ because controllability improved\n\nThis is why 'raise the dead, ½ ball toward the live engine, ~2° bank' is the muscle memory after every engine failure. It's the only single-input action that helps everything at once.",
    },
  },
  { factor: "Aft CG",                               perf: "↑",  perfNote: "+ Rate of Climb",       ctrl: "↓",  ctrlNote: "Less Rudder Authority", vmc: "↑" },
  { factor: "Takeoff config (gear up / flaps up)",  perf: "↑",  perfNote: "Clean",                 ctrl: "↓",  ctrlNote: "Keel / Flaps",        vmc: "↑" },
  { factor: "Standard day — Low DA",                perf: "↑",  perfNote: "",                      ctrl: "↓",  ctrlNote: "+ PAST",              vmc: "↑" },
  { factor: "High DA",                              perf: "↓",  perfNote: "",                      ctrl: "↑",  ctrlNote: "− PAST",              vmc: "↓" },
];

// ---------- V-Speeds (PA-30 reference, verify against POH) ----------
const VSPEEDS = [
  { code: "Vmc",  name: "Min control speed, critical engine inop", val: "80 mph", marking: "Red radial line" },
  { code: "Vsse", name: "Safe single-engine speed",                val: "90 mph", marking: "Manufacturer recommended" },
  { code: "Vxse", name: "Best angle of climb, single engine",      val: "90 mph", marking: "" },
  { code: "Vyse", name: "Best rate of climb, single engine",       val: "105 mph", marking: "Blue radial line" },
  { code: "Vy",   name: "Best rate of climb, both engines",        val: "112 mph", marking: "" },
  { code: "Vx",   name: "Best angle of climb, both engines",       val: "90 mph",  marking: "" },
  { code: "Vfe",  name: "Max flap extended",                       val: "125 mph", marking: "Top of white arc" },
  { code: "Vlo",  name: "Max landing gear operating",              val: "125 mph", marking: "" },
  { code: "Vle",  name: "Max landing gear extended",               val: "150 mph", marking: "" },
  { code: "Vno",  name: "Max structural cruise",                   val: "185 mph", marking: "Top of green arc" },
  { code: "Vne",  name: "Never exceed",                            val: "230 mph", marking: "Red line" },
];

// ---------- N1100L — actual aircraft panel familiarization ----------
const AIRCRAFT = {
  reg: "N1100L",
  model: "1963 Piper PA-30 Twin Comanche",
  rate: "$443/hour (instructor included)",
  avionics: ["Garmin GNS 430W (GPS/NAV/COM)", "Dual Garmin G5 (PFD + HSI)", "ADS-B In/Out", "GMA audio panel", "KX 155 NAV/COM (#2)", "NARCO DME 190", "JPI/EI CGR-30P engine monitors (L/R)", "CGR-30C fuel/electrical monitor", "GPSS heading mode for autopilot interface (A/P currently INOP)"],
  notable: [
    "**A/P INOP** — placard says it. Plan all single-engine IFR approaches as hand-flown.",
    "**Stall warning is INOP when master is OFF** — this is normal characteristic, but is placarded. Verify stall warning during pre-flight with master ON.",
    "**Manual alternate engine induction air** — placard reads: alternate air available only by pulling 'ALT AIR' control full on. Carb-ice / induction-blockage scenario means manually pull alt air; not automatic.",
    "**MAX GEAR DOWN SPEED 150 MPH** — placarded right above the gear handle. That's Vle. Don't extend or fly with gear extended above this.",
    "**FLAPS** — do not extend beyond 15° (takeoff position) above Vfe — placarded on the panel.",
    "**Dual G5s** are independent of each other and of the steam gauges (AI, ASI, ALT). Loss of one G5 still leaves the other plus the round-dial backups. Loss of vacuum is far less critical here than in a vacuum-only panel.",
  ],
  // Panel sections — for the interactive panel quiz
  panel: [
    {
      area: "Left Six-Pack (Pilot Primary)",
      items: [
        { name: "Airspeed Indicator (steam)", note: "Mph indication. Red line at Vne (~230). Top of white arc = Vfe (~125). Top of green = Vno (~185). Red radial = Vmc (~80). Blue radial = Vyse (~105)." },
        { name: "Garmin G5 #1 — Attitude / PFD", note: "Primary attitude, airspeed tape, altitude tape, vertical speed. Battery-backed — survives electrical loss. Independent ADAHRS." },
        { name: "Altimeter (steam)", note: "Backup pressure altimeter. Set to current altimeter setting; cross-check against G5." },
        { name: "Vertical Speed Indicator (steam)", note: "Backup VSI. Note lag — trend information, not instantaneous." },
        { name: "Garmin G5 #2 — HSI", note: "Heading, course, GPS or VLOC navigation source (slaved to GNS 430W). Replaces the traditional DG and CDI in one display." },
        { name: "Turn Coordinator", note: "Backup rate-of-turn and ball/inclinometer. Electric-powered — survives vacuum loss. The BALL is your primary single-engine reference for zero sideslip." },
      ],
    },
    {
      area: "Center — Engine Instruments (CGR-30P L/R)",
      items: [
        { name: "Manifold Pressure (MP)", note: "Top of each engine display. Full throttle on the ground at low DA reads ~26-29\". Drops with altitude (NA engine, no turbo). 25\" = common climb power setting." },
        { name: "RPM (tachometer)", note: "Right side of engine display. Redline ~2700. Climb 2500. Cruise often 2400 or 2300 RPM." },
        { name: "Fuel Flow", note: "GPH per engine. Cruise typically 7-9 GPH per side. Sudden drop = fuel issue (selector, pump, contamination)." },
        { name: "Oil Pressure / Oil Temp", note: "Both engines. Green within limits per POH. Loss of oil pressure = imminent engine failure — secure quickly." },
        { name: "EGT / CHT", note: "Per cylinder. CHT redline typically 460°F. Sustained CHT over ~400°F = adjust mixture richer or reduce power. Critical for engine longevity." },
      ],
    },
    {
      area: "Center — Fuel & Electrical (CGR-30C)",
      items: [
        { name: "L MAIN / R MAIN", note: "Main fuel tank quantity in gallons each side. Primary tanks for takeoff/landing per POH." },
        { name: "L AUX / R AUX", note: "Auxiliary fuel tanks. PA-30 POH typically restricts aux use to LEVEL CRUISE only — do NOT take off, land, or operate single-engine on aux tanks. Verify exact restriction in this aircraft's POH." },
        { name: "Volts", note: "12V system. Below ~12.0 = alternator issue. Above ~14.5 = overvoltage." },
        { name: "L ALT / R ALT", note: "Per-engine alternator output (amps). Loss of one = the other carries full load (load-shed if needed). Both showing 0.0 in the photo = engines off." },
        { name: "GAT", note: "Outside Air Temperature. Use for DA calculations and induction-icing awareness (carb/induction icing risk in 20-70°F + visible moisture)." },
      ],
    },
    {
      area: "Center Stack — Avionics",
      items: [
        { name: "GMA Audio Panel (top)", note: "Selects which COM you're transmitting on, monitor mode for inactive COMs, intercom, marker beacon. Set COM1 = primary, COM2 = standby/monitor." },
        { name: "Garmin GNS 430W", note: "Primary GPS, COM1, NAV1. Loads & flies enroute, terminal, and approaches (RNAV/GPS, ILS, LOC, VOR). CDI button toggles GPS↔VLOC. The PROC button accesses approaches/departures/arrivals." },
        { name: "KX 155 (TSO)", note: "COM2 / NAV2. Independent backup to the 430W's COM1/NAV1. Has its own flip-flop frequency." },
        { name: "NARCO DME 190", note: "Distance Measuring Equipment. Tunes off NAV1 or NAV2. Reads distance, groundspeed, time-to-station." },
      ],
    },
    {
      area: "Gear & Annunciators",
      items: [
        { name: "Gear Handle (down/up)", note: "Electrically-actuated hydraulic gear typical for PA-30. Verify 3 green lights (or single annunciator + uplock indicators per modification status). 'GEAR DOWN' green annunciator visible." },
        { name: "GEAR UP (amber)", note: "Lights when gear is in transit or up — verify before turning final downwind→base." },
        { name: "GEAR DOWN (green)", note: "Confirms all three down and locked. NO GREEN = NO LANDING. Use the emergency gear extension procedure if needed." },
        { name: "Stall warning (amber, top right of gear panel)", note: "Vane-driven horn/light. Inop when master off — placarded." },
      ],
    },
    {
      area: "Lower Switch Panel",
      items: [
        { name: "Master switch", note: "Bus master. Controls battery and alternator field." },
        { name: "Alternators L / R", note: "Individual alternator switches. Both should be ON for normal ops. Verify alt amps positive after start." },
        { name: "Mags L / R (each engine)", note: "Independent mag switches per engine. Runup checks each mag at the POH-specified RPM." },
        { name: "Starters L / R", note: "Individual starter switches. Start left first per POH typical." },
        { name: "Fuel Pumps L / R", note: "Electric boost pumps. ON for start, takeoff, landing, fuel tank changes, and per POH for engine failure procedures." },
        { name: "Lights", note: "Beacon, strobes, position, instrument, landing — verify all functional pre-flight." },
      ],
    },
    {
      area: "Throttle Quadrant",
      items: [
        { name: "Throttles (BLACK, two)", note: "Manifold pressure control. Full forward = full power. Match both engines' MP during climb/cruise." },
        { name: "Propellers (BLUE, two)", note: "Constant-speed control. FULL FORWARD = high RPM (low pitch). Pull aft = lower RPM (higher pitch). Pull all the way back = FEATHER (only with mixture cutoff in normal ops)." },
        { name: "Mixtures (RED, two)", note: "Fuel-air ratio. FULL FORWARD = full rich. Lean for cruise above ~3000 ft DA per POH. Pull all the way back = IDLE CUTOFF (engine shutdown / feathering sequence)." },
        { name: "Cowl Flaps", note: "Open for ground ops, takeoff, climb, low-airspeed/high-power. Close for cruise to manage CHT. Reduce drag at the cost of CHT." },
      ],
    },
  ],
  // Aircraft-specific quiz questions
  quiz: [
    { q: "N1100L's autopilot status:", a: ["Fully functional", "INOP — placarded, plan to hand-fly all approaches", "Functional but slaved to G5 only", "Functional only in cruise"], correct: 1, explain: "The panel has an A/P INOP placard. For Private AMEL add-on this isn't a problem — the checkride doesn't require autopilot use — but it means single-engine instrument approaches are hand-flown, which is harder. Plan workload accordingly: get the approach loaded and briefed BEFORE engine failure simulation, use the G5 HSI for primary nav reference, and consider going missed earlier than you would with autopilot help." },
    { q: "What does the placard above the gear handle ('MAX GEAR DOWN SPEED 150 MPH') correspond to?", a: ["Vmc", "Vle — max gear EXTENDED speed", "Vlo — max gear OPERATING speed", "Vfe"], correct: 1, explain: "Vle = Velocity, Landing gear, Extended. The maximum airspeed at which the airplane may be flown with gear DOWN. Vlo (operating) is the max speed at which you may RAISE or LOWER the gear — sometimes the same number, sometimes different. On many PA-30s they're both 150 mph; verify against this aircraft's POH." },
    { q: "Stall warning system on N1100L is INOP when:", a: ["Pitot heat is off", "The master switch is off", "Above 5000 ft", "Gear is up"], correct: 1, explain: "Placarded next to the stall warning light. It's electrically powered, so it requires master ON to function. Practical implication: during pre-flight runup, verify the stall warning works (lift the vane, hear the horn). Pre-takeoff item, not optional." },
    { q: "Loss of vacuum in N1100L would cause loss of which instruments?", a: ["Both G5s and the airspeed indicator", "Attitude indicator (steam) and DG only — G5s and TC are unaffected", "All flight instruments", "Only the GNS 430W"], correct: 1, explain: "The dual G5s are electric (with internal battery backup), and the turn coordinator is electric. A vacuum failure would only kill the legacy steam AI and DG (if present). This is a HUGE redundancy improvement over a vacuum-only panel. You'd still have G5 attitude + G5 HSI + electric TC. Practical: vacuum loss in N1100L is an annoyance, not an emergency." },
    { q: "On the GNS 430W, switching from GPS to VLOC for an ILS approach is done:", a: ["Automatically by the unit", "Manually with the CDI button — typically when the unit prompts, on the intermediate segment before localizer intercept", "At the FAF only", "On missed approach"], correct: 1, explain: "The 430W will display a prompt: 'SET CRS to xxx and switch CDI to VLOC.' You press the CDI button to toggle. The G5 HSI will then show the localizer needle from the 430W's NAV side. RNAV (GPS) approaches stay on GPS the whole way." },
    { q: "PA-30 auxiliary fuel tank usage is typically restricted to:", a: ["Takeoff and landing only", "Level cruise flight only — NOT for takeoff, landing, or single-engine operation", "Anytime above 1000 ft AGL", "No restrictions"], correct: 1, explain: "Standard PA-30 POH limitation. Aux tanks have no fuel pickup geometry suited for high pitch attitudes (takeoff/climb) or banked flight, and aren't certified for engine failure / single-engine operation. Switch to mains for takeoff, climb, descent, landing, and single-engine ops. Verify exact wording in this aircraft's POH." },
    { q: "On the engine monitor (CGR-30P), which parameter most directly indicates impending engine damage from heat?", a: ["RPM", "Manifold pressure", "Cylinder Head Temperature (CHT)", "Fuel flow"], correct: 2, explain: "CHT is the canary. Sustained CHTs above ~400°F (well below the redline of 460°F) shorten cylinder life dramatically. If you see climbing CHTs: enrich mixture, reduce power, increase airspeed (better cooling), open cowl flaps. CHT management is how you keep $50K+ engine overhauls on schedule instead of premature." },
    { q: "Both alternators showing 0.0 amps in flight indicates:", a: ["Normal cruise condition", "Both alternators have failed — battery is now the only source of electrical power, load-shed immediately", "Master switch failure only", "A G5 issue"], correct: 1, explain: "Dual alternator failure is rare but catastrophic on a long IFR flight. Battery alone gives you maybe 30 minutes of full panel before voltage drops below G5 sustaining levels (G5s have ~4 hr internal battery). LOAD SHED: unnecessary lights, second COM, DME, transponder to standby briefly, etc. Land at the nearest suitable airport. Both showing 0.0 with engines OFF (as in the parked photo) is normal." },
    { q: "Manual alternate air control on the PA-30:", a: ["Activates automatically when carb ice is detected", "Must be MANUALLY pulled full-on by the pilot when induction blockage is suspected", "Only works above 5000 ft", "Is connected to the cowl flap lever"], correct: 1, explain: "Placarded on the panel. Fuel-injected engines don't get carb ice (no carburetor), but they CAN get induction icing — ice forming in the air intake from impact icing or freezing rain. If you suspect induction blockage (loss of power, rising MP unexplained), pull the alt air control. Manual = you have to remember it. Brief it before flight in any visible-moisture conditions." },
    { q: "Throttle quadrant color code: BLUE handles control:", a: ["Mixture", "Throttles", "Propellers (constant-speed prop control)", "Cowl flaps"], correct: 2, explain: "Standard piston-twin convention: BLACK = throttles, BLUE = propellers, RED = mixtures. Memorize cold. Reaching for the wrong handle in an emergency = pulling mixture when you meant prop = engine shutdown when you wanted feather. Always verify by COLOR before moving anything." },
  ],
};

// ---------- PERFORMANCE PLANNING (Lubbock, early May, PA-30) ----------
const PERFORMANCE = {
  context: {
    location: "Lubbock area (KLBB and F49 Slaton)",
    season: "Early May",
    elevations: {
      KLBB: 3282,
      F49: 3124,
    },
    typicalWeather: {
      highF: 85,
      lowF: 57,
      windKt: "10-20",
      notes: "Lubbock is consistently windy. Plan for crosswind components every flight. Mornings cooler, afternoons can push DA into the danger zone for single-engine climb.",
    },
  },
  daScenarios: [
    {
      label: "Cool morning (60°F at KLBB)",
      tempF: 60, fieldElev: 3282,
      pressureAlt: 3282, da: 3100,
      verdict: "best", verdictText: "Easy day. Full single-engine performance available.",
    },
    {
      label: "Mild midday (75°F at KLBB)",
      tempF: 75, fieldElev: 3282,
      pressureAlt: 3282, da: 4500,
      verdict: "good", verdictText: "Normal. Single-engine climb still healthy at gross.",
    },
    {
      label: "Warm afternoon (85°F at KLBB)",
      tempF: 85, fieldElev: 3282,
      pressureAlt: 3282, da: 5800,
      verdict: "caution", verdictText: "Single-engine climb degraded ~30%. Consider weight reduction. Long runway preferred.",
    },
    {
      label: "Hot day (95°F at KLBB)",
      tempF: 95, fieldElev: 3282,
      pressureAlt: 3282, da: 7200,
      verdict: "danger", verdictText: "Approaching single-engine service ceiling at gross weight (~7,100 ft). Engine failure on departure = controlled descent into terrain. Either reduce weight significantly or scrub.",
    },
  ],
  keyNumbers: [
    { label: "PA-30 single-engine service ceiling (gross weight, std day)", value: "~7,100 ft", note: "Where single-engine climb = 50 fpm" },
    { label: "Single-engine absolute ceiling", value: "~7,500 ft", note: "Where single-engine climb = 0 fpm" },
    { label: "Approximate DA increase per 10°F above ISA", value: "+700 ft", note: "Rule of thumb. ISA at field elevation 3,300 ft = ~47°F." },
    { label: "Approximate DA increase per 10°C above ISA", value: "+1,200 ft", note: "Same math, metric." },
    { label: "KLBB field elevation", value: "3,282 ft MSL", note: "Pattern altitude 4,300 ft MSL" },
    { label: "F49 (Slaton) field elevation", value: "3,124 ft MSL", note: "Home base for training" },
  ],
  chartUseGuide: [
    {
      chart: "Takeoff Distance (ground roll + over 50 ft obstacle)",
      inputs: ["Pressure altitude", "OAT", "Aircraft weight", "Headwind/tailwind", "Runway slope (usually 0)", "Surface (paved/grass)"],
      output: "Distance to clear 50 ft obstacle in feet",
      whatToWatch: "Lubbock typically has long runways — KLBB has 11,500 ft runway, F49 has 4,600 ft. F49 is the one to math out carefully on hot days at gross.",
    },
    {
      chart: "Accelerate-Stop Distance",
      inputs: ["Same as takeoff distance"],
      output: "Runway needed to accelerate to decision speed (Vr or Vmc per POH), lose an engine, and stop on remaining runway",
      whatToWatch: "If accelerate-stop > runway available, you have no abort margin. F49's 4,600 ft is the constraint. On a hot day at gross, this gets tight.",
    },
    {
      chart: "Single-Engine Climb (rate of climb, gear up, prop feathered)",
      inputs: ["Pressure altitude", "OAT", "Aircraft weight"],
      output: "fpm climb single-engine",
      whatToWatch: "THE chart that determines whether engine failure on departure is survivable. If chart says 100 fpm at your DA and weight, engine failure means a slow climb to nearest airport. If it says 0 fpm, you're descending into whatever's ahead.",
    },
    {
      chart: "Cruise Performance (TAS, fuel flow vs altitude/power)",
      inputs: ["Pressure altitude", "OAT", "Power setting (% or MP/RPM)", "Mixture (best power vs best economy)"],
      output: "TAS in mph/kt, fuel flow GPH per engine",
      whatToWatch: "Less critical for checkride than departure performance, but examiner may ask for cruise calculation as a setup question.",
    },
    {
      chart: "Landing Distance",
      inputs: ["Pressure altitude", "OAT", "Aircraft weight", "Headwind/tailwind"],
      output: "Distance to stop from 50 ft AGL",
      whatToWatch: "Less of a factor in Lubbock with long runways, but include in calculation. Tailwind dramatically increases landing distance.",
    },
  ],
  scenarios: [
    {
      setup: "It's early May, KLBB, 1500 local. OAT 85°F. Wind 220 at 18. You're at gross weight (3,600 lbs). Runway 17R (11,500 ft).",
      question: "Density altitude?",
      answer: "~5,800 ft DA. Field elev 3,282 + (85°F − 47°F ISA = 38°F above ISA) × 70 ft/°F ≈ +2,650 ft → DA ~5,930 ft. Round to 5,800-6,000 ft.",
      examinerLooksFor: "Approximate DA reasoning. Don't need exact — need to recognize you're at 5,000-6,000 ft DA on an 85°F afternoon.",
    },
    {
      setup: "Same day. You compute single-engine climb at 5,800 ft DA, 3,600 lbs from the chart: 130 fpm.",
      question: "Engine fails 200 ft after liftoff. Discuss your options.",
      answer: "Maintain control — pitch blue line. Climb available is 130 fpm best case. Option 1: long runway behind you (11,500 ft) — land straight ahead, gear down if just lifted off. Option 2: if past the runway, climb out at Vyse, declare, return to KLBB or divert to F49 (8 nm SE). With 130 fpm I can climb to pattern altitude in about 8 minutes — viable but not heroic. Single-engine missed approach NOT advisable at this DA — go missed early if needed.",
      examinerLooksFor: "Recognition that Lubbock's long runways are a SAFETY ASSET — straight-ahead landing is the right answer if you're below pattern altitude. ALSO recognition that single-engine performance is degraded but not zero at this DA.",
    },
    {
      setup: "Same conditions but at F49 (3,124 ft elev) with 4,600 ft runway. 85°F. Gross weight.",
      question: "Go or no-go?",
      answer: "Compute accelerate-stop distance. At 5,500 ft DA, gross weight, no wind: AS distance ~3,800-4,000 ft from typical PA-30 charts. With 4,600 ft runway available you have ~600-800 ft margin — tight but legal. Headwind extends margin. Tailwind kills it. PROBABLE: go with full headwind component, no tailwind, awareness that you're accepting a tight abort margin. ALTERNATIVE: reduce weight by 200 lbs (one less passenger or partial fuel), AS distance drops ~400 ft, much more comfortable margin.",
      examinerLooksFor: "Understanding that go/no-go is a calculation, not a feeling. Willingness to articulate margin in feet, not vibes. Acknowledgment that 'reduce weight' is always an option.",
    },
    {
      setup: "100°F day, KLBB, gross weight, runway 17R 11,500 ft, no wind.",
      question: "Discuss whether you'd take off.",
      answer: "DA = 3,282 + (100−47) × 70 = ~7,000 ft DA. That's AT or ABOVE single-engine service ceiling for PA-30 at gross. Engine failure after liftoff = airplane CANNOT MAINTAIN ALTITUDE single-engine. Runway length is irrelevant once airborne — terrain is the constraint. Decision: reduce weight (depart with min fuel + go fuel up at lower-DA destination), wait for cooler temps, or scrub. Long runway doesn't save you from the climb chart.",
      examinerLooksFor: "Recognition that runway length is NOT the only constraint — single-engine ceiling is. Willingness to refuse a flight that's legally possible but operationally unsafe.",
    },
  ],
  quiz: [
    { q: "On an 85°F afternoon at KLBB (3,282 ft MSL), approximate DA is:", a: ["3,300 ft", "4,500 ft", "5,800 ft", "8,000 ft"], correct: 2, explain: "Field 3,282 + ISA deviation. ISA at 3,282 ft ≈ 47°F. 85°F is 38°F above ISA. DA increase ≈ 38 × 70 = ~2,650 ft. 3,282 + 2,650 ≈ 5,900 ft. The trap answer (3,300 ft) ignores temperature entirely." },
    { q: "PA-30 single-engine service ceiling at gross weight, standard day, is approximately:", a: ["3,000 ft", "5,000 ft", "7,100 ft", "12,000 ft"], correct: 2, explain: "About 7,100 ft. That's where single-engine climb degrades to 50 fpm. Practical implication for Lubbock: a 95°F day puts your DA at ~7,200 ft — at or above this ceiling — meaning engine failure on departure leaves no climb capability." },
    { q: "F49 (Slaton) runway length is 4,600 ft. On an 85°F day at gross weight, accelerate-stop distance is approximately:", a: ["2,000 ft", "3,800 ft", "5,500 ft", "Always less than runway available"], correct: 1, explain: "Roughly 3,800-4,000 ft from typical PA-30 POH charts at ~5,500 ft DA, gross weight, no wind. Margin against 4,600 ft runway is ~600-800 ft — legal but tight. Headwind helps; tailwind kills it." },
    { q: "Engine failure 100 ft AGL after takeoff at KLBB on a hot day, runway 11,500 ft and majority remaining. Best action:", a: ["Climb out at Vyse, declare, return", "Land straight ahead on remaining runway, gear down if available", "Pitch up to clear obstacles", "Bank toward operating engine and try to circle back"], correct: 1, explain: "Lubbock's long runways are an asset. If you have runway remaining at 100 ft AGL, the SAFE answer is land straight ahead. Climbing out single-engine at high DA when you have a runway is taking the harder option for no reason. Pre-takeoff briefing: 'Runway remaining → land. No runway → blue line, identify-verify-feather, return.'" },
    { q: "Why is the single-engine climb chart the most safety-critical performance chart for Lubbock operations in May?", a: ["It's required by FAA", "Lubbock's high field elevation (~3,300 ft) plus warm temps push DA to 5,000-6,000+ ft, where PA-30 single-engine climb capability degrades significantly", "It tells you cruise speed", "It's used for landing only"], correct: 1, explain: "Lubbock is high-elevation by piston-twin standards. Combine field elevation (~3,300 ft) with typical May afternoon temps (80-90°F) and DA quickly hits 5,000-6,000 ft. The PA-30 loses single-engine climb capability fast as DA increases. Knowing the climb-rate number for the day is what separates a safe go/no-go from a guess." },
    { q: "Approximate rule of thumb: DA increase per 10°F above ISA?", a: ["+100 ft", "+700 ft", "+2,000 ft", "+10,000 ft"], correct: 1, explain: "About +700 ft per 10°F above ISA. So 30°F above ISA ≈ +2,100 ft DA. Useful for ramp math when you don't have charts handy. The metric version: +1,200 ft per 10°C above ISA." },
  ],
};

// ---------- CURRICULUM ----------
const CURRICULUM = [
  // ============ DAY 1 ============
  {
    id: "d1", day: "Day 1", icon: "BookOpen",
    blocks: [
      {
        id: "g1", kind: "ground", title: "Ground Lesson 1",
        topics: [
          {
            id: "critical-engine",
            title: "Critical Engine",
            summary: "The engine whose failure most adversely affects performance and handling.",
            teach: [
              "**Definition:** The critical engine is the engine whose failure would most adversely affect the performance or handling qualities of the airplane.",
              "**On a conventional twin** (both props rotating clockwise from the pilot's view, like a standard PA-30): the **LEFT engine is critical**.",
              "**Why? Memorize P-A-S-T:**",
              {
                text: "**P — P-factor.** The descending propeller blade produces more thrust than the ascending blade. With both engines rotating clockwise, the descending blade of each engine is on its right side. That puts the right engine's effective thrust line *farther* from centerline than the left's. Lose the left engine and the surviving right engine creates a yawing moment on a longer arm — harder to control.",
                eli16: "Imagine the propeller blade going DOWN on one side and UP on the other as it spins. The blade going DOWN bites into the air harder — like swimming. So one side of the prop pulls the airplane forward more than the other side. This off-center pull is called P-factor.",
              },
              {
                text: "**A — Accelerated slipstream.** Same geometry: the right engine's high-velocity slipstream acts on a longer moment arm.",
                eli16: "The propeller throws air backward really fast — like a fan. That fast air hits the wing behind it and creates extra lift on that side. The strongest part of the air-throwing happens off-center, not in the middle of the engine.",
              },
              {
                text: "**S — Spiraling slipstream.** The left engine's slipstream wraps around the fuselage and strikes the left side of the vertical stabilizer, *helping* counteract left-yaw tendency. Lose the left engine and you lose that helpful airflow.",
                eli16: "Picture the air coming off the prop like water swirling down a drain — it spins as it goes back. That spinning air hits the tail of the airplane and pushes it sideways. The LEFT engine's spinning air helps push the tail in a useful direction, so when the left engine quits, you lose that helpful push.",
              },
              {
                text: "**T — Torque.** Both engines produce torque that rolls the airplane left. With the left engine out and right engine at high power, torque rolls you toward the dead engine — exactly the wrong direction.",
                eli16: "When you spin a drill, your hand twists the OPPOSITE way. The propeller does the same thing to the airplane — it tries to roll the plane the other direction. Both engines roll the plane LEFT. With the left engine dead and the right engine at full power, you're getting rolled hard left — toward the dead engine — exactly the wrong direction.",
              },
              "**PA-30 vs PA-39:** The standard PA-30 is *not* counter-rotating — left engine is critical. The PA-39 has counter-rotating props — neither engine is critical. Confirm which airframe you're flying.",
            ],
            quiz: [
              { q: "On a conventional twin with both props rotating clockwise (pilot's view), which is the critical engine?", a: ["Left", "Right", "Either", "Neither"], correct: 0, explain: "Both props rotating clockwise → descending blades on the right side of each engine → right engine's thrust acts on a longer arm. Losing the LEFT means surviving thrust is on the longer arm — bigger yaw, harder to control. Hence left = critical." },
              { q: "What does the 'P' in P-A-S-T stand for?", a: ["Power", "P-factor", "Pitch", "Propeller"], correct: 1, explain: "P-A-S-T = P-factor, Accelerated slipstream, Spiraling slipstream, Torque. The four reasons the left engine is critical on a conventional twin." },
              { q: "Why does losing the left engine produce a larger yawing moment on a conventional twin?", a: ["The left engine is more powerful", "The right engine's thrust line is farther from centerline (longer arm)", "The right engine produces more torque", "The left engine has a longer prop"], correct: 1, explain: "P-factor puts each engine's high-thrust point on its descending (right) blade. That makes the right engine's effective thrust line farther outboard. Yawing moment = force × arm. Longer arm = bigger moment." },
              { q: "On a counter-rotating twin (e.g., PA-39), which engine is critical?", a: ["Left", "Right", "Neither — there is no critical engine", "Both"], correct: 2, explain: "Counter-rotating props mean both descending blades are inboard (or both outboard, depending on direction), so thrust is symmetric about centerline. Neither engine has a longer moment arm — neither is critical." },
              { q: "Which 'helpful' aerodynamic effect from the left engine is LOST when the left engine fails?", a: ["P-factor on the right engine", "Spiraling slipstream over the vertical stabilizer", "Accelerated slipstream over the right wing", "Torque from the right engine"], correct: 1, explain: "The left engine's slipstream wraps around the fuselage and strikes the LEFT side of the vertical stabilizer, creating a small yaw force that opposes the airplane's natural left-yaw tendency. Lose the left engine, lose that helpful airflow." },
            ],
          },
          {
            id: "vmc",
            title: "Vmc — Minimum Control Speed",
            summary: "The minimum airspeed at which directional control can be maintained with the critical engine inoperative.",
            teach: [
              "**Vmc** is the minimum flight speed at which the airplane is directionally controllable with the critical engine inoperative, the operating engine at max power, and the airplane flown within specific certification conditions.",
              "**Marked on the airspeed indicator as a RED RADIAL LINE.**",
              "**Certification conditions** (14 CFR §23.149) — memorize these, the examiner will ask:",
              "  • Critical engine windmilling (most drag)",
              "  • Operating engine at maximum takeoff power",
              "  • Most unfavorable weight (typically lighter)",
              "  • Most unfavorable CG (aft)",
              "  • Landing gear retracted",
              "  • Flaps in takeoff position",
              "  • Up to 5° bank toward the operating engine",
              "  • Standard day, sea level",
              "**Below Vmc with an engine out, the rudder cannot overcome the asymmetric thrust** — the airplane yaws and rolls toward the dead engine. This is a Vmc roll. Unrecoverable at low altitude.",
              "**Recovery from imminent Vmc loss of control:** REDUCE POWER on the operating engine, LOWER THE NOSE to gain airspeed, then re-establish controlled flight. Don't try to power your way out of it.",
            ],
            quiz: [
              { q: "Vmc is marked on the airspeed indicator as a:", a: ["Blue line", "Red radial line", "Yellow arc", "White arc"], correct: 1, explain: "Vmc = RED radial line. Vyse (best rate single-engine) = BLUE radial line. Easy mnemonic: 'Red = Dead' (below Vmc with engine out = dead), 'Blue = Best (single-engine climb).'" },
              { q: "Maximum bank angle assumed in the Vmc certification standard?", a: ["0°", "Up to 5° toward the operating engine", "10° toward the dead engine", "15° wings level"], correct: 1, explain: "14 CFR §23.149 allows up to 5° bank toward the OPERATING engine in the Vmc determination. That bank produces a horizontal lift component that helps counter the asymmetric yaw — the only assumption in the cert standard that makes Vmc lower." },
              { q: "If you encounter Vmc loss of control, your FIRST action is:", a: ["Add full power on the good engine", "Pull the nose up to slow further", "Reduce power on the operating engine and lower the nose", "Feather the operating engine"], correct: 2, explain: "More power on the good engine = more asymmetric thrust = MORE yaw. The fix is the opposite: reduce power to reduce the asymmetry, lower the nose to gain airspeed back above Vmc, then re-establish controlled flight. Counterintuitive but lifesaving." },
              { q: "Per certification, the inoperative engine is assumed to be:", a: ["Feathered", "Windmilling", "At idle", "Shut down with prop stopped"], correct: 1, explain: "The certification assumes WINDMILLING — the worst-case drag condition. A feathered prop has much less drag, which is why feathering in real life lowers actual Vmc below the published red line." },
              { q: "Per certification, the gear and flaps are:", a: ["Gear down, flaps full", "Gear up, flaps in takeoff position", "Gear up, flaps up", "Gear down, flaps up"], correct: 1, explain: "Gear UP, flaps in TAKEOFF position. This represents the most-likely engine-failure scenario (just after liftoff, before clean-up complete). Gear-down would actually add a small amount of directional stability (keel effect)." },
            ],
          },
          {
            id: "vmc-factors",
            title: "Vmc Factors — Performance vs Controllability",
            summary: "How each variable affects single-engine performance, controllability, and actual Vmc.",
            isFactorTable: true,
            teach: [
              "This is the single most testable concept in the multi-engine oral. The examiner will name a factor and ask: *what does it do to performance, controllability, and Vmc?*",
              "**Key insight:** Performance and Vmc do NOT always move together. A factor can hurt your climb performance while *lowering* Vmc, and vice versa.",
              "**Use the table below.** Up arrow ↑ means the factor *increases* the metric. Down arrow ↓ means *decreases*.",
              "**The deceptive ones to memorize:**",
              "  • **High DA:** Performance ↓ but Vmc ↓ too (less power available = less asymmetric thrust). Real Vmc can be lower than the published red line at altitude — which is *more* dangerous because you'll stall before you lose control.",
              "  • **Aft CG:** Performance ↑ slightly but Vmc ↑ (shorter rudder arm = less rudder authority).",
              "  • **Max gross weight:** Performance ↓ but Vmc ↓ (more horizontal lift component when banked counters yaw).",
              "  • **Bank toward operating engine (5°):** Performance ↑ AND Vmc ↓ — the only factor that helps both. That's why zero-sideslip technique matters so much.",
            ],
            quiz: [
              { q: "Effect of HIGH DENSITY ALTITUDE on Vmc?", a: ["Vmc increases", "Vmc decreases (less power available, less asymmetric thrust)", "No effect", "Vmc only changes with weight"], correct: 1, explain: "Less air → less power from the operating engine → less asymmetric thrust → less rudder needed to control. Vmc decreases. The TRAP: at altitude, actual Vmc may drop below stall speed, meaning the airplane will STALL before losing directional control. A stall with one engine windmilling = Vmc roll. The published red line gives no warning." },
              { q: "Effect of AFT CG on Vmc?", a: ["Vmc decreases", "Vmc increases (shorter rudder arm)", "No effect", "Same as forward CG"], correct: 1, explain: "Aft CG = shorter distance between CG and rudder = shorter moment arm for the rudder. Less rudder authority means more airspeed needed to generate enough rudder force to counter the asymmetric thrust. Vmc goes UP." },
              { q: "Effect of MAX GROSS WEIGHT on Vmc?", a: ["Vmc increases", "Vmc decreases (horizontal lift component when banked)", "No effect", "Doubles Vmc"], correct: 1, explain: "Heavier airplane + the 5° bank toward the live engine = larger horizontal lift component working against the asymmetric yaw. Vmc actually DECREASES. But performance also tanks — heavier = worse climb. Vmc and performance moving in opposite directions is the whole point of the factor table." },
              { q: "Bank up to 5° toward the operating engine has what effect?", a: ["Performance ↑ and Vmc ↑", "Performance ↓ and Vmc ↓", "Performance ↑ and Vmc ↓ (helps both)", "Performance ↓ and Vmc ↑"], correct: 2, explain: "The unicorn factor — bank toward the live engine HELPS both. Reduces sideslip (less drag = better climb) AND adds horizontal lift component (lower Vmc). That's why zero-sideslip technique with ~2° bank toward the live engine is so important after a real engine failure." },
              { q: "FEATHERING the inoperative prop (vs windmilling) does what to Vmc?", a: ["Increases Vmc", "Decreases Vmc (less drag, less asymmetric force)", "No change", "Only matters above 5000 ft"], correct: 1, explain: "Windmilling props are huge drag generators — that's the worst-case the cert standard assumes. Feathering eliminates most of that drag, which dramatically reduces the asymmetric force and lowers actual Vmc. This is why the engine-failure flow prioritizes feathering quickly." },
              { q: "Why is the published Vmc considered conservative at altitude?", a: ["Because the red line is calibrated for sea level / max power conditions; actual Vmc is lower at altitude — and you may stall before losing control", "Because the FAA pads it by 10%", "Because props change pitch automatically", "It isn't conservative"], correct: 0, explain: "Published Vmc is for sea-level standard day with full power available. At altitude, normally-aspirated engines lose power, asymmetric thrust drops, actual Vmc drops. The danger isn't that Vmc is too high — it's that real Vmc may now be BELOW stall speed, so the airplane stalls without warning of Vmc approach." },
              { q: "Effect of operating engine at MAX POWER on Vmc?", a: ["Decreases Vmc", "Increases Vmc (more asymmetric thrust)", "No effect", "Only on takeoff"], correct: 1, explain: "More power on the live engine = more asymmetric force = more rudder needed = higher Vmc. That's why the Vmc recovery is to REDUCE power on the operating engine — it actually lowers Vmc and lets you regain control." },
              { q: "Gear up / flaps up (clean takeoff config) — effect on Vmc?", a: ["Decreases Vmc", "Increases Vmc (less keel / fin effect, less rudder authority from flap-blown air)", "No effect", "Same as gear down"], correct: 1, explain: "Gear and flaps act as 'keel' surfaces that add directional stability and let the airplane resist yaw at lower airspeeds. Take them away (clean config) and you need more airspeed to maintain control. Gear-down would actually lower Vmc slightly — but you don't leave gear down for performance reasons after engine failure." },
            ],
          },
          {
            id: "zero-sideslip",
            title: "Zero Sideslip",
            summary: "The bank/rudder combination that minimizes drag and maximizes single-engine climb.",
            teach: [
              "**Problem:** After an engine failure, asymmetric thrust yaws the airplane. If you just step on the rudder and keep wings level, the airplane is flying *sideways* through the air — huge drag, terrible climb.",
              "**Zero sideslip:** The condition where the relative wind is parallel to the longitudinal axis. No sideways airflow = minimum drag = maximum single-engine climb.",
              "**How to achieve it:** Bank approximately **2° toward the OPERATING engine**, with rudder such that the inclinometer **ball is displaced about ½ ball-width toward the operating engine** (NOT centered).",
              "**Memory aid:** *'Raise the dead'* — raise the wing on the dead-engine side, which means banking toward the live engine.",
              "**Payoff:** Done correctly, zero-sideslip can roughly *double* your single-engine climb rate vs wings-level / ball-centered.",
              "This is the configuration you'll fly during your Vyse climb after the failure is identified, verified, feathered, and secured.",
            ],
            quiz: [
              { q: "In zero-sideslip after an engine failure, you bank:", a: ["Toward the dead engine", "Toward the operating engine", "Wings level", "Whichever feels coordinated"], correct: 1, explain: "Bank TOWARD the live engine. This counteracts the rolling tendency caused by asymmetric thrust AND reduces sideslip drag AND lowers Vmc — three benefits in one. 'Raise the dead' = raise the dead engine's wing." },
              { q: "Approximate bank angle for zero sideslip?", a: ["0°", "About 2° toward the operating engine", "5° toward the dead engine", "10° toward the operating engine"], correct: 1, explain: "About 2° toward the live engine — small but critical. The 5° in the cert standard is the MAXIMUM allowed for Vmc determination; real-world zero sideslip is closer to 2° because that's what minimizes total drag." },
              { q: "In zero-sideslip the inclinometer ball is:", a: ["Perfectly centered", "Fully deflected toward the operating engine", "About ½ ball displaced toward the operating engine", "Fully deflected toward the dead engine"], correct: 2, explain: "Counterintuitive but correct. With wings level + ball centered, the airplane is actually slipping. The 'coordinated' look (centered ball) is wrong here. About ½ ball toward the live engine = relative wind parallel to longitudinal axis = minimum drag." },
              { q: "'Raise the dead' refers to:", a: ["Recovering from a Vmc roll", "Raising the wing on the dead-engine side (banking toward live engine)", "Pulling the dead mixture", "Restarting a failed engine"], correct: 1, explain: "Mnemonic for zero sideslip. The dead engine's wing wants to drop (loss of lift, asymmetric drag). Raising it = banking toward the live engine = the correct attitude for best single-engine performance." },
            ],
          },
        ],
      },
      {
        id: "f1", kind: "flight", title: "Flight Lesson 1",
        topics: [
          {
            id: "engine-start",
            title: "Engine Start, Runup & Prop Cycling",
            summary: "Twin Comanche start procedure, mag check, and feather check.",
            teach: [
              "**Always run the printed checklist** — never from memory in a complex twin.",
              "**Start sequence:** master ON, fuel pump ON, mixture rich, throttle cracked ¼ inch, prop full forward, mags BOTH (or START), starter engage. After start: fuel pump OFF, verify oil pressure rises into green within ~30 seconds.",
              "**Runup:** each engine individually. Mag check at the RPM specified in the POH (commonly ~2000 RPM). Watch for max drop and max differential between mags per POH.",
              "**Prop cycle (twin-specific):** cycle each prop control toward low-RPM 2–3 times. Why? To circulate WARM oil into the propeller hub — feathering depends on oil pressure, and cold oil delays feather.",
              "**Feather check:** at low RPM per POH, briefly pull the prop control toward feather and watch RPM drop, then return to high RPM. **Don't go full feather on the ground** — confirms the feather mechanism is functional only.",
              "**Pre-takeoff brief (the most important checklist item):** *'Below Vmc — abort, throttles closed, brakes. Above Vmc with runway remaining — land. Airborne with no runway — gear up, identify-verify-feather-secure, climb at blue line, return for landing.'*",
            ],
            quiz: [
              { q: "Why cycle the prop controls during runup in a twin?", a: ["To check magneto drop", "To circulate warm oil through the prop hub for feathering", "To check fuel flow", "To warm the engine"], correct: 1, explain: "Constant-speed feathering props use OIL PRESSURE to drive blades to low pitch / high RPM. When oil pressure is interrupted, springs and counterweights drive blades to feather. Cold, thick oil delays feathering — sometimes by enough to matter. Cycling circulates warm oil into the hub before takeoff." },
              { q: "During a feather check on the ground, you:", a: ["Pull the prop fully into feather and let it stop", "Briefly move the prop toward feather, observe RPM drop, return", "Skip it — only done in flight", "Pull mixture to idle cutoff"], correct: 1, explain: "Brief move toward feather = confirms the mechanism works (RPM drops). Going to FULL feather on the ground would stop the prop, requiring a starter to break it free — hard on the engine and not necessary for confirmation." },
              { q: "The takeoff briefing's 'blue line' refers to:", a: ["Vmc", "Vx", "Vyse — best rate of climb single engine", "Vfe"], correct: 2, explain: "Blue line = Vyse = best rate of climb single engine. After an engine failure airborne, your sole pitch target is blue line. Red line (Vmc) is what you must stay above to maintain control. Blue line is what you climb at." },
              { q: "After a successful start, the electric fuel pump should be:", a: ["Left on indefinitely", "Turned off, with engine-driven pump verified producing pressure", "Left on until takeoff", "Turned off only above 1000 ft"], correct: 1, explain: "Electric pump assists during start. Once running, the engine-driven pump should produce normal pressure on its own — turn off the electric pump and verify pressure stays in the green. If it doesn't, you have an engine-driven pump problem to diagnose before flight." },
            ],
          },
          {
            id: "normal-takeoff",
            title: "Normal Takeoff and Climb",
            summary: "Multi-engine normal takeoff profile, speeds, and gear/flap discipline.",
            teach: [
              "**Line-up:** heading bug set to runway heading, transponder ALT, lights on, brief one more time.",
              "**Throttles up smoothly together to full power.** Verify both engines green, MP and RPM matched, fuel flow in range, oil pressure good — *before* releasing brakes or committing past abort speed.",
              "**Rotate at Vr** (per POH; ~80 mph in a PA-30 — verify your aircraft).",
              "**Initial climb at Vy** until clear of obstacles and a safe altitude (commonly 500 ft AGL).",
              "**Positive rate, no usable runway → GEAR UP.** Gear up timing matters: too early and a touch-down would be expensive; too late and you accept drag during a critical phase.",
              "**At a safe altitude:** reduce to climb power per POH (often '25 squared' — 25\" MP / 2500 RPM, or as published), accelerate to cruise climb.",
              "**Engine failure decision tree on takeoff:**",
              "  • Below Vmc → abort, no debate.",
              "  • Above Vmc, runway remaining → land on remaining runway.",
              "  • Above Vmc, airborne, no runway → gear up if not already, pitch for blue line (Vyse), identify–verify–feather–secure, declare emergency, return.",
            ],
            quiz: [
              { q: "After a normal takeoff with both engines, initial climb is at:", a: ["Vmc", "Vyse (blue line)", "Vy", "Vfe"], correct: 2, explain: "With BOTH engines running, you climb at Vy (best rate, both engines) — gives best altitude over time. Vyse is only your target if you LOSE an engine. Vmc and Vfe are limit speeds, not target speeds." },
              { q: "Engine fails airborne, above blue line, no runway remaining. First priority:", a: ["Identify and feather", "Pitch for blue line and maintain control", "Declare emergency", "Restart attempt"], correct: 1, explain: "Aviate, navigate, communicate. FIRST priority is always control — pitch for blue line, manage yaw with rudder. Identification and feathering happen AFTER positive control is established. Rushing identify/feather while not in control is how Vmc rolls happen." },
              { q: "Gear retraction timing on a normal takeoff:", a: ["Immediately at rotation", "Once positive rate is confirmed AND no usable runway remains", "After leaving the pattern", "At Vyse"], correct: 1, explain: "Two conditions: positive rate (you don't want gear up while still possibly settling onto the runway) AND no usable runway (if you lose an engine with runway remaining, you want gear DOWN to land back). Both must be true before gear up." },
            ],
          },
          {
            id: "steep-turns",
            title: "Steep Turns",
            summary: "Private ACS: 50° bank, ±100 ft altitude, ±10 kt airspeed, ±10° rollout.",
            teach: [
              "**Private AMEL ACS standard:** 50° bank ±5°, altitude ±100 ft, airspeed ±10 kt, rollout ±10° of entry heading. (Commercial is 50° bank ±5° with tighter tolerances — you're the private standard.)",
              "**Setup:** clearing turns, pick a maneuvering speed (per POH — often 130-ish mph in PA-30; verify Va).",
              "**Entry:** smooth roll into 50° bank, add power as bank increases (drag rises), increase back-pressure to maintain altitude.",
              "**Maintenance:** bank angle is the priority — small pitch corrections, scan outside primarily, glance at instruments.",
              "**Rollout:** lead by ~½ the bank angle (about 25°) to roll out on heading. Reduce back-pressure and power as bank decreases.",
            ],
            quiz: [
              { q: "Private AMEL steep turn ACS bank angle?", a: ["30°", "45°", "50°", "60°"], correct: 2, explain: "Private AMEL steep turn = 50° bank ±5°. (Private SEL is 45°, Commercial is also 50°, ATP is 45° at 250+ kt.) Multi-engine private gets the 50° standard." },
              { q: "Altitude tolerance for Private AMEL steep turns?", a: ["±50 ft", "±100 ft", "±150 ft", "±200 ft"], correct: 1, explain: "±100 ft altitude, ±10 kt airspeed, ±10° rollout heading, ±5° bank angle. Memorize all four — examiner will check each." },
              { q: "When rolling out of a 50° steep turn, you should lead by approximately:", a: ["10°", "25° (half the bank angle)", "45°", "Don't lead — roll out on heading"], correct: 1, explain: "Rule of thumb: lead rollout by HALF your bank angle. 50° bank = 25° lead. The faster you roll, the less lead needed; slow roll-out = full half-bank lead." },
            ],
          },
          {
            id: "slow-flight",
            title: "Slow Flight",
            summary: "Flight at an airspeed that any further increase in AOA, load factor, or power reduction would result in a stall warning.",
            teach: [
              "**Current ACS definition:** maneuver at the slowest airspeed at which the airplane is capable of maintaining controlled flight without activating the stall warning — typically 5–10 kt above stall warning onset.",
              "**Configuration:** as specified by examiner — typically gear and flaps configured for landing.",
              "**Tolerances (Private):** altitude ±100 ft, heading ±10°, airspeed +10/−0 kt, bank ±10° in turns.",
              "**Twin-specific:** be deliberate with power changes — asymmetric reduction near stall is a Vmc setup. Maintain coordination.",
              "**Recovery:** smoothly add power, lower nose to reduce AOA, retract flaps in stages, clean up gear when positive rate.",
            ],
            quiz: [
              { q: "Current Private ACS slow flight criterion is:", a: ["Minimum controllable airspeed with stall horn blaring", "Just above stall warning activation, no warning sounding", "1.3 Vso", "Vmc + 5"], correct: 1, explain: "The ACS was revised — slow flight is now demonstrated WITHOUT the stall warning sounding. Old PTS standard was 'minimum controllable' with horn going. New standard is 5–10 kt above stall warning activation. Don't get caught using the old standard." },
              { q: "Private slow-flight altitude tolerance?", a: ["±50 ft", "±100 ft", "±200 ft", "±150 ft"], correct: 1, explain: "Same ±100 ft as steep turns. Heading ±10°, airspeed +10/-0 kt (don't go below target — stall warning activates), bank ±10° in turns." },
            ],
          },
          {
            id: "stalls",
            title: "Power-Off, Power-On, Accelerated Stalls",
            summary: "Stall recognition and recovery — twin-specific cautions.",
            teach: [
              "**Power-off (approach) stall:** simulate landing config — gear down, flaps as appropriate, throttles to idle, slow to stall. Recover at first indication of stall: reduce AOA, add power on BOTH engines symmetrically, level wings, retract flaps in stages.",
              "**Power-on (departure) stall:** simulate takeoff/climb — takeoff config, climb power, pitch up to stall. Recovery same principle: reduce AOA *first*, then power, level wings.",
              "**Accelerated stall:** stall in a turn / load factor > 1G. Demonstrates that stall AOA is constant but stall *speed* increases with load factor.",
              "**TWIN CRITICAL POINT:** at high AOA / low airspeed, an asymmetric power loss can drive you below Vmc *while you're already near stall* — recipe for a Vmc roll OR cross-controlled stall/spin. Always recover by reducing AOA first; never try to power out with one engine.",
              "**ACS tolerance:** recognize and recover at first indication (stall horn, buffet) — examiner will not require a full stall break.",
            ],
            quiz: [
              { q: "Recovery from a stall in a multi-engine airplane begins with:", a: ["Adding full power on both engines", "Reducing AOA (lower the nose)", "Banking toward the operating engine", "Retracting flaps"], correct: 1, explain: "AOA reduction is ALWAYS the first step in any stall recovery. Adding power without lowering AOA can deepen the stall (increases pitch-up moment). Lower nose first, THEN add power symmetrically. Same in twins as in singles — but in twins, asymmetric power makes it worse." },
              { q: "Why is asymmetric power especially dangerous near stall AOA?", a: ["It can cause carb ice", "It can drive the airplane below Vmc near stall — risk of Vmc roll or cross-controlled spin", "Only matters above 10,000 ft", "It causes prop overspeed"], correct: 1, explain: "Near stall = high AOA = low airspeed. If one engine fails (or is reduced) at this point, you're already near Vmc speed. Combined with full power on the other engine = instant Vmc roll. Even worse: cross-controlled with rudder = spin. Never try to power out of a stall with asymmetric thrust." },
              { q: "Private ACS stall recovery point:", a: ["Full aerodynamic break required", "First indication of stall (horn / buffet)", "5 kt below stall speed", "Examiner's discretion"], correct: 1, explain: "ACS revision changed PTS standard. Recover at FIRST INDICATION (stall horn, buffet, or any onset cue) — no longer required to take it to a full break. Going past first indication is now actually a deficiency." },
            ],
          },
          {
            id: "normal-landing",
            title: "Normal Landing",
            summary: "Approach, configuration, touchdown — twin specifics.",
            teach: [
              "**Pattern:** pattern altitude, downwind at cruise-light power. Abeam touchdown: gear down, prop checks (often left at cruise on downwind, full forward by short final). GUMPS check.",
              "**Approach speeds (verify POH):** typical PA-30 final ~85–90 mph. ACS: ±5 kt of target.",
              "**Stabilized approach:** on speed, on glidepath, configured by 500 ft AGL. If not — go around.",
              "**GUMPS** at every key checkpoint: Gas (correct tank, pumps), Undercarriage (DOWN — verify 3 green), Mixture (rich), Prop (full forward), Switches (lights, pumps).",
              "**Flare and touchdown:** main wheels first, hold nose off, brake as needed, props back to high RPM after rollout.",
            ],
            quiz: [
              { q: "GUMPS stands for:", a: ["Gas, Undercarriage, Mixture, Prop, Switches", "Gear, Undercarriage, Master, Power, Speed", "Gas, Up, Mixture, Pitch, Speed", "Gear, Up, Master, Pitch, Switches"], correct: 0, explain: "GAS (correct tank, fuel pumps), UNDERCARRIAGE (gear DOWN, 3 green), MIXTURE (rich), PROP (full forward for go-around), SWITCHES (lights, pumps, etc.). Run it abeam touchdown, on base, on final, and short final — any time you re-confirm landing config." },
              { q: "On final you notice you're not stabilized by 500 ft AGL. Action?", a: ["Continue and try to stabilize before flare", "Go around", "Reduce power", "Add flaps"], correct: 1, explain: "Stabilized approach criteria: on speed, on glidepath, configured, by 500 ft AGL VFR (1000 ft IFR). If any of those are missing, GO AROUND. Trying to salvage an unstable approach is how you bend airplanes. Examiners watch for this exact decision." },
            ],
          },
        ],
      },
      {
        id: "g2", kind: "ground", title: "Ground Lesson 2",
        topics: [
          {
            id: "vyse",
            title: "Vyse — Blue Line",
            summary: "Best rate of climb, single-engine. Single most important number in the airplane after engine failure.",
            teach: [
              "**Vyse** = the airspeed that gives the greatest gain in altitude per unit *time* with one engine inoperative.",
              "**Marked as a BLUE RADIAL LINE** on the ASI.",
              "**Why it matters:** after an engine failure, you are climbing (or descending) at the rate single-engine performance allows. Off-speed in either direction reduces climb rate. Slower than Vyse → more induced drag and risk of approaching Vmc. Faster than Vyse → too much parasite drag.",
              "**Vxse** (best *angle* single engine) is for obstacle clearance only — you'll spend most of your single-engine time at Vyse.",
              "**Vyse decreases with altitude** (as does single-engine climb rate). At the airplane's single-engine service ceiling, Vyse and Vxse converge and climb rate is 50 fpm.",
              "**Practical:** memorize your airplane's blue line. PA-30 Vyse ~105 mph (verify POH). After identify-verify-feather, your sole pitch target is blue line until you have terrain or maneuvering reasons to change it.",
            ],
            quiz: [
              { q: "Vyse is marked as what color radial?", a: ["Red", "Blue", "Green", "White"], correct: 1, explain: "Blue line. Memorize: Red = Dead (Vmc, below this with engine out = uncontrollable). Blue = Best (Vyse, single-engine best rate of climb)." },
              { q: "After identify–verify–feather, your primary pitch target is:", a: ["Vmc", "Vyse (blue line)", "Vy", "Vne"], correct: 1, explain: "Single-engine, you climb at Vyse. Off-speed in either direction reduces climb rate. Vy is the two-engine best rate (irrelevant when one is feathered). Vmc is a limit, not a target. Vne is a max." },
              { q: "Vxse is used primarily for:", a: ["Cruise climb", "Obstacle clearance on single-engine departure", "Approach", "Stall recovery"], correct: 1, explain: "Vxse = best ANGLE single engine = greatest altitude per horizontal distance. Used only when you need to clear an obstacle. Otherwise climb at Vyse for best rate. Vxse is closer to Vmc, so less margin." },
              { q: "At the airplane's single-engine service ceiling, climb rate is defined as:", a: ["0 fpm", "50 fpm", "100 fpm", "500 fpm"], correct: 1, explain: "Single-engine SERVICE ceiling = 50 fpm climb. (Single-engine ABSOLUTE ceiling = 0 fpm.) Above the service ceiling, you can't reliably maintain altitude on one engine — that defines the safe operating envelope for one-engine operations." },
            ],
          },
          {
            id: "accelerate-stop",
            title: "Accelerate-Stop Distance",
            summary: "Runway needed to accelerate to liftoff/decision speed and bring the airplane to a stop on the remaining runway.",
            teach: [
              "**Accelerate-stop distance:** the runway length required to accelerate from a standstill to a decision speed (often Vr or Vmc, per POH), experience an engine failure, and then bring the airplane to a complete stop on the remaining runway.",
              "**Accelerate-go distance** (informational, often not in POH for light twins): runway needed to accelerate to liftoff, lose an engine, and continue the takeoff while clearing a 50 ft obstacle. Many light twins cannot do this from short fields at gross weight — that's a key safety realization.",
              "**You compute accelerate-stop from POH charts** for actual conditions: weight, pressure altitude, temperature, runway slope, surface, wind.",
              "**Decision-making:** if accelerate-stop distance > runway available → don't go, or reduce weight. Compare to accelerate-go where charts allow.",
              "**Examiner question:** *'How much runway do you need today?'* You should be able to compute this on the ramp before flight.",
            ],
            quiz: [
              { q: "Accelerate-stop distance is the runway needed to:", a: ["Take off and climb to 50 ft", "Accelerate to decision speed, lose an engine, and stop on remaining runway", "Land and stop from threshold", "Accelerate to Vmc"], correct: 1, explain: "Three phases: accelerate to decision speed (often Vr), lose an engine, stop on remaining runway. The PA-30 chart gives you this number for current weight, DA, and surface. Compare to runway available BEFORE every takeoff." },
              { q: "If accelerate-stop distance exceeds runway available, you should:", a: ["Take off anyway, just be careful", "Reduce weight, choose another runway, or don't go", "Accept the risk if winds are favorable", "Use a higher rotation speed"], correct: 1, explain: "If you can't stop on remaining runway after an engine failure at Vr, you have no margin for the worst-case event. Three options: lose weight (fuel, bags, pax), find longer runway, or scrub the flight. Anything else is gambling with insufficient margins." },
            ],
          },
          {
            id: "abort-plan",
            title: "Pre-Takeoff Abort Plan",
            summary: "The verbal brief that primes your decision before brake release.",
            teach: [
              "Every takeoff is briefed *out loud* (even to yourself when solo) before brake release. The brief commits you to a plan so the engine failure isn't a surprise — it's the *expected* event.",
              "**Standard brief structure:**",
              "  1. *Runway, conditions:* runway in use, wind, distance available.",
              "  2. *Speeds:* Vr, Vmc (red line), Vyse (blue line).",
              "  3. *Abort logic:*",
              "     • Any malfunction before Vmc → abort, throttles closed, max braking.",
              "     • Engine failure above Vmc with runway remaining → land straight ahead on remaining runway.",
              "     • Engine failure airborne, no runway → maintain control, gear up, pitch blue line, identify–verify–feather–secure, declare, return.",
              "  4. *Departure plan:* initial heading, altitude, frequency.",
            ],
            quiz: [
              { q: "Engine failure on takeoff roll BELOW Vmc, runway remaining. Action?", a: ["Continue, lift off, troubleshoot in air", "Abort: throttles closed, brakes", "Pitch up to clear obstacles", "Feather and continue"], correct: 1, explain: "Below Vmc, you cannot maintain directional control if you fly with one engine at takeoff power — you'll Vmc roll. ABORT is the only option. Throttles closed (both!), max braking, directional control with rudder and brakes. Even with 10,000 ft of runway ahead, the answer is abort." },
              { q: "Engine failure airborne above Vmc, no runway remaining. Sequence?", a: ["Identify, verify, feather, gear up, blue line", "Maintain control, gear up, pitch blue line, identify–verify–feather–secure, declare", "Land straight ahead, gear down", "Return immediately to runway"], correct: 1, explain: "ALWAYS aviate first. Maintain control + clean up drag (gear up) + pitch blue line — these come before identify/verify/feather. Once the airplane is flying stably at blue line, then run the engine-failure flow. Gear-down 'straight ahead' is the option ONLY if you can't safely climb." },
            ],
          },
          {
            id: "engine-failure-drill",
            title: "Engine Failure 'Drill' — The Flow",
            summary: "The memorized flow you'll execute when an engine fails in flight.",
            teach: [
              "**This is the most important muscle memory in multi-engine flying.** Your instructor will drill it cold and warm. Practice in the chair until it's automatic.",
              "**Step 1 — MAINTAIN CONTROL.** Pitch for blue line (Vyse). Rudder to stop the yaw. Bank ~2° toward the live engine. *Fly the airplane first.*",
              "**Step 2 — MIXTURES, PROPS, THROTTLES — full forward.** (Max performance from the good engine, ensures you don't shut down the wrong engine in the next step because all controls are now in known positions.)",
              "**Step 3 — FLAPS UP, GEAR UP** (if airborne and not landing imminently).",
              "**Step 4 — IDENTIFY:** *'Dead foot, dead engine.'* The foot you're NOT pressing to the floor identifies the failed side. Look outside, confirm.",
              "**Step 5 — VERIFY:** retard the throttle on the suspected dead engine slowly. If yaw doesn't change, you correctly identified the dead engine. If yaw worsens, you grabbed the wrong throttle — return it forward.",
              "**Step 6 — FEATHER:** prop control on the dead engine to FEATHER position.",
              "**Step 7 — SECURE:** mixture idle cutoff, mags off, fuel selector off, electrical (alternator/boost pump) off on the dead side.",
              "**Step 8 — TROUBLESHOOT (if appropriate) and DECLARE.** Land at the nearest suitable airport. Don't try to make the original destination.",
              "**Memory hooks:** *Control–Configure–Identify–Verify–Feather–Secure.*",
            ],
            quiz: [
              { q: "First action after an engine failure in flight?", a: ["Identify the failed engine", "Maintain control, pitch for blue line", "Feather the prop", "Declare emergency"], correct: 1, explain: "AVIATE first, always. Pitch for blue line, rudder to stop the yaw, bank ~2° toward the live engine. ONLY after the airplane is under control do you start identifying and feathering. Skipping this step kills people." },
              { q: "'Dead foot, dead engine' means:", a: ["The foot you press identifies the dead engine", "The foot you do NOT press identifies the dead engine", "Both feet should be off the rudder", "Use the foot opposite to the live engine"], correct: 1, explain: "Asymmetric thrust yaws the airplane TOWARD the dead engine. To stop the yaw, you press the rudder on the LIVE engine's side. So the foot doing nothing (dead foot) is on the dead engine's side. Lazy foot identifies the failed engine." },
              { q: "How do you VERIFY the failed engine before feathering?", a: ["Look at engine instruments only", "Slowly retard the throttle on the suspected dead engine and observe yaw", "Pull mixture immediately", "Cycle the prop"], correct: 1, explain: "Slowly pull the throttle on the engine you think is dead. If yaw doesn't change → you're right, that engine wasn't producing power anyway. If yaw gets worse → you grabbed the wrong throttle, return it forward FAST. This step prevents shutting down the GOOD engine — which is shockingly common in stress." },
              { q: "Correct order in the engine-failure flow?", a: ["Identify–Verify–Feather–Control", "Control–Configure–Identify–Verify–Feather–Secure", "Feather–Secure–Verify–Identify", "Declare–Identify–Feather"], correct: 1, explain: "Memorize this exact order. CONTROL (pitch + yaw) → CONFIGURE (mixtures, props, throttles forward; flaps up; gear up) → IDENTIFY (dead foot) → VERIFY (slow throttle pull) → FEATHER (prop control) → SECURE (mixture cutoff, mags off, fuel off, electrical off). Then declare and land at nearest suitable." },
              { q: "After securing a failed engine in flight, your destination should be:", a: ["The original destination if weather allows", "The nearest suitable airport", "The departure airport always", "Whichever is largest"], correct: 1, explain: "Single-engine = degraded performance, no redundancy, possibly fire/structural concerns. NEAREST SUITABLE airport — the one with adequate runway, services, and weather. Don't try to make destination 'because we're so close.' Insurance and your CFI will both ask why you didn't land sooner." },
            ],
          },
        ],
      },
    ],
  },
  // ============ DAY 2 ============
  {
    id: "d2", day: "Day 2", icon: "Plane",
    blocks: [
      {
        id: "f2", kind: "flight", title: "Flight Lesson 2",
        topics: [
          {
            id: "engine-failure-before-vmc",
            title: "Engine Failure Before Vmc",
            summary: "Simulated engine failure on the takeoff roll — abort and stop.",
            teach: [
              "**Scenario:** instructor reduces power on one side during the takeoff roll, before reaching Vmc.",
              "**Correct response:** ABORT — no exceptions.",
              "  • Throttles to idle (BOTH).",
              "  • Maximum braking.",
              "  • Maintain directional control with rudder and brakes.",
              "  • If departing the runway is unavoidable, intentionally retract gear (off-airport) only if pre-briefed.",
              "**Why no continue option:** below Vmc you cannot maintain directional control with one engine at takeoff power. Trying to fly is how Vmc rolls happen — at low altitude, fatal.",
              "**Discipline:** even if there's 10,000 ft of runway, the answer is still abort. Don't negotiate with the rule.",
            ],
            quiz: [
              { q: "Engine failure on takeoff roll BELOW Vmc:", a: ["Lift off and feather", "Abort: throttles idle, max braking", "Continue to Vyse", "Add full power on the other engine"], correct: 1, explain: "Below Vmc, you cannot fly with one engine at takeoff power — full rudder won't hold the airplane straight. Abort is non-negotiable. Trying to lift off below Vmc = Vmc roll within seconds of leaving the ground." },
              { q: "Why is 'continue' not an option below Vmc?", a: ["Insurance reasons", "You cannot maintain directional control with one engine at takeoff power below Vmc", "FAA prohibition only", "Engine damage risk"], correct: 1, explain: "Vmc is literally defined as the speed below which you cannot maintain directional control with one engine. It's an aerodynamic certainty, not a recommendation. Below that speed, the rudder cannot generate enough force to overcome the asymmetric thrust." },
            ],
          },
          {
            id: "short-field-takeoff",
            title: "Short-Field Takeoff",
            summary: "Maximum performance takeoff over a 50 ft obstacle.",
            teach: [
              "**Configuration:** flaps as specified by POH (often takeoff position or specific notch).",
              "**Technique:** taxi to the very end of usable runway, hold brakes, throttles up to full power, verify gauges, release brakes.",
              "**Rotate at POH-specified short-field Vr** (slower than normal Vr).",
              "**Climb at Vx** until clear of obstacle (typically a 50-ft object), then transition to Vy and clean up.",
              "**Twin caution:** Vx is *closer to Vmc* than Vy. Engine failure at Vx is more critical than at Vy. Be ready for an immediate abort decision.",
              "**Private AMEL ACS:** ±5 kt of target, configured per POH, clear the obstacle.",
            ],
            quiz: [
              { q: "Climb speed during short-field takeoff (until obstacle cleared)?", a: ["Vy", "Vx", "Vyse", "Va"], correct: 1, explain: "Vx = best ANGLE of climb = greatest altitude per horizontal distance = obstacle clearance. Once clear of the obstacle, transition to Vy (best rate). Vyse only matters with one engine inop." },
              { q: "Why is Vx more critical than Vy on a twin?", a: ["Higher fuel burn", "Vx is closer to Vmc — engine failure has less margin", "Lower oil pressure", "More noise"], correct: 1, explain: "Vx is a slower speed than Vy. Slower = closer to Vmc. If you lose an engine at Vx during obstacle clearance, you have very little speed margin before going below Vmc. That's why short-field takeoffs are higher-risk in twins." },
            ],
          },
          {
            id: "vmc-demo",
            title: "Vmc Demonstration",
            summary: "Examiner-required maneuver: deliberate approach to Vmc and recovery.",
            teach: [
              "**Purpose:** demonstrate awareness of the loss-of-control symptoms approaching Vmc and the recovery procedure.",
              "**Setup:** safe altitude (typically ≥5,000 ft AGL), clearing turns, gear up, flaps up, takeoff power on operating engine, idle (or zero thrust) on the simulated dead engine.",
              "**Entry:** pitch up to bleed airspeed at ~1 kt/sec while maintaining directional control with rudder. Bank ~5° toward the operating engine.",
              "**RECOVER at the FIRST of these three indicators:**",
              "  1. Loss of directional control (full rudder no longer holds heading)",
              "  2. Onset of stall warning / buffet",
              "  3. Pitch attitude that's clearly inappropriate",
              "**Recovery:** simultaneously REDUCE POWER on the operating engine and LOWER THE NOSE. Do not bank away — keep banking ~5° toward live engine until you regain Vyse.",
              "**ACS standard:** recover promptly at first indication; do not actually reach Vmc demonstrated.",
              "**SAFETY:** never below 3,000 ft AGL. Never with a feathered prop (zero thrust only — you may need that engine).",
            ],
            quiz: [
              { q: "During Vmc demo you recover at the FIRST indication of:", a: ["Loss of directional control, stall warning, or inappropriate pitch — whichever comes first", "Full Vmc loss only", "Stall break only", "Audible warning only"], correct: 0, explain: "Three triggers, recover at whichever happens FIRST: (1) full rudder no longer holds heading, (2) stall warning/buffet, or (3) extreme pitch attitude. At altitude with thin air, stall warning often comes BEFORE loss of control — recover anyway. Don't ride it past first indication looking for 'real' Vmc." },
              { q: "Recovery from Vmc demo includes:", a: ["Adding power, pulling nose up", "Reducing power on operating engine and lowering the nose", "Banking away from operating engine", "Feathering immediately"], correct: 1, explain: "Counterintuitive but lifesaving: REDUCE power (less asymmetric thrust = restored control) and LOWER nose (gain airspeed back above Vmc). Adding power makes it worse. Banking away makes it worse. Same exact recovery as a real Vmc loss-of-control." },
              { q: "Vmc demo should never be performed below:", a: ["1,000 ft AGL", "3,000 ft AGL", "10,000 ft MSL", "Pattern altitude"], correct: 1, explain: "Minimum 3,000 ft AGL. The maneuver intentionally puts you near loss-of-control with one engine simulated dead — if recovery doesn't go as planned, you need altitude to sort it out. Below 3,000 ft AGL there's no margin for error." },
              { q: "The simulated 'dead' engine in a Vmc demo is:", a: ["Fully feathered", "At idle / zero thrust setting", "Mixture cutoff", "Mags off"], correct: 1, explain: "Idle (or 'zero thrust' power setting per POH) — NOT feathered. You may need that engine if recovery doesn't work as planned. Feathering on purpose for a training maneuver loses your safety net. Actual feather is reserved for the actual-shutdown training event." },
            ],
          },
          {
            id: "short-field-landing",
            title: "Short-Field Landing",
            summary: "Maximum performance landing over a 50-ft obstacle to a precise touchdown point.",
            teach: [
              "**Approach:** stabilized, full flaps (or as POH), at POH-specified short-field approach speed (typically a few kt below normal final).",
              "**Aim point:** examiner-designated; touchdown within +200/–0 ft of the spot for Private AMEL ACS.",
              "**Power management:** small adjustments — final approach in a twin is power-on; idle would steepen excessively.",
              "**Touchdown:** firm (no float), main wheels first, immediately retract flaps (verify the GEAR handle), maximum braking.",
              "**Twin caution:** never reach for the gear handle on rollout — confirm gear handle vs flap handle visually. Mistakes here destroy airplanes.",
            ],
            quiz: [
              { q: "Private AMEL ACS short-field touchdown tolerance?", a: ["±100 ft of aim point", "+200 / −0 ft of aim point", "Anywhere in the first third", "+500 / −0 ft"], correct: 1, explain: "Land AT or BEYOND the aim point, never short, no more than 200 ft long. Landing short = obstacle strike in real life. The asymmetric tolerance (+200, -0) reflects that overshoot is recoverable; undershoot is fatal." },
              { q: "Why retract flaps (NOT gear) on rollout after short-field landing?", a: ["More braking via weight transfer; gear handle on the ground = retracted gear = bent airplane", "Saves the flap motor", "Reduces noise", "FAA requirement"], correct: 0, explain: "Retracting flaps reduces lift = transfers weight to wheels = better braking. Reaching for the gear handle on rollout is how pilots accidentally retract gear with the airplane on the ground = sad airplane, expensive insurance call. ALWAYS visually verify gear handle vs flap handle." },
            ],
          },
          {
            id: "intro-instrument-approach",
            title: "Introduction to the Instrument Approach",
            summary: "GNS430W setup, loading and activating an approach in the Lubbock area (F49, KLBB).",
            teach: [
              "Per the syllabus, you should arrive familiar with **F49 (Slaton) and KLBB (Lubbock Preston Smith)** approaches and the **Garmin GNS430W**.",
              "**Basic GNS430W flow for an approach:**",
              "  1. PROC button → SELECT APPROACH → choose airport (KLBB, F49) → choose approach → choose IAF or vectors.",
              "  2. ACTIVATE — either 'Load' (preview, fly the route) or 'Activate' (jump direct to active leg).",
              "  3. CDI button to switch from GPS to VLOC for ILS / VOR approaches at the appropriate point. **For RNAV (GPS) approaches, stay GPS.**",
              "  4. Verify the approach armed/active annunciator and that you're on the correct leg.",
              "**Private add-on caveat:** you are NOT being tested to instrument-rated standards. Your task is to *load and activate* an approach for situational awareness as required by the multi-engine private add-on standards. The full instrument procedures are part of your ME-IR add-on, not this checkride.",
              "**Knowledge to bring:** courses, MDA/DA, missed approach point, missed approach procedure for the approach you brief.",
            ],
            quiz: [
              { q: "On a GNS430W, after loading an ILS approach, you switch the CDI from GPS to VLOC:", a: ["At the FAF", "When the magenta GPS guidance transitions to LOC needles — typically before intercept inbound", "Never — leave it on GPS", "On missed approach"], correct: 1, explain: "The 430W gives you a prompt: 'Set CRS to xxx and switch CDI to VLOC.' This typically happens on the intermediate segment, before you intercept the localizer inbound. Leaving CDI on GPS would track you to the airport, not down the localizer — bad day." },
              { q: "For an RNAV (GPS) approach on the GNS430W, the CDI should be set to:", a: ["VLOC", "GPS", "Either", "OBS only"], correct: 1, explain: "RNAV (GPS) approaches use GPS as the navigation source. Stay on GPS the whole way. VLOC is only used for ground-based approaches (ILS, LOC, VOR). Different approach type = different nav source." },
              { q: "Per the syllabus, which two airports' approaches should you study?", a: ["KLBB and KAMA", "F49 and KLBB", "KAUS and KSAT", "F49 and KMAF"], correct: 1, explain: "Per the Raider Aviation syllabus: F49 (Slaton, the home base) and KLBB (Lubbock Preston Smith). Examiner will likely use approaches at one or both. Be familiar with the IAF, courses, mins, missed procedure, missed point." },
            ],
          },
        ],
      },
      {
        id: "g3", kind: "ground", title: "Ground Lesson 3",
        topics: [
          {
            id: "performance-charts",
            title: "Performance Charts",
            summary: "Reading PA-30 charts: takeoff, climb (both engines and single engine), cruise, accelerate-stop.",
            teach: [
              "**Inputs you'll need every time:** weight, pressure altitude, OAT (or DA), wind, runway slope/surface.",
              "**Charts you'll be asked to use:**",
              "  • Takeoff distance (ground roll, total over 50 ft)",
              "  • Accelerate-stop distance",
              "  • Single-engine service ceiling and single-engine climb rate",
              "  • Cruise performance (TAS, fuel flow vs altitude/power)",
              "  • Landing distance",
              "**Single-engine climb chart is the safety-critical one:** if the chart says 200 fpm at gross weight at 5,000 ft DA, that's a bad day to be at gross weight on a high-DA day.",
              "**Density altitude rule of thumb:** every 10°C above standard adds ~1,000 ft to DA. Hot days kill twin performance fast.",
              "**Examiner will likely give you a scenario** — weight, weather, runway — and ask: *can you go today?* Be ready to compute and decide.",
            ],
            quiz: [
              { q: "Single-engine service ceiling is defined as:", a: ["100 fpm climb single engine", "50 fpm climb single engine", "0 fpm climb single engine", "500 fpm climb single engine"], correct: 1, explain: "SERVICE ceiling = 50 fpm. Above this altitude, you can't reliably climb on one engine. ABSOLUTE ceiling (0 fpm single engine) is theoretical; you don't operate near it." },
              { q: "Approximate DA increase per 10°C above standard temperature?", a: ["100 ft", "1,000 ft", "10,000 ft", "Zero — only altitude matters"], correct: 1, explain: "Rule of thumb: every 10°C above standard adds ~1,000 ft to density altitude. So a 90°F day in Lubbock at 3,300 ft elevation can easily push DA above 6,000 ft — which puts you near or above the PA-30's single-engine service ceiling at gross weight. Hot days kill twin performance." },
              { q: "Which performance chart is most critical to single-engine survival on a hot/high day?", a: ["Cruise fuel flow", "Single-engine climb / service ceiling", "Landing distance", "Takeoff ground roll only"], correct: 1, explain: "The single-engine climb chart tells you whether you can outclimb terrain after losing an engine on departure. If the chart says 0 fpm at your DA and weight, you have no climb capability — engine failure = controlled descent into whatever's ahead. THIS chart drives go/no-go on hot days." },
            ],
          },
          {
            id: "systems",
            title: "Systems — PA-30 Twin Comanche",
            summary: "Powerplant, fuel, electrical, gear, props, environmental.",
            teach: [
              "**Powerplant:** two Lycoming IO-320 (typical PA-30) — 160 hp each. Fuel-injected, normally aspirated, direct drive.",
              "**Propellers:** Hartzell constant-speed, full-feathering, hydraulic (oil pressure to LOW pitch / high RPM; springs and counterweights drive toward HIGH pitch / feather when oil pressure is lost).",
              "**Feather mechanism:** counterweights and feathering springs pull blades to feather when prop control is pulled and oil pressure to the hub is interrupted. Why prop cycle on runup matters — warm oil = reliable feather.",
              "**Fuel:** main + auxiliary tanks each side. Crossfeed available — primary use: balance fuel after an engine failure to feed the operating engine. **Know your specific fuel system layout per POH.**",
              "**Electrical:** dual alternators, single battery typical. Loss of one alternator → load shed, monitor remaining alternator amps.",
              "**Landing gear:** electrically actuated hydraulic (or fully electric, depending on model year). Emergency extension procedure — practice with eyes closed.",
              "**Environmental:** cabin heat from exhaust shroud — CO risk; carbon monoxide detector recommended.",
              "**Pitot/static, vacuum:** verify which instruments run on which source. A vacuum failure takes the AI/HSI; pitot/static takes the ASI/ALT/VSI.",
            ],
            quiz: [
              { q: "Hartzell constant-speed full-feathering props use what to drive blades to feather?", a: ["Oil pressure pushes to feather", "Counterweights and feathering springs (when oil pressure is lost)", "Electrical motor", "Pilot manually rotates"], correct: 1, explain: "Reverse of single-engine constant-speed props. In a single, oil pressure drives the blades toward HIGH pitch. In a feathering twin prop, oil pressure drives blades toward LOW pitch (high RPM); springs and counterweights drive them to feather when oil pressure is lost or commanded away. That's why losing the engine doesn't make feathering impossible — physics drives it." },
              { q: "Primary purpose of fuel crossfeed in a twin?", a: ["Balance fuel during normal cruise", "Feed the operating engine from the dead engine's fuel after engine failure", "Reduce fuel burn", "Required for takeoff"], correct: 1, explain: "After engine failure, the dead engine's fuel is now an asset for the live engine. Crossfeed lets you draw from the opposite tank. Also useful for fuel imbalance correction. NOT used for takeoff/landing per most POHs (each engine on its own tank for redundancy)." },
              { q: "Loss of vacuum system in a typical PA-30 takes out which instrument(s)?", a: ["Airspeed and altimeter", "Attitude indicator and heading indicator", "Tachometer", "Manifold pressure"], correct: 1, explain: "Vacuum drives gyroscopic instruments: AI and HI (DG). Losing vacuum in IMC = partial panel scenario — you fall back to TC, ASI, ALT, VSI. Pitot/static failure (different system) takes ASI/ALT/VSI. Know which instruments live on which system — examiners ask." },
            ],
          },
        ],
      },
    ],
  },
  // ============ DAY 3 ============
  {
    id: "d3", day: "Day 3", icon: "Target",
    blocks: [
      {
        id: "f3", kind: "flight", title: "Flight Lesson 3",
        topics: [
          {
            id: "instrument-approach-eng-fail",
            title: "Instrument Approach with Engine Failure",
            summary: "Single-engine instrument approach — load, brief, fly, manage.",
            teach: [
              "**Private AMEL add-on:** you'll fly an approach (likely under simulated instrument conditions / hood) with one engine simulated failed.",
              "**Brief BEFORE the failure:** approach name, frequency, course, FAF altitude, MDA/DA, missed approach point, missed approach procedure.",
              "**When the failure occurs:** Control–Configure–Identify–Verify–Feather (or zero thrust per training)–Secure. Then continue the approach.",
              "**Pitch and power management:** single-engine, gear-down approach is a high-drag, low-power state. You may need *more* power than usual on the operating engine.",
              "**Decision point:** if you're not stabilized or single-engine performance is marginal, *go missed early* — don't try to salvage. A single-engine missed at minimums is ugly; a single-engine missed from 1,000 ft AGL is manageable.",
              "**Key:** stay ahead of the airplane. Get the approach loaded and briefed before you're task-saturated. Use the autopilot (if equipped) — there is no purist points awarded for hand-flying single-engine IFR.",
            ],
            quiz: [
              { q: "If single-engine performance becomes marginal on an approach, the right call is:", a: ["Continue and hope it improves", "Go missed early before reaching minimums", "Add full flaps", "Feather the operating engine to reduce drag"], correct: 1, explain: "A single-engine missed approach from 1,000 ft AGL is manageable. From DA at minimums in IMC, it's a marginal-to-impossible maneuver. If you see it going bad early, get out early. Pride costs nothing on the ground; it costs everything in a hole at minimums." },
              { q: "Single-engine, gear-down ILS — your power requirement on the operating engine compared to a normal two-engine approach is:", a: ["Less", "About the same", "More — to maintain glidepath against asymmetric drag", "Zero"], correct: 2, explain: "Two-engine approach at idle = appropriate descent rate. One engine windmilling/feathered + gear/flaps = much more drag. To maintain a 3° glidepath, you'll need significantly more power on the live engine — sometimes near climb power. Plan for it; don't be surprised when the airplane sinks below glideslope at your normal power setting." },
            ],
          },
        ],
      },
      {
        id: "f4", kind: "flight", title: "Flight Lesson 4",
        topics: [
          {
            id: "checkride-prep",
            title: "Checkride Prep — Putting It All Together",
            summary: "Full-profile rehearsal of every required maneuver.",
            teach: [
              "**Goal:** fly each required ACS task to private AMEL add-on standards in one session.",
              "**Likely flight profile:**",
              "  1. Departure briefing, normal takeoff, climb to maneuvering area.",
              "  2. Steep turns, slow flight, stalls (power-on, power-off).",
              "  3. Vmc demo.",
              "  4. Engine failure simulation in cruise → drill → restart or zero-thrust.",
              "  5. Single-engine approach and landing back at home field.",
              "  6. Short-field takeoff and landing.",
              "  7. Engine failure on takeoff (simulated, briefed scenarios).",
              "**Self-debrief:** every miss is a checkride miss. Identify the gap, log it, drill it tomorrow.",
              "**ACS hot list to self-check:** altitudes within tolerance, airspeeds within tolerance, configurations correct, callouts correct, checklists used.",
            ],
            quiz: [
              { q: "Private AMEL steep turn ACS bank?", a: ["30°", "45°", "50°", "60°"], correct: 2, explain: "50° bank ±5° for Private AMEL. Don't confuse with Private ASEL (45°) or Commercial standards." },
              { q: "Private AMEL short-field landing tolerance?", a: ["±100 ft", "+200/−0 ft of aim point", "+500/−0 ft", "Anywhere in first third"], correct: 1, explain: "+200 / -0 ft. At the aim point or up to 200 ft beyond. NEVER short. Examiner will pace it off if needed." },
            ],
          },
        ],
      },
    ],
  },
  // ============ DAY 4 ============
  {
    id: "d4", day: "Day 4", icon: "Wrench",
    blocks: [
      {
        id: "g4", kind: "ground", title: "Ground Lesson 4",
        topics: [
          {
            id: "actual-shutdown",
            title: "Actual Engine Shutdown Process",
            summary: "Real (not simulated) shutdown of an engine in flight — done at safe altitude, briefed in detail.",
            teach: [
              "**This is the only training event where the prop is actually feathered.** Done at safe altitude (typically ≥5,000 ft AGL, over an airport or within glide).",
              "**Pre-shutdown briefing:** confirm altitude, confirm restart procedure, confirm divert plan if restart fails, declare or coordinate with ATC if appropriate.",
              "**Shutdown sequence:** mixture to idle cutoff (smooth), prop control to FEATHER, mags off, fuel selector OFF on dead side, electrical (alt, pump) off on dead side.",
              "**Verify feather:** prop blades to ~90° pitch, RPM to zero (or very low windmill if you stopped short of full feather).",
              "**Restart procedure (PA-30 typical — verify POH):** unfeather lever / starter procedure, fuel selector ON, mixture rich, mags ON, prop to high RPM, throttle cracked, monitor temps as the engine spins up. Allow oil temp to come up before applying significant power.",
              "**Don't rush the restart.** A windmilling engine can be brought back; a damaged engine from rushed power application cannot.",
            ],
            quiz: [
              { q: "Actual engine shutdown training is performed:", a: ["At any altitude", "At safe altitude (typically ≥5,000 ft AGL) and within glide of an airport", "Below pattern altitude only", "Only over water"], correct: 1, explain: "This is the only event where you actually feather a working engine. If the restart fails, you need altitude AND a glide-reachable runway. ≥5,000 ft AGL within glide of an airport is industry-standard. Brief the divert plan before shutdown." },
              { q: "Correct shutdown sequence?", a: ["Mags off, mixture cutoff, prop feather", "Mixture cutoff, prop feather, mags off, fuel selector off, electrical off (dead side)", "Fuel off, mags off, prop feather", "Throttle idle, mixture cutoff, mags off"], correct: 1, explain: "Order matters. Mixture FIRST (clean shutdown, no raw fuel), then prop to feather (stops the prop), then secure: mags off, fuel selector off, alternator/pump off on the dead side. Mags-off first risks fuel pooling; fuel-off first risks rough running before shutdown." },
              { q: "After restart in flight, before applying significant power:", a: ["Apply takeoff power immediately", "Allow oil temp to rise into the green range", "Wait 10 minutes regardless", "Cycle the prop 3 times"], correct: 1, explain: "Cold engine + sudden high power = thermal shock + cylinder damage. After restart, idle until oil temp comes up into green, then gradually add power. Same principle as your single-engine cold-start procedure, applied to a previously-shut-down engine." },
            ],
          },
          {
            id: "oral-prep",
            title: "Oral Exam Prep — Hot Topics",
            summary: "What examiners ask on the Private AMEL add-on oral.",
            teach: [
              "**Aerodynamics & V-speeds:** Vmc certification conditions, factors affecting Vmc, critical engine, zero sideslip.",
              "**Performance:** accelerate-stop, single-engine service ceiling, climb performance, runway analysis for the day.",
              "**Systems:** fuel system layout and crossfeed, electrical bus, prop feathering mechanism, gear system & emergency extension.",
              "**Procedures:** engine failure flow on takeoff (below Vmc, above Vmc, airborne), engine failure in flight, Vmc demo, restart procedure.",
              "**Regulations:** currency to act as PIC of a multi-engine airplane (you already hold a PPL — focus on the multi-engine class privileges), endorsements required, IACRA requirements.",
              "**Aircraft-specific:** know your PA-30 inside out — POH limitations, V-speeds memorized, fuel system, electrical system.",
              "**Examiner format:** scenario-based. *'It's a hot August day in Lubbock at gross weight, what does that mean for your performance and decision-making?'* Connect knowledge to flight planning.",
            ],
            quiz: [
              { q: "After your Private AMEL add-on, what additional currency requirement applies if you want to carry passengers in a twin?", a: ["No additional currency", "3 takeoffs and landings in a twin in the preceding 90 days (per 61.57)", "Annual flight review only", "10 hours twin time"], correct: 1, explain: "61.57(a): 3 takeoffs/landings in the preceding 90 days IN THE SAME CATEGORY AND CLASS. Multi-engine is a different class than single-engine. ASEL T/Os don't count toward AMEL currency. Tailwheel needs full-stop landings; nosewheel can be touch-and-go." },
              { q: "Which of these is most likely a scenario question vs a rote question?", a: ["'Define Vmc.'", "'It's hot, you're at gross, runway is 3,500 ft — go or no-go and why?'", "'What color is the Vmc line?'", "'When was the PA-30 certified?'"], correct: 1, explain: "Modern ACS oral exams favor scenario-based questions that tie multiple knowledge areas together. The hot/gross/short scenario tests: density altitude, accelerate-stop, single-engine climb performance, ADM (aeronautical decision making), and PIC authority. One question, five knowledge areas. Be ready." },
            ],
          },
        ],
      },
      {
        id: "f5", kind: "flight", title: "Flight Lesson 5",
        topics: [
          {
            id: "checkride-prep-shutdown",
            title: "Checkride Prep with Engine Shutdown",
            summary: "Final dress rehearsal — full profile including actual feather and restart.",
            teach: [
              "Same flow as Flight Lesson 4 plus the actual shutdown/restart.",
              "**Mental model:** by this point everything is rote. You're not learning — you're polishing. If you find yourself surprised by anything, log it for cleanup before checkride day.",
            ],
            quiz: [
              { q: "By the dress-rehearsal flight, your mental state should be:", a: ["Cramming new material", "Polishing — every maneuver is rote, surprises are flagged for cleanup", "Hoping for the best", "Practicing only weak maneuvers"], correct: 1, explain: "If you're still learning new material on the last training flight, your CFI shouldn't be signing you off. The dress rehearsal is for refining timing, callouts, and edge cases — not first-time exposure to procedures. Surprises here = note to self, drill before checkride." },
            ],
          },
        ],
      },
      {
        id: "g5", kind: "ground", title: "Ground Lesson 5",
        topics: [
          {
            id: "iacra-paperwork",
            title: "IACRA, Endorsements, Maintenance Logbook Review",
            summary: "Paperwork — the easiest checkride bust if not done right.",
            teach: [
              "**IACRA application** (8710-1) submitted online. Confirm correct: name, address, certificate number, course of training (Add a class rating: AMEL), aircraft used.",
              "**Required endorsements** in your logbook from your instructor for the Private AMEL add-on:",
              "  • Aeronautical knowledge prerequisite (no separate written test for class rating add-on at the private level — you already have your PPL)",
              "  • Flight proficiency / training completed (61.31 / 61.63 endorsement)",
              "  • Recommendation for the practical test",
              "**Aircraft documents day-of-checkride:** Airworthiness, Registration, Operating limitations (POH/AFM), Weight & balance — **AROW**.",
              "**Maintenance logbook review:** annual inspection current, 100-hour if applicable, transponder (24 mo), pitot-static (24 mo for IFR), ELT (battery and 12-mo inspection), AD compliance.",
              "**Pro tip:** sticky-tab or photograph every relevant logbook entry the day before. Don't fumble in front of the examiner.",
            ],
            quiz: [
              { q: "AROW stands for:", a: ["Airworthiness, Registration, Owner, Weight", "Airworthiness, Registration, Operating limitations, Weight & balance", "Aircraft, Records, Owner, Weight", "Annual, Registration, Operations, Wires"], correct: 1, explain: "AROW = the four documents required to be in the aircraft: Airworthiness certificate, Registration, Operating limitations (POH/AFM, placards), Weight & balance data. Examiner WILL check that all four are aboard the aircraft on checkride day." },
              { q: "Transponder inspection currency?", a: ["12 months", "24 months", "100 hours", "Annual"], correct: 1, explain: "Transponder inspection: 24 calendar months (91.413). Static system / altimeter / encoder for IFR: also 24 months (91.411). VOR check (for IFR): 30 days. ELT: every 12 months for the inspection, and battery replacement when 50% of useful life is consumed or after 1 cumulative hour of use." },
              { q: "For Private AMEL add-on (you already hold PPL ASEL), do you need a new written knowledge test?", a: ["Yes, multi-engine written required", "No — class rating add-on at the private level requires no additional knowledge test", "Only if older than 24 months", "Only if first checkride failed"], correct: 1, explain: "61.63(c): adding a class rating at the same certificate level requires NO additional knowledge test, NO additional aeronautical experience minimums, and NO additional aeronautical knowledge — just demonstrate proficiency on the practical test. That's why this 5-day course works at all." },
            ],
          },
        ],
      },
    ],
  },
  // ============ DAY 5 ============
  {
    id: "d5", day: "Day 5", icon: "Award",
    blocks: [
      {
        id: "checkride", kind: "checkride", title: "Checkride Day",
        topics: [
          {
            id: "checkride-day",
            title: "Checkride Day — What to Expect",
            summary: "Oral, then flight, then debrief.",
            teach: [
              "**Show up early.** Aircraft documents, your logbook, IACRA confirmation, payment for examiner.",
              "**Oral phase (~1.5–2 hours):** scenario-based. Cover aerodynamics, systems, performance, procedures, regs.",
              "**Flight phase (~1.5 hours):** preflight, normal takeoff, area maneuvers (steep turns, slow flight, stalls), Vmc demo, simulated engine failure, single-engine approach and landing, short-field operations.",
              "**The discontinuance rule:** if any task is unsatisfactory, examiner may discontinue. Discontinuance ≠ failure of remaining tasks — you can complete those on a re-test.",
              "**Mindset:** every maneuver, treat it as if you're flying paying passengers. ACS standards are the *minimum* — fly to better.",
              "**After pass:** examiner issues a temporary airman certificate. Permanent certificate arrives by mail in a few weeks. *You're now rated AMEL — congratulations.*",
            ],
            quiz: [
              { q: "If you bust one task on the checkride, what happens?", a: ["You fail and must redo the entire test", "Examiner may discontinue; you complete remaining tasks on a re-test", "You can re-attempt that task immediately", "You lose your existing certificate"], correct: 1, explain: "Examiner has discretion. If a task is unsatisfactory, they may discontinue OR continue with the rest. On re-test, you only redo the unsatisfactory task plus anything affected by it. You do NOT lose your existing PPL — only the add-on attempt fails. Try again after additional training and an instructor sign-off." },
              { q: "After passing, you receive:", a: ["Permanent certificate same day", "Temporary airman certificate; permanent arrives by mail", "Nothing until permanent arrives", "Logbook stamp only"], correct: 1, explain: "Examiner issues a temporary airman certificate valid for 120 days. Permanent plastic arrives by mail in a few weeks. The temp is fully valid for exercising your new privileges — you can fly home as a freshly-rated AMEL pilot the same day." },
            ],
          },
        ],
      },
    ],
  },
];

// =====================================================================
// COMPONENTS
// =====================================================================

const AMBER = "#ffb84a";
const CYAN = "#5dd5e6";
const RED = "#ff5252";
const BLUE = "#4a9eff";
const BG = "#0f1419";
const PANEL = "#1a2230";
const PANEL_2 = "#222b3a";
const BORDER = "#3a4658";
const TEXT = "#e8eef7";
const TEXT_DIM = "#a0aabb";

function StyleSheet() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Bebas+Neue&family=Source+Serif+Pro:wght@400;600&display=swap');
      * { box-sizing: border-box; }
      body, html { margin: 0; padding: 0; background: ${BG}; color: ${TEXT}; }
      .me-app { font-family: 'JetBrains Mono', monospace; min-height: 100vh; background:
        radial-gradient(ellipse 80% 60% at 50% 0%, rgba(74,158,255,0.06), transparent 60%),
        radial-gradient(ellipse 60% 40% at 100% 100%, rgba(255,184,74,0.04), transparent 60%),
        ${BG};
        color: ${TEXT};
        padding: 16px;
      }
      .me-display { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.06em; }
      .me-serif { font-family: 'Source Serif Pro', serif; }
      .me-panel {
        background: linear-gradient(180deg, ${PANEL} 0%, ${PANEL_2} 100%);
        border: 1px solid ${BORDER};
        border-radius: 4px;
        position: relative;
      }
      .me-panel::before {
        content: '';
        position: absolute; inset: 0;
        background: repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.012) 3px, rgba(255,255,255,0.012) 4px);
        pointer-events: none;
        border-radius: 4px;
      }
      .me-rivet {
        width: 6px; height: 6px; border-radius: 50%;
        background: radial-gradient(circle at 30% 30%, #555, #1a1f29);
        box-shadow: inset 0 0 1px rgba(0,0,0,0.6);
      }
      .me-button {
        font-family: 'JetBrains Mono', monospace;
        background: ${PANEL_2};
        color: ${TEXT};
        border: 1px solid ${BORDER};
        padding: 10px 14px;
        cursor: pointer;
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.08em;
        font-weight: 500;
        transition: all 0.15s ease;
        border-radius: 2px;
      }
      .me-button:hover { border-color: ${AMBER}; color: ${AMBER}; }
      .me-button.active { background: ${AMBER}; color: #000; border-color: ${AMBER}; }
      .me-button.cyan:hover { border-color: ${CYAN}; color: ${CYAN}; }
      .me-button.cyan.active { background: ${CYAN}; color: #000; border-color: ${CYAN}; }
      .me-tag {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
        padding: 3px 7px; border: 1px solid ${BORDER}; border-radius: 2px;
        font-weight: 700;
      }
      .me-glow-amber { color: ${AMBER}; text-shadow: 0 0 8px rgba(255,184,74,0.4); }
      .me-glow-cyan  { color: ${CYAN};  text-shadow: 0 0 8px rgba(93,213,230,0.4); }
      .me-glow-red   { color: ${RED};   text-shadow: 0 0 8px rgba(255,82,82,0.4); }
      .me-glow-blue  { color: ${BLUE};  text-shadow: 0 0 8px rgba(74,158,255,0.4); }
      .me-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, ${BORDER} 20%, ${BORDER} 80%, transparent);
      }
      .me-card {
        background: ${PANEL};
        border: 1px solid ${BORDER};
        border-left: 3px solid ${AMBER};
        padding: 14px 16px;
        cursor: pointer;
        transition: all 0.15s ease;
        border-radius: 0 4px 4px 0;
        font-size: 15px;
        font-weight: 500;
      }
      .me-card:hover {
        background: ${PANEL_2};
        border-left-color: ${CYAN};
        transform: translateX(2px);
      }
      .me-card.flight { border-left-color: ${BLUE}; }
      .me-card.ground { border-left-color: ${AMBER}; }
      .me-card.checkride { border-left-color: ${RED}; }
      .me-bullet { color: ${AMBER}; font-weight: 700; }
      .me-progress-bar {
        height: 4px;
        background: ${PANEL_2};
        border-radius: 2px;
        overflow: hidden;
        position: relative;
      }
      .me-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, ${AMBER}, ${CYAN});
        transition: width 0.3s ease;
      }
      .me-quiz-option {
        text-align: left;
        background: ${PANEL_2};
        border: 1px solid ${BORDER};
        color: ${TEXT};
        padding: 12px 16px;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: 'JetBrains Mono', monospace;
        font-size: 13px;
        border-radius: 3px;
        width: 100%;
        line-height: 1.5;
      }
      .me-quiz-option:hover { border-color: ${CYAN}; }
      .me-quiz-option.correct { background: rgba(64,220,140,0.15); border-color: #40dc8c; color: #b8f5d0; }
      .me-quiz-option.wrong { background: rgba(255,82,82,0.15); border-color: ${RED}; color: #ffb8b8; }
      .me-quiz-option.disabled { cursor: not-allowed; }
      .me-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .me-table th, .me-table td {
        padding: 10px 8px;
        text-align: left;
        border-bottom: 1px solid ${BORDER};
        vertical-align: top;
      }
      .me-table th {
        font-family: 'Bebas Neue', sans-serif;
        font-size: 13px;
        letter-spacing: 0.1em;
        color: ${AMBER};
        background: ${PANEL_2};
        font-weight: normal;
      }
      .me-table tr:hover { background: rgba(255,184,74,0.03); }
      .me-arrow-up { color: #40dc8c; font-weight: 700; }
      .me-arrow-down { color: ${RED}; font-weight: 700; }
      .me-vmc-up { color: ${RED}; font-weight: 700; }
      .me-vmc-down { color: #40dc8c; font-weight: 700; }
      .me-corner-marker {
        position: absolute;
        width: 12px; height: 12px;
        border-color: ${AMBER};
        border-style: solid;
      }
      .me-corner-tl { top: 6px; left: 6px; border-width: 1px 0 0 1px; }
      .me-corner-tr { top: 6px; right: 6px; border-width: 1px 1px 0 0; }
      .me-corner-bl { bottom: 6px; left: 6px; border-width: 0 0 1px 1px; }
      .me-corner-br { bottom: 6px; right: 6px; border-width: 0 1px 1px 0; }
      @keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.3; } }
      .me-blink { animation: blink 1.5s infinite; }
      .me-scrollshadow {
        max-height: 60vh;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: ${BORDER} transparent;
      }
      .me-scrollshadow::-webkit-scrollbar { width: 6px; }
      .me-scrollshadow::-webkit-scrollbar-thumb { background: ${BORDER}; border-radius: 3px; }
    `}</style>
  );
}

function Header({ progress, onReset, view, setView }) {
  return (
    <div className="me-panel" style={{ padding: 18, marginBottom: 16, position: "relative" }}>
      <div className="me-corner-marker me-corner-tl"></div>
      <div className="me-corner-marker me-corner-tr"></div>
      <div className="me-corner-marker me-corner-bl"></div>
      <div className="me-corner-marker me-corner-br"></div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Plane size={26} style={{ color: AMBER, transform: "rotate(-30deg)" }} />
            <div>
              <div className="me-display" style={{ fontSize: 28, lineHeight: 1, color: TEXT, letterSpacing: "0.08em" }}>
                MULTI-ENGINE <span className="me-glow-amber">TRAINER</span>
              </div>
              <div style={{ fontSize: 10, color: TEXT_DIM, marginTop: 4, letterSpacing: "0.15em" }}>
                PA-30 TWIN COMANCHE  ·  PRIVATE AMEL ADD-ON  ·  ACS REV 2026
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className={`me-button ${view === "home" ? "active" : ""}`} onClick={() => setView("home")}>
            <ListChecks size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Syllabus
          </button>
          <button className={`me-button ${view === "aircraft" || view === "aircraftquiz" ? "active" : ""}`} onClick={() => setView("aircraft")}>
            <Plane size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />N1100L
          </button>
          <button className={`me-button ${view === "performance" || view === "performancequiz" ? "active" : ""}`} onClick={() => setView("performance")}>
            <BarChart3 size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Perf
          </button>
          <button className={`me-button cyan ${view === "drillall" ? "active" : ""}`} onClick={() => setView("drillall")}>
            <Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Drill All
          </button>
          <button className={`me-button cyan ${view === "vspeeds" ? "active" : ""}`} onClick={() => setView("vspeeds")}>
            <Gauge size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />V-Speeds
          </button>
          <button className={`me-button cyan ${view === "vmctable" ? "active" : ""}`} onClick={() => setView("vmctable")}>
            <AlertTriangle size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Vmc Table
          </button>
          <button className="me-button" onClick={onReset} title="Reset progress">
            <RotateCcw size={11} />
          </button>
        </div>
      </div>

      <div className="me-divider" style={{ margin: "16px 0 12px" }}></div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, letterSpacing: "0.15em", color: TEXT_DIM, marginBottom: 6 }}>
        <span>OVERALL MASTERY</span>
        <span className="me-glow-amber">{Math.round(progress * 100)}%</span>
      </div>
      <div className="me-progress-bar">
        <div className="me-progress-fill" style={{ width: `${progress * 100}%` }}></div>
      </div>
    </div>
  );
}

function VSpeedsView({ onBack }) {
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 24, color: AMBER, marginBottom: 4 }}>V-SPEED REFERENCE</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.15em" }}>
        PA-30 TWIN COMANCHE — VERIFY ALL VALUES AGAINST AIRCRAFT POH
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="me-table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Speed</th>
              <th>Definition</th>
              <th style={{ width: 90 }}>Value</th>
              <th>ASI Marking</th>
            </tr>
          </thead>
          <tbody>
            {VSPEEDS.map((v, i) => (
              <tr key={i}>
                <td><span className="me-glow-amber" style={{ fontWeight: 700, fontSize: 13 }}>{v.code}</span></td>
                <td>{v.name}</td>
                <td className="me-glow-cyan" style={{ fontWeight: 700 }}>{v.val}</td>
                <td style={{ color: TEXT_DIM, fontSize: 11 }}>{v.marking || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArrowNote({ arrow, note }) {
  const cls = arrow === "↑" ? "me-arrow-up" : "me-arrow-down";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className={cls} style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{arrow}</span>
      {note && <span style={{ color: TEXT_DIM, fontSize: 11.5, lineHeight: 1.4 }}>{note}</span>}
    </div>
  );
}

function DeeperPanel({ deeper }) {
  const paragraphs = deeper.body.split(/\n\n+/);
  return (
    <div style={{
      padding: "14px 16px",
      borderLeft: `3px solid ${CYAN}`,
      color: TEXT,
    }}>
      <div style={{ fontSize: 10, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>
        {deeper.title}
      </div>
      {paragraphs.map((p, i) => (
        <p
          key={i}
          style={{
            fontSize: 13,
            lineHeight: 1.7,
            margin: 0,
            marginBottom: i === paragraphs.length - 1 ? 0 : 10,
            whiteSpace: "pre-wrap",
            color: TEXT,
            fontWeight: 500,
          }}
        >
          {p}
        </p>
      ))}
    </div>
  );
}

function VmcTableView({ onBack }) {
  const [openRow, setOpenRow] = useState(null);
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 24, color: AMBER, marginBottom: 4 }}>Vmc FACTOR MATRIX</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.12em" }}>
        EFFECT OF EACH FACTOR ON PERFORMANCE · CONTROLLABILITY · ACTUAL Vmc
      </div>

      <div style={{ marginBottom: 14, padding: "14px 16px", background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${CYAN}`, borderRadius: "0 3px 3px 0" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 8 }}>THE FUNDAMENTAL RULE</div>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: TEXT, fontWeight: 500 }}>
          Controllability and Vmc are <span className="me-glow-cyan" style={{ fontWeight: 700 }}>INVERSE</span>. Anything that improves controllability (↑) lowers Vmc (↓). Anything that hurts controllability (↓) raises Vmc (↑). They're the same axis, viewed two ways. Once you see this, you only need to reason about ONE column — the other follows automatically.
        </div>
      </div>

      <div style={{ marginBottom: 22, padding: "14px 16px", background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${AMBER}`, borderRadius: "0 3px 3px 0" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", color: AMBER, fontWeight: 700, marginBottom: 10 }}>PAST — THE FOUR LEFT-YAWING TENDENCIES</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 4, fontSize: 13.5, marginBottom: 12, fontWeight: 500 }}>
          <span style={{ color: AMBER, fontWeight: 700 }}>P</span><span style={{ color: TEXT }}>— P-factor</span>
          <span style={{ color: AMBER, fontWeight: 700 }}>A</span><span style={{ color: TEXT }}>— Accelerated slipstream</span>
          <span style={{ color: AMBER, fontWeight: 700 }}>S</span><span style={{ color: TEXT }}>— Spiraling slipstream</span>
          <span style={{ color: AMBER, fontWeight: 700 }}>T</span><span style={{ color: TEXT }}>— Torque</span>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.7, color: TEXT, fontWeight: 500 }}>
          PAST is the <span className="me-glow-amber" style={{ fontWeight: 700 }}>WHY</span> behind the controllability column. It explains:
        </div>
        <ul style={{ fontSize: 13, lineHeight: 1.7, color: TEXT, margin: "6px 0 0 0", paddingLeft: 20 }}>
          <li>Why the <span className="me-glow-amber" style={{ fontWeight: 700 }}>LEFT engine is critical</span> on a conventional twin (PAST puts the right engine's thrust line farther from centerline)</li>
          <li>Why operating engine at max power <span className="me-glow-amber" style={{ fontWeight: 700 }}>raises</span> Vmc (more power = more PAST = more controllability burden)</li>
          <li>Why high DA <span className="me-glow-amber" style={{ fontWeight: 700 }}>lowers</span> Vmc (less power available = less PAST)</li>
        </ul>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="me-table">
          <thead>
            <tr>
              <th>Factor</th>
              <th style={{ width: 200 }}>Performance</th>
              <th style={{ width: 220 }}>Controllability</th>
              <th style={{ textAlign: "center", width: 70 }}>Vmc</th>
            </tr>
          </thead>
          <tbody>
            {VMC_TABLE.map((row, i) => {
              const isOpen = openRow === i;
              const hasDeeper = !!row.deeper;
              return (
                <React.Fragment key={i}>
                  <tr>
                    <td style={{ fontWeight: 600 }}>
                      {row.factor}
                      {hasDeeper && (
                        <button
                          onClick={() => setOpenRow(isOpen ? null : i)}
                          aria-label="Show deeper explanation"
                          style={{
                            marginLeft: 8,
                            background: "transparent",
                            border: `1px solid ${CYAN}`,
                            color: CYAN,
                            cursor: "pointer",
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 10,
                            lineHeight: 1.4,
                            verticalAlign: "1px",
                          }}
                        >
                          ?
                        </button>
                      )}
                    </td>
                    <td>
                      <ArrowNote arrow={row.perf} note={row.perfNote} />
                    </td>
                    <td>
                      <ArrowNote arrow={row.ctrl} note={row.ctrlNote} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className={row.vmc === "↑" ? "me-vmc-up" : "me-vmc-down"} style={{ fontSize: 22, fontWeight: 700 }}>{row.vmc}</span>
                    </td>
                  </tr>
                  {isOpen && hasDeeper && (
                    <tr>
                      <td colSpan={4} style={{ background: PANEL_2, padding: 0, borderBottom: `1px solid ${BORDER}` }}>
                        <DeeperPanel deeper={row.deeper} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 20, padding: 14, background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${RED}`, fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", color: RED, fontWeight: 700, marginBottom: 6 }}>EXAMINER WILL ASK:</div>
        <span style={{ color: TEXT }}>"What's the effect of high density altitude on Vmc?" → </span>
        <span className="me-glow-amber">Vmc DECREASES because less power is available, producing less asymmetric thrust. The danger: actual Vmc may now be BELOW stall speed — you'll stall before losing directional control, and you can't see the published red line creeping toward you.</span>
      </div>
    </div>
  );
}

function AircraftView({ onBack, onStartQuiz }) {
  const [openSection, setOpenSection] = useState(0);
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div className="me-display" style={{ fontSize: 26, color: AMBER, lineHeight: 1.1 }}>
            {AIRCRAFT.reg}
          </div>
          <div style={{ fontSize: 12, color: TEXT, marginTop: 4, fontWeight: 500 }}>{AIRCRAFT.model}</div>
          <div style={{ fontSize: 10, color: TEXT_DIM, marginTop: 2, letterSpacing: "0.1em" }}>
            {AIRCRAFT.rate.toUpperCase()}
          </div>
        </div>
        <button className="me-button cyan" onClick={onStartQuiz}>
          <Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Quiz Me
        </button>
      </div>

      <div className="me-divider" style={{ margin: "8px 0 16px" }}></div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 8 }}>EQUIPMENT</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {AIRCRAFT.avionics.map((item, i) => (
            <span key={i} className="me-tag" style={{ fontSize: 10, borderColor: BORDER, color: TEXT }}>
              {item}
            </span>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", color: RED, fontWeight: 700, marginBottom: 8 }}>
          ⚠ NOTABLE — KNOW THESE COLD
        </div>
        <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${RED}`, padding: "12px 14px", borderRadius: "0 3px 3px 0" }}>
          {AIRCRAFT.notable.map((line, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: i === AIRCRAFT.notable.length - 1 ? 0 : 10, fontSize: 12.5, lineHeight: 1.55 }}>
              <span className="me-bullet" style={{ flexShrink: 0 }}>›</span>
              <span><RichText line={line} /></span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", color: AMBER, fontWeight: 700, marginBottom: 10 }}>
          PANEL WALK · TAP TO EXPAND
        </div>
        {AIRCRAFT.panel.map((section, i) => {
          const isOpen = openSection === i;
          return (
            <div key={i} style={{ marginBottom: 8, background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 3, overflow: "hidden" }}>
              <button
                onClick={() => setOpenSection(isOpen ? -1 : i)}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  padding: "12px 14px",
                  textAlign: "left",
                  cursor: "pointer",
                  color: TEXT,
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  letterSpacing: "0.03em",
                }}
              >
                <span><span style={{ color: AMBER, marginRight: 8 }}>{String(i + 1).padStart(2, "0")}</span>{section.area}</span>
                <ChevronRight size={14} style={{ color: TEXT_DIM, transform: isOpen ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s" }} />
              </button>
              {isOpen && (
                <div style={{ borderTop: `1px solid ${BORDER}`, padding: "10px 14px 14px" }}>
                  {section.items.map((item, j) => (
                    <div key={j} style={{ marginTop: j === 0 ? 4 : 12, paddingBottom: j === section.items.length - 1 ? 0 : 10, borderBottom: j === section.items.length - 1 ? "none" : `1px dashed ${BORDER}` }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: AMBER, marginBottom: 3 }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: 12, color: TEXT, lineHeight: 1.55 }}>
                        {item.note}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="me-divider" style={{ margin: "20px 0 12px" }}></div>
      <div style={{ fontSize: 9, color: TEXT_DIM, letterSpacing: "0.15em", textAlign: "center" }}>
        ALWAYS DEFER TO N1100L'S POH/AFM AND PLACARDS · VERIFY ALL VALUES BEFORE FLIGHT
      </div>
    </div>
  );
}

function AircraftQuizView({ onBack }) {
  // Pseudo-topic shaped like the others so we can reuse DrillMode
  const topic = useMemo(() => ({
    id: "aircraft-quiz",
    title: "N1100L Aircraft Quiz",
    summary: "Cockpit familiarization drill",
    quiz: AIRCRAFT.quiz,
  }), []);

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 24, color: AMBER, marginBottom: 4 }}>N1100L · COCKPIT QUIZ</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.12em" }}>
        AIRCRAFT-SPECIFIC KNOWLEDGE · 1963 PA-30 · DUAL G5 + GNS 430W
      </div>
      <DrillMode topic={topic} onQuizComplete={() => {}} />
    </div>
  );
}

const VERDICT_COLORS = {
  best: "#40dc8c",
  good: CYAN,
  caution: AMBER,
  danger: RED,
};

function PerformanceView({ onBack, onStartQuiz }) {
  const [openScenario, setOpenScenario] = useState(null);
  const ctx = PERFORMANCE.context;
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>

      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>PERFORMANCE PLANNING</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.15em" }}>
        LUBBOCK · EARLY MAY · PA-30 · CHECKRIDE FOCUS
      </div>

      {/* CONTEXT BANNER */}
      <div style={{ marginBottom: 22, padding: "14px 16px", background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${AMBER}`, borderRadius: "0 3px 3px 0" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", color: AMBER, fontWeight: 700, marginBottom: 10 }}>OPERATING CONTEXT</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: "0.12em", marginBottom: 2 }}>LOCATION</div>
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>{ctx.location}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: "0.12em", marginBottom: 2 }}>SEASON</div>
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>{ctx.season}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: "0.12em", marginBottom: 2 }}>FIELD ELEV</div>
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>
              KLBB <span className="me-glow-amber">{ctx.elevations.KLBB.toLocaleString()}'</span> · F49 <span className="me-glow-amber">{ctx.elevations.F49.toLocaleString()}'</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: "0.12em", marginBottom: 2 }}>TYPICAL WX</div>
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>
              {ctx.typicalWeather.lowF}°F – {ctx.typicalWeather.highF}°F · Wind {ctx.typicalWeather.windKt} kt
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.6, fontStyle: "italic" }}>
          {ctx.typicalWeather.notes}
        </div>
      </div>

      {/* KEY NUMBERS BLOCK */}
      <div style={{ fontSize: 11, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 10 }}>KEY NUMBERS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, marginBottom: 24 }}>
        {PERFORMANCE.keyNumbers.map((kn, i) => (
          <div key={i} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, padding: "10px 12px", borderRadius: 3 }}>
            <div style={{ fontSize: 11, color: TEXT_DIM, lineHeight: 1.4, marginBottom: 4 }}>{kn.label}</div>
            <div className="me-glow-amber me-display" style={{ fontSize: 22, letterSpacing: "0.04em", lineHeight: 1.1, marginBottom: 4 }}>
              {kn.value}
            </div>
            <div style={{ fontSize: 10.5, color: TEXT_DIM, lineHeight: 1.4 }}>{kn.note}</div>
          </div>
        ))}
      </div>

      {/* DA SCENARIOS */}
      <div style={{ fontSize: 11, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 10 }}>DENSITY ALTITUDE BY CONDITIONS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {PERFORMANCE.daScenarios.map((sc, i) => {
          const c = VERDICT_COLORS[sc.verdict] || TEXT_DIM;
          return (
            <div key={i} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${c}`, padding: "12px 14px", borderRadius: "0 3px 3px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: TEXT }}>{sc.label}</div>
                <div style={{ fontSize: 11, color: c, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>{sc.verdict}</div>
              </div>
              <div style={{ fontSize: 12.5, color: TEXT, marginBottom: 6, fontWeight: 500 }}>
                Field Elev: <span className="me-glow-amber">{sc.fieldElev.toLocaleString()} ft</span> → DA: <span style={{ color: c, fontWeight: 700 }}>{sc.da.toLocaleString()} ft</span>
              </div>
              <div style={{ fontSize: 12, color: TEXT_DIM, fontStyle: "italic", lineHeight: 1.5 }}>
                {sc.verdictText}
              </div>
            </div>
          );
        })}
      </div>

      {/* CHART USE GUIDE */}
      <div style={{ fontSize: 11, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 10 }}>WHICH CHARTS YOU'LL ACTUALLY USE</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        {PERFORMANCE.chartUseGuide.map((c, i) => (
          <div key={i} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, padding: "12px 14px", borderRadius: 3 }}>
            <div className="me-glow-amber" style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>{c.chart}</div>
            <div style={{ fontSize: 12, color: TEXT, marginBottom: 4, lineHeight: 1.5 }}>
              <span style={{ color: TEXT_DIM, letterSpacing: "0.08em", fontWeight: 700 }}>INPUTS: </span>
              {c.inputs.join(", ")}
            </div>
            <div style={{ fontSize: 12, color: TEXT, marginBottom: 6, lineHeight: 1.5 }}>
              <span style={{ color: TEXT_DIM, letterSpacing: "0.08em", fontWeight: 700 }}>OUTPUT: </span>
              {c.output}
            </div>
            <div style={{ fontSize: 12, color: TEXT_DIM, fontStyle: "italic", lineHeight: 1.5 }}>
              <span style={{ color: AMBER, letterSpacing: "0.08em", fontWeight: 700, fontStyle: "normal" }}>WATCH: </span>
              {c.whatToWatch}
            </div>
          </div>
        ))}
      </div>

      {/* SCENARIO DRILLS */}
      <div style={{ fontSize: 11, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 10 }}>EXAMINER SCENARIOS — TAP TO REVEAL ANSWER</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        {PERFORMANCE.scenarios.map((sc, i) => {
          const isOpen = openScenario === i;
          return (
            <div key={i} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, padding: "12px 14px", borderRadius: 3 }}>
              <div style={{ fontSize: 12.5, color: TEXT_DIM, fontStyle: "italic", lineHeight: 1.55, marginBottom: 8 }}>
                {sc.setup}
              </div>
              <div style={{ fontSize: 14, color: TEXT, fontWeight: 600, lineHeight: 1.5, marginBottom: 10 }}>
                {sc.question}
              </div>
              <button
                className="me-button cyan"
                onClick={() => setOpenScenario(isOpen ? null : i)}
                style={{ fontSize: 10 }}
              >
                {isOpen ? "Hide answer" : "Show answer"}
                <ChevronRight size={11} style={{ display: "inline", marginLeft: 4, verticalAlign: "-2px", transform: isOpen ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s" }} />
              </button>
              {isOpen && (
                <div style={{ marginTop: 10, padding: "12px 14px", background: PANEL, borderLeft: `3px solid ${CYAN}`, borderRadius: "0 3px 3px 0" }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 6 }}>ANSWER:</div>
                  <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.65, marginBottom: 12, fontWeight: 500 }}>
                    {sc.answer}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: "0.15em", color: AMBER, fontWeight: 700, marginBottom: 6 }}>WHAT THE EXAMINER LOOKS FOR:</div>
                  <div style={{ fontSize: 12.5, color: TEXT_DIM, lineHeight: 1.6, fontStyle: "italic" }}>
                    {sc.examinerLooksFor}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="me-divider" style={{ margin: "8px 0 16px" }}></div>
      <button className="me-button cyan" onClick={onStartQuiz}>
        <Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Drill These Scenarios
      </button>
    </div>
  );
}

function PerformanceQuizView({ onBack }) {
  const topic = useMemo(() => ({
    id: "performance-quiz",
    title: "Lubbock Performance Drill",
    summary: "DA, single-engine ceiling, go/no-go scenarios",
    quiz: PERFORMANCE.quiz,
  }), []);

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 24, color: AMBER, marginBottom: 4 }}>PERFORMANCE · DRILL</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.12em" }}>
        LUBBOCK · PA-30 · DA & CHART REASONING
      </div>
      <DrillMode topic={topic} onQuizComplete={() => {}} />
    </div>
  );
}

function HomeView({ progress, perTopicProgress, onSelectTopic }) {
  const iconMap = { BookOpen, Plane, Target, Wrench, Award };
  return (
    <div>
      {CURRICULUM.map((day) => {
        const Icon = iconMap[day.icon] || BookOpen;
        return (
          <div key={day.id} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Icon size={16} style={{ color: AMBER }} />
              <div className="me-display" style={{ fontSize: 22, color: TEXT, letterSpacing: "0.1em" }}>
                {day.day.toUpperCase()}
              </div>
              <div style={{ flex: 1, height: 1, background: BORDER }}></div>
            </div>
            {day.blocks.map((block) => (
              <div key={block.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 11, letterSpacing: "0.1em", color: TEXT_DIM, textTransform: "uppercase" }}>
                  <span className={`me-tag`} style={{ borderColor: block.kind === "flight" ? BLUE : block.kind === "checkride" ? RED : AMBER, color: block.kind === "flight" ? BLUE : block.kind === "checkride" ? RED : AMBER }}>
                    {block.kind}
                  </span>
                  <span>{block.title}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {block.topics.map((topic) => {
                    const tp = perTopicProgress[topic.id] || { studied: false, quizScore: null };
                    return (
                      <div key={topic.id} className={`me-card ${block.kind}`} onClick={() => onSelectTopic(topic, block.kind)}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: TEXT, lineHeight: 1.3 }}>
                            {topic.title}
                          </div>
                          <ChevronRight size={14} style={{ color: TEXT_DIM, flexShrink: 0 }} />
                        </div>
                        <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 6, lineHeight: 1.4 }}>
                          {topic.summary}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                          <span className="me-tag" style={{ borderColor: tp.studied ? "#40dc8c" : BORDER, color: tp.studied ? "#40dc8c" : TEXT_DIM }}>
                            {tp.studied ? <Check size={9} /> : <BookOpen size={9} />}
                            Learn
                          </span>
                          <span className="me-tag" style={{ borderColor: tp.quizScore != null ? (tp.quizScore >= 0.8 ? "#40dc8c" : AMBER) : BORDER, color: tp.quizScore != null ? (tp.quizScore >= 0.8 ? "#40dc8c" : AMBER) : TEXT_DIM }}>
                            <Target size={9} />
                            {tp.quizScore != null ? `${Math.round(tp.quizScore * 100)}%` : "Drill"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Render markdown-ish bold and bullets
function RichText({ line }) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return <span key={i} className="me-glow-amber" style={{ fontWeight: 700 }}>{p.slice(2, -2)}</span>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function TopicView({ topic, kind, mode, setMode, onBack, onMarkStudied, onQuizComplete }) {
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <button className="me-button" onClick={onBack}>
          <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={`me-button ${mode === "learn" ? "active" : ""}`} onClick={() => setMode("learn")}>
            <BookOpen size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Learn
          </button>
          <button className={`me-button cyan ${mode === "drill" ? "active" : ""}`} onClick={() => setMode("drill")}>
            <Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Drill
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <span className="me-tag" style={{ borderColor: kind === "flight" ? BLUE : kind === "checkride" ? RED : AMBER, color: kind === "flight" ? BLUE : kind === "checkride" ? RED : AMBER }}>
          {kind}
        </span>
      </div>
      <div className="me-display" style={{ fontSize: 26, color: TEXT, letterSpacing: "0.05em", marginBottom: 6 }}>
        {topic.title.toUpperCase()}
      </div>
      <div className="me-serif" style={{ fontSize: 14, color: TEXT_DIM, fontStyle: "italic", marginBottom: 18, lineHeight: 1.5 }}>
        {topic.summary}
      </div>

      {mode === "learn" ? (
        <LearnMode topic={topic} onMarkStudied={onMarkStudied} />
      ) : (
        <DrillMode topic={topic} onQuizComplete={onQuizComplete} />
      )}
    </div>
  );
}

function LearnMode({ topic, onMarkStudied }) {
  const [expanded, setExpanded] = useState({});
  const [openFactor, setOpenFactor] = useState(null);
  return (
    <div>
      {topic.isFactorTable && (
        <div style={{ marginBottom: 18, overflowX: "auto" }}>
          <table className="me-table">
            <thead>
              <tr>
                <th>Factor</th>
                <th>Perf</th>
                <th>Ctrl</th>
                <th style={{ textAlign: "center", width: 60 }}>Vmc</th>
              </tr>
            </thead>
            <tbody>
              {VMC_TABLE.map((row, i) => {
                const isOpen = openFactor === i;
                const hasDeeper = !!row.deeper;
                return (
                  <React.Fragment key={i}>
                    <tr>
                      <td style={{ fontSize: 11.5 }}>
                        <div style={{ fontWeight: 600 }}>
                          {row.factor}
                          {hasDeeper && (
                            <button
                              onClick={() => setOpenFactor(isOpen ? null : i)}
                              aria-label="Show deeper explanation"
                              style={{
                                marginLeft: 6,
                                background: "transparent",
                                border: `1px solid ${CYAN}`,
                                color: CYAN,
                                cursor: "pointer",
                                fontFamily: "JetBrains Mono, monospace",
                                fontSize: 9,
                                fontWeight: 700,
                                padding: "1px 5px",
                                borderRadius: 10,
                                lineHeight: 1.4,
                                verticalAlign: "1px",
                              }}
                            >
                              ?
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <ArrowNote arrow={row.perf} note={row.perfNote} />
                      </td>
                      <td>
                        <ArrowNote arrow={row.ctrl} note={row.ctrlNote} />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className={row.vmc === "↑" ? "me-vmc-up" : "me-vmc-down"} style={{ fontSize: 18, fontWeight: 700 }}>{row.vmc}</span>
                      </td>
                    </tr>
                    {isOpen && hasDeeper && (
                      <tr>
                        <td colSpan={4} style={{ background: PANEL_2, padding: 0, borderBottom: `1px solid ${BORDER}` }}>
                          <DeeperPanel deeper={row.deeper} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="me-scrollshadow" style={{ marginBottom: 20 }}>
        {topic.teach.map((entry, i) => {
          const isObj = typeof entry === "object" && entry !== null;
          const lineText = isObj ? entry.text : entry;
          const eli16 = isObj ? entry.eli16 : null;
          const isOpen = !!expanded[i];
          return (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 12, fontSize: 15, lineHeight: 1.8, fontWeight: 500 }}>
              <span className="me-bullet" style={{ flexShrink: 0, fontFamily: "monospace" }}>›</span>
              <span style={{ flex: 1 }}>
                <RichText line={lineText} />
                {eli16 && (
                  <>
                    <div style={{ marginTop: 6 }}>
                      <button
                        onClick={() => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: CYAN,
                          cursor: "pointer",
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: 12,
                          padding: 0,
                          letterSpacing: "0.05em",
                          textDecoration: "underline",
                          textUnderlineOffset: 2,
                        }}
                      >
                        {isOpen ? "Hide simpler explanation ⓘ" : "Explain simpler ⓘ"}
                      </button>
                    </div>
                    {isOpen && (
                      <div style={{
                        marginTop: 8,
                        padding: "10px 14px",
                        background: PANEL_2,
                        borderLeft: `3px solid ${CYAN}`,
                        borderRadius: "0 3px 3px 0",
                        fontSize: 14,
                        lineHeight: 1.7,
                        fontWeight: 400,
                        color: TEXT,
                      }}>
                        {eli16}
                      </div>
                    )}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="me-divider" style={{ margin: "12px 0" }}></div>
      <button className="me-button cyan" onClick={onMarkStudied} style={{ marginTop: 4 }}>
        <Check size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Mark Studied · Go Drill
      </button>
    </div>
  );
}

function DrillMode({ topic, onQuizComplete }) {
  const total = topic.quiz.length;
  const [queue, setQueue] = useState(() => shuffle(topic.quiz.map((q, i) => ({ ...q, _origIdx: i }))));
  const [picked, setPicked] = useState(null);
  const [mastered, setMastered] = useState(() => new Set());
  const [totalAnswers, setTotalAnswers] = useState(0);
  const [firstTryCorrect, setFirstTryCorrect] = useState(0);
  const [missedIds, setMissedIds] = useState(() => new Set());
  const [done, setDone] = useState(false);

  useEffect(() => {
    setQueue(shuffle(topic.quiz.map((q, i) => ({ ...q, _origIdx: i }))));
    setPicked(null);
    setMastered(new Set());
    setTotalAnswers(0);
    setFirstTryCorrect(0);
    setMissedIds(new Set());
    setDone(false);
  }, [topic.id]);

  const q = queue[0];

  function pick(i) {
    if (picked !== null || !q) return;
    setPicked(i);
    setTotalAnswers(n => n + 1);
    if (i === q.correct) {
      if (!missedIds.has(q._origIdx) && !mastered.has(q._origIdx)) {
        setFirstTryCorrect(n => n + 1);
      }
      setMastered(prev => {
        const next = new Set(prev);
        next.add(q._origIdx);
        return next;
      });
    } else {
      setMissedIds(prev => {
        const next = new Set(prev);
        next.add(q._origIdx);
        return next;
      });
    }
  }

  function next() {
    if (!q) return;
    const wasCorrect = picked === q.correct;
    let nextQueue;
    if (wasCorrect) {
      nextQueue = queue.slice(1);
    } else {
      nextQueue = [...queue.slice(1), q];
    }
    setPicked(null);
    if (nextQueue.length === 0) {
      setQueue(nextQueue);
      setDone(true);
      const finalScore = firstTryCorrect / total;
      onQuizComplete(finalScore);
    } else {
      setQueue(nextQueue);
    }
  }

  function restart() {
    setQueue(shuffle(topic.quiz.map((q, i) => ({ ...q, _origIdx: i }))));
    setPicked(null);
    setMastered(new Set());
    setTotalAnswers(0);
    setFirstTryCorrect(0);
    setMissedIds(new Set());
    setDone(false);
  }

  if (done) {
    const pct = Math.round((firstTryCorrect / total) * 100);
    const pass = pct === 100;
    return (
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <div className="me-display" style={{ fontSize: 18, color: TEXT_DIM, letterSpacing: "0.15em" }}>
          DRILL COMPLETE
        </div>
        <div className="me-display" style={{ fontSize: 80, lineHeight: 1, margin: "16px 0", color: pass ? "#40dc8c" : RED, textShadow: `0 0 20px ${pass ? "rgba(64,220,140,0.4)" : "rgba(255,82,82,0.4)"}` }}>
          {pct}%
        </div>
        <div style={{ fontSize: 13, color: pass ? "#40dc8c" : RED, marginBottom: 8, letterSpacing: "0.1em", fontWeight: 700 }}>
          {pass ? "MASTERY ACHIEVED" : "TRY AGAIN — 100% REQUIRED FOR MASTERY"}
        </div>
        <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 24, letterSpacing: "0.1em" }}>
          {firstTryCorrect} OF {total} ON FIRST TRY · {totalAnswers} TOTAL ANSWERS
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="me-button" onClick={restart}>
            <RotateCcw size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Retry Drill
          </button>
        </div>
      </div>
    );
  }

  if (!q) return null;

  const wasCorrect = picked === q.correct;
  const masteredCount = mastered.size;
  const progressPct = (masteredCount / total) * 100;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, letterSpacing: "0.12em", color: TEXT_DIM, marginBottom: 8 }}>
        <span>MASTERED {masteredCount} / {total}  ·  QUEUE {queue.length}</span>
        <span className="me-glow-cyan">FIRST-TRY: {firstTryCorrect}/{total}</span>
      </div>
      <div className="me-progress-bar" style={{ marginBottom: 18 }}>
        <div className="me-progress-fill" style={{ width: `${progressPct}%` }}></div>
      </div>

      <div style={{ fontSize: 16.5, lineHeight: 1.55, marginBottom: 16, color: TEXT, fontWeight: 500 }}>
        {q.q}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {q.a.map((opt, i) => {
          let cls = "me-quiz-option";
          if (picked !== null) {
            cls += " disabled";
            if (i === q.correct) cls += " correct";
            else if (i === picked) cls += " wrong";
          }
          return (
            <button key={i} className={cls} onClick={() => pick(i)}>
              <span style={{ color: AMBER, marginRight: 10, fontWeight: 700 }}>{String.fromCharCode(65 + i)}.</span>
              {opt}
              {picked !== null && i === q.correct && <Check size={14} style={{ float: "right", color: "#40dc8c" }} />}
              {picked !== null && i === picked && i !== q.correct && <X size={14} style={{ float: "right", color: RED }} />}
            </button>
          );
        })}
      </div>

      {picked !== null && q.explain && (
        <div style={{
          background: PANEL_2,
          border: `1px solid ${BORDER}`,
          borderLeft: `3px solid ${wasCorrect ? "#40dc8c" : AMBER}`,
          padding: "12px 14px",
          marginBottom: 14,
          fontSize: 12.5,
          lineHeight: 1.6,
          borderRadius: "0 3px 3px 0",
        }}>
          <div style={{ fontSize: 9, letterSpacing: "0.15em", color: wasCorrect ? "#40dc8c" : AMBER, fontWeight: 700, marginBottom: 6 }}>
            {wasCorrect ? "✓ CORRECT — WHY:" : "✗ NOT QUITE — HERE'S THE WHY:"}
          </div>
          <div style={{ color: TEXT }}>{q.explain}</div>
        </div>
      )}

      {picked !== null && (() => {
        const willFinish = wasCorrect && queue.length === 1;
        const willRequeue = !wasCorrect;
        return (
          <button className="me-button active" onClick={next} style={{ width: "100%" }}>
            {willFinish ? "FINISH DRILL" : willRequeue ? "RE-QUEUED · NEXT QUESTION" : "NEXT QUESTION"}
            <ChevronRight size={11} style={{ display: "inline", marginLeft: 4, verticalAlign: "-2px" }} />
          </button>
        );
      })()}
    </div>
  );
}

// =====================================================================
// DRILL ALL — cross-curriculum spaced repetition mode
// Pulls every quiz question from every topic. Missed questions get
// re-queued to the end (Leitner-style); session ends when all are
// answered correctly at least once.
// =====================================================================

function buildAllQuestions() {
  const all = [];
  CURRICULUM.forEach((day) => {
    day.blocks.forEach((block) => {
      block.topics.forEach((topic) => {
        topic.quiz.forEach((q, qi) => {
          all.push({
            ...q,
            _id: `${topic.id}__${qi}`,
            _topic: topic.title,
            _day: day.day,
            _kind: block.kind,
          });
        });
      });
    });
  });
  // Include aircraft-specific questions
  AIRCRAFT.quiz.forEach((q, qi) => {
    all.push({
      ...q,
      _id: `aircraft__${qi}`,
      _topic: `${AIRCRAFT.reg} Cockpit`,
      _day: "Aircraft",
      _kind: "aircraft",
    });
  });
  // Include performance-planning questions
  PERFORMANCE.quiz.forEach((q, qi) => {
    all.push({
      ...q,
      _id: `performance__${qi}`,
      _topic: "Lubbock Performance Planning",
      _day: "Performance",
      _kind: "performance",
    });
  });
  return all;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function DrillAllView({ onBack, mode = "untilMastered" }) {
  // mode: "untilMastered" — every Q must be correct once; misses re-queue
  //       "fixed" — fixed N-question session, scored at end
  const [sessionMode, setSessionMode] = useState(mode);
  const [queue, setQueue] = useState([]);
  const [picked, setPicked] = useState(null);
  const [stats, setStats] = useState({ seen: 0, correctFirstTry: 0, totalAnswers: 0, missed: 0, mastered: 0 });
  const [done, setDone] = useState(false);
  const [firstTryMap, setFirstTryMap] = useState({}); // _id -> bool (true if got it right first time without ever missing)
  const [sessionTotal, setSessionTotal] = useState(0);

  function start(modeToUse) {
    const all = shuffle(buildAllQuestions());
    setQueue(all);
    setPicked(null);
    setStats({ seen: 0, correctFirstTry: 0, totalAnswers: 0, missed: 0, mastered: 0 });
    setFirstTryMap({});
    setDone(false);
    setSessionMode(modeToUse);
    setSessionTotal(all.length);
  }

  useEffect(() => { start(sessionMode); /* eslint-disable-next-line */ }, []);

  if (queue.length === 0 && !done) {
    return (
      <div className="me-panel" style={{ padding: 20 }}>
        <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
          <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
        </button>
        <div className="me-display" style={{ fontSize: 22, color: AMBER }}>Loading drill bank…</div>
      </div>
    );
  }

  if (done) {
    const accuracy = stats.totalAnswers > 0 ? Math.round((stats.mastered / stats.totalAnswers) * 100) : 0;
    return (
      <div className="me-panel" style={{ padding: 20 }}>
        <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
          <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
        </button>
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div className="me-display" style={{ fontSize: 22, color: TEXT_DIM, letterSpacing: "0.15em" }}>
            FULL CURRICULUM DRILL · COMPLETE
          </div>
          <div className="me-display" style={{ fontSize: 84, lineHeight: 1, margin: "16px 0", color: AMBER, textShadow: "0 0 20px rgba(255,184,74,0.4)" }}>
            {stats.mastered}
          </div>
          <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 8, letterSpacing: "0.1em" }}>
            QUESTIONS MASTERED
          </div>
          <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 24, letterSpacing: "0.1em" }}>
            FIRST-TRY ACCURACY: <span className="me-glow-cyan">{stats.totalAnswers === 0 ? 0 : Math.round((stats.correctFirstTry / stats.mastered) * 100)}%</span>  ·  TOTAL ATTEMPTS: {stats.totalAnswers}  ·  MISSES: {stats.missed}
          </div>
          <button className="me-button active" onClick={() => start(sessionMode)}>
            <RotateCcw size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Run Again
          </button>
        </div>
      </div>
    );
  }

  const q = queue[0];
  const wasCorrect = picked === q.correct;

  function pick(i) {
    if (picked !== null) return;
    setPicked(i);
    const isCorrect = i === q.correct;
    setStats(s => ({
      ...s,
      totalAnswers: s.totalAnswers + 1,
      missed: s.missed + (isCorrect ? 0 : 1),
    }));
    if (!isCorrect) {
      // mark this question as "ever missed" so a future correct doesn't count as first-try
      setFirstTryMap(m => ({ ...m, [q._id]: false }));
    } else {
      // only set firstTryMap to true if it wasn't already set (i.e., never missed before)
      setFirstTryMap(m => (q._id in m ? m : { ...m, [q._id]: true }));
    }
  }

  function next() {
    const isCorrect = picked === q.correct;
    let newQueue;
    let newStats = { ...stats };

    if (isCorrect) {
      // Mastered — drop from queue
      newQueue = queue.slice(1);
      newStats.mastered = stats.mastered + 1;
      if (firstTryMap[q._id] === true || !(q._id in firstTryMap)) {
        // Got it right and was never missed before → first-try success
        newStats.correctFirstTry = stats.correctFirstTry + 1;
      }
    } else {
      // Missed — re-queue at the end (with a few buffer questions in between)
      const reinsertAt = Math.min(queue.length - 1, Math.max(3, Math.floor(queue.length / 4)));
      newQueue = [...queue.slice(1)];
      newQueue.splice(reinsertAt, 0, q);
    }

    setQueue(newQueue);
    setStats(newStats);
    setPicked(null);

    if (newQueue.length === 0) {
      setDone(true);
    }
  }

  const progressPct = sessionTotal > 0 ? (stats.mastered / sessionTotal) * 100 : 0;

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <button className="me-button" onClick={onBack}>
          <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
        </button>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="me-tag" style={{ borderColor: CYAN, color: CYAN }}>SPACED · UNTIL MASTERED</span>
        </div>
      </div>

      <div className="me-display" style={{ fontSize: 22, color: AMBER, marginBottom: 4 }}>FULL CURRICULUM DRILL</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 14, letterSpacing: "0.12em" }}>
        ANSWER EVERY QUESTION CORRECTLY · MISSED QUESTIONS RECYCLE TO THE BACK
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        <Stat label="MASTERED" value={stats.mastered} color="#40dc8c" />
        <Stat label="REMAINING" value={queue.length} color={AMBER} />
        <Stat label="ATTEMPTS" value={stats.totalAnswers} color={CYAN} />
        <Stat label="MISSES" value={stats.missed} color={RED} />
      </div>

      <div className="me-progress-bar" style={{ marginBottom: 18 }}>
        <div className="me-progress-fill" style={{ width: `${progressPct}%` }}></div>
      </div>

      <div style={{ fontSize: 9, letterSpacing: "0.15em", color: TEXT_DIM, marginBottom: 6 }}>
        <span className="me-glow-amber">{q._day}</span> · {q._topic}
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.55, marginBottom: 16, color: TEXT, fontWeight: 500 }}>
        {q.q}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {q.a.map((opt, i) => {
          let cls = "me-quiz-option";
          if (picked !== null) {
            cls += " disabled";
            if (i === q.correct) cls += " correct";
            else if (i === picked) cls += " wrong";
          }
          return (
            <button key={i} className={cls} onClick={() => pick(i)}>
              <span style={{ color: AMBER, marginRight: 10, fontWeight: 700 }}>{String.fromCharCode(65 + i)}.</span>
              {opt}
              {picked !== null && i === q.correct && <Check size={14} style={{ float: "right", color: "#40dc8c" }} />}
              {picked !== null && i === picked && i !== q.correct && <X size={14} style={{ float: "right", color: RED }} />}
            </button>
          );
        })}
      </div>

      {picked !== null && q.explain && (
        <div style={{
          background: PANEL_2,
          border: `1px solid ${BORDER}`,
          borderLeft: `3px solid ${wasCorrect ? "#40dc8c" : AMBER}`,
          padding: "12px 14px",
          marginBottom: 14,
          fontSize: 12.5,
          lineHeight: 1.6,
          borderRadius: "0 3px 3px 0",
        }}>
          <div style={{ fontSize: 9, letterSpacing: "0.15em", color: wasCorrect ? "#40dc8c" : AMBER, fontWeight: 700, marginBottom: 6 }}>
            {wasCorrect ? "✓ CORRECT — WHY:" : "✗ NOT QUITE — HERE'S THE WHY:"}
          </div>
          <div style={{ color: TEXT }}>{q.explain}</div>
          {!wasCorrect && (
            <div style={{ marginTop: 8, fontSize: 10, color: TEXT_DIM, fontStyle: "italic", letterSpacing: "0.05em" }}>
              ↻ This question will return later in the queue.
            </div>
          )}
        </div>
      )}

      {picked !== null && (
        <button className="me-button active" onClick={next} style={{ width: "100%" }}>
          {queue.length === 1 && wasCorrect ? "FINISH" : "NEXT"}
          <ChevronRight size={11} style={{ display: "inline", marginLeft: 4, verticalAlign: "-2px" }} />
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, padding: "8px 10px", borderRadius: 3, textAlign: "center" }}>
      <div style={{ fontSize: 9, letterSpacing: "0.12em", color: TEXT_DIM }}>{label}</div>
      <div className="me-display" style={{ fontSize: 24, color, lineHeight: 1.1, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// =====================================================================
// MAIN APP
// =====================================================================

export default function App() {
  const [view, setView] = useState("home"); // home, topic, vspeeds, vmctable
  const [activeTopic, setActiveTopic] = useState(null);
  const [activeKind, setActiveKind] = useState(null);
  const [mode, setMode] = useState("learn");
  const [perTopicProgress, setPerTopicProgress] = useState({});

  // Total topic count
  const allTopics = useMemo(() => {
    const arr = [];
    CURRICULUM.forEach(d => d.blocks.forEach(b => b.topics.forEach(t => arr.push(t))));
    return arr;
  }, []);

  const progress = useMemo(() => {
    if (allTopics.length === 0) return 0;
    let pts = 0;
    allTopics.forEach(t => {
      const p = perTopicProgress[t.id];
      if (!p) return;
      if (p.studied) pts += 0.4;
      if (p.quizScore != null) pts += 0.6 * p.quizScore;
    });
    return pts / allTopics.length;
  }, [perTopicProgress, allTopics]);

  function selectTopic(topic, kind) {
    setActiveTopic(topic);
    setActiveKind(kind);
    setMode("learn");
    setView("topic");
  }

  function markStudied() {
    if (!activeTopic) return;
    setPerTopicProgress(prev => ({
      ...prev,
      [activeTopic.id]: { ...(prev[activeTopic.id] || {}), studied: true }
    }));
    setMode("drill");
  }

  function quizComplete(scorePct) {
    if (!activeTopic) return;
    if (scorePct < 1.0) return;
    setPerTopicProgress(prev => ({
      ...prev,
      [activeTopic.id]: {
        ...(prev[activeTopic.id] || { studied: true }),
        studied: true,
        quizScore: 1.0,
      }
    }));
  }

  function reset() {
    if (confirm("Reset all progress?")) setPerTopicProgress({});
  }

  return (
    <div className="me-app">
      <StyleSheet />
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Header progress={progress} onReset={reset} view={view} setView={setView} />
        {view === "home" && (
          <HomeView progress={progress} perTopicProgress={perTopicProgress} onSelectTopic={selectTopic} />
        )}
        {view === "aircraft" && (
          <AircraftView onBack={() => setView("home")} onStartQuiz={() => setView("aircraftquiz")} />
        )}
        {view === "aircraftquiz" && (
          <AircraftQuizView onBack={() => setView("aircraft")} />
        )}
        {view === "performance" && (
          <PerformanceView onBack={() => setView("home")} onStartQuiz={() => setView("performancequiz")} />
        )}
        {view === "performancequiz" && (
          <PerformanceQuizView onBack={() => setView("performance")} />
        )}
        {view === "drillall" && (
          <DrillAllView onBack={() => setView("home")} />
        )}
        {view === "vspeeds" && (
          <VSpeedsView onBack={() => setView("home")} />
        )}
        {view === "vmctable" && (
          <VmcTableView onBack={() => setView("home")} />
        )}
        {view === "topic" && activeTopic && (
          <TopicView
            topic={activeTopic}
            kind={activeKind}
            mode={mode}
            setMode={setMode}
            onBack={() => setView("home")}
            onMarkStudied={markStudied}
            onQuizComplete={quizComplete}
          />
        )}
        <div style={{ textAlign: "center", marginTop: 28, fontSize: 9, color: TEXT_DIM, letterSpacing: "0.2em" }}>
          ⊿ FOR STUDY USE ONLY · ALWAYS DEFER TO POH AND CFI · NOT A SUBSTITUTE FOR INSTRUCTION ⊿
        </div>
      </div>
    </div>
  );
}
