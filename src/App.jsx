import React, { useState, useMemo, useEffect, useRef } from "react";
import { Plane, BookOpen, Target, ChevronRight, Check, X, RotateCcw, ArrowLeft, AlertTriangle, AlertOctagon, Wind, Settings, ClipboardCheck, Gauge, Wrench, Radio, MapPin, FileText, Award, ListChecks, BarChart3, MessageSquare, Search, Square, CheckSquare } from "lucide-react";

// =====================================================================
// MULTI-ENGINE STUDY APP — Private Pilot AMEL Add-On
// Calibrated to FAA Private Pilot AMEL ACS, PA-30 Twin Comanche
// Built around Raider Aviation's 5-day syllabus
// =====================================================================

// ---------- Cross-device sync helpers ----------
function generateUserId() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // skip ambiguous: l, o, 0, 1
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function getUserIdFromUrl() {
  const path = window.location.pathname;
  const match = path.match(/^\/u\/([a-z0-9]+)$/i);
  return match ? match[1] : null;
}

function setUserIdInUrl(userId) {
  const newUrl = `/u/${userId}`;
  if (window.location.pathname !== newUrl) {
    window.history.replaceState(null, "", newUrl);
  }
}

async function saveProgressRemote(userId, progress) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return false;
  }
  try {
    const res = await fetch("/api/save-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, progress }),
    });
    if (!res.ok) throw new Error("Save failed");
    return true;
  } catch (e) {
    console.warn("Remote save failed:", e);
    return false;
  }
}

async function loadProgressRemote(userId) {
  try {
    const res = await fetch(`/api/load-progress?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error("Load failed");
    const data = await res.json();
    return { ok: true, progress: data.progress };
  } catch (e) {
    console.warn("Remote load failed:", e);
    return { ok: false, progress: null };
  }
}

function localKey(userId) {
  return `me-study:progress:${userId}`;
}

function loadProgressLocal(userId) {
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveProgressLocal(userId, progress) {
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(progress));
  } catch (e) {
    /* quota or disabled — silently ignore */
  }
}

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

// ---------- VMC MASTERY (120 questions, 3 tiers) ----------
const VMC_MASTERY = {
  tiers: [
    {
      id: "foundations",
      level: 1,
      name: "Tier 1 — Foundations",
      blurb: "Direct factor lookups. Lock in the core relationships before reasoning about combinations.",
      questions: [
        { q: "Effect of HIGH DENSITY ALTITUDE on Vmc?", a: ["Vmc increases", "Vmc decreases (less power, less PAST)", "No effect", "Only changes with weight"], correct: 1, type: "lookup", explain: "Less air = less power available from operating engine = less asymmetric thrust = less rudder needed. Vmc decreases. The trap: actual Vmc may drop below stall speed, so airplane stalls before losing directional control." },
        { q: "Effect of LOW DENSITY ALTITUDE (standard day, sea level) on Vmc?", a: ["Vmc decreases", "Vmc increases (full power available, more PAST)", "No effect", "Only matters with engine failure"], correct: 1, type: "lookup", explain: "Sea level standard day = engine produces full rated power = maximum PAST = maximum asymmetric thrust to overcome = highest Vmc. This is the certification basis." },
        { q: "Effect of OPERATING ENGINE AT MAX POWER on Vmc?", a: ["Vmc decreases", "Vmc increases (more PAST)", "No effect", "Only on takeoff"], correct: 1, type: "lookup", explain: "More power on the live engine = more asymmetric thrust = more rudder needed to control = higher Vmc. Vmc recovery procedure is to REDUCE power on operating engine — directly leverages this relationship." },
        { q: "Effect of REDUCING POWER on operating engine on Vmc?", a: ["Vmc decreases", "Vmc increases", "No change", "Doubles Vmc"], correct: 0, type: "lookup", explain: "Less power = less PAST = less asymmetric thrust = lower Vmc. This is the entire basis of Vmc recovery: when you encounter loss of control, REDUCE power and the airplane becomes controllable again." },
        { q: "Effect of MAX GROSS WEIGHT on Vmc?", a: ["Vmc increases", "Vmc decreases (more inertia + horizontal lift when banked)", "No effect", "Doubles Vmc"], correct: 1, type: "lookup", explain: "Heavier airplane = more inertia resisting yaw + larger horizontal lift component when banked toward operating engine. Both lower Vmc. But performance also tanks. Vmc and performance moving opposite directions on weight is a key examiner trap." },
        { q: "Effect of LIGHTER WEIGHT on Vmc?", a: ["Vmc decreases", "Vmc increases", "No effect", "Same as max gross"], correct: 1, type: "lookup", explain: "Less inertia + smaller horizontal lift component when banked = less resistance to yaw = higher Vmc. Lighter is BETTER for climb performance but WORSE for Vmc. This is why the certification standard uses 'most unfavorable weight' — generally lighter — for the worst-case Vmc." },
        { q: "Effect of AFT CG on Vmc?", a: ["Vmc decreases", "Vmc increases (shorter rudder arm)", "No effect", "Same as forward CG"], correct: 1, type: "lookup", explain: "Aft CG shortens the moment arm between CG and rudder. Less rudder authority for the same deflection. Need more airspeed to generate enough rudder force = higher Vmc." },
        { q: "Effect of FORWARD CG on Vmc?", a: ["Vmc decreases (longer rudder arm)", "Vmc increases", "No effect", "Same as aft CG"], correct: 0, type: "lookup", explain: "Forward CG = longer moment arm = more rudder authority for same deflection = lower Vmc. This is why operationally, weighting forward helps single-engine controllability (though performance penalty exists from longer trim drag)." },
        { q: "Effect of BANK 5° TOWARD OPERATING ENGINE on Vmc?", a: ["Vmc increases", "Vmc decreases (horizontal lift component opposes yaw)", "No effect", "Only matters above 5,000 ft"], correct: 1, type: "lookup", explain: "Banking creates a horizontal lift component that physically opposes the asymmetric yaw. Plus reduces sideslip drag. The ONE factor that helps both Vmc AND performance — that's why 'raise the dead, ½ ball, ~2° bank' is post-failure muscle memory." },
        { q: "Effect of BANK TOWARD DEAD ENGINE on Vmc?", a: ["Vmc decreases", "Vmc increases significantly (compounds the asymmetric yaw)", "No effect", "Same as wings level"], correct: 1, type: "lookup", explain: "Banking toward the dead engine puts the horizontal lift component working WITH the asymmetric yaw, not against it. Vmc rises sharply. NEVER bank toward the dead engine after engine failure." },
        { q: "Effect of WINGS LEVEL (zero bank) with one engine out on Vmc?", a: ["Vmc decreases vs banked", "Vmc increases vs banked toward operating engine (no horizontal lift to oppose yaw)", "No effect", "Same as both engines running"], correct: 1, type: "lookup", explain: "Wings level = no horizontal lift component to counter yaw. Vmc is higher than the banked-toward-operating case. The certification spec allows up to 5° bank toward operating engine specifically because this lowers the published Vmc." },
        { q: "Effect of WINDMILLING propeller on the dead engine on Vmc?", a: ["Vmc decreases (less drag)", "Vmc increases (more drag, more asymmetric force)", "No effect", "Only matters with gear up"], correct: 1, type: "lookup", explain: "Windmilling prop produces enormous drag — more than gear extended. That drag adds to the asymmetric force already present from the live engine, raising Vmc. Worst-case condition assumed in cert standard." },
        { q: "Effect of FEATHERED propeller on the dead engine on Vmc?", a: ["Vmc decreases (drag reduced)", "Vmc increases", "No effect", "Only matters above 5,000 ft"], correct: 0, type: "lookup", explain: "Feathering eliminates ~80% of the windmilling drag. Less asymmetric force = lower Vmc. Plus better climb performance. Why the engine-failure flow prioritizes feathering quickly." },
        { q: "Effect of GEAR UP / FLAPS UP (clean takeoff config) on Vmc?", a: ["Vmc decreases", "Vmc increases (less keel/fin effect, less rudder authority from flap-blown air)", "No effect", "Same as gear down"], correct: 1, type: "lookup", explain: "Gear and flaps act as 'keel' surfaces that add directional stability. Clean config = less keel = need more airspeed to maintain control. Cert standard uses clean config = higher published Vmc." },
        { q: "Effect of GEAR DOWN / FLAPS DOWN on Vmc?", a: ["Vmc decreases (more keel/fin effect)", "Vmc increases", "No effect", "Doubles Vmc"], correct: 0, type: "lookup", explain: "Extended gear/flaps = more vertical surface area resisting yaw = lower Vmc. But MASSIVE drag penalty kills climb performance. So even though gear-down lowers Vmc, you clean up after engine failure for the climb performance." },
        { q: "Effect of CRITICAL ENGINE INOP (windmilling) on Vmc — does Vmc apply?", a: ["No, Vmc only applies with both engines running", "Yes — Vmc IS the speed below which one-engine-out control is lost", "Only on takeoff", "Only on landing"], correct: 1, type: "lookup", explain: "Vmc is BY DEFINITION the minimum control speed with the critical engine inoperative. Vmc is the airspeed below which the rudder cannot overcome asymmetric thrust from one engine at full power." },
        { q: "Vmc is marked on the airspeed indicator as a:", a: ["Blue radial line", "Red radial line", "Yellow arc", "White arc"], correct: 1, type: "lookup", explain: "RED radial line. Mnemonic: Red = Dead (below Vmc with engine out, the airplane becomes uncontrollable). Blue = Best (Vyse, single-engine best rate of climb)." },
        { q: "Vyse is marked as what color radial?", a: ["Red", "Blue", "Green", "White"], correct: 1, type: "lookup", explain: "BLUE radial. Vyse = best rate of climb single-engine. After identify-verify-feather, your sole pitch target is blue line." },
        { q: "Per certification, the inoperative engine in Vmc determination is assumed to be:", a: ["Feathered", "Windmilling", "At idle", "Shut down with prop stopped"], correct: 1, type: "lookup", explain: "Windmilling — the worst-case drag condition. Feathering would lower actual Vmc below the published red line, which is why feathering quickly in real life is so beneficial." },
        { q: "Per certification, the gear and flaps are assumed to be:", a: ["Gear down, flaps full", "Gear up, flaps in takeoff position", "Gear up, flaps up", "Gear down, flaps up"], correct: 1, type: "lookup", explain: "Gear UP, flaps in TAKEOFF position. Represents the most-likely engine-failure scenario (just after liftoff, before clean-up complete)." },
        { q: "Maximum bank angle assumed in Vmc certification?", a: ["0°", "Up to 5° toward the operating engine", "10° toward the dead engine", "15° wings level"], correct: 1, type: "lookup", explain: "14 CFR §23.149: up to 5° bank toward the OPERATING engine. The horizontal lift component lowers the determined Vmc — without this bank allowance, published Vmc would be unworkably high." },
        { q: "Per certification, weight assumed for Vmc determination is:", a: ["Maximum gross", "Most unfavorable (typically lighter)", "Empty weight", "Mid-range"], correct: 1, type: "lookup", explain: "Most unfavorable. For Vmc, lighter = higher Vmc (less inertia, less horizontal lift when banked), so cert uses lighter weight. The 'most unfavorable' phrasing is in the regulation." },
        { q: "Per certification, CG assumed for Vmc determination is:", a: ["Forward limit", "Most unfavorable (typically aft)", "Mid-range", "Empty weight CG"], correct: 1, type: "lookup", explain: "Most unfavorable, typically aft — shortens rudder arm, reduces rudder authority, raises Vmc. Cert standard always picks the worst-case, so the published red line is conservative." },
        { q: "Per certification, the operating engine is at:", a: ["Cruise power", "Maximum takeoff power", "Idle", "75% power"], correct: 1, type: "lookup", explain: "Maximum takeoff power — produces the most asymmetric thrust = highest rudder demand = highest Vmc. Worst-case assumption." },
        { q: "Per certification, density altitude condition assumed:", a: ["High DA (10,000 ft)", "Standard day at sea level", "Service ceiling", "Density altitude doesn't matter"], correct: 1, type: "lookup", explain: "Standard day, sea level. Where engine makes full rated power. At altitude, less power = less PAST = lower actual Vmc, but the published red line stays put." },
        { q: "On a conventional twin (both props clockwise from pilot view), the critical engine is the:", a: ["Right engine", "Left engine", "Either", "Neither"], correct: 1, type: "lookup", explain: "LEFT engine. PAST puts each engine's effective thrust line on its right side; geometry makes the right engine's thrust farther from centerline. Lose the left and the right's longer arm produces a bigger yawing moment." },
        { q: "On a counter-rotating twin (e.g., PA-39), the critical engine is the:", a: ["Right engine", "Left engine", "Neither — counter-rotation cancels asymmetry", "Both"], correct: 2, type: "lookup", explain: "Neither. Counter-rotating props mirror PAST effects, so thrust geometry is symmetric about centerline. Neither engine is critical." },
        { q: "P-A-S-T stands for:", a: ["P-factor, Asymmetric thrust, Slipstream, Torque", "P-factor, Accelerated slipstream, Spiraling slipstream, Torque", "Power, Airflow, Spin, Throttle", "Pitch, Angle, Speed, Trim"], correct: 1, type: "lookup", explain: "The four left-yawing tendencies in any propeller airplane. In a twin, these are why the LEFT engine is critical and why operating engine power affects controllability." },
        { q: "If Vmc on a twin is published as 80 mph, can actual Vmc be lower than 80 mph in flight?", a: ["No, never", "Yes — at altitude (less power available, less PAST)", "Only with feathered prop", "Only on cold days"], correct: 1, type: "lookup", explain: "Actual Vmc decreases with altitude because the engine can't produce full rated power. Real Vmc may drop well below 80 mph at 8,000 ft DA. The danger: actual Vmc may even drop below stall speed, meaning the airplane stalls without warning of Vmc approach." },
        { q: "Can actual Vmc ever be higher than the published red line?", a: ["No, never — published is conservative for normal ops", "Yes, with windmilling prop and aft CG combined", "Yes, on hot days", "Always at altitude"], correct: 0, type: "lookup", explain: "No. The cert standard uses the worst-case combination of factors, so published Vmc is conservative. Any real-world deviation from the cert assumptions either lowers Vmc or doesn't change it. (Some training literature debates edge cases, but for ACS oral the answer is 'no.')" },
      ],
    },
    {
      id: "reasoning",
      level: 2,
      name: "Tier 2 — Reasoning",
      blurb: "Reverse questions, combinations, rule application. You can't unlock without 100% on Tier 1.",
      questions: [
        { q: "Vmc DECREASED but you didn't change weight or CG. Most likely change?", a: ["You climbed to higher altitude (less power available, less PAST)", "You gained weight", "You shifted CG aft", "Wings rolled level"], correct: 0, type: "reverse", explain: "Of the standard Vmc factors, only altitude/DA changes Vmc without you actively changing weight, CG, or configuration. Higher altitude → less power → less PAST → lower Vmc." },
        { q: "Vmc INCREASED. The pilot states they did not change power, configuration, or altitude. Most likely cause?", a: ["Burned fuel = lighter weight", "Forward CG shift", "Banked harder toward operating engine", "Outside air temperature dropped"], correct: 0, type: "reverse", explain: "Burning fuel reduces weight. Lighter = less inertia + less horizontal lift = higher Vmc. The classic 'I'm flying lighter and Vmc went up' scenario." },
        { q: "Single-engine performance is degrading but Vmc is unchanged. Most likely?", a: ["Climbed to high altitude (Vmc would also drop, contradicts)", "Gear and flaps now extended (drag = perf ↓, but keel effect lowers Vmc — contradicts)", "Engine output of operating engine fading from heat soak (Vmc would also fall)", "Trick question — these two move together; if perf drops, something is also affecting Vmc"], correct: 3, type: "reverse", explain: "This is a CFI-level question. Performance and controllability/Vmc are linked through power. If single-engine performance drops, it's almost certainly because of less power being produced, which would also reduce PAST → reduce Vmc. So 'perf down, Vmc unchanged' is essentially contradictory in real conditions." },
        { q: "After feathering, single-engine climb dramatically improved AND Vmc dropped. Why both?", a: ["Coincidence", "Feathering reduced drag (perf ↑) AND reduced asymmetric force (Vmc ↓) — same physical change drives both", "The pilot also shifted CG forward", "Altitude must have changed"], correct: 1, type: "reverse", explain: "ONE physical change (windmilling → feathered) drives both improvements. Drag drops dramatically AND the asymmetric force from the dead engine drops. This is why feathering is the highest-leverage post-failure action." },
        { q: "Pilot reports symmetric airplane behavior with one engine windmilling — no yaw. Most likely?", a: ["The airplane is fully feathered, not windmilling", "The pilot is flying below Vmc and has lost control already", "The airplane is at zero airspeed", "Both engines are actually running normally"], correct: 3, type: "reverse", explain: "With one engine truly windmilling at high power on the other side, there WILL be asymmetric yaw — that's basic physics. If there's no yaw, the most likely explanation is the dead engine isn't actually dead. Verify before feathering." },
        { q: "On a hot day at altitude, the airplane stalls instead of giving you a Vmc roll warning. Why?", a: ["The airplane is broken", "Actual Vmc dropped below stall speed (less power = lower Vmc; stall speed unchanged with altitude)", "Stall speed went up at altitude", "It's not actually stalling"], correct: 1, type: "reverse", explain: "Stall speed is purely about airflow over the wing — same indicated airspeed at any altitude. Vmc decreases at altitude because of reduced power. At enough altitude, real Vmc can drop below stall speed, so the airplane stalls before any Vmc warning. THE most dangerous twin scenario." },
        { q: "Pilot has banked toward operating engine but Vmc still seems high. Most likely?", a: ["Bank angle is too small (need ~2°, ½ ball)", "Wings level — bank not actually achieved", "Bank is correct but ball is centered (sideslip still present, drag high)", "All of the above are possible diagnostic checks"], correct: 3, type: "reverse", explain: "All three are common errors that prevent zero-sideslip benefit. The fix is the same in all cases: ~2° bank toward operating engine, ball ½ split toward operating engine, NOT centered." },
        { q: "Vmc went UP and weight went DOWN. What changed?", a: ["Altitude — lower altitude (more power available)", "Weight reduction directly raises Vmc (less inertia)", "Aft CG shift", "Operating engine power increased to max"], correct: 1, type: "reverse", explain: "Weight reduction directly RAISES Vmc — less inertia and less horizontal lift component when banked. Could also be combined with altitude or power changes, but the weight change alone explains Vmc going up." },
        { q: "Vmc went UP but pilot didn't touch the power lever. The likely change is:", a: ["Burned fuel (lighter weight)", "Crossed into different airspace", "Time of day changed", "Magnetic deviation"], correct: 0, type: "reverse", explain: "Without changing power, altitude, or configuration, the most common cause of Vmc creep is fuel burn = weight loss = higher Vmc. CGs shift too as fuel burns, depending on tank arms — but weight is the dominant effect." },
        { q: "After 30 minutes of single-engine flight, the pilot notices it takes more rudder to maintain heading even though airspeed is the same. Why?", a: ["Rudder cable stretched", "Fuel burn made the airplane lighter, raising Vmc, increasing required rudder", "Engine warmed up and is making more power", "Both engines are now running"], correct: 1, type: "reverse", explain: "Fuel burn = lighter weight = higher Vmc = at the same airspeed, you've effectively gotten closer to Vmc, so more rudder is needed. Sneaky real-world effect — reason cross-feeding is sometimes used to balance fuel and weight in long single-engine ops." },
        { q: "Pilot increased altitude by 3,000 ft. Vmc dropped 5 mph. Then they shifted CG forward by re-stowing baggage. What likely happened to Vmc?", a: ["Dropped further (forward CG also lowers Vmc)", "Rose back up to baseline", "No change", "Vmc became zero"], correct: 0, type: "reverse", explain: "Both factors lower Vmc independently. They stack. Higher altitude (less power) AND forward CG (longer rudder arm) both decrease Vmc → combined effect is even lower Vmc." },
        { q: "Vmc DROPPED below stall speed. What does this mean operationally?", a: ["Safer — the airplane will stall before losing directional control", "More dangerous — no Vmc warning before stall, and stall + windmilling engine = Vmc roll", "No practical difference", "Vmc is now irrelevant"], correct: 1, type: "reverse", explain: "MORE DANGEROUS. With Vmc above stall, you get a yaw warning as you slow toward Vmc — recoverable. With Vmc below stall, the airplane stalls with no warning, and a stalled airplane with one engine windmilling is a Vmc-roll/spin setup. This is the central altitude risk." },
        { q: "Hot day (95°F) + max gross weight + aft CG. Net effect on Vmc vs a cool day at gross with mid CG?", a: ["Vmc significantly higher (all three raise Vmc)", "Vmc lower (heat dominates)", "Vmc roughly the same (effects cancel)", "Cannot determine without exact numbers"], correct: 2, type: "combined", explain: "Hot day = higher DA = LOWER Vmc. Max gross = LOWER Vmc. Aft CG = HIGHER Vmc. The first two pull Vmc down, the third pushes up. Roughly cancel for examiner-level reasoning. The actual answer depends on magnitudes, but the cancellation is the conceptual point." },
        { q: "Light weight + forward CG + standard day SL. Effect on Vmc?", a: ["Lower than published red line", "Higher than published red line in some directions, lower in others", "Closer to published red line — these are roughly the cert conditions", "Vmc becomes negative"], correct: 2, type: "combined", explain: "These conditions are CLOSE to the cert assumptions: most unfavorable weight (lighter) and aft CG. Forward CG would actually be slightly LESS unfavorable for Vmc. So you're in the ballpark of the published red line — maybe slightly below it. Exact answer requires knowing how much forward CG offsets." },
        { q: "Engine fails at 8,000 ft on a hot day. Pilot feathers, banks 2° toward operating engine, ball ½ split. Effect on Vmc compared to wings level?", a: ["Vmc roughly halved", "Vmc dropped significantly (~5-10 mph) below already-altitude-reduced Vmc", "Vmc unchanged at altitude", "Vmc went above stall speed"], correct: 1, type: "combined", explain: "Multiple factors stacking to lower Vmc: high altitude (less power available), feathered prop (less drag/asymmetric force), correct bank (horizontal lift opposing yaw). All push Vmc down. Real Vmc here may be 60 mph or less vs published 80." },
        { q: "Engine fails at low altitude. Pilot pitches up to slow to Vyse, banks toward dead engine by mistake, doesn't feather. Combined effect?", a: ["Vmc drops dramatically", "Vmc rises significantly + performance kills - imminent loss of control", "Performance improves", "No change"], correct: 1, type: "combined", explain: "Three errors compounding: bank toward DEAD engine (raises Vmc), windmilling prop (raises Vmc + drag kills climb), pitching up to slow (approaching Vmc). This is exactly the chain that causes Vmc rolls and fatal accidents on engine failure." },
        { q: "On the takeoff roll, you experience an engine failure 5 mph BELOW Vmc with 5,000 ft of runway remaining. Action?", a: ["Continue, climb out single-engine", "Abort — throttles idle, max braking", "Try to drift left to compensate", "Add power on the operating engine"], correct: 1, type: "combined", explain: "Below Vmc, no amount of remaining runway changes the fact that the airplane CAN'T be controlled airborne with one engine at takeoff power. ABORT, no exceptions. Every multi-engine briefing must commit to this rule before brake release." },
        { q: "On takeoff, engine fails 10 mph ABOVE Vmc with 2,000 ft runway remaining. Action?", a: ["Land straight ahead", "Lift off, climb at Vyse", "Push throttles to red line", "Bank toward dead engine"], correct: 0, type: "combined", explain: "Above Vmc with runway remaining = LAND. Don't try to fly out of a problem when there's runway available. The runway is your friend — the airborne single-engine option is harder, more error-prone, and takes you away from the runway." },
        { q: "Engine fails just after liftoff, gear retracted, no useable runway. You're 5 mph above Vmc. Pitch target?", a: ["Climb at Vy", "Climb at Vyse (blue line) ASAP", "Pitch DOWN slightly to gain margin above Vmc, then climb at Vyse", "Pull nose up sharply to avoid terrain"], correct: 2, type: "combined", explain: "5 mph above Vmc is dangerously thin. You need MORE airspeed margin first. Pitch down slightly to gain energy, get above Vyse, then begin climbing at Vyse. Trying to climb immediately at 5 above Vmc risks dropping below Vmc on the first turbulence bump = roll." },
        { q: "After identifying and feathering the dead engine, you bank toward operating engine. Why does this help BOTH performance AND controllability?", a: ["Performance only", "Controllability only", "Bank reduces sideslip drag (perf ↑) AND adds horizontal lift component (Vmc ↓)", "It only helps controllability"], correct: 2, type: "combined", explain: "Bank is the ONE single input that helps both. Sideslip drops (less drag = better climb). Horizontal lift component opposes asymmetric yaw (lower Vmc, easier to control). 'Raise the dead, ½ ball.'" },
        { q: "If you're at 9,500 ft DA and your weight is at gross, single-engine climb is 0 fpm. What happens to Vmc and stall speed in this configuration?", a: ["Vmc rose, stall dropped", "Vmc dropped (less power), stall speed unchanged at indicated airspeed", "Both rose", "Both dropped"], correct: 1, type: "combined", explain: "Stall speed (indicated) is unchanged with altitude — wing lift behavior is the same in any density. Vmc dropped because reduced power = reduced PAST. The trap: at this combination, real Vmc may be NEAR or BELOW stall speed — stall warning may come BEFORE Vmc warning." },
        { q: "Single-engine, gear up, prop feathered, bank 2° toward op engine. Now extend gear. Net effect?", a: ["Climb performance drops dramatically + Vmc drops slightly (more keel)", "Climb performance improves + Vmc rises", "No change to either", "Climb performance improves significantly"], correct: 0, type: "combined", explain: "Gear extension = MASSIVE drag = climb performance drops. Slight Vmc reduction from extra keel/fin effect. Net: bad trade. Don't extend gear unless you're committed to landing." },
        { q: "Pilot adds full power on operating engine and pitches UP to climb steeply. With one engine out, this combination drives Vmc:", a: ["DOWN — more power = better climb", "UP — full power increases PAST, slowing the airplane brings it closer to actual Vmc", "Unchanged", "Below stall speed"], correct: 1, type: "combined", explain: "Full power = more PAST = higher Vmc. Pitching up bleeds airspeed, getting closer to that elevated Vmc. This is one of the worst combinations — exactly how Vmc rolls happen. Recovery: REDUCE power AND pitch DOWN simultaneously." },
        { q: "On a cool morning at light weight on a long Lubbock runway, an engine fails after liftoff. Compared to a hot afternoon at gross weight on the same runway:", a: ["Both scenarios are equivalently dangerous", "Cool/light morning is much safer — full performance available, Vmc behaves normally above stall, runway available", "Cool/light is more dangerous (Vmc higher)", "Hot/heavy is safer (Vmc lower)"], correct: 1, type: "combined", explain: "Cool morning at light weight = full single-engine climb available + Vmc above stall (controlled warning) + same runway = much better outcome. Even though Vmc is higher in the cool/light case, you have the climb performance to deal with it. Performance dominates Vmc as a safety factor in real engine-out scenarios." },
        { q: "Examiner asks: 'Compare actual Vmc on a 95°F day at 5,000 ft DA at gross weight vs published red line of 80 mph.'", a: ["Actual is higher than 80", "Actual is lower than 80 (less power available, less PAST)", "Actual is exactly 80", "Cannot determine"], correct: 1, type: "combined", explain: "High DA + max gross weight both LOWER Vmc. Actual Vmc at these conditions is meaningfully below the published 80. The danger isn't that you'll exceed Vmc — it's that you may stall before any Vmc warning." },
        { q: "Bank 5° toward dead engine, full power on operating, aft CG, gear up. Effect on Vmc:", a: ["Vmc dropped to safe levels", "Vmc spiked dramatically — every factor pushes Vmc up", "Performance improved", "Cannot determine"], correct: 1, type: "combined", explain: "Every single factor in that combination raises Vmc: bank toward dead (yaw augmenting), full power (max PAST), aft CG (less rudder authority), clean (less keel). This is essentially the recipe for an immediate Vmc roll." },
        { q: "If Vmc went UP without changing power or config, the most likely cause is:", a: ["Burned fuel (lighter weight)", "Climbed to higher altitude", "Aft CG shift", "Both A and C"], correct: 3, type: "apply", explain: "Both lighter weight (less inertia, less horizontal lift) AND aft CG (shorter rudder arm) raise Vmc. Without changing power or configuration, these are the two most likely changes during cruise." },
        { q: "If Vmc went DOWN without changing weight, CG, or configuration, the most likely cause is:", a: ["Climbed to higher altitude", "Lowered the gear", "Switched to heavier fuel", "Engine fire"], correct: 0, type: "apply", explain: "Without changing weight, CG, or config, altitude is the only factor left. Climbing reduces available power, reduces PAST, lowers Vmc." },
        { q: "Pilot wants to LOWER Vmc as much as possible. Which combination achieves this best?", a: ["Light weight, forward CG, gear down, climb to altitude", "Heavy, aft CG, gear up, sea level", "Heavy, forward CG, gear down, high altitude, feathered", "Light, aft CG, gear up, sea level"], correct: 2, type: "apply", explain: "Stacking ALL Vmc-lowering factors: heavy (more inertia + horizontal lift), forward CG (longer rudder arm), gear down (more keel), high altitude (less power), feathered (less drag/asymmetric force). Combined effect: lowest possible Vmc." },
        { q: "If you want Vmc to be HIGHEST (worst case), the combination is:", a: ["Cert standard conditions: light weight, aft CG, gear up, flaps takeoff, max power, windmilling, sea level", "Heavy weight, forward CG, sea level", "Just maximum power on a hot day", "Aft CG and full flaps"], correct: 0, type: "apply", explain: "The certification standard combination IS the worst case by design. The published red line represents these conditions. Any deviation in real-world operation typically lowers actual Vmc — this is why cert is conservative." },
        { q: "Which factor is the ONLY one that helps BOTH performance and Vmc simultaneously?", a: ["Higher altitude", "Heavier weight", "Bank toward operating engine", "Forward CG"], correct: 2, type: "apply", explain: "Bank toward operating engine: reduces sideslip (perf ↑), adds horizontal lift (Vmc ↓). The other factors help one and hurt the other. This is why zero-sideslip technique is core after every engine failure." },
        { q: "Examiner asks how to get the airplane MOST controllable after engine failure. Best procedure?", a: ["Add full power immediately", "Feather, bank ~2° toward operating engine, ball ½ split, maintain Vyse", "Pull nose up to slow flight", "Lower gear and flaps for keel effect"], correct: 1, type: "apply", explain: "Feather (drag/asymmetric force ↓ = Vmc ↓), bank toward op engine (horizontal lift = Vmc ↓), Vyse (best climb). This is the textbook post-failure configuration. Adding gear/flaps for keel would hurt performance more than help Vmc." },
        { q: "If a pilot wants to demonstrate Vmc as defined in §23.149, they would:", a: ["Configure for max Vmc (cert conditions) and approach loss of control at altitude", "Configure for min Vmc to be safe", "Perform at cruise altitude only", "Use feathered prop"], correct: 0, type: "apply", explain: "Vmc demo replicates cert conditions (or close to them) to show the loss-of-control onset. Idle/zero-thrust on dead engine, full power on op engine, gear up, flaps takeoff, slowing toward Vmc with up to 5° bank. ALWAYS at safe altitude (≥3,000 AGL)." },
        { q: "If actual Vmc is found to be lower than published red line in flight, the safe interpretation is:", a: ["The red line is wrong, recalibrate", "Published Vmc is for worst case; real Vmc is lower in normal ops, but the red line is still your reference", "Ignore the red line", "Vmc has no meaning"], correct: 1, type: "apply", explain: "Real Vmc < published is normal — published is conservative. Always reference the red line as your operational minimum. The exception is the 'Vmc below stall' situation at altitude, where the trap is the airplane STALLS before yaw warning." },
        { q: "Real-world post-failure procedure that uses Vmc-factor knowledge:", a: ["Feather (Vmc ↓), bank 2° toward operating (Vmc ↓), maintain Vyse (best climb)", "Add full power, pitch up", "Lower gear, full flaps", "Bank toward dead engine"], correct: 0, type: "apply", explain: "Each step has both controllability and performance rationale. Feathering eliminates 80% of the asymmetric drag and force. Bank uses horizontal lift to oppose yaw. Vyse maximizes climb on remaining engine. All together = safest post-failure configuration." },
        { q: "Operating engine fails, you confirm dead foot dead engine, slowly retard the suspected dead throttle, and the yaw GETS WORSE. What does this tell you?", a: ["Confirmed dead engine — feather it", "You retarded the GOOD engine — push that throttle back forward immediately", "Both engines failed", "Carb ice"], correct: 1, type: "apply", explain: "If retarding a throttle WORSENS yaw, you grabbed the WORKING engine. Push it forward fast. This is the entire point of VERIFY before FEATHER — prevents shutting down the only working engine." },
        { q: "Pilot reports successful single-engine ILS at 8,500 ft DA. After landing, why was that approach manageable?", a: ["Vmc was lower at altitude", "Lower power requirement on operating engine + zero-sideslip technique + delayed gear extension", "ATC provided extra vectors", "Wing didn't stall"], correct: 1, type: "apply", explain: "Zero-sideslip + delaying gear-down (until landing assured) + careful power management = manageable single-engine approach. Vmc being lower at altitude is incidental — what matters is the procedure was followed." },
        { q: "After engine failure, you go through Identify-Verify-Feather. Which factor is most affected by the FEATHER step?", a: ["Weight", "CG", "Drag from windmilling prop", "Atmospheric pressure"], correct: 2, type: "apply", explain: "Feathering eliminates ~80% of windmilling drag. Massive performance improvement (climb returns) AND lower Vmc (less asymmetric force). One physical action, two big benefits — why feathering is highest-leverage post-failure step." },
      ],
    },
    {
      id: "examiner",
      level: 3,
      name: "Tier 3 — Examiner Mode",
      blurb: "Scenario paragraphs, traps, oral-style questions. Locks open after 100% on Tier 2.",
      questions: [
        { q: "Examiner: 'Hot August day at KLBB, 95°F, gross weight, runway 17R 11,500 ft, no wind. Walk me through your go/no-go.'", a: ["Take off — long runway compensates for any DA issue", "DA is ~7,000 ft — at or above single-engine service ceiling at gross. Engine failure on departure means no climb capability. Reduce weight, wait for cooler temps, or scrub. Long runway doesn't help once airborne if you can't climb.", "Take off because Vmc is lower at altitude", "Use shorter runway"], correct: 1, type: "scenario", explain: "Recognition that runway length is NOT the only constraint. Single-engine ceiling is the binding limit on a hot day in Lubbock. Lower Vmc at altitude is irrelevant if you can't climb. ADM > legality." },
        { q: "Examiner: 'You're cruising at 6,500 ft, single-engine after failure. Fuel burn over 30 minutes drops you 200 lbs lighter. What changed for Vmc, performance, and controllability?'", a: ["Nothing — fuel burn doesn't matter", "Vmc rose (lighter), performance improved (lighter), controllability slightly degraded (more rudder needed at same airspeed)", "All metrics improved", "All metrics degraded"], correct: 1, type: "scenario", explain: "Lighter weight — three effects: Vmc up (less inertia + less horizontal lift component), performance up (less weight to climb), controllability slightly worse (Vmc closer to your current speed = more rudder needed). Real-world cross-country single-engine ops awareness." },
        { q: "Examiner: 'You're on single-engine ILS, 600 ft AGL above DA, on glidepath, on speed. Suddenly performance starts degrading. What do you do?'", a: ["Continue and try to salvage", "Go missed approach NOW — single-engine missed at minimums is marginal at best, going missed early gives you more options", "Add full flaps to slow down", "Reduce power on operating engine"], correct: 1, type: "scenario", explain: "Going missed EARLY is the safe call. From 600 ft you can climb out at Vyse, evaluate the issue, divert. From DA you have no margin. ADM principle: take the safer option earlier rather than the marginal one later." },
        { q: "Examiner: 'I'm going to fail the right engine. Walk me through your procedure from the moment of failure.'", a: ["Identify the failed engine first, then feather", "Maintain control: pitch blue line, rudder to stop yaw, ~2° bank toward live engine. Then configure: mixtures/props/throttles forward, gear up if airborne, flaps up. Then identify (dead foot), verify (slow throttle pull), feather, secure. Declare emergency, divert nearest suitable.", "Add full power to compensate, then troubleshoot", "Pull nose up to maintain altitude"], correct: 1, type: "scenario", explain: "The CCIVFS sequence: Control, Configure, Identify, Verify, Feather, Secure. Every multi-engine pilot must run this in their sleep. AVIATE first, always. Skipping aviate is how Vmc rolls happen." },
        { q: "Examiner: 'It's hot, gross weight, takeoff roll. You hear an engine miss at 65 mph (below Vmc). What do you do?'", a: ["Lift off and feather", "Abort — throttles idle, brakes, maintain control with rudder/brakes", "Continue to Vyse and assess", "Add full power on the other engine"], correct: 1, type: "scenario", explain: "Below Vmc with even a power loss = abort. No exceptions, no negotiation. Doesn't matter how much runway is ahead. You cannot fly with one engine at takeoff power below Vmc." },
        { q: "Examiner: 'Compare an engine failure at 500 ft AGL to one at 5,000 ft AGL. What changes?'", a: ["Nothing — same procedure", "At 500 ft: less time to react, terrain proximity, may need to land straight ahead. At 5,000 ft: more altitude to set up, can troubleshoot, can fly to nearest suitable. Procedure same, ADM differs.", "5,000 ft is harder", "Only Vmc changes"], correct: 1, type: "scenario", explain: "Procedure is identical at any altitude. ADM and time-margin differ dramatically. At low altitude, runway becomes a critical asset (if any remains). At altitude, you have time to be methodical." },
        { q: "Examiner: 'You're at 7,000 ft DA, Vmc demo. As you slow toward Vmc, the stall horn comes on BEFORE you feel directional control loss. What does this mean and what do you do?'", a: ["Continue to actual Vmc", "Recover at first indication = stall horn here. Real Vmc dropped below stall speed at this altitude. Reduce power on operating engine, lower nose. Recovery same as Vmc loss-of-control.", "Add power", "Bank harder"], correct: 1, type: "scenario", explain: "Critical Vmc demo lesson: at altitude, stall warning often precedes Vmc indication because Vmc drops with altitude while stall speed is unchanged. Recover at FIRST indication. Going past stall warning to seek 'real' Vmc = stall + windmilling engine = spin." },
        { q: "Examiner: 'After feathering, you're at Vyse climbing 200 fpm. Then performance drops to 100 fpm. What might have changed?'", a: ["The airplane is broken", "Likely either DA increased (climb to higher altitude — power dropping) OR weight burned/dropped slightly OR pilot configuration drift (gear/flap/cowl)", "Engine RPM increased", "Vmc went down"], correct: 1, type: "scenario", explain: "Performance drift in single-engine flight has multiple causes. Most common: climbed into thinner air, picked up icing, or unintentional configuration change. Examiner wants to see you THINK about the cause, not just observe the symptom." },
        { q: "Examiner: 'Engine failure shortly after takeoff. You're at 200 ft AGL, half the runway still ahead. Action?'", a: ["Continue at Vyse, climb out", "Land straight ahead on remaining runway, gear DOWN if not yet retracted, throttles idle, brakes", "Pitch up to clear obstacles", "Feather and divert"], correct: 1, type: "scenario", explain: "Runway remaining is your safety net. Use it. Don't try to fly out of a problem when you have a runway available. Pre-takeoff briefing must include 'land straight ahead with runway remaining' as the rule." },
        { q: "Examiner: 'Why is the engine-failure procedure on takeoff different from in-flight?'", a: ["It isn't — same procedure", "Takeoff has phase-of-flight decision points (below Vmc, above Vmc with runway, airborne with no runway). In-flight has time and altitude. Different decisions because different consequences and time margins.", "FAA requirement", "Insurance reasons"], correct: 1, type: "scenario", explain: "Takeoff's three decision-zones (below Vmc abort / above Vmc runway-remaining land / airborne no-runway flight-out) reflect that decisions are constrained by phase. In-flight, you have altitude and time to be methodical." },
        { q: "Examiner: 'It's the same airplane, same weight, same DA — but a different pilot's checkride. Pilot A demonstrates Vmc demo cleanly. Pilot B stalls during the demo. Why might that be?'", a: ["Pilot B is heavier", "Pilot B may have used incorrect bank, less rudder, or pitched up too steeply, losing airspeed faster than Pilot A and stalling before reaching the recovery indication", "Vmc changed", "Engine failed"], correct: 1, type: "scenario", explain: "Vmc demo execution depends on pilot inputs. Bank angle, rudder application, pitch rate all affect whether you hit stall or Vmc indication first. The factors are the same; the inputs differ. Examiner watches technique." },
        { q: "Examiner: 'You're 30 minutes into a single-engine flight and the airplane feels harder to control. Why?'", a: ["Probably nothing — the mind plays tricks", "Fuel burn = lighter weight = higher Vmc. At the same indicated airspeed, you're now closer to Vmc, requiring more rudder. Realistic single-engine fatigue effect.", "Wind shifted", "ATC instructed differently"], correct: 1, type: "scenario", explain: "Real-world phenomenon. Long single-engine flights subtly raise Vmc as fuel burns. May want to reduce operating engine power slightly (which lowers Vmc) or increase airspeed margin." },
        { q: "TRUE OR FALSE: Hot, humid days are GOOD for engine failure scenarios because Vmc is lower.", a: ["TRUE — lower Vmc means safer", "FALSE — Hot/humid days are MUCH MORE dangerous because climb performance drops far more than Vmc helps. You can't climb after engine failure on a hot day at gross weight in Lubbock.", "Depends on altitude", "Only true above 5,000 ft"], correct: 1, type: "trap", explain: "THE classic Vmc trap. Yes, Vmc drops at altitude. But performance drops FASTER and matters MORE. Single-engine service ceiling at gross may equal field elevation on a hot day. Examiner's favorite trap question." },
        { q: "TRUE OR FALSE: You should always bank away from the dead engine to clear it for restart attempts.", a: ["TRUE", "FALSE — Always bank TOWARD the operating (live) engine. Banking toward dead increases yaw and Vmc.", "Only at altitude", "Depends on phase"], correct: 1, type: "trap", explain: "Trap: 'away from dead' sounds intuitive. Wrong. Bank TOWARD the live engine. Memory aid: 'raise the dead' = raise the dead engine's wing = bank toward live." },
        { q: "TRUE OR FALSE: Adding maximum power on the operating engine after engine failure will help you climb out fastest.", a: ["TRUE — more power = more climb", "PARTIALLY TRUE but with major caveat: max power maximizes asymmetric thrust = Vmc rises = if airspeed drops near Vmc, you risk loss of control. Procedure is to use what climb you need at safe airspeed (Vyse), not necessarily max power.", "Always TRUE", "Always FALSE"], correct: 1, type: "trap", explain: "Subtle trap. Max power gives best climb numerically but raises Vmc significantly. Procedure is to leave operating engine at climb power (not max) at Vyse — gives best balance of performance and controllability margin." },
        { q: "TRUE OR FALSE: A windmilling propeller is fine if you can fly the airplane with one engine.", a: ["TRUE — feathering is a luxury", "FALSE — Windmilling produces enormous drag, far more than gear extended. It dramatically reduces single-engine climb and significantly raises Vmc. Feathering is essential, not optional.", "Only true above 10,000 ft", "Only true with gear up"], correct: 1, type: "trap", explain: "Windmilling drag is enormous — often more than gear-down drag. The airplane may be controllable but climb capability vanishes. Feathering is the highest-leverage post-failure step." },
        { q: "TRUE OR FALSE: Vmc is always 80 mph for a PA-30 — that's why the red line is at 80.", a: ["TRUE — it's a fixed number", "FALSE — Published Vmc is for worst-case cert conditions. Real Vmc varies with altitude, weight, CG, configuration, and prop state. The red line is a conservative reference.", "Only TRUE at sea level", "Only TRUE at gross weight"], correct: 1, type: "trap", explain: "Critical understanding. Vmc varies in real-world conditions. The published red line is the FAA's worst-case calibration. Real Vmc may be 60 mph at altitude at gross with feathered prop. Don't fly to the red line as if it's exact at all conditions." },
        { q: "TRUE OR FALSE: Feathering the dead engine eliminates the dead engine's effect on the airplane.", a: ["TRUE — feathered = no effect", "PARTIALLY TRUE — feathering eliminates ~80% of the dead engine's drag and reduces asymmetric force, but the airplane is still single-engine. Performance still degraded vs both engines, just much better than windmilling.", "Always TRUE", "Always FALSE"], correct: 1, type: "trap", explain: "Feathering hugely improves the situation but doesn't restore the dead engine's contribution. You're still flying single-engine — climb is still degraded, Vmc still applies, just at much better numbers." },
        { q: "TRUE OR FALSE: When Vmc drops below stall speed, the airplane is safer because you'll stall before losing directional control.", a: ["TRUE — stall is recoverable", "FALSE — When stall comes before any yaw warning, you stall WITHOUT recognizing you're approaching loss of directional control. A stalled airplane with one engine windmilling and the other at high power = Vmc roll/spin. NO Vmc warning.", "Depends on prop", "Only TRUE at altitude"], correct: 1, type: "trap", explain: "Probably the most dangerous Vmc misconception. With Vmc above stall, you get a yaw warning approaching loss of control = recoverable. With Vmc below stall, the airplane stalls = wing drops = engine asymmetry = roll. The OPPOSITE of safer." },
        { q: "TRUE OR FALSE: After engine failure, you should immediately add full power on the operating engine and pitch up to climb.", a: ["TRUE — climb is the priority", "FALSE — Maintain control FIRST (pitch blue line, rudder to stop yaw, ~2° bank toward live engine). THEN configure, then identify-verify-feather. Climb comes after. Full power + pitch up = recipe for Vmc roll.", "TRUE if airborne", "Only FALSE at altitude"], correct: 1, type: "trap", explain: "Prioritization trap. Aviate (control) ALWAYS comes before climb. Adding full power and pitching up before establishing zero-sideslip and feathering is the worst combination — full PAST + low airspeed = Vmc loss." },
        { q: "TRUE OR FALSE: Heavier airplane is always more dangerous for single-engine operations.", a: ["TRUE — more weight = harder", "PARTIALLY TRUE — Heavier reduces single-engine climb (worse). But heavier ALSO lowers Vmc (more inertia, more horizontal lift when banked). So perf is worse but controllability is slightly better. Trade-off, not pure penalty.", "Always TRUE", "Always FALSE"], correct: 1, type: "trap", explain: "Performance and controllability decoupling. Lighter = better climb but higher Vmc. Heavier = worse climb but lower Vmc. Examiner wants you to recognize the trade, not pretend weight is monolithic." },
        { q: "TRUE OR FALSE: The published Vmc red line is the same number whether you're at sea level or 10,000 ft.", a: ["TRUE — it's painted on the dial", "TRUE in display, but FALSE in actual physics. The painted red line stays at the same indicated airspeed, but actual Vmc decreases with altitude. The red line doesn't move when you climb.", "Always FALSE", "Only TRUE in PA-30s"], correct: 1, type: "trap", explain: "The dial is fixed. Reality is variable. The published red line is calibrated for cert conditions and doesn't move with altitude. Pilots must understand actual Vmc differs from indicated. This is what makes high-DA Vmc traps so dangerous." },
        { q: "TRUE OR FALSE: Flaps and gear extended are always preferred for engine-out approach because they lower Vmc.", a: ["TRUE", "FALSE — Gear down lowers Vmc but adds significant drag, killing climb performance. Standard procedure is to delay gear extension until landing assured, accepting slightly higher Vmc for the performance margin.", "Only TRUE on approach", "Always TRUE"], correct: 1, type: "trap", explain: "Trade-off again. Gear-down lowers Vmc but the drag penalty is severe. In single-engine approach, you want climb performance available for go-around if needed. Delay gear until late." },
        { q: "TRUE OR FALSE: Once both engines are running smoothly, Vmc considerations don't apply.", a: ["TRUE — Vmc is only for engine failure", "TRUE in normal ops, but the airplane is always susceptible to engine failure. Pre-takeoff briefing must commit to abort logic BEFORE every takeoff. Brief Vmc considerations even when both engines run.", "FALSE — Vmc always applies", "Only at altitude"], correct: 1, type: "trap", explain: "Vmc considerations apply CONTINGENTLY in normal ops — they activate the moment an engine fails. The pilot's mental model must include 'what if?' all the time. Pre-takeoff briefing is when you commit to the answer." },
      ],
    },
  ],
};

// ---------- SPEEDS (PA-30 — kts + mph, from CheckMate) ----------
const SPEEDS = {
  intro: "All N1100L (PA-30 Twin Comanche) speeds in knots AND mph. Counter-rotating PA-39 variant noted where different.",
  vSpeeds: [
    { code: "Vr",    label: "Rotation Speed",                  kts: 78,  mph: 90,  note: "Counter-rotating: 70/80" },
    { code: "Vx",    label: "Best Angle Climb",                kts: 78,  mph: 90 },
    { code: "Vxse",  label: "Best Angle Climb 1-Engine",       kts: 82,  mph: 94 },
    { code: "Vy",    label: "Best Rate Climb",                 kts: 97,  mph: 112 },
    { code: "Vyse",  label: "Best Rate 1-Engine (Blue Line)",  kts: 91,  mph: 105, accent: "blue" },
    { code: "Vmca",  label: "Min Ctrl 1-Engine (Red Line)",    kts: 78,  mph: 90,  accent: "red", note: "Counter-rotating: 70/80" },
    { code: "Vsse",  label: "Safe Single-Engine Speed",        kts: 84,  mph: 97 },
    { code: "Vs0",   label: "Stall With Flaps",                kts: 60,  mph: 69 },
    { code: "Vs",    label: "Stall w/o Flaps",                 kts: 66,  mph: 76 },
    { code: "Va",    label: "Max Abrupt (3000 lbs)",           kts: 129, mph: 148 },
    { code: "Va",    label: "Max Abrupt (Full Gross)",         kts: 141, mph: 162 },
    { code: "Vno",   label: "Max Structural Cruise",           kts: 169, mph: 194 },
    { code: "Vne",   label: "Never Exceed",                    kts: 200, mph: 230 },
    { code: "Vfe",   label: "Full Flaps",                      kts: 109, mph: 125 },
    { code: "Vlo",   label: "Max Gear Operate",                kts: 130, mph: 150 },
    { code: "Vle",   label: "Max Gear Extended",               kts: 130, mph: 150 },
    { code: "X-Wind", label: "Max Demo'd Crosswind",           kts: 17,  mph: 20 },
  ],
  departure: [
    { phase: "Rotation *",        kts: 78, mph: 90,  flaps: "0°" },
    { phase: "Best Angle Climb",  kts: 78, mph: 90,  flaps: "0°" },
    { phase: "Best Rate Climb",   kts: 97, mph: 112, flaps: "0°" },
  ],
  departureNotes: [
    "Counter-Rotating Props Vmca – 70 KIAS (80 MPH)",
    "Short Field: 15° Lift-Off 61 KIAS (70 MPH), * 73 KIAS (84 MPH) Over 50' Obstacle",
  ],
  cruise: [
    { mode: "Economy", kts: 142, mph: 163, flaps: "0°", note: "19.1\" Hg – 2300 RPM – 13.4 GPH – 55%" },
    { mode: "Normal",  kts: 156, mph: 179, flaps: "0°", note: "20.8\" Hg – 2400 RPM – 15.2 GPH – 65%" },
    { mode: "Maximum", kts: 167, mph: 192, flaps: "0°", note: "Full Throttle – 2400 RPM – 17.2 GPH – 75%" },
  ],
  cruiseNotes: [
    "True airspeeds at 7,000 ft.",
    "Specs are approximate — environment & plane variables apply (lbs, KIAS, sea level, standard day, normal category, max gross weight, no wind, best power, new engines).",
  ],
  arrival: [
    { phase: "Approach",       kts: 100, mph: 115, flaps: "15°", note: "17\" MP (Initially)" },
    { phase: "Short Final *",  kts: 83,  mph: 95,  flaps: "27°", note: "Props – 2400 RPM Min." },
  ],
};

// ---------- CHECKLIST (from CheckMate, 14 phases) ----------
const CHECKLIST = {
  intro: "PA-30 Twin Comanche checklists from CheckMate. Tap items to check them off — your progress persists across sessions until you hit Clear.",
  phases: [
    {
      id: "initial", label: "INITIAL", next: "exterior",
      items: [
        { text: "Weather & Den. Alt." },
        { text: "Weight & Balance" },
        { text: "Performance Req." },
        { text: "Flight Plan – File" },
        { text: "Papers – A.R.O.W.", tooltip: "Airworthiness Certificate, Registration, Operating Limitations (POH), Weight & Balance" },
        { text: "Mags – Off" },
        { text: "Mixtures – Full Lean" },
        { text: "Gear Lever – Down" },
        { text: "Master – On" },
        { text: "Gear Lights – Green" },
        { text: "Flaps – Extend" },
        { text: "Pitot Heat – Test" },
        { text: "Stall Vanes – Test" },
        { text: "Lights – Int. / Ext." },
        { text: "Fuel Gauges – True" },
        { text: "Master – Off" },
      ],
    },
    {
      id: "exterior", label: "EXTERIOR SUMMARY", next: "interior",
      blurb: "After thorough geographical check",
      items: [
        { text: "Fuel Quantity" },
        { text: "Fuel Quality" },
        { text: "Caps / Drains / Vents" },
        { text: "Engines / Oil / Belt" },
        { text: "Props / Air Intakes" },
        { text: "Exhaust Systems" },
        { text: "Cowl Flaps" },
        { text: "Surfaces & Controls" },
        { text: "Pitot & Static Ports" },
        { text: "Gear / Tires / Brakes" },
        { text: "Antennas" },
        { text: "Baggage Doors" },
        { text: "Ties / Chocks / Towbar" },
        { text: "Final Walk Around" },
      ],
    },
    {
      id: "interior", label: "INTERIOR", next: "start",
      items: [
        { text: "Flaps – Up" },
        { text: "Passenger Load / Brief" },
        { text: "Hobbs / Tach Time" },
        { text: "Circuit Breakers" },
        { text: "Oxygen" },
        { text: "ELT – Armed" },
      ],
    },
    {
      id: "start", label: "START", next: "pre-taxi",
      items: [
        { text: "Seat Track / Back-Lock" },
        { text: "Avionics – Off" },
        { text: "Autopilot – Off" },
        { text: "Prop Sync – Off" },
        { text: "Cowl Flaps – Open" },
        { text: "Brakes" },
        { text: "— #1 ENGINE START —" },
        { text: "Fuel – Mains" },
        { text: "Mixture – Rich" },
        { text: "Prop – High RPM" },
        { text: "Throttle – Slight" },
        { text: "Prop – Clear" },
        { text: "Master – On" },
        { text: "Beacon – On" },
        { text: "Fuel Pump (Off After Fuel Indication)" },
        { text: "Mixture – Lean" },
        { text: "Mags – On" },
        { text: "Starter – Engage" },
        { text: "Mixture – Rich" },
        { text: "Oil / Fuel Pressure" },
        { text: "Generator – On" },
        { text: "— #2 ENGINE START (Repeat) —" },
        { text: "Lights – As Req." },
        { text: "Mixture – As Req." },
      ],
    },
    {
      id: "pre-taxi", label: "PRE-TAXI / TAXI", next: "run-up",
      items: [
        { text: "Seat Belts / Harness" },
        { text: "Heat / Vent / Defrost" },
        { text: "Avionics" },
        { text: "ATIS / AWOS" },
        { text: "Altimeter" },
        { text: "XPDR – Alt + Sqwk", tooltip: "Transponder set to Altitude reporting mode + assigned squawk code" },
        { text: "ADS-B – On" },
        { text: "Radio – Test" },
        { text: "Taxi Light – As Req" },
        { text: "Brakes – Test" },
        { text: "Fuel Crossfeed – Test" },
        { text: "Attitude Indic. – Test" },
        { text: "Turn Coord. – Test" },
        { text: "HSI To Compass – Test", tooltip: "Horizontal Situation Indicator aligned with magnetic compass" },
      ],
    },
    {
      id: "run-up", label: "RUN-UP", next: "pre-takeoff",
      items: [
        { text: "Brakes" },
        { text: "Elec. Trim / Autopilot" },
        { text: "Trim – Takeoff" },
        { text: "Flight Controls" },
        { text: "Instruments" },
        { text: "Mixture – Best Power" },
        { text: "1500 RPM" },
        { text: "Feather – Test" },
        { text: "2200 RPM" },
        { text: "Props – Cycle" },
        { text: "Mags (L & R) – Test" },
        { text: "Vacuum" },
        { text: "Amps / Volts" },
        { text: "Generators" },
        { text: "Oil Pressure" },
        { text: "Oil Temperature" },
        { text: "Idle – Check Closed" },
        { text: "Friction Lock" },
      ],
    },
    {
      id: "pre-takeoff", label: "PRE-TAKEOFF", next: "takeoff",
      items: [
        { text: "Flaps – 0° to 15°" },
        { text: "Props – High RPM" },
        { text: "Mixture – Best Power" },
        { text: "Fuel Pumps – On" },
        { text: "Heading Bug" },
        { text: "XPDR – Alt + Sqwk" },
        { text: "Doors / Windows" },
        { text: "Pitot Heat – As Req." },
        { text: "Landing Light – On" },
        { text: "Strobes – On" },
        { text: "Time – Note" },
        { text: "Brakes – Release" },
        { text: "ABORT PLAN – READY", tooltip: "Brief abort decision criteria before brake release: below Vmc abort, above Vmc with runway remaining land, airborne with no runway flight-out at Vyse" },
      ],
    },
    {
      id: "takeoff", label: "TAKEOFF", next: "climb",
      items: [
        { text: "Full Throttle" },
        { text: "2700 RPM (Max)" },
        { text: "Manifold Pressure" },
        { text: "Oil Pressure" },
        { text: "Rotate * 78 (90)", tooltip: "Vr = 78 KIAS / 90 MPH at gross. Counter-rotating prop variant: 70/80." },
        { text: "Vy – 97 (112)", tooltip: "Best rate of climb both engines, 97 KIAS / 112 MPH" },
        { text: "Gear – Up" },
        { text: "Flaps – Up" },
      ],
    },
    {
      id: "climb", label: "CLIMB", next: "cruise",
      items: [
        { text: "113 (130)", tooltip: "Cruise climb speed: 113 KIAS / 130 MPH" },
        { text: "Throttles – 24\" MP" },
        { text: "Props – 2400 RPM" },
        { text: "Mixture – As Req." },
        { text: "Fuel Pumps – As Req." },
        { text: "Cowl Flaps – As Req." },
        { text: "Instruments" },
        { text: "Taxi / Land Light – Off" },
        { text: "Flight Plan – Open" },
      ],
    },
    {
      id: "cruise", label: "CRUISE", next: "descent",
      items: [
        { text: "Throttles" },
        { text: "Props" },
        { text: "Mixture" },
        { text: "Fuel Pumps – As Req." },
        { text: "Cowl Flaps – As Req." },
        { text: "Instruments" },
        { text: "Oxygen" },
        { text: "Fuel – Proper Tanks" },
      ],
    },
    {
      id: "descent", label: "DESCENT", next: "pre-landing",
      items: [
        { text: "Power – As Req." },
        { text: "Mixture – Richen" },
        { text: "Fuel – Mains" },
        { text: "Cowl Flaps – Close" },
        { text: "ATIS / AWOS" },
        { text: "Altimeter" },
        { text: "Defroster" },
        { text: "Instruments" },
      ],
    },
    {
      id: "pre-landing", label: "PRE-LANDING", next: "landing",
      items: [
        { text: "Brakes / Pedal Test" },
        { text: "Landing Light – On" },
        { text: "Autopilot – Off" },
        { text: "Seat Belts / Harness" },
        { text: "Mixture – Best Power" },
        { text: "Fuel Pumps – On" },
        { text: "Fuel – Mains" },
        { text: "Gear – Down (Green)" },
        { text: "Brake Pedal – Test" },
        { text: "Flaps – As Req." },
      ],
    },
    {
      id: "landing", label: "LANDING", next: "after-landing",
      items: [
        { text: "Gear – Down (Green)" },
        { text: "Flaps – 27° Or As Req." },
        { text: "Prop – >2400 RPM" },
        { text: "Speed * 83 (95)", tooltip: "Short final: 83 KIAS / 95 MPH" },
        { text: "G.U.M.P.F.S.", tooltip: "Gas, Undercarriage, Mixture, Props, Flaps, Switches/Seatbelts" },
        { text: "— GO-AROUND —" },
        { text: "Power – Full" },
        { text: "Positive Rate Climb" },
        { text: "Flaps – Up" },
        { text: "Gear – Up" },
        { text: "Cowl Flaps – Open" },
      ],
    },
    {
      id: "after-landing", label: "AFTER LANDING", next: "securing",
      items: [
        { text: "Flaps – Up" },
        { text: "Fuel Pumps – Off" },
        { text: "Cowl Flaps – Open" },
        { text: "Strobes – Off" },
        { text: "Landing Light – Off" },
        { text: "Taxi Light – As Req." },
        { text: "Props – High RPM" },
        { text: "Pitot Heat – Off" },
        { text: "Heater – Fan" },
        { text: "Mixture – As Req." },
        { text: "Trim – Takeoff" },
        { text: "XPDR – Alt + Sqwk" },
      ],
    },
    {
      id: "securing", label: "SECURING", next: null,
      items: [
        { text: "ELT – Verify Silent" },
        { text: "Avionics – Off" },
        { text: "Mixture – Full Lean" },
        { text: "Mags – Off" },
        { text: "Master – Off" },
        { text: "Lights – Off" },
        { text: "Cowl Flaps – Closed" },
        { text: "Hobbs / Tach Time" },
        { text: "Secure Yoke" },
        { text: "Chocks" },
        { text: "Tie Downs" },
        { text: "Pitot Cover" },
        { text: "Baggage Doors" },
        { text: "Cabin Doors" },
      ],
    },
  ],
};

// ---------- EMERGENCY (10 procedures from CheckMate) ----------
const EMERGENCY = {
  intro: "PA-30 emergency procedures from CheckMate. Read in order, top to bottom. These are not checklists — execute the steps as fast as the situation requires.",
  procedures: [
    {
      id: "power-loss-takeoff",
      label: "Power Loss During Takeoff",
      subtitle: "(If Unable to Abort Takeoff)",
      severity: "critical",
      steps: [
        "THROTTLES – CLOSE BOTH IMMEDIATELY",
        "BRAKES – AS REQUIRED / STOP STRAIGHT AHEAD (Unlatch Doors)",
        "* IF INSUFFICIENT RUNWAY REMAINS FOR STOPPING:",
        "* FUEL SELECTORS – OFF",
        "* MASTER / MAGS – OFF",
      ],
    },
    {
      id: "one-engine-after-takeoff",
      label: "One Engine Immediately After Takeoff",
      subtitle: ">78 KIAS (90 MPH) · Also One Engine Go-Around — Avoid If Possible",
      severity: "critical",
      steps: [
        "MAINTAIN SAFE AIRSPEED  (Quality Landing Area Ahead?)",
        "GEAR / FLAPS – UP",
        "DIRECTIONAL CONTROL – MAINTAIN",
        "IDENTIFY",
        "VERIFY – CLOSE THROTTLE  (Inop. Engine)",
        "PROP – FEATHER  (Inop. Engine, Above 1000 RPM)",
        "ACCELERATE TO 91 KIAS (105 MPH)  (3°-5° Bank & ½ Ball to Good Engine)",
      ],
    },
    {
      id: "one-engine-in-flight",
      label: "One Engine In Flight",
      severity: "high",
      steps: [
        "CONTROL AIRPLANE – MAINTAIN SAFE AIRSPEED >84 KIAS (97 MPH)",
        "INOPERATIVE ENGINE – IDENTIFY",
        "OPERATIVE ENGINE – ADJUST",
        "THROTTLE – AS NEEDED TO MAINTAIN CONTROL",
        "— TROUBLESHOOT —",
        "Fuel On / Crossfeed, Fuel Pump-On, Mixture, Prop, Throttle, Master / Gen., Mags",
        "— IF NO RESTART – SECURE DEAD ENGINE —",
        "Retard Throttle, Feather Prop, Mixture-Idle Cutoff, Fuel Pump Off, Fuel Off, Mag/Gen Off, Close Cowl Flap",
        "COWL FLAP (Operative Engine) – AS REQUIRED",
        "FUEL PUMP (Operative Engine) – AS REQUIRED  (Consider Xfeed)",
      ],
    },
    {
      id: "one-engine-landing",
      label: "One Engine Landing",
      severity: "high",
      steps: [
        "SECURE INOP. ENGINE – MAINTAIN SAFE AIRSPEED",
        "FLAPS – AS NEEDED",
        "LOWER GEAR – WHEN FIELD ASSURED",
        "FINAL APPROACH – 91 KIAS (105 MPH)",
        "FULL FLAPS – WHEN COMMITTED TO LAND",
      ],
    },
    {
      id: "both-engines-out",
      label: "Both Engines Out / Landing",
      severity: "critical",
      steps: [
        "MAINTAIN BEST GLIDE – 96 KIAS (110 MPH)  (Full Gross)",
        "PROPS – FEATHER",
        "MIXTURE – FULL LEAN / IDLE CUTOFF",
        "FUEL SELECTORS – OFF",
        "SQUAWK 7700",
        "DECLARE EMERGENCY  (TWR, APP, Unicom, 121.5)",
        "SEATBELTS / HARNESS",
        "FLAPS – AS NEEDED  (Full Flaps When Field Assured)",
        "GEAR – DOWN  (Up If Very Rough or Soft Terrain)",
        "MASTER / MAGS – OFF",
        "UNLATCH DOORS / PROTECT BODY",
      ],
    },
    {
      id: "electrical-fire",
      label: "Electrical Fire In Flight",
      severity: "critical",
      steps: [
        "ALL ELECTRICAL DEVICES + MASTER / GEN – OFF  (Pull CB's, Mags On)",
        "CABIN HEAT & AIR – OFF  (Vents – Closed)",
        "IF FIRE OUT TRY MASTER ON ONLY  (Vents – Open)",
        "THEN ONE ESSENTIAL ELECTRICAL DEVICE AT A TIME",
        "RESET CIRCUIT BREAKER(S) ONLY IF CRITICAL – LAND ASAP",
      ],
    },
    {
      id: "engine-fire-flight",
      label: "Engine Fire In Flight",
      severity: "critical",
      steps: [
        "FUEL SELECTOR – OFF TO AFFECTED ENGINE",
        "CLOSE THROTTLE / FEATHER PROP",
        "MIXTURE – FULL LEAN / IDLE CUTOFF",
        "COWL FLAP – OPEN",
        "HEATER / DEFROSTER – OFF",
        "INCREASE AIRSPEED TO EXTINGUISH – LAND ASAP",
      ],
    },
    {
      id: "engine-fire-start",
      label: "Engine Fire During Start",
      severity: "high",
      steps: [
        "MIXTURE – FULL LEAN / IDLE CUTOFF",
        "CONTINUE CRANKING ENGINE / THROTTLE – FULL OPEN",
        "FUEL SELECTOR / FUEL PUMPS – OFF",
        "MASTER – OFF",
        "SHUTDOWN OTHER ENGINE",
        "EVACUATE / FIRE EXTINGUISHER",
      ],
    },
    {
      id: "icing",
      label: "Icing",
      severity: "high",
      steps: [
        "PITOT HEAT – ON",
        "MANUAL ALTERNATE AIR – AS NEEDED",
        "CABIN HEAT & DEFROST – MAXIMUM",
        "STRONGLY CONSIDER 180° TURN",
        "ATTAIN HIGHER OR LOWER ALTITUDE",
        "INCREASE ENGINE & PROP SPEED",
        "FULL FLAPS NOT RECOMMENDED FOR LANDING",
        "LAND FASTER AS NEEDED",
      ],
    },
    {
      id: "manual-gear-extension",
      label: "Manual Gear Extension",
      severity: "moderate",
      steps: [
        "AIRSPEED – 87 KIAS (100 MPH) OR LESS",
        "LOWER GEAR LEVER OR IF 3 POSITION SWITCH – CENTER OFF",
        "DISENGAGE MOTOR – RAISE RELEASE ARM & PUSH FORWARD",
        "PLACE HANDLE IN LEFT SOCKET – LOCK & EXTEND HANDLE",
        "(If Left Socket Not Clear Use Right Socket, Twist Clockwise To Lock, Then Left Socket)",
        "ROTATE FORWARD FULL TRAVEL – VERIFY GREEN LIGHT",
      ],
    },
  ],
};

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

// ---------- MANEUVERS (Per-task ACS deep dive) ----------
const MANEUVERS = {
  tasks: [
    {
      id: "preflight",
      name: "Preflight Inspection",
      acs: {
        standards: [
          "Use checklist; identify discrepancies",
          "Verify aircraft is airworthy (AROW + maintenance currency)",
          "Recognize go/no-go items per POH and 91.213",
        ],
        tolerances: "Examiner observes thoroughness; no specific tolerance — discrepancies must be caught",
      },
      flow: [
        "Cabin: documents (AROW), POH/AFM, weight & balance, placards verified",
        "Logbook: annual, 100-hour if applicable, ADs, transponder/static (24mo), ELT (12mo + battery)",
        "Walkaround starting at left wing root, working clockwise",
        "Each engine: oil quantity, cowl security, prop free of nicks, induction inlet clear",
        "Each gear: tire condition, brake lines, struts, gear pin removed",
        "Fuel: sumps drained from all tanks (mains + aux), cap secure, vents clear, color/smell checked",
        "Pitot/static: covers off, ports clear, AOA vane (if equipped)",
        "Stall warning vane: lift it, hear horn (master ON)",
      ],
      commonErrors: [
        "Skipping the documents check — this is what the examiner watches first",
        "Not draining aux tank sumps (PA-30 has 4 sumps total)",
        "Forgetting to verify stall warning works",
        "Missing AD compliance verification in logbook",
      ],
      examinerGotchas: [
        "'Show me the airworthiness certificate' — must be displayed visibly in the cabin",
        "'Is this aircraft legal to fly today?' — must check annual + 100-hour + transponder + static + ELT all in one breath",
        "'What's the most recent AD compliance?' — should know how to find AD records in the logbook",
      ],
      quiz: [
        { q: "AROW means:", a: ["Airworthiness, Registration, Owner, Weight", "Airworthiness, Registration, Operating limitations, Weight & balance", "Annual, Required, Owner, Weight", "Aircraft, Records, Operating, Weather"], correct: 1, explain: "The four documents required onboard: Airworthiness cert, Registration, Operating limitations (POH/AFM/placards), Weight & balance data. Examiner WILL verify all four are aboard the aircraft." },
        { q: "Transponder inspection currency for IFR?", a: ["12 months", "24 calendar months", "100 hours", "Annual"], correct: 1, explain: "91.413: 24 calendar months. Same window for static/altimeter system per 91.411 (IFR only). VOR check 30 days for IFR. ELT inspection 12 months." },
        { q: "PA-30 has how many fuel sump drain points to check on preflight?", a: ["2 (one per main)", "4 (mains + aux per side)", "6", "8"], correct: 1, explain: "Two mains, two aux = 4 sumps minimum. Some PA-30s have additional drains at the gascolator. Verify all per N1100L's specific configuration." },
      ],
    },
    {
      id: "engine-start-twin",
      name: "Engine Start (Twin)",
      acs: {
        standards: ["Use checklist", "Start without damage", "Verify engine instruments green before taxi"],
        tolerances: "Engine instruments in green within 30 seconds of start; oil pressure rising",
      },
      flow: [
        "Brakes set, parking brake on, prop area clear (CLEAR PROP shouted)",
        "Master ON, mags OFF, throttle cracked ¼ inch, mixture rich, prop full forward",
        "Fuel pump ON for 3-5 seconds for prime, then OFF",
        "Mags to BOTH or START (per POH)",
        "Engage starter, release when engine catches",
        "Verify oil pressure rises into green within 30 seconds — IF NOT, shut down immediately",
        "Set 1000-1200 RPM for warm-up",
        "Repeat for second engine",
        "Once both running: alternators ON, verify amps positive, avionics master ON",
      ],
      commonErrors: [
        "Starting with master OFF (won't crank) or mags ON before starter (kickback risk)",
        "Leaving electric fuel pump on after start (masks engine-driven pump failure)",
        "Excessive cranking (>10 seconds — starter overheats)",
        "Adding power before oil temp comes off the peg in cold weather",
      ],
      examinerGotchas: [
        "'What if oil pressure doesn't come up in 30 seconds?' — IMMEDIATE shutdown to prevent engine damage",
        "'Why turn the electric pump off after start?' — to verify the engine-driven pump produces pressure on its own",
      ],
      quiz: [
        { q: "After start, if oil pressure does NOT rise into green within 30 seconds:", a: ["Wait another minute", "Shut down immediately", "Increase RPM to 2000", "Continue with start of second engine"], correct: 1, explain: "Oil pressure not rising = oil pump failure or oil leak. Continued running causes engine damage in seconds. Shut down immediately and investigate before any further attempt." },
        { q: "Why turn off the electric fuel pump after start?", a: ["Saves battery", "To verify the engine-driven pump produces normal pressure", "FAA requirement", "Reduces noise"], correct: 1, explain: "Electric pump assists during start. Once running, the engine-driven pump should produce normal pressure on its own. Verifying this on the ground means you don't discover an engine-driven pump failure at altitude." },
      ],
    },
    {
      id: "normal-takeoff-amel",
      name: "Normal Takeoff & Climb",
      acs: {
        standards: [
          "Configure per POH (flaps, trim)",
          "Vr per POH",
          "Climb at Vy",
          "Maintain runway centerline",
          "Positive rate confirmed before gear retraction",
        ],
        tolerances: "Vr ±5 kt, Vy ±5 kt, centerline maintained, no excessive drift",
      },
      flow: [
        "Pre-takeoff briefing (out loud, every time): runway, conditions, abort plan, departure plan",
        "Line up, heading bug to runway heading, transponder ALT, lights ON",
        "Throttles smoothly forward to FULL, BOTH ENGINES TOGETHER",
        "Verify all engine instruments green BEFORE releasing brakes",
        "Release brakes, accelerate",
        "Rotate at Vr (PA-30 typical ~80 mph)",
        "Climb at Vy (PA-30 typical ~112 mph) until 500 ft AGL or as briefed",
        "Positive rate + NO usable runway → GEAR UP",
        "At safe altitude (typically 500-1000 ft AGL): reduce to climb power, retract flaps if used",
      ],
      commonErrors: [
        "Brakes released before verifying both engines made full power (asymmetric power start = swerve)",
        "Gear up too early (still over usable runway)",
        "Climbing at Vyse instead of Vy (Vyse is single-engine target only)",
        "Forgetting the takeoff briefing — examiner notices immediately",
      ],
      examinerGotchas: [
        "'Why do you advance throttles together and verify before brake release?' — to detect asymmetric power BEFORE you're committed to the takeoff roll",
        "'When do you retract gear?' — positive rate AND no usable runway remaining (both conditions must be true)",
      ],
      quiz: [
        { q: "Initial climb after a normal takeoff (both engines) is at:", a: ["Vmc", "Vyse (blue line)", "Vy", "Vfe"], correct: 2, explain: "Vy with both engines. Vyse is the single-engine climb target — irrelevant when both engines are running normally." },
        { q: "Throttles up: smoothly together or one at a time?", a: ["One at a time, left then right", "Together, smoothly to full", "Right first since it's the critical engine compensation", "Whichever feels right"], correct: 1, explain: "Together. Asymmetric advance = asymmetric thrust = swerve at low speed. Smooth advance lets you detect any engine issue (gauge mismatch) before committing." },
      ],
    },
    {
      id: "short-field-takeoff",
      name: "Short-Field Takeoff & Climb",
      acs: {
        standards: ["Configure per POH (flaps in takeoff position)", "Use max available runway", "Vx until obstacle cleared, then Vy"],
        tolerances: "Vx +5/-0 kt until clear of 50 ft obstacle",
      },
      flow: [
        "Taxi to very end of usable runway",
        "Hold brakes, throttles to FULL, verify gauges",
        "Release brakes",
        "Rotate at POH short-field Vr (slightly lower than normal)",
        "Climb at Vx (~90 mph PA-30) until clear of 50 ft obstacle",
        "Transition to Vy, retract gear when positive rate + past obstacle",
      ],
      commonErrors: [
        "Climbing at Vy instead of Vx (won't clear obstacle)",
        "Holding Vx longer than necessary (Vx is closer to Vmc — engine failure has less margin)",
        "Forgetting to set flaps to takeoff position per POH",
      ],
      examinerGotchas: [
        "'Why is Vx more critical than Vy in a twin?' — Vx is closer to Vmc, so engine failure at Vx has less speed margin before loss of control",
        "'When do you transition from Vx to Vy?' — once clear of the 50 ft obstacle",
      ],
      quiz: [
        { q: "Climb speed during short-field takeoff (until obstacle cleared)?", a: ["Vy", "Vx", "Vyse", "Va"], correct: 1, explain: "Vx = best ANGLE = most altitude per horizontal distance = obstacle clearance. Once past the obstacle, transition to Vy for best rate." },
        { q: "Why is Vx more critical than Vy in a twin?", a: ["Higher fuel burn", "Vx is closer to Vmc — engine failure at Vx has less speed margin", "Lower oil pressure", "More noise"], correct: 1, explain: "Vx is slower than Vy. Slower = closer to Vmc. Engine failure at Vx leaves less speed cushion before loss of directional control." },
      ],
    },
    {
      id: "steep-turns",
      name: "Steep Turns",
      acs: {
        standards: ["Maneuvering speed (Va) per POH", "50° bank both directions", "Coordinated turn"],
        tolerances: "50° bank ±5°, altitude ±100 ft, airspeed ±10 kt, rollout ±10° of entry heading",
      },
      flow: [
        "Clearing turns",
        "Set maneuvering speed (Va — PA-30 typical ~130 mph)",
        "Pick visual reference for entry heading",
        "Smooth roll into 50° bank, add power as bank increases (drag rises)",
        "Increase back-pressure to maintain altitude",
        "Roll out by leading ~25° (half the bank)",
        "Roll directly into opposite-direction steep turn",
      ],
      commonErrors: [
        "Losing altitude (not enough back-pressure)",
        "Gaining altitude (too much back-pressure or letting bank shallow)",
        "Forgetting to add power",
        "Rolling out late (overshooting entry heading)",
      ],
      examinerGotchas: [
        "'Why do you add power in a steep turn?' — induced drag rises with load factor, requires more thrust to maintain airspeed",
        "'What's the load factor at 50° bank?' — 1.56 G's (1/cos(50°))",
      ],
      quiz: [
        { q: "Private AMEL steep turn ACS standard bank angle?", a: ["30°", "45°", "50°", "60°"], correct: 2, explain: "50° bank ±5° for Private AMEL. (Private ASEL is 45°; Commercial is also 50°.)" },
        { q: "Altitude tolerance during Private AMEL steep turns?", a: ["±50 ft", "±100 ft", "±150 ft", "±200 ft"], correct: 1, explain: "±100 ft. Memorize all four: bank ±5°, altitude ±100 ft, airspeed ±10 kt, rollout ±10°." },
        { q: "Approximate load factor at 50° bank, level turn?", a: ["1.0 G", "1.25 G", "1.56 G", "2.0 G"], correct: 2, explain: "1/cos(50°) = 1.56 G. Stall speed in this turn = Vs × √1.56 = Vs × 1.25. So if Vs is 70 mph wings level, accelerated stall in a 50° turn happens at ~88 mph." },
      ],
    },
    {
      id: "slow-flight",
      name: "Slow Flight",
      acs: {
        standards: ["Maintain airspeed just above stall warning activation", "Maintain altitude/heading"],
        tolerances: "Altitude ±100 ft, heading ±10°, airspeed +10/-0 kt, bank ±10° in turns",
      },
      flow: [
        "Clearing turns",
        "Configure as specified by examiner (typically gear + flaps as for landing)",
        "Reduce power, slowly raise nose",
        "Stabilize at airspeed 5-10 kt above stall warning activation (NOT WHERE WARNING IS SOUNDING — that's the old PTS standard, the current ACS is just above activation)",
        "Maintain altitude with pitch, airspeed with power",
        "Demonstrate level turns ±10° bank",
        "Recover: power up, lower nose, retract flaps in stages, gear up if appropriate",
      ],
      commonErrors: [
        "Letting stall warning sound (current ACS specifies just above activation, no warning)",
        "Asymmetric power changes (Vmc setup near stall AOA — DANGEROUS)",
        "Loss of altitude during turns",
      ],
      examinerGotchas: [
        "'What's the current ACS slow flight criterion?' — just above stall warning activation; horn is NOT supposed to sound. Easy bust if you use old PTS standard.",
        "'Why is asymmetric power especially dangerous in slow flight?' — high AOA + low airspeed = Vmc setup",
      ],
      quiz: [
        { q: "Current Private ACS slow flight criterion?", a: ["Minimum controllable airspeed with stall horn blaring", "Just above stall warning activation, no warning sounding", "1.3 Vso", "Vmc + 5"], correct: 1, explain: "ACS revision changed the standard. Slow flight is now demonstrated WITHOUT stall warning sounding. Old PTS standard was 'minimum controllable' with horn going. Examiner will mark you down if you ride the horn." },
      ],
    },
    {
      id: "stalls",
      name: "Power-Off, Power-On, Accelerated Stalls",
      acs: {
        standards: ["Recognize and recover at first indication of stall"],
        tolerances: "Recover at first indication (horn, buffet, or any onset cue) — going to full break is now considered a deficiency",
      },
      flow: [
        "Clearing turns, configure (off = landing config; on = takeoff/climb config)",
        "Slow toward stall while maintaining altitude",
        "At first indication (horn, buffet, decay): RECOVER",
        "Recovery: REDUCE AOA FIRST (lower nose), THEN add power on BOTH engines symmetrically, level wings, retract flaps in stages",
      ],
      commonErrors: [
        "Adding power before reducing AOA (deepens stall)",
        "Asymmetric power application (Vmc roll setup)",
        "Going past first indication (current ACS deficiency)",
      ],
      examinerGotchas: [
        "'Why reduce AOA before adding power?' — power-on stall recovery without AOA reduction can deepen the stall (pitch-up moment from thrust)",
        "'Why is asymmetric power dangerous near stall?' — high AOA + low airspeed = below Vmc with engine differential = Vmc roll or cross-controlled spin",
      ],
      quiz: [
        { q: "Stall recovery in a multi-engine airplane begins with:", a: ["Adding full power on both engines", "Reducing AOA (lower the nose)", "Banking toward operating engine", "Retracting flaps"], correct: 1, explain: "AOA reduction is ALWAYS the first step in stall recovery. Adding power first can deepen the stall via pitch-up moment. Same in twins as singles, but consequences of mistake are bigger in twins." },
      ],
    },
    {
      id: "vmc-demo",
      name: "Vmc Demonstration",
      acs: {
        standards: ["Demonstrate awareness of approaching Vmc loss-of-control with one engine simulated inoperative"],
        tolerances: "Recover at FIRST indication (loss of directional control, stall warning, or unsafe pitch attitude) — whichever comes first",
      },
      flow: [
        "Safe altitude (≥3,000 ft AGL minimum)",
        "Clearing turns",
        "Gear up, flaps up, takeoff power on operating engine, idle (or zero thrust) on simulated dead engine",
        "Bank ~5° toward operating engine",
        "Pitch up gradually to bleed airspeed at ~1 kt/sec",
        "Maintain heading with rudder",
        "RECOVER at first indication: simultaneously REDUCE POWER on operating engine, LOWER NOSE",
        "Re-establish controlled flight at Vyse",
      ],
      commonErrors: [
        "Trying to ride to actual Vmc (not the standard — recover at FIRST indication)",
        "Adding power instead of reducing during recovery (deepens loss of control)",
        "Pulling nose UP during recovery (lower it!)",
        "Banking AWAY from operating engine (worsens situation)",
        "Performing below 3,000 ft AGL",
      ],
      examinerGotchas: [
        "'Three indicators for recovery — name them.' — loss of directional control, stall warning, unsafe pitch attitude",
        "'Why reduce power and lower nose simultaneously?' — power reduction lowers asymmetric thrust (regains control); lower nose increases airspeed (gets above Vmc again)",
        "'Why ≥3,000 ft AGL?' — if recovery doesn't go as planned, you need altitude to sort it out",
      ],
      quiz: [
        { q: "During Vmc demo, recover at FIRST indication of:", a: ["Loss of directional control, stall warning, or unsafe pitch — whichever first", "Full Vmc loss only", "Stall break only", "Audible warning only"], correct: 0, explain: "Three triggers, recover at whichever happens FIRST. At altitude, stall warning often comes BEFORE loss of control because thin air = lower power = lower actual Vmc, but stall speed is unchanged." },
        { q: "Recovery from Vmc demo:", a: ["Add power, pull nose up", "Reduce power on operating engine and lower the nose", "Bank away from operating engine", "Feather immediately"], correct: 1, explain: "Counterintuitive but correct. Reduce power = less asymmetric thrust = regain control. Lower nose = gain airspeed back above Vmc. Adding power makes it worse." },
        { q: "Vmc demo minimum altitude?", a: ["1,000 ft AGL", "3,000 ft AGL", "10,000 ft MSL", "Pattern altitude"], correct: 1, explain: "3,000 ft AGL minimum. Recovery margin if it goes wrong." },
      ],
    },
    {
      id: "drag-demo",
      name: "Drag Demonstration",
      acs: {
        standards: ["Demonstrate effect of various drag sources on single-engine climb performance"],
        tolerances: "Configure as directed; describe and demonstrate performance loss",
      },
      flow: [
        "Safe altitude, simulate engine failure (one engine to zero thrust)",
        "Establish Vyse climb wings level, ball centered",
        "Demonstrate sequence:",
        "  1. Wings level + ball centered: poor climb (sideslipping)",
        "  2. Bank 2° toward operating engine + ½ ball: best climb",
        "  3. Add gear DOWN: massive performance loss",
        "  4. Add flaps: more performance loss",
        "  5. Windmilling vs feathered prop: dramatic difference",
      ],
      commonErrors: [
        "Not actually demonstrating each step quantitatively (climb rate observed at each config)",
        "Confusing drag demo with Vmc demo",
      ],
      examinerGotchas: [
        "'Show me what gear-down does to single-engine climb.' Be ready to call out the specific climb rate change",
        "'Which is worse — windmilling prop or gear down?' Both significant; windmilling typically more",
      ],
      quiz: [
        { q: "Greatest drag penalty after engine failure (and most important to fix quickly):", a: ["Gear down", "Windmilling prop", "Cowl flaps open", "Pitot heat on"], correct: 1, explain: "Windmilling prop produces more drag than a wide-open paddle. Feathering quickly is the highest-leverage drag reduction available. Gear down is significant but a smaller effect than windmilling." },
      ],
    },
    {
      id: "engine-failure-during-takeoff",
      name: "Engine Failure During Takeoff",
      acs: {
        standards: ["Recognize engine failure", "Maintain control", "Apply correct procedure based on phase of takeoff"],
        tolerances: "Decision must be made and executed without delay",
      },
      flow: [
        "ENGINE FAILURE BELOW Vmc (on takeoff roll):",
        "  THROTTLES IDLE (both)",
        "  Maximum braking",
        "  Maintain directional control with rudder + brakes",
        "  Stop on runway",
        "",
        "ENGINE FAILURE ABOVE Vmc, RUNWAY REMAINING:",
        "  Land straight ahead on remaining runway",
        "  Throttles idle, gear DOWN if not yet retracted",
        "  Brake to stop",
        "",
        "ENGINE FAILURE AIRBORNE, NO RUNWAY:",
        "  AVIATE: pitch for blue line (Vyse), rudder to stop yaw, ~2° bank toward live engine",
        "  CLEAN UP: gear up if not already, flaps up if used",
        "  IDENTIFY: dead foot, dead engine",
        "  VERIFY: slowly retard throttle on dead-side; if no yaw change, you got the right one",
        "  FEATHER: prop to feather on dead engine",
        "  SECURE: mixture cutoff, mags off, fuel selector off, alt/pump off on dead side",
        "  DECLARE: tell ATC, return for landing",
      ],
      commonErrors: [
        "Trying to fly out below Vmc (Vmc roll, fatal at low altitude)",
        "Climbing with gear DOWN airborne (massive drag loss)",
        "Identifying via instruments instead of dead-foot rule (slow)",
        "Feathering before verifying (risk shutting down good engine)",
      ],
      examinerGotchas: [
        "'Below Vmc, runway remaining or not — what's the answer?' — ALWAYS abort. No exceptions.",
        "'Show me the dead-foot rule.' — the foot you're NOT pressing identifies the failed engine",
        "'Why verify before feathering?' — to avoid shutting down the WORKING engine",
      ],
      quiz: [
        { q: "Engine failure on takeoff roll BELOW Vmc, with 8,000 ft of runway remaining:", a: ["Continue, lift off, troubleshoot", "Abort: throttles idle, max braking", "Add full power on the other engine", "Pull up sharply to clear obstacles"], correct: 1, explain: "Below Vmc the airplane is uncontrollable with one engine at full power. Doesn't matter how much runway is ahead — you cannot maintain directional control airborne. ABORT is the only answer." },
        { q: "After engine failure airborne with no runway, the correct order is:", a: ["Identify-Verify-Feather-Maintain control", "Maintain control-Configure-Identify-Verify-Feather-Secure", "Feather-Secure-Identify", "Declare-Identify-Feather"], correct: 1, explain: "AVIATE FIRST. Pitch blue line, rudder, ~2° bank → THEN configure (gear up, mixtures/props/throttles forward) → THEN identify (dead foot) → THEN verify (slow throttle pull) → THEN feather → THEN secure. Skipping aviate = Vmc roll." },
      ],
    },
    {
      id: "engine-failure-cruise",
      name: "Engine Failure in Flight (Cruise)",
      acs: {
        standards: ["Recognize, control, identify, verify, secure, troubleshoot, divert"],
        tolerances: "Maintain altitude or controlled descent; reach single-engine cruise without loss of control",
      },
      flow: [
        "AVIATE: maintain control, pitch for blue line if descending",
        "If at cruise altitude, you may be able to maintain altitude single-engine — depends on weight, DA, and altitude",
        "IDENTIFY-VERIFY-FEATHER-SECURE",
        "TROUBLESHOOT (if appropriate): is restart possible? (fuel selector wrong tank, mag, primer leak)",
        "If restart not possible: DECLARE, divert to nearest suitable airport",
        "Single-engine cruise: typically reduce to ~70-75% on operating engine to stay below redlines",
        "Plan single-engine approach with extra altitude margin and flatter glide path",
      ],
      commonErrors: [
        "Trying to make original destination instead of nearest suitable",
        "Adding too much flap on single-engine approach (drag spike)",
        "Configuring for landing too early (excess drag = sink)",
      ],
      examinerGotchas: [
        "'Where do you go after engine failure in cruise?' — nearest SUITABLE airport (length, weather, services)",
        "'Why not your destination if it's only 30 miles further?' — degraded performance, no redundancy, possible undetected damage",
      ],
      quiz: [
        { q: "After securing a failed engine in flight, your destination should be:", a: ["The original destination if weather allows", "The nearest suitable airport", "The departure airport always", "Whichever is largest"], correct: 1, explain: "Nearest suitable. Single-engine = degraded performance, no redundancy. 'Suitable' = adequate runway, services, weather. Don't try to make destination just because you're close." },
      ],
    },
    {
      id: "single-engine-approach",
      name: "Single-Engine Approach & Landing",
      acs: {
        standards: ["Configure appropriately", "Maintain Vyse on approach", "Stabilized approach", "Land safely"],
        tolerances: "Vyse +10/-5 until short final, then ref speed ±5 kt",
      },
      flow: [
        "Brief approach in advance",
        "Maintain Vyse until on final, then transition to approach speed",
        "Gear DOWN once landing is assured (not before — gear is huge drag)",
        "Flaps in stages, only as needed (each notch = drag)",
        "Power on operating engine: significantly more than two-engine approach (offsets asymmetric drag)",
        "Touchdown on speed, on aim point",
        "Be ready for go-around — single-engine missed approach is harder than two-engine",
      ],
      commonErrors: [
        "Gear down too early (drag sink during turn to final)",
        "Full flaps too early (similar)",
        "Insufficient power (sink below glidepath)",
        "Trying to salvage an unstable approach instead of going missed early",
      ],
      examinerGotchas: [
        "'When do you put the gear down on a single-engine approach?' — once landing is assured (not on downwind)",
        "'Compared to a normal two-engine approach, your power on the operating engine is:' — MORE, not less",
      ],
      quiz: [
        { q: "On single-engine approach, gear should be lowered:", a: ["Abeam the touchdown point on downwind, like normal", "Once landing is assured (typically short final or after intercepting glidepath)", "On the takeoff roll", "Never on single engine"], correct: 1, explain: "Gear is huge drag, especially with asymmetric thrust. Delay gear-down until landing is assured to preserve glide energy. Standard 'abeam touchdown' gear extension is for two-engine ops." },
      ],
    },
    {
      id: "instrument-approach",
      name: "Instrument Approach (with Engine Failure)",
      acs: {
        standards: ["Load and brief approach in GNS 430W", "Fly approach to MDA/DA", "Manage degraded single-engine performance", "Recognize when to go missed early"],
        tolerances: "Course ±¾ scale on CDI, altitude ±100 ft on stabilized segments, MDA/DA -0/+50 ft",
      },
      flow: [
        "Load approach EARLY (before any failure)",
        "Brief: course, altitudes, FAF, MDA/DA, missed approach",
        "When engine failure simulated: maintain control FIRST, then continue approach",
        "Single-engine approach = MORE power on operating engine",
        "If performance is marginal at any point: GO MISSED EARLY (don't try to salvage to minimums)",
        "On 430W: switch CDI from GPS to VLOC for ILS at the appropriate prompt; stay on GPS for RNAV",
      ],
      commonErrors: [
        "Trying to brief approach AFTER the failure (task saturation)",
        "Forgetting to switch CDI from GPS to VLOC on ILS",
        "Continuing to minimums when performance shows you can't go missed safely",
      ],
      examinerGotchas: [
        "'When do you switch CDI from GPS to VLOC?' — at the 430W's prompt, typically intermediate segment before LOC intercept",
        "'When do you go missed?' — early if performance is marginal; don't push to minimums",
      ],
      quiz: [
        { q: "On a GNS 430W ILS approach, the CDI is switched from GPS to VLOC:", a: ["At the FAF", "When the unit prompts (intermediate segment, before LOC intercept)", "Never", "On missed approach"], correct: 1, explain: "The 430W shows a prompt: 'Set CRS xxx, switch CDI to VLOC.' That's typically before localizer intercept. Leaving it on GPS means tracking to airport, not down the localizer." },
        { q: "RNAV (GPS) approach CDI source:", a: ["VLOC", "GPS for the entire approach", "Either", "OBS"], correct: 1, explain: "RNAV approaches use GPS as the navigation source. Stay on GPS the whole way." },
      ],
    },
    {
      id: "short-field-landing",
      name: "Short-Field Landing",
      acs: {
        standards: ["Stabilized approach at POH speed", "Touchdown at or beyond aim point", "Stop in shortest distance"],
        tolerances: "Touchdown +200 / -0 ft of aim point, full flaps per POH",
      },
      flow: [
        "Stabilized approach at POH short-field speed (slightly slower than normal final)",
        "Full flaps per POH",
        "Aim point established by examiner",
        "Firm touchdown at or beyond aim point — NEVER short",
        "Immediately retract FLAPS (verify gear handle vs flap handle visually)",
        "Maximum braking",
      ],
      commonErrors: [
        "Touchdown short of aim point (instant deficiency, fail in real life = obstacle strike)",
        "Floating past aim point (didn't dissipate energy)",
        "Reaching for gear handle on rollout instead of flaps (= retracted gear on ground = bent airplane)",
      ],
      examinerGotchas: [
        "'Show me the aim point.' Examiner picks it; you commit to landing at or just past",
        "'Why retract flaps not gear on rollout?' — flap retraction transfers weight to wheels for braking; gear retraction = ground loop with prop strikes",
      ],
      quiz: [
        { q: "Private AMEL short-field landing tolerance?", a: ["±100 ft of aim point", "+200 / -0 ft of aim point", "+500 / -0 ft", "Anywhere in first third"], correct: 1, explain: "+200 / -0 ft. AT or BEYOND the aim point, never short. Asymmetric tolerance reflects that overshoot is recoverable; undershoot strikes obstacles." },
      ],
    },
    {
      id: "emergency-descent",
      name: "Emergency Descent",
      acs: {
        standards: ["Establish max-allowed descent rate", "Maintain control", "Configure per POH"],
        tolerances: "Configure per POH; arrive at target altitude ±100 ft",
      },
      flow: [
        "Cause: cabin fire, smoke, depressurization (less applicable PA-30, no pressurization), passenger medical",
        "Throttles to IDLE",
        "Prop full forward (high RPM = drag, plus available for go-around)",
        "Gear DOWN (max drag if at safe airspeed)",
        "Bank into a steep descending turn (clear traffic visually)",
        "Pitch for max allowable airspeed (just below Vle/Vno depending on config)",
        "Communicate with ATC, declare emergency",
        "Plan landing at nearest field",
      ],
      commonErrors: [
        "Not declaring emergency",
        "Pitching too steep (overspeed)",
        "Forgetting to clear visually before steep turn",
      ],
      examinerGotchas: [
        "'When would you do an emergency descent?' — fire, smoke, structural damage, medical emergency",
        "'What speed?' — max allowed in current config (Vle, Vno, Vne minus margin)",
      ],
      quiz: [
        { q: "Emergency descent in PA-30: what speed do you target?", a: ["Vy", "Vyse", "Maximum allowed in current configuration (typically Vle ~150 mph with gear down)", "Vmc"], correct: 2, explain: "Max allowed speed gets you down fast. Gear DOWN = Vle ~150 mph (drag bonus). Gear up = Vno/Vne minus margin. Pick the max for your config." },
      ],
    },
  ],
};

// ---------- ORAL EXAM PREP ----------
const ORAL = {
  intro: "These topics map directly to the Raider Aviation Multi-Engine Oral Exam Guide. Master these and you've covered what your examiner will actually ask.",
  groups: [
    {
      id: "core-oral",
      label: "CORE ORAL — RAIDER PDF",
      blurb: "The 9 topics your CFI explicitly told you to know cold.",
      topics: [
        {
          id: "critical-engine",
          title: "Critical Engine",
          raiderQuote: "The engine whose failure most adversely affects the performance and handling of the airplane. On a conventional twin that doesn't have counter-rotating props, this will be the left engine.",
          definition: "The critical engine is the engine whose failure most adversely affects the performance and handling of the airplane. On a conventional twin (both props rotating clockwise from the pilot's view, like the PA-30), it's the LEFT engine.",
          keyPoints: [
            "On a conventional twin with both props rotating clockwise (cockpit view), the LEFT engine is critical.",
            "Why: PAST puts each engine's effective thrust line on its right side. The right engine's thrust acts on a longer arm from centerline.",
            "Lose the LEFT engine → surviving right engine produces a yawing moment on a longer arm = larger yaw, harder to control.",
            "Lose the RIGHT engine → surviving left engine has a shorter arm = smaller yaw, easier to control.",
            "Counter-rotating twins (e.g., PA-39) have NO critical engine — descending blades are inboard, thrust geometry is symmetric.",
            "'Most adversely affects' means BOTH performance (larger yawing moment costs more rudder/drag) AND handling (harder to maintain heading).",
          ],
          quiz: [
            { q: "Define critical engine.", a: ["Whichever engine fails first", "The engine whose failure most adversely affects the performance and handling of the airplane", "The bigger of the two engines", "The right engine in all twins"], correct: 1, explain: "The Raider/FAA definition: the engine whose failure most adversely affects the airplane's performance and handling qualities." },
            { q: "On a PA-30 (both props rotate clockwise from the pilot's view), which engine is critical?", a: ["Right", "Left", "Either — depends on weight", "Neither"], correct: 1, explain: "LEFT engine. PAST geometry makes the right engine's thrust line farther from centerline, so losing the left leaves the surviving right engine producing yaw on a longer arm — harder to control." },
            { q: "Why is the LEFT engine the critical engine on a conventional twin?", a: ["The left engine has more horsepower", "PAST factors put the right engine's effective thrust line farther from centerline; losing the left leaves a larger yawing arm", "The left engine drives the alternator", "It's just FAA convention"], correct: 1, explain: "The four left-yawing tendencies (P-factor, Accelerated slipstream, Spiraling slipstream, Torque) all shift each engine's effective thrust line to its RIGHT side. That puts the right engine's thrust farther from centerline, so losing the LEFT means the right engine's longer-arm thrust produces a bigger yaw." },
            { q: "On a counter-rotating twin (e.g., PA-39), which engine is critical?", a: ["Left", "Right", "Neither — counter-rotation cancels the asymmetry", "Both"], correct: 2, explain: "Counter-rotating props mirror PAST effects, so each engine's effective thrust acts symmetrically about centerline. Neither engine has a longer moment arm; neither is critical." },
            { q: "When the examiner says 'most adversely affects performance AND handling,' the phrase covers:", a: ["Only climb rate", "Only directional control", "Both: a larger yaw arm hurts climb (more drag/rudder) and hurts handling (more rudder needed to fly straight)", "Only fuel burn"], correct: 2, explain: "PAST puts both performance and handling penalties on the same engine. Losing the engine OPPOSITE the longer-arm side means the surviving longer-arm engine produces both more drag-from-rudder (perf) and more yaw demand (handling)." },
            { q: "If you swap the PA-30 for a PA-39 (counter-rotating), what happens to the critical-engine concept?", a: ["Critical engine swaps to the right side", "Both engines become critical", "There is no critical engine — neither has thrust on a longer arm", "Critical engine analysis still applies but Vmc doubles"], correct: 2, explain: "Counter-rotation makes thrust geometry symmetric. With no engine having a longer effective thrust arm, neither qualifies as 'most adversely affects' the airplane on failure." },
            { q: "On a conventional twin, the descending propeller blade of EACH engine is on:", a: ["The left side of each engine", "The right side of each engine", "The top of each engine", "The bottom of each engine"], correct: 1, explain: "Both props turn clockwise from the cockpit view. As each blade comes down on the right side of its engine, P-factor produces more thrust there — shifting effective thrust line to the right of each engine." },
            { q: "Trick framing: 'Why isn't the RIGHT engine critical on a PA-30?' The answer:", a: ["It is — examiners often misstate this", "Losing the right engine leaves the LEFT (shorter-arm) engine as the survivor — smaller yawing moment, easier to control", "Right engine has more power so it's never critical", "The right engine drives the autopilot"], correct: 1, explain: "If you lose the right engine, the left's effective thrust line is closer to centerline → smaller yaw moment → easier handling. Critical engine = the one whose failure makes things WORST. That's the engine on the OPPOSITE side from the longer-arm survivor." },
            { q: "Which is NOT a reason the left engine is critical?", a: ["P-factor shifts thrust right on each engine", "Spiraling slipstream off the left engine helps with yaw control", "The left engine has different displacement than the right engine", "Asymmetric thrust would act on a longer arm via the right engine"], correct: 2, explain: "Both engines have identical displacement on a PA-30. The left engine's criticality comes purely from PAST geometry, not engine differences." },
          ],
        },
        {
          id: "past",
          title: "PAST — The 4 Factors",
          raiderQuote: "P-factor, Accelerated slipstream, Spiraling slipstream, Torque",
          definition: "PAST = the four left-yawing tendencies that act on every propeller airplane. On a conventional twin, all four shift each engine's effective thrust line to its RIGHT side, which is why the LEFT engine is critical.",
          keyPoints: [
            "**P-factor:** the descending blade produces more thrust than the ascending blade. With clockwise rotation (cockpit view), the descending blade is on the RIGHT side of each engine, shifting effective thrust right.",
            "**Accelerated slipstream:** same geometry as P-factor — the high-velocity slipstream behind the descending blade hits the wing on the right side, producing more lift/drag asymmetry on the right of each engine.",
            "**Spiraling slipstream:** prop wash spirals back around the fuselage and strikes the LEFT side of the vertical stabilizer, producing a left-yaw force. This is the only PAST factor that doesn't depend on which engine is failed — it's always a left-yaw input.",
            "**Torque:** Newton's third law — prop spinning right (cockpit view) twists the airframe LEFT.",
            "All four shift effective thrust line on each engine to its RIGHT side, except torque (whole-airframe yaw).",
            "Net result: lose the LEFT engine → surviving right engine's longer-arm thrust = larger yawing moment to the LEFT (toward the dead engine). Vmc rises, handling degrades.",
          ],
          quiz: [
            { q: "PAST stands for:", a: ["Power, Air, Spin, Trim", "P-factor, Asymmetric thrust, Slipstream, Torque", "P-factor, Accelerated slipstream, Spiraling slipstream, Torque", "Pitch, Angle, Speed, Thrust"], correct: 2, explain: "P-factor, Accelerated slipstream, Spiraling slipstream, Torque — the four left-yawing tendencies in any propeller airplane." },
            { q: "P-factor is caused by:", a: ["Cold engine compensation", "The descending blade producing more thrust than the ascending blade at high AOA", "Air pressure differences in the fuselage", "Magnetic compass deviation"], correct: 1, explain: "At high AOA, the descending blade has a higher relative AOA than the ascending blade, producing more thrust. With clockwise rotation, the descending blade is on the right side of the engine — thrust shifts right." },
            { q: "Accelerated slipstream effect:", a: ["Air slows behind the prop", "High-velocity prop wash hits the wing/fuselage asymmetrically, producing more lift/drag on the right side of each engine", "Crosswind compensation", "Engine cooling effect"], correct: 1, explain: "The propeller throws air backward at high velocity. Where that fast air strikes the wing or fuselage, it generates extra lift and drag. The asymmetric pattern (more from the descending-blade side) shifts effective thrust line right on each engine." },
            { q: "Spiraling slipstream wraps around the fuselage and strikes:", a: ["The left side of the vertical stabilizer, producing a left-yaw force", "The right side of the rudder, helping yaw control", "The horizontal stabilizer only", "Nothing — it dissipates"], correct: 0, explain: "Prop wash spirals back around the fuselage and impacts the LEFT side of the vertical fin, pushing the tail right and the nose left. This is one of the four left-yawing factors." },
            { q: "Torque (Newton's third law) on a single-engine airplane causes:", a: ["The engine to spin in the opposite direction of the prop", "The airframe to roll/yaw to the LEFT (props turning right from cockpit view)", "Increased power output", "No effect on handling"], correct: 1, explain: "If the prop spins right (clockwise from cockpit view), Newton's reaction is the airframe wanting to twist LEFT. Pilot must counteract with right rudder/aileron." },
            { q: "On a conventional twin, all four PAST factors shift each engine's effective thrust line to:", a: ["The left side of each engine", "The right side of each engine", "Wherever the wind pushes it", "Centerline of the aircraft"], correct: 1, explain: "P-factor: descending blade on right. Accelerated slipstream: max velocity on right (where descending blade is). Spiraling slipstream: independent of engine but augments left yaw. Torque: airframe yaws left (opposite of prop rotation). Net: each engine's effective thrust acts on the RIGHT side of its own centerline." },
            { q: "Which PAST factor is LEAST sensitive to which engine has failed?", a: ["P-factor", "Accelerated slipstream", "Spiraling slipstream (it's a fixed left-yaw force regardless of which engine quits)", "Torque"], correct: 2, explain: "Spiraling slipstream is generated by the LIVE engine and always strikes the same side of the vertical stab. Whether you lose the left or right engine, the surviving engine's spiral always tries to yaw the nose left." },
            { q: "Why is P-factor especially relevant on a twin?", a: ["It only matters in twins", "Combined with the other PAST factors, it shifts effective thrust line outboard on the right engine, making losing the left engine yield a larger yawing moment", "It cancels in twins", "Twins are immune to P-factor"], correct: 1, explain: "Singles experience P-factor too. In twins, P-factor on each engine pushes thrust right of each engine's centerline. The right engine's thrust line ends up farther from aircraft centerline (longer moment arm) — that's what makes losing the LEFT engine 'critical.'" },
            { q: "Counter-rotating twins eliminate the critical-engine concept because:", a: ["Their props are larger", "Each engine's PAST shifts thrust INBOARD instead of outboard, making thrust geometry symmetric about centerline", "They have more rudder authority", "PAST doesn't apply to counter-rotating engines"], correct: 1, explain: "On counter-rotating props, the descending blades are on the inboard sides of each engine. Effective thrust lines point inward symmetrically. Neither engine has a longer-arm advantage — no critical engine." },
            { q: "Mnemonic test: which of these is NOT one of the four PAST factors?", a: ["Spiraling slipstream", "Accelerated slipstream", "Slipstream drag (made-up term)", "P-factor"], correct: 2, explain: "PAST = P-factor + Accelerated slipstream + Spiraling slipstream + Torque. 'Slipstream drag' isn't a standard PAST factor — it's a distractor." },
          ],
        },
        {
          id: "vmc",
          title: "Vmc — Definition & N1100L",
          raiderQuote: "Minimum controllable airspeed with one engine inoperative. Know what speed this is for your training aircraft.",
          definition: "Vmc is the minimum airspeed at which the airplane is directionally controllable with the critical engine inoperative, the operating engine at maximum power, and the airplane in the certification configuration. For N1100L (PA-30): Vmc = 80 mph IAS, marked as the RED radial line.",
          keyPoints: [
            "**N1100L Vmc: 80 mph IAS** (red radial line on the ASI). Memorize cold.",
            "Below Vmc with one engine out at full power, rudder cannot overcome asymmetric thrust → airplane yaws and rolls toward the dead engine = Vmc roll.",
            "Vmc is a FLOOR, not a target. Never operate at or near Vmc with engine failure threat.",
            "Recovery from imminent Vmc loss-of-control: REDUCE power on the operating engine + LOWER the nose to gain airspeed. Counterintuitive — adding power makes it worse.",
            "Mnemonic: 'Red = Dead' (below Vmc with engine out = airplane is dead). 'Blue = Best' (Vyse = best single-engine climb).",
            "Real-world Vmc varies: lower at altitude (less power), lower with feathered prop, higher with bank toward dead engine. The painted red line is for cert conditions only.",
          ],
          quiz: [
            { q: "Define Vmc.", a: ["Maximum cruise speed with one engine", "Minimum controllable airspeed with one engine inoperative", "Vmin coordination", "Maximum certification speed"], correct: 1, explain: "Vmc = the minimum airspeed at which directional control is maintainable with the critical engine inoperative and the operating engine at max power, in the certification configuration." },
            { q: "N1100L's Vmc is:", a: ["70 mph", "80 mph IAS (red radial line)", "90 mph", "105 mph"], correct: 1, explain: "PA-30 Vmc is 80 mph IAS — marked as the RED radial line on the ASI. Memorize this number for the oral." },
            { q: "Vmc is marked on the airspeed indicator as the:", a: ["Top of the green arc", "Red radial line", "Bottom of the white arc", "Blue radial line"], correct: 1, explain: "RED radial line. Mnemonic: Red = Dead (below Vmc with engine out = uncontrollable). Blue = Best (Vyse, single-engine best climb)." },
            { q: "What happens if airspeed drops below Vmc with one engine inoperative at takeoff power?", a: ["Nothing — engines compensate", "Loss of directional control: airplane yaws and rolls toward the dead engine (Vmc roll)", "Climb rate increases", "Engines automatically reduce thrust"], correct: 1, explain: "Below Vmc, the rudder cannot generate enough side force to counter the asymmetric thrust from the operating engine. The airplane yaws and rolls into the dead engine — a Vmc roll, often unrecoverable at low altitude." },
            { q: "First action when you encounter loss of directional control approaching Vmc:", a: ["Add full power on the operating engine", "Pull the nose up sharply", "Reduce power on the operating engine and lower the nose", "Bank toward the dead engine"], correct: 2, explain: "REDUCE POWER on the operating engine (less asymmetric thrust = less yaw demand = controllable again). LOWER THE NOSE to gain airspeed back above Vmc. Adding power or pitching up makes the situation worse." },
            { q: "Why is reducing power on the operating engine the correct Vmc recovery?", a: ["It prevents engine damage", "It lowers asymmetric thrust, which lowers actual Vmc and reduces rudder demand", "It saves fuel", "It signals ATC"], correct: 1, explain: "Less power = less PAST = less asymmetric thrust = less rudder needed = the airplane regains directional control. Combined with lower nose for airspeed, you climb back above Vmc and re-establish control." },
            { q: "Vmc represents a FLOOR, not a target. This means:", a: ["Always operate exactly at Vmc", "Never operate at or near Vmc with engine-failure threat — give yourself airspeed margin (Vyse)", "Vmc is the same as best climb", "Vmc is irrelevant in cruise"], correct: 1, explain: "Vmc is the minimum below which control is impossible. You always want margin above it. The operational speed after engine failure is Vyse (blue line), well above Vmc." },
            { q: "Real-world Vmc compared to the published red line:", a: ["Always exactly the same", "Can be LOWER (at altitude, with feathered prop) or HIGHER (with bank toward dead engine, etc.) — published is conservative for cert conditions", "Always higher in flight", "Doesn't apply once airborne"], correct: 1, explain: "Published Vmc is calibrated for the certification standard (sea level standard day, max power, windmilling prop, aft CG, etc.). Real-world Vmc varies. The painted red line is a fixed reference; actual Vmc shifts with conditions." },
            { q: "If you're at 8,000 ft DA with the dead prop feathered, your actual Vmc is likely:", a: ["Higher than 80 mph", "About 80 mph", "Lower than 80 mph (less power available + less drag from windmilling)", "Zero"], correct: 2, explain: "Less power available at altitude → less PAST → lower Vmc. Feathered prop → less drag/asymmetric force → lower Vmc. Both push real Vmc below the published red line. The trap: real Vmc may even drop below stall speed at high DA — stall warning could come BEFORE any yaw warning." },
            { q: "Easy memory aid for Vmc red and Vyse blue:", a: ["Both are decoration only", "Red = Dead (below = uncontrollable). Blue = Best (single-engine climb)", "Red = Right, Blue = Left", "Colors have no meaning"], correct: 1, explain: "Red = Dead, Blue = Best. Below the red line you're dead (Vmc roll). At the blue line you climb best on one engine. These are the two most important radial lines on a multi-engine airspeed indicator." },
          ],
        },
        {
          id: "vmc-cert-conditions",
          title: "Vmc Certification Conditions",
          raiderQuote: "Standard day at sea-level. Max power on the operating engine. Aft CG. Critical engine windmilling. Flaps and gear up. Up to 5 degrees of bank. Most unfavorable weight.",
          definition: "Per AC 23-8C / 14 CFR §23.149, the published Vmc is determined under a SPECIFIC set of worst-case conditions. Knowing these is core oral content — they explain why real-world Vmc can be lower than the painted red line.",
          keyPoints: [
            "**Standard day at sea level.** Max engine power available — biggest asymmetric thrust possible.",
            "**Operating engine at maximum takeoff power.** Worst-case PAST.",
            "**Critical engine windmilling.** Maximum drag and asymmetric force from the failed side.",
            "**Most unfavorable weight.** For Vmc, that means LIGHTER (less inertia, less horizontal lift component when banked).",
            "**Most unfavorable CG (aft).** Shorter rudder arm = less rudder authority.",
            "**Flaps in takeoff position, gear UP.** Clean (less keel/fin effect resisting yaw).",
            "**Up to 5° bank toward the operating engine.** This LOWERS the determined Vmc — without this allowance, published Vmc would be unworkably high.",
            "**Why this matters:** real-world conditions almost always deviate from cert (heavier, forward CG, feathered prop, altitude), so actual Vmc is usually LOWER than the published red line. The exception: bank toward the DEAD engine raises real Vmc above published.",
          ],
          quiz: [
            { q: "What atmospheric condition is assumed for Vmc certification?", a: ["High DA (10,000 ft)", "Standard day at sea level (max power available)", "Service ceiling of the aircraft", "Density altitude doesn't matter"], correct: 1, explain: "Standard day, sea level. Where the engine produces full rated power, generating maximum asymmetric thrust — the worst-case for Vmc." },
            { q: "Per cert, the operating engine power setting is:", a: ["Idle", "Cruise", "Maximum takeoff power", "75% power"], correct: 2, explain: "Maximum takeoff power = maximum PAST = maximum rudder demand = highest Vmc. Worst-case assumption." },
            { q: "Per cert, the inoperative engine is assumed to be:", a: ["Feathered (best case)", "Windmilling (worst-case drag)", "At idle", "Stopped completely"], correct: 1, explain: "Windmilling = maximum drag from the dead side, maximum asymmetric force. Cert assumes the worst case. Feathering in real life lowers actual Vmc below published — that's why feathering is so important." },
            { q: "Per cert, what weight is assumed for Vmc determination?", a: ["Maximum gross", "Most unfavorable (typically LIGHTER — less inertia, less horizontal lift)", "Empty weight", "Mid-range"], correct: 1, explain: "Counterintuitive: lighter weight is WORSE for Vmc (less inertia resisting yaw, less horizontal lift component when banked). Cert uses 'most unfavorable' which for Vmc is the lighter weight." },
            { q: "Per cert, CG is assumed to be:", a: ["Forward limit", "Most unfavorable (typically AFT — shorter rudder arm)", "Mid-range", "Wherever empty CG sits"], correct: 1, explain: "Aft CG shortens the moment arm between CG and rudder = less rudder authority for the same deflection = higher Vmc. Cert uses the most-unfavorable case." },
            { q: "Gear and flap configuration assumed for cert:", a: ["Gear DOWN, flaps full", "Gear UP, flaps in takeoff position", "Gear UP, flaps UP", "Gear DOWN, flaps UP"], correct: 1, explain: "Gear UP, flaps in TAKEOFF position. Represents the most-likely engine-failure scenario (just after liftoff). Less keel/fin area than gear-down = less directional stability = higher Vmc." },
            { q: "Maximum bank angle allowed in the cert standard?", a: ["0° (wings level)", "Up to 5° toward the OPERATING engine", "10° toward the dead engine", "15° wings level"], correct: 1, explain: "14 CFR §23.149 allows up to 5° bank toward the OPERATING engine. The horizontal lift component this produces lowers the determined Vmc. Without this allowance, published Vmc would be much higher." },
            { q: "Why is the published Vmc considered conservative for normal ops?", a: ["FAA pads it by 10%", "Real-world conditions almost always deviate from cert in ways that LOWER actual Vmc (heavier, more forward CG, feathered, at altitude)", "It isn't conservative", "Manufacturers add a safety margin themselves"], correct: 1, explain: "Cert uses worst-case combinations. Real flight typically has heavier weight (more inertia), more forward CG (more rudder arm), feathered prop (less drag), and higher altitude (less power). All of these lower real Vmc below published. Bank toward the DEAD engine is the ONE deviation that raises real Vmc." },
            { q: "Operating engine at MAX POWER raises Vmc because:", a: ["More fuel burn", "More PAST = more asymmetric thrust = more rudder needed = higher airspeed required to generate that rudder force", "Engine vibration", "Manufacturer requirement"], correct: 1, explain: "More power = more asymmetric thrust = more rudder force needed to counter the yaw = higher airspeed required to generate that rudder force. That's why Vmc recovery starts with REDUCING power on the operating engine." },
            { q: "Bank up to 5° toward the OPERATING engine LOWERS Vmc because:", a: ["It changes wing camber", "The horizontal lift component physically opposes the asymmetric-thrust yaw, reducing rudder demand", "It increases stall margin", "It saves fuel"], correct: 1, explain: "When banked, lift has a horizontal component. Banked toward the live engine, that horizontal component pulls the airplane toward the operating engine — which OPPOSES the asymmetric yaw caused by the dead engine. Less rudder needed = lower Vmc." },
          ],
        },
        {
          id: "vyse",
          title: "Vyse — Definition & N1100L",
          raiderQuote: "Best rate of climb on a single engine — or maybe the least amount of descent. Know what speed this is for your training aircraft.",
          definition: "Vyse is the airspeed that produces the best RATE of climb (most altitude per unit time) with the critical engine inoperative. For N1100L: Vyse = 105 mph IAS, marked as the BLUE radial line. At high DA where single-engine climb is zero or negative, Vyse becomes the speed for least rate of descent.",
          keyPoints: [
            "**N1100L Vyse: 105 mph IAS** (blue radial line). Memorize cold.",
            "Vyse is your operational target after engine failure: above Vmc, above stall, gives best climb performance on one engine.",
            "Off-speed in either direction reduces climb rate. Below Vyse: more induced drag + closer to Vmc. Above Vyse: more parasite drag.",
            "Slowing below Vyse with an engine out is hazardous — you trade climb performance AND lose Vmc margin.",
            "**The 'or maybe least descent' caveat:** at high DA above the single-engine service ceiling (50 fpm climb @ ~7,100 ft DA on PA-30), the airplane can't climb single-engine. Vyse then becomes least-descent speed.",
            "After identify-verify-feather-secure, Vyse is your ONLY pitch target until you have terrain or maneuvering reasons to deviate.",
          ],
          quiz: [
            { q: "Define Vyse.", a: ["Maximum gear extension speed", "Best RATE of climb on a single engine (or least rate of descent if climb isn't possible)", "Best ANGLE of climb single engine", "Stall speed"], correct: 1, explain: "Vyse = best rate of climb (greatest altitude per unit time) on one engine. At high DA where climb isn't available, it's the least-descent speed." },
            { q: "N1100L's Vyse is:", a: ["80 mph", "90 mph", "105 mph IAS (blue radial line)", "112 mph"], correct: 2, explain: "PA-30 Vyse = 105 mph IAS, marked as the BLUE radial line. Memorize for the oral." },
            { q: "Vyse is marked on the airspeed indicator as:", a: ["Red radial", "Blue radial line", "Top of the white arc", "Top of the green arc"], correct: 1, explain: "BLUE radial line. Mnemonic: Blue = Best (single-engine best rate of climb)." },
            { q: "After identify-verify-feather, your sole pitch target is:", a: ["Vmc", "Vy (multi-engine)", "Vyse (blue line)", "Vne"], correct: 2, explain: "Vyse — best single-engine climb. Vy is for both engines. Vmc is a limit, not a target. Vne is a max." },
            { q: "If you slow below Vyse single-engine:", a: ["Climb rate stays the same", "Climb rate decreases (more induced drag) AND you reduce Vmc margin", "Climb rate increases", "No effect on safety"], correct: 1, explain: "Below Vyse you generate more induced drag (climb suffers) AND you're closer to Vmc (less control margin). Both bad. Stay AT Vyse precisely." },
            { q: "If you fly above Vyse single-engine:", a: ["Climb rate stays the same", "Climb rate decreases (more parasite drag, but you have more Vmc margin)", "Climb rate increases", "You always climb better the faster you go"], correct: 1, explain: "Above Vyse you incur more parasite drag, reducing climb rate. The Vmc margin is bigger, but the trade-off is performance. Vyse is precisely the optimum." },
            { q: "What's the 'or maybe least amount of descent' caveat in Vyse's definition?", a: ["Vyse is always a climb speed", "At high DA above the single-engine service ceiling, the aircraft can't climb single-engine — Vyse becomes the speed for least rate of descent", "It refers to gear extension", "The caveat doesn't apply to PA-30"], correct: 1, explain: "Vyse is the airspeed that maximizes performance (climb when possible, least descent when climb isn't). On a hot day at gross weight where DA is above the SE service ceiling, the airplane can't maintain altitude single-engine — Vyse minimizes the descent rate to give you the most time/distance." },
            { q: "PA-30 single-engine service ceiling at gross weight is approximately:", a: ["3,000 ft DA", "5,000 ft DA", "~7,100 ft DA (climb = 50 fpm)", "12,000 ft DA"], correct: 2, explain: "About 7,100 ft DA at gross. That's where single-engine climb degrades to 50 fpm. On hot Lubbock days, DA can push or exceed this — meaning engine failure on departure leaves no climb capability." },
            { q: "Which speed do you climb at if BOTH engines are running normally during initial climb?", a: ["Vyse", "Vy (best multi-engine climb)", "Vmc", "Vfe"], correct: 1, explain: "Vy with both engines (about 112 mph in PA-30). Vyse is only relevant after engine failure. Don't fly Vyse with both engines running — you'd be climbing slower than necessary." },
            { q: "What's an acceptable airspeed margin above Vmc for engine-out maneuvering?", a: ["Vmc itself is fine", "At least Vyse (well above Vmc with safety margin AND best climb)", "Vmc + 5 mph", "Vne minus 10"], correct: 1, explain: "Vyse (blue line) gives both adequate Vmc margin AND best climb performance. Operating at or near Vmc with engine out is dangerous — even small turbulence can drop you below Vmc and into a roll." },
          ],
        },
        {
          id: "accelerate-stop",
          title: "Accelerate-Stop Distance",
          raiderQuote: "The amount of runway needed to accelerate to takeoff speed, lose the critical engine, and come to a stop. Be able to calculate accelerate stop distance and add a safety buffer to come up with your personal minimum on runway length.",
          definition: "Accelerate-stop distance is the runway length required to accelerate to decision speed (per POH, typically Vr or Vmc), simulate critical-engine failure, then bring the airplane to a complete stop on the remaining runway. Key go/no-go input for every multi-engine takeoff.",
          keyPoints: [
            "Computed from POH chart inputs: pressure altitude, OAT, weight, headwind/tailwind, surface, slope.",
            "If accelerate-stop distance exceeds runway available, you have NO abort margin — engine failure on takeoff roll = unsurvivable on that runway.",
            "Add a personal-minimum buffer (commonly 10-25% margin) so you don't fly to the chart's edge.",
            "Factors that INCREASE accelerate-stop distance: high DA, high weight, tailwind, slope down (uphill to abort = longer roll-out), wet/grass surface.",
            "Factors that DECREASE: cool air, light weight, headwind, paved/dry, slight downhill in abort direction.",
            "Lubbock note: KLBB's 11,500 ft runway dwarfs typical PA-30 needs. F49's 4,600 ft is the constraint — math it carefully on warm afternoons at gross.",
            "On the checkride, the examiner wants to see you treating runway length as a calculation, not a feeling.",
          ],
          quiz: [
            { q: "Define accelerate-stop distance.", a: ["Distance from V1 to V2", "Runway length needed to accelerate to takeoff/decision speed, lose the critical engine, and stop on the remaining runway", "Single-engine landing distance", "Distance from rotation to clear of 50 ft obstacle"], correct: 1, explain: "Accel-stop = the runway length required to abort safely if the critical engine fails on the takeoff roll. The Raider definition." },
            { q: "Why is accelerate-stop the critical takeoff calculation in a twin?", a: ["FAA requires it", "It defines whether engine failure on the takeoff roll is survivable on the runway you have", "It determines fuel burn", "It sets approach speeds"], correct: 1, explain: "If accel-stop exceeds runway available, you can't abort safely. Below Vmc with one engine out, you can't fly out either. So you need accel-stop ≤ runway length minus your personal buffer to even commit to the takeoff." },
            { q: "Personal minimum on runway length for the PA-30 in your operations:", a: ["Always 5,000 ft", "Accelerate-stop distance + a safety buffer (commonly 10-25%) per your CFI's guidance", "Whatever the runway is", "POH minimum exactly"], correct: 1, explain: "Accelerate-stop from POH plus a personal buffer. The exact buffer depends on your CFI's standard and your comfort level — but flying to the chart's edge leaves no margin for any unanticipated factor." },
            { q: "Which of these INCREASES accelerate-stop distance the most?", a: ["Cool morning, paved runway, headwind", "High DA + tailwind + grass surface + max gross weight", "Slight headwind, near-sea-level field", "Light weight, cool air"], correct: 1, explain: "All four factors stack: high DA (less acceleration), tailwind (need more runway to accelerate, less wind to slow), grass (more rolling resistance), gross weight (longer to accelerate AND longer to stop). Worst-case combo for accel-stop." },
            { q: "F49 (Slaton) runway is 4,600 ft. On an 85°F day at gross weight, accelerate-stop is approximately:", a: ["1,500 ft (always under runway)", "~3,800-4,000 ft (margin ~600-800 ft, tight but legal)", "8,000 ft (cannot operate)", "Not applicable"], correct: 1, explain: "Roughly 3,800-4,000 ft from typical PA-30 charts at ~5,500 ft DA, gross weight, no wind. That's tight against 4,600 ft of runway. Headwind helps; tailwind kills it." },
            { q: "If accelerate-stop > runway available, your decision is:", a: ["Try anyway", "Reduce weight (one less passenger or partial fuel) to bring accel-stop within runway, or wait for cooler temps, or scrub", "Take off with maximum power", "Take off and circle back if the engine fails"], correct: 1, explain: "Below Vmc you can't fly out, and above Vmc on the runway you can't stop in remaining runway. The fix: reduce a controllable variable — usually weight — until accel-stop is within runway minus margin. Or scrub." },
            { q: "Lubbock-specific: which Lubbock airport is most likely the binding constraint for accelerate-stop?", a: ["KLBB (11,500 ft runway dwarfs PA-30 needs)", "F49 Slaton (4,600 ft — the binding constraint on hot days at gross)", "Both equally", "Neither — runway never matters in Lubbock"], correct: 1, explain: "KLBB's 11,500 ft easily covers any PA-30 takeoff. F49's 4,600 ft is where you have to math out accel-stop on warm afternoons at gross weight. Examiner will probe this specifically." },
            { q: "What input from the POH chart gets you accel-stop distance?", a: ["Just runway length and OAT", "Pressure altitude, OAT, weight, headwind/tailwind, surface, slope (all the takeoff distance inputs)", "Just OAT", "Just weight"], correct: 1, explain: "Same input set as takeoff distance, but the chart returns accelerate-stop. POH PA-30 has a dedicated accelerate-stop chart. Read inputs carefully." },
            { q: "If you compute accel-stop = 4,500 ft on a 4,600 ft runway, your action:", a: ["Go", "Treat margin as inadequate (only 100 ft / 2%) — reduce weight or wait for cooler temps", "Add full power and rotate at Vmc", "Skip the calculation"], correct: 1, explain: "100 ft margin on 4,500 ft is ~2% — wildly inadequate. Personal minimums (commonly 10-25%) would require 4,950-5,625 ft. Reduce weight or scrub." },
            { q: "Examiner asks 'How does runway slope affect accel-stop?' Best answer:", a: ["No effect", "Downhill takeoff direction = faster acceleration but longer roll-out for abort. Uphill takeoff = slower acceleration but shorter roll-out. Both need to be considered, slope is in the chart.", "Uphill always means abort", "Slope only matters at high DA"], correct: 1, explain: "Slope acts in opposite directions for takeoff and abort. Most POHs include a slope correction. The examiner wants you to understand the dual effect, not just blindly apply a number." },
          ],
        },
        {
          id: "abort-plan",
          title: "Before-Takeoff Abort Plan",
          raiderQuote: "Any engine failure on takeoff before rotation or before the gear is up: throttles to idle and stop or land straight ahead. An engine failure after the gear is in transit: maintain directional control, identify/verify/feather.",
          definition: "Every multi-engine takeoff requires committing to a specific decision before brake release. Three zones: (1) BEFORE rotation OR before gear is up → ABORT (throttles idle, stop or land straight ahead). (2) AFTER gear is up airborne → maintain control, identify/verify/feather. The gear-up callout is the practical pivot.",
          keyPoints: [
            "**Brief the abort BEFORE brake release**, every takeoff. 'If anything happens before rotation or gear up, throttles idle, stop or land straight ahead. Past gear up, climb at blue line, identify-verify-feather, return.'",
            "**Below rotation / gear in transit / runway remaining → ABORT.** No exceptions, no negotiation. Throttles idle, max braking, maintain centerline.",
            "**Airborne, no usable runway → fly the aircraft.** Pitch blue line (Vyse), rudder, ~2° bank toward live engine. THEN identify, verify, feather, secure, declare, return.",
            "Below Vmc you cannot fly out. Doesn't matter how much runway is ahead of you airborne — if you're below Vmc with one engine at takeoff power, you're going down.",
            "Once airborne with the gear up and no runway remaining, the runway BEHIND you is unusable — terrain, trees, distance prevent it.",
            "Examiner wants to hear this brief before taxi for departure. Brief out loud, every time. It commits you to the right action and signals to the examiner you're disciplined.",
          ],
          quiz: [
            { q: "Engine fails BEFORE rotation, runway remaining. Action?", a: ["Continue takeoff", "Abort: throttles idle, max braking, maintain centerline", "Climb out single-engine", "Bank toward dead engine"], correct: 1, explain: "Below rotation = below Vmc + still on the ground. ABORT. Throttles idle, brakes, maintain directional control. Land straight ahead if you've already lifted off." },
            { q: "Engine fails AFTER rotation but BEFORE gear is up, with runway remaining. Action?", a: ["Climb out at Vyse", "Abort/land straight ahead — gear DOWN if not yet retracted, throttles idle, brake to stop", "Pitch up sharply", "Bank toward dead engine"], correct: 1, explain: "Per Raider's guidance: any failure before gear is up means abort/land. Use remaining runway. Don't try to fly out when you have a runway." },
            { q: "Engine fails AFTER gear retraction, no usable runway ahead. Action sequence?", a: ["Identify-Verify-Feather first, then control", "Maintain control (pitch Vyse, rudder, bank toward live engine), THEN identify-verify-feather, secure, declare, return", "Add full power and circle back", "Pitch up to clear obstacles"], correct: 1, explain: "AVIATE first. Always. Pitch blue line, manage yaw, ~2° bank toward operating engine. Configuration and identification come AFTER control is established. Skipping aviate = Vmc roll." },
            { q: "Why is the runway BEHIND you (after airborne) considered unusable?", a: ["FAA prohibits returning to runway", "Distance, terrain, and trees make it impractical to spiral back single-engine at low altitude — descent rate vs distance doesn't work", "It's reserved for incoming traffic", "Insurance regulations"], correct: 1, explain: "Once airborne and past the runway with gear up, attempting to return single-engine usually means a low-altitude turn that you can't complete safely. The 'impossible turn' problem is well-documented for singles and just as bad in twins single-engine. Land ahead or commit to single-engine departure." },
            { q: "When do you brief the abort plan?", a: ["Once a year during flight review", "Before brake release on EVERY takeoff", "Only on training flights", "Only at unfamiliar airports"], correct: 1, explain: "Every. Takeoff. Briefing the abort commits you to the correct action and prevents hesitation when seconds matter. Examiner expects to hear it." },
            { q: "Engine fails 5 mph BELOW Vmc with 5,000 ft of runway ahead. Action?", a: ["Continue, climb out single-engine", "Abort — throttles idle, max braking", "Add full power on operating engine and lift off", "Pull mixtures to idle"], correct: 1, explain: "Below Vmc, no amount of runway ahead changes the fact that you cannot fly with one engine at takeoff power. ABORT. The runway is your friend on the ground; airborne below Vmc, runway is irrelevant." },
            { q: "Engine fails 10 mph ABOVE Vmc with 2,000 ft runway remaining. Best action?", a: ["Climb out, declare, return", "Land straight ahead — runway remaining is your safety net", "Increase power on the operating engine", "Bank away from dead engine"], correct: 1, explain: "Above Vmc + runway remaining = LAND. Don't try to fly out of a problem when there's runway to land on. Examiner wants to hear this exact reasoning." },
            { q: "After brake release, your mental model becomes:", a: ["'I'm committed to taking off no matter what'", "'Below rotation/gear-up: abort. Above gear-up no runway: control first, then IVF.'", "'Whatever feels right'", "'Just rotate at the right speed'"], correct: 1, explain: "Two clear decision zones with explicit actions. The brief commits you. Anything ambiguous or improvised in this phase = bad outcome. Discipline = practiced abort decision." },
            { q: "Why is 'maintain directional control' the FIRST action airborne after engine failure?", a: ["Because the checklist says so", "Because below Vmc you cannot fly — losing control = Vmc roll. You must establish/maintain control before doing anything else.", "Because it sounds professional", "Because ATC requires it"], correct: 1, explain: "Aviate is first because losing control kills you instantly. Identify, verify, feather all happen AFTER you've established positive control with rudder, blue line pitch, and bank toward the live engine." },
            { q: "Pre-takeoff brief contents (minimum):", a: ["Runway and weather only", "Runway, abort logic (below rotation/gear in transit = abort; airborne no runway = blue line + IVF), departure plan", "Just the runway number", "Just the V-speeds"], correct: 1, explain: "Brief commits you to actions before you're under stress. Cover the abort logic explicitly so the decision is pre-made when (not if) something happens." },
          ],
        },
        {
          id: "engine-failure-drill",
          title: "Engine Failure Drill (Raider 8-Step Flow)",
          raiderQuote: "Reduce angle of attack. Maintain directional control - set zero sideslip. Mixtures as required. Props forward. Throttles forward. Gear up - flaps up. Identify - verify. 3000' AGL - Fix or feather: Fix - get the checklist out and troubleshoot if you are above 3000' AGL. Feather - bring the correct prop control all the way back to feather if you are below 3000' AGL.",
          definition: "Raider's 8-step flow for any in-flight engine failure. Memorize the EXACT order. Each step is sequenced for a reason: aviate before identify, configure before feather, fix or feather decided by altitude.",
          keyPoints: [
            "**1. Reduce angle of attack** — pitch for blue line (Vyse), trade altitude for airspeed if needed.",
            "**2. Maintain directional control — set zero sideslip** (½ ball + ~2° bank toward live engine, not centered).",
            "**3. Mixtures as required** — typically forward to rich (best power), unless POH says otherwise.",
            "**4. Props forward** — both prop controls forward (high RPM available on the live engine; dead engine doesn't matter yet because not feathered).",
            "**5. Throttles forward** — both throttles forward to max climb power.",
            "**6. Gear up, flaps up** — clean up drag.",
            "**7. Identify – verify** — DEAD FOOT, DEAD ENGINE (the foot you're not pressing rudder against = the side that failed). Then VERIFY by slowly pulling the suspected dead throttle back. If yaw doesn't change, you've got the right one.",
            "**8. 3,000 ft AGL — fix or feather:** ABOVE 3,000 ft AGL, troubleshoot first (get the checklist out, try restart). BELOW 3,000 ft AGL, feather the dead engine immediately — no time for troubleshooting.",
            "The exact order matters: control before configure, configure before identify, identify before feather. Skipping ahead can shut down the working engine.",
          ],
          quiz: [
            { q: "Step 1 of Raider's engine failure drill:", a: ["Identify the dead engine", "Reduce angle of attack (pitch for blue line)", "Feather immediately", "Add full power"], correct: 1, explain: "Reduce AOA first. Pitch for blue line / Vyse to maintain controllable airspeed. AVIATE before everything else." },
            { q: "Step 2 of Raider's drill:", a: ["Pull the dead-side mixture", "Maintain directional control — set zero sideslip (½ ball, ~2° bank toward live engine)", "Verify before identify", "Feather"], correct: 1, explain: "Establish zero sideslip immediately after pitching for Vyse. Half ball deflection toward operating engine, up to 5° bank (typically ~2°). Wings level + ball centered is WRONG and reduces climb." },
            { q: "Correct order of steps 3-6 (configure):", a: ["Throttles, mixtures, props, gear/flaps", "Mixtures, props, throttles, gear up/flaps up", "Gear up, mixtures, throttles, props", "Flaps, gear, mixtures, throttles"], correct: 1, explain: "Mixtures forward → props forward → throttles forward → gear up, flaps up. The 'forward' sequence (mixtures, props, throttles) is muscle memory. Then clean up drag (gear, flaps)." },
            { q: "Step 7 (identify-verify): how do you identify the dead engine?", a: ["Look at the engine instruments", "Dead foot = dead engine: the foot you're NOT pressing rudder with identifies the failed side", "Listen for which engine is quieter", "Check the EGT"], correct: 1, explain: "Dead foot, dead engine. The asymmetric thrust pushes you toward the failed side; you instinctively press the OPPOSITE rudder. The foot you're NOT pressing = the dead side. Fast and reliable." },
            { q: "After identifying with dead-foot rule, how do you VERIFY?", a: ["Just feather based on identification", "Slowly retard the throttle on the suspected dead side. If yaw doesn't change, you've got it right. If yaw worsens, you grabbed the WORKING engine — push that throttle forward.", "Look at the manifold pressure gauges", "Pull the dead-side mixture"], correct: 1, explain: "Verify before feather. Slowly retard the suspected dead throttle. No yaw change = correct identification (already dead). Yaw worsens = you grabbed the LIVE engine; push it back forward immediately. Verify prevents shutting down the working engine." },
            { q: "At 5,000 ft AGL, engine fails. Per Raider's drill: fix or feather?", a: ["Feather immediately", "FIX — above 3,000 ft AGL, get the checklist out and troubleshoot (try fuel selector, mixture, mags, restart)", "Land immediately", "Cycle the prop"], correct: 1, explain: "Above 3,000 ft AGL you have time to troubleshoot. Common fixes: wrong fuel tank selector, mixture too lean, primer left out, magneto issue. Try them before committing to feather, which is irreversible without electrical assist (and often impossible to unfeather without gear-driven oil pressure)." },
            { q: "At 1,500 ft AGL, engine fails. Per Raider's drill: fix or feather?", a: ["Try to fix first (use checklist)", "FEATHER — below 3,000 ft AGL there's no time for troubleshooting. Feather the correct prop and secure.", "Land immediately without feathering", "Add power on the dead engine"], correct: 1, explain: "Below 3,000 ft AGL feather immediately after IDENTIFY-VERIFY. Drag from windmilling prop is enormous; you don't have altitude/time to troubleshoot. Feather buys back climb performance and lowers Vmc — buys you time to handle the rest." },
            { q: "Why does the drill have you do CONFIGURE (mixtures-props-throttles-gear-flaps) BEFORE identify-verify?", a: ["No reason — could be reversed", "Gives you maximum performance from the live engine and reduces drag while you take the second to identify the dead one. Saves altitude during identification.", "FAA requirement", "Cosmetic"], correct: 1, explain: "Configure first puts the LIVE engine at max power and cleans up drag. That preserves altitude/airspeed during the brief moments you spend identifying and verifying. Skipping configure first = bleeding altitude unnecessarily." },
            { q: "What's the danger of feathering BEFORE verifying?", a: ["No danger", "You might feather the WORKING engine. If you misidentified and shut down the live one, you have no power at all and you're now a glider.", "Just slows you down", "Only matters above 5,000 ft"], correct: 1, explain: "Verify is the safety check before feathering. Misidentification + immediate feather = shut down the only working engine. Industry-known fatal accident pattern. Always verify with throttle pull first." },
            { q: "Memorize Raider's exact order: which sequence is correct?", a: ["Reduce AOA → Mixtures → Props → Throttles → Identify → Verify → Feather", "Reduce AOA → Zero sideslip → Mixtures → Props → Throttles → Gear/flaps up → Identify-Verify → Fix or feather", "Identify → Verify → Feather → Configure → Aviate", "Aviate → Identify → Feather → Configure"], correct: 1, explain: "AOA → zero sideslip → forward (mixtures, props, throttles) → up (gear, flaps) → identify-verify → fix-or-feather. 8 steps in this exact order. The examiner may quiz you on the order specifically." },
            { q: "After feathering, the next checklist phase is:", a: ["Land at the nearest airport — no further checks", "Secure the dead engine (mixture cutoff, mags off, fuel selector off, alt/pump off on dead side), declare emergency, divert to nearest suitable airport", "Try to restart immediately", "Climb to cruise altitude"], correct: 1, explain: "After feather: SECURE the dead engine (prevents fuel/electrical issues), declare emergency to ATC, divert to nearest SUITABLE airport. The Raider drill ends at feather; SECURE is the immediate follow-on." },
          ],
        },
        {
          id: "zero-sideslip",
          title: "Zero Sideslip & Maneuvering OEI",
          raiderQuote: "Half ball deflection towards the operating engine. Up to 5 degrees of bank towards the operating engine (raise the dead). Be able to explain what zero sideslip does and why we use it in OEI situations. When is it OK to make turns into the dead engine?",
          definition: "Zero sideslip is the bank/rudder configuration where the airplane's relative wind is parallel to its longitudinal axis — minimum drag. With one engine inoperative, this means: ½ ball deflected TOWARD the operating engine, ~2-5° bank TOWARD the operating engine (raise the dead). Single-engine performance roughly DOUBLES vs wings-level ball-centered.",
          keyPoints: [
            "**Setup:** ½ ball toward the live engine (NOT centered), ~2° bank (max 5°) toward the live engine.",
            "**'Raise the dead' memory aid:** the dead engine's wing wants to drop (loss of lift, asymmetric drag). Raise it = bank toward the live engine.",
            "**Why it works:** banking toward the live engine produces a horizontal lift component that opposes the asymmetric-thrust yaw → less rudder needed → less rudder-induced drag.",
            "**Performance gain:** zero sideslip can roughly DOUBLE single-engine climb rate vs wings-level + ball-centered. Huge difference for survival.",
            "**Vmc effect:** zero sideslip also LOWERS actual Vmc — the bank's horizontal lift contribution is the entire reason cert allows up to 5° bank.",
            "**Turns into the dead engine:** generally avoid at low altitude (Vmc considerations + asymmetric drag during turn). OK at altitude with Vyse + margin — you're not bank-limited, just careful about coordination.",
            "Wings-level + ball-centered after engine failure is a CLASSIC ROOKIE ERROR — feels coordinated, actually generates max sideslip drag.",
          ],
          quiz: [
            { q: "Zero sideslip with one engine out: where's the ball?", a: ["Perfectly centered", "Half ball deflected toward the OPERATING engine", "Half ball deflected toward the dead engine", "Fully deflected toward operating engine"], correct: 1, explain: "Half ball toward the operating (live) engine. NOT centered — that's the trap. The ball gives you a precise reference for zero sideslip." },
            { q: "Zero sideslip bank angle:", a: ["0° (wings level)", "About 2° toward the operating engine (up to 5° max)", "5° toward the dead engine", "Whatever feels right"], correct: 1, explain: "Approximately 2° toward the live engine, with 5° as the max allowed in cert standards. Small but critical." },
            { q: "Mnemonic 'raise the dead' means:", a: ["Restart the failed engine", "Raise the wing on the DEAD-engine side, which means banking TOWARD the live (operating) engine", "Pitch the nose up", "Restart radio communications"], correct: 1, explain: "Raise the dead (engine's) wing. The dead engine's wing wants to drop — lift it by banking toward the live side. Same as 'bank toward the live engine.'" },
            { q: "Performance benefit of zero sideslip vs wings-level/ball-centered:", a: ["Same — just more comfortable", "Roughly DOUBLES single-engine climb rate (less drag from sideslip)", "10% improvement", "Only matters at high altitude"], correct: 1, explain: "Wings level + ball centered with one engine out = maximum sideslip = maximum drag. Zero sideslip eliminates that drag. Climb rate roughly doubles — life-or-death difference at high DA." },
            { q: "Why does zero sideslip also LOWER Vmc?", a: ["It doesn't", "The bank toward the live engine produces a horizontal lift component that helps counter the asymmetric-thrust yaw — less rudder needed = lower Vmc", "Magic", "Reduced parasite drag"], correct: 1, explain: "Banking toward the live engine: lift has a horizontal component pulling toward the live side. That horizontal component opposes the asymmetric yaw caused by the dead engine. Less rudder force needed = lower Vmc." },
            { q: "Wings-level + ball-centered after engine failure is:", a: ["The correct configuration", "A common rookie error — looks coordinated but is actually maximum sideslip = maximum drag", "Required by FAA", "Best for stability"], correct: 1, explain: "Classic rookie trap. Centered ball is what you train for in normal flight, but with one engine out it produces sideslip — the airplane is flying sideways through the air. Half-ball-toward-live-engine is correct." },
            { q: "When are turns INTO the dead engine acceptable?", a: ["Never", "Generally avoided at low altitude/low airspeed (Vmc considerations); acceptable at higher altitude with adequate Vyse margin and careful coordination — required for some procedures (e.g., circle-to-land)", "Always required", "Only above 10,000 ft"], correct: 1, explain: "At altitude with airspeed margin, turns into the dead engine are routine — just watch coordination and don't reduce airspeed. At low altitude with engine failure threat, avoid turns toward the dead engine because they aggravate the yaw." },
            { q: "After identify-verify-feather, your maneuvering technique is:", a: ["Wings level, ball centered, fly to airport", "Establish and HOLD zero sideslip (½ ball toward live, ~2° bank toward live), maintain Vyse, fly to nearest suitable airport", "Bank away from dead engine for visibility", "No special technique needed"], correct: 1, explain: "Hold zero sideslip throughout. Any deviation back toward 'feels coordinated' wings-level instantly costs you climb performance. Train this as muscle memory." },
            { q: "Bank TOWARD the dead engine after engine failure:", a: ["Recommended for visibility", "WORST option — adds horizontal lift in the SAME direction as the asymmetric yaw, raises Vmc, kills climb", "Same as bank toward live engine", "Used for landing"], correct: 1, explain: "Banking toward the dead engine creates a horizontal lift component that AUGMENTS the asymmetric yaw rather than opposing it. Raises Vmc significantly. Recipe for loss of control. Never do this." },
            { q: "Zero sideslip works AT ANY weight, AT ANY altitude. The principle is:", a: ["Only works at sea level", "Generic — bank toward the live engine puts horizontal lift opposing asymmetric yaw, regardless of altitude or weight", "Only works at gross weight", "Only works at high DA"], correct: 1, explain: "The physics applies at every weight and altitude. The exact angle (~2°) may vary slightly by aircraft, but the principle is universal. Bank toward live + ½ ball toward live = least drag, lowest Vmc, best climb." },
          ],
        },
      ],
    },
    {
      id: "pa30-systems",
      label: "PA-30 SYSTEMS",
      blurb: "Systems coverage from Raider PDF page 2. The DPE will ask about these.",
      topics: [
        {
          id: "landing-gear",
          title: "Landing Gear",
          raiderQuote: "Know how the gear works, what to do if it doesn't extend, and the speed limitations.",
          definition: "PA-30 has electric-hydraulic retractable landing gear. Hydraulic pressure (driven by an electric pump) actuates extension and retraction. Emergency manual extension is via a hand pump or mechanical release per POH.",
          keyPoints: [
            "**Vlo (max gear OPERATING speed) = 150 mph** — never EXTEND or RETRACT above this.",
            "**Vle (max gear EXTENDED speed) = 150 mph** — never FLY with gear down above this. (Same number on most PA-30s; verify in this aircraft's POH.)",
            "**Three green lights** — confirms gear down and locked. NO GREEN = NO LANDING. Use emergency extension.",
            "**Gear warning horn** — sounds when throttle is reduced below a threshold with gear up (often ~12-14 inches MP) — alerts you that you're in approach config without gear.",
            "**Emergency extension procedure (per POH):** verify gear circuit breaker IN, attempt normal extension, then use the hand pump or mechanical release per POH. Maintain Vle margin.",
            "**Gear won't retract on takeoff:** likely a microswitch issue, hydraulic pump failure, or squat-switch (weight-on-wheels) not seeing transition. Continue at reduced speed below Vle, troubleshoot, return for landing.",
          ],
          quiz: [
            { q: "PA-30's Vle (max gear extended speed) is:", a: ["100 mph", "125 mph", "150 mph", "175 mph"], correct: 2, explain: "Vle = 150 mph. Don't fly with gear down above this. Same number as Vlo on PA-30 (max gear OPERATING). Verify in this aircraft's POH." },
            { q: "Three green lights tell you:", a: ["The engines are running", "All three landing gear are DOWN and LOCKED", "The autopilot is engaged", "The transponder is squawking"], correct: 1, explain: "Each gear has a position-indicator microswitch. All three green = all three down and locked. Critical pre-landing check: 'Gear down, three green.'" },
            { q: "If you don't see three green on short final, your action is:", a: ["Land anyway", "Go around — verify gear circuit breaker, try normal extension again, use emergency extension procedure if needed", "Add full power and circle indefinitely", "Tap the gauge"], correct: 1, explain: "NO GREEN = NO LANDING. Go around at safe altitude, troubleshoot. PA-30 has manual emergency extension — typically a hand pump or mechanical release per POH. Verify CB, retry, then use emergency procedure." },
            { q: "Gear warning horn sounds when:", a: ["Throttle is reduced below approximately 12-14 inches MP with gear UP — alerts you to gear-up approach", "Mixture is set to lean", "ATC commands it", "Master switch is on"], correct: 0, explain: "Throttle threshold + gear-up condition = horn. Designed to catch the 'forgot gear' approach. If you hear it, lower the gear — or if intentional (low-pass etc.), expect the horn." },
            { q: "Maximum airspeed for raising the gear (Vlo)?", a: ["100 mph", "125 mph", "150 mph", "Same as Vne"], correct: 2, explain: "Vlo on PA-30 = 150 mph. Don't operate the gear above this. (Same as Vle on most PA-30s; some POHs differentiate. Always verify.)" },
            { q: "If gear won't retract after positive rate on takeoff:", a: ["Force the lever harder", "Continue at reduced airspeed below Vle, troubleshoot — likely microswitch, hydraulic pump, or squat-switch issue, return for landing", "Climb to high altitude before troubleshooting", "Cycle the master switch"], correct: 1, explain: "Don't exceed Vle with gear extended. Climb at reduced airspeed, troubleshoot calmly: gear circuit breaker, position indicator microswitches, possible hydraulic pump failure. Plan a return for landing — running cross-country with gear down is a fuel/airspeed disaster." },
            { q: "Emergency manual gear extension typically requires:", a: ["Just leaving the gear handle down", "Following the POH procedure: typically pull a release handle and/or use a hand pump to manually drive hydraulic pressure", "Pulling the master switch", "Calling ATC"], correct: 1, explain: "PA-30 has a manual extension procedure per POH — usually involving a release lever and/or hand pump. Practice this procedure mentally. Examiner will ask you to walk through it." },
            { q: "What single component drives the normal gear extension/retraction?", a: ["Pure mechanical linkage", "An electric-driven hydraulic pump (with backup gravity assist for emergency extension)", "Compressed air", "Cable-and-pulley system"], correct: 1, explain: "Electric-hydraulic. Electric pump pressurizes hydraulic fluid which drives the gear actuators. Emergency extension uses a manual pump and/or gravity (gear free-falls into down position with manual unlock)." },
            { q: "After landing rollout on a short-field, the action is:", a: ["Retract gear handle to clean up", "Retract FLAPS (verify gear handle visually) — never reach for gear handle on rollout", "Pull mixture to idle cutoff", "Apply takeoff power for go-around"], correct: 1, explain: "Reaching for gear handle on rollout is how pilots collapse gear on the runway. Verify visually you're touching the FLAP handle. Flaps come up to transfer weight to wheels for braking. Gear handle stays put." },
            { q: "If the gear position-indicator lights are extinguished but the gear feels solid down on touchdown, what's the likely issue?", a: ["The gear is up", "Microswitch or indicator-light failure (the gear itself is down) — verify with mirror check or low pass with tower observer if available", "Hydraulic failure", "Battery dead"], correct: 1, explain: "Light failure ≠ gear failure. Common scenario: bulb out, microswitch out of adjustment, or wiring issue. Confirmation methods: mirror, tower fly-by, partial extension test. Brief the field; some airports have tower visual confirmation services." },
          ],
        },
        {
          id: "fuel-system",
          title: "Fuel System & Cross-Feed",
          raiderQuote: "Know your tanks, when you can use them, and how cross-feed works.",
          definition: "PA-30 has 4 fuel tanks: L MAIN, R MAIN, L AUX, R AUX. Each engine normally feeds from its same-side main. Cross-feed allows feeding either engine from the OPPOSITE side's tanks — primary use is balancing fuel after engine failure. Aux tanks are restricted to LEVEL CRUISE only per POH.",
          keyPoints: [
            "**4 tanks: L MAIN / R MAIN / L AUX / R AUX.** Selectors are on the floor between the seats (typical PA-30).",
            "**Mains feed each engine on takeoff, climb, descent, landing.** Standard normal-ops position.",
            "**Aux tanks: level cruise only.** Per POH — not for takeoff, landing, or single-engine ops. Geometry of pickup tubes doesn't work in high pitch attitudes or banked flight.",
            "**Cross-feed:** allows the LEFT engine to feed from the RIGHT side's tanks (or vice versa). Used after engine failure to consume fuel from the dead-side tanks via the live engine.",
            "**Boost pumps:** electric pumps assist during start, takeoff, landing, fuel-tank changes, and per POH for engine-failure scenarios. Position depends on phase of flight.",
            "**Fuel pressure indications:** monitor on the engine cluster. Sudden drop on one engine = check fuel selector first (wrong tank?), then boost pump, then engine-driven pump.",
            "**Restart troubleshooting:** wrong fuel selector position is a top reason for engine 'failure.' Always verify selector before declaring the engine actually failed.",
          ],
          quiz: [
            { q: "How many fuel tanks does the PA-30 have?", a: ["2 (one per engine)", "4 (L MAIN, R MAIN, L AUX, R AUX)", "6", "1 large tank"], correct: 1, explain: "Four tanks: each engine has a main and an aux on its side. Selectors typically on the floor between the seats." },
            { q: "Aux tank usage limitation per POH?", a: ["No limitation", "LEVEL CRUISE only — NOT for takeoff, landing, or single-engine operation", "Above 5,000 ft only", "First 30 minutes of flight only"], correct: 1, explain: "Aux pickup tubes don't work in high pitch attitudes (takeoff/climb), banked flight, or single-engine ops. Cruise level flight only. Verify exact wording in this aircraft's POH." },
            { q: "Primary purpose of cross-feed?", a: ["Increase total fuel burn", "After engine failure, feed the operating engine from the dead-side fuel — balances fuel and uses fuel that would otherwise be stranded", "Required during start", "Increases endurance dramatically"], correct: 1, explain: "Cross-feed lets the live engine consume fuel from the dead-side tanks. Without it, fuel on the dead side would be unusable. Critical for long single-engine flights to a divert airport." },
            { q: "On takeoff, the fuel selectors should be on:", a: ["L AUX and R AUX", "L MAIN and R MAIN", "Both on cross-feed", "OFF"], correct: 1, explain: "Mains for takeoff, landing, climb, descent — anywhere geometry of tank pickup matters. Aux is cruise-only." },
            { q: "Engine fails. You suspect fuel exhaustion. First troubleshooting step before declaring failure?", a: ["Feather immediately", "Verify fuel selector is on a tank with fuel — wrong selector position is a common cause", "Pull the mixture to idle cutoff", "Restart immediately"], correct: 1, explain: "Wrong selector position is one of the top reasons for engine 'failure' in flight. Above 3,000 ft AGL (per Raider's drill), check selector before committing to feather. Below 3,000 ft, feather first — but flagging selector error in your post-event review." },
            { q: "Boost pumps are typically ON during:", a: ["All phases of flight", "Start, takeoff, landing, fuel tank changes, and per POH for engine-failure procedures", "Cruise only", "Never"], correct: 1, explain: "Boost pumps assist when fuel pressure could be marginal: start (cold engine), takeoff and landing (high power demand), tank changes (avoid air bubble in line), engine failure (per POH)." },
            { q: "After engine failure, you want to use the dead-side fuel. Action?", a: ["Cross-feed the operating engine from the dead-side tanks", "Don't bother — the fuel is unusable", "Switch the dead engine to its own aux", "Pull all mixtures"], correct: 0, explain: "Cross-feed enables the live engine to consume the dead side's mains. Otherwise that fuel is lost. Important for long single-engine flights to divert." },
            { q: "Aux tank rule of thumb in PA-30:", a: ["Use aux first to balance load", "Use aux only in level cruise — switch back to mains for any takeoff, climb, descent, landing, or single-engine op", "Use aux only at altitude above 10,000 ft", "Aux is decorative"], correct: 1, explain: "Level cruise = aux usable. Anywhere else = mains. Selector discipline is examiner-watched. Wrong tank in critical phase = enrichment fault, possibly engine failure." },
            { q: "The fuel system selectors on a PA-30 are typically located:", a: ["On the panel above the throttle quadrant", "On the floor between the pilot and copilot seats", "In the baggage compartment", "In the engine nacelles"], correct: 1, explain: "Floor-mounted between the seats on most PA-30s. Easy reach but make sure your fuel-selector check is part of every cockpit flow." },
            { q: "If you switch to an aux tank in cruise and the engine begins to roughen 30 seconds later, the most likely cause is:", a: ["Engine failure", "Air in the line / aux tank pickup issue / contaminated aux fuel — switch back to main, monitor", "Pilot error in throttle setting", "Cross-feed left on"], correct: 1, explain: "Tank changes can introduce air bubbles or expose problems with the new tank (water, sediment). If issues develop after a tank change, switch back to a known-good tank, monitor for resolution. Don't trust the aux blindly." },
          ],
        },
        {
          id: "constant-speed-prop",
          title: "Constant-Speed Propeller",
          raiderQuote: "Know how the prop works, how feathering works, and what the prop check on runup verifies.",
          definition: "A constant-speed propeller maintains a chosen RPM by varying blade pitch via a governor. Increase MP without changing RPM by changing pitch (more bite when more power). For multi-engine: feathering allows the dead-engine prop to be aligned edge-into-relative-wind, eliminating ~80% of windmilling drag.",
          keyPoints: [
            "**Governor maintains RPM:** flyweights spin proportionally to RPM; centrifugal force balances against a control spring. Spring tension is set by the BLUE prop control. Governor varies blade pitch via oil pressure to keep flyweights in balance with spring → constant RPM.",
            "**Cruise: high pitch / low RPM.** Better fuel economy, less wear. Climb: low pitch / high RPM (more bite, more thrust at climb power).",
            "**Feathering mechanism:** counterweights and a spring drive the blades to FEATHER (edge-into-wind) when oil pressure is interrupted. Pulling the BLUE control fully aft beyond a detent commands feather. PHYSICS drives feather, not pilot strength.",
            "**Why oil-pressure works on counterweights:** governor oil pressure normally counters the springs/counterweights, holding blades in low pitch (high RPM). Loss of oil pressure (engine quit, governor fail) → counterweights/springs win → blades go to feather.",
            "**Unfeathering:** governor accumulator (some PA-30s have one) or starter cranking generates oil pressure to drive blades back to a workable pitch. Without an accumulator, restart in flight requires significant cranking.",
            "**Prop check on runup:** cycle each prop control toward low-RPM 2-3 times. WHY: circulates warm oil into the prop hub. Cold oil delays feather — sometimes by enough to matter in real engine failure.",
            "**Feather check on runup:** briefly pull each prop toward feather, observe RPM drop (~300 RPM decrease), return to normal. Confirms the feather mechanism works. DON'T go to full feather on the ground.",
          ],
          quiz: [
            { q: "Constant-speed propeller maintains RPM by:", a: ["Varying engine throttle", "Varying blade pitch via a governor (oil pressure adjusts blade angle to keep RPM constant for a given prop control setting)", "Varying mixture", "Cycling magnetos"], correct: 1, explain: "Governor uses oil pressure to vary blade pitch. Higher MP/airspeed = governor commands more pitch (more bite) to keep RPM at the set value." },
            { q: "If you reduce throttle in cruise without changing prop control, what happens?", a: ["RPM drops", "RPM stays the same; governor reduces blade pitch to maintain RPM with less power; MP drops", "Engine shuts down", "Prop feathers"], correct: 1, explain: "Constant-speed prop holds RPM. The governor responds by reducing blade pitch (less bite needed for the same RPM at lower power). MP drops because you closed the throttle." },
            { q: "Feathering on engine failure is driven by:", a: ["Pilot pulling the prop control aft", "Counterweights and a spring (mechanical) — pilot's prop-control lever just ALLOWS them to win when oil pressure goes away", "Electric motor", "Centrifugal force from prop rotation"], correct: 1, explain: "Springs and counterweights ALWAYS want to drive blades to feather. Normally, governor oil pressure overpowers them and holds low pitch (high RPM). When oil pressure goes away, springs/counterweights win — blades go to feather. Pilot's blue control commands the governor to ALLOW this transition." },
            { q: "Cruise prop setting on PA-30 typically:", a: ["Low pitch / high RPM", "High pitch / low RPM (better economy, less wear)", "Feathered", "Maximum reverse"], correct: 1, explain: "Cruise: high pitch (large blade angle, more bite per revolution) and low RPM. More efficient than running RPM higher than necessary. Climb is the opposite: low pitch + high RPM for max thrust." },
            { q: "Why do you cycle the prop controls during runup?", a: ["Test the magnetos", "Circulate WARM oil into the propeller hub — cold oil delays feathering in actual engine failure", "Lubricate the cabin heater", "Save fuel"], correct: 1, explain: "Cycling moves oil into the hub. Warm oil = quick feather response when needed. Cold oil = delayed feather = drag persists for longer = climb performance worse during the crucial first seconds of engine failure." },
            { q: "Feather check on runup involves:", a: ["Going to full feather and stopping the prop", "Briefly pulling the prop toward feather, observing the RPM drop, returning to normal — confirms the mechanism works without stopping the prop", "Just listening to the engine", "Checking blade pitch visually"], correct: 1, explain: "Brief move toward feather: RPM drops a few hundred. Confirms the feather mechanism works. Going to FULL feather on the ground would stop the prop, requiring starter to break free. Brief check only." },
            { q: "What physically aligns the blades when feathered?", a: ["Pilot strength via the prop control", "Counterweights and a spring drive blades to edge-into-wind (~80° pitch) when oil pressure is interrupted", "Hydraulic ram", "Electric motor"], correct: 1, explain: "Counterweights + spring = the feathering force. The pilot commands feather by pulling the blue control past a detent, which removes governor oil pressure resistance. Mechanical force does the work." },
            { q: "Approximate drag reduction from feathering vs windmilling?", a: ["10%", "About 80% — feathered prop has minimal drag; windmilling is enormous (more than gear-down)", "100% — no drag", "Negligible"], correct: 1, explain: "Windmilling drag is enormous, roughly equivalent to flat-paddle drag — more than gear extended. Feathering eliminates ~80% of that drag. Single-engine climb performance roughly returns to chart values; Vmc drops back toward published. Highest-leverage post-failure action." },
            { q: "Unfeathering in flight (after a precautionary feather, not an actual failure):", a: ["Easy — just push prop control forward", "Requires governor oil pressure restoration (cranking the engine via starter, or accumulator if equipped); without an accumulator can take significant time", "Always automatic", "Impossible"], correct: 1, explain: "To unfeather, you need oil pressure back on the governor. Some PA-30s have an accumulator (stores hydraulic pressure for restart help). Without one, you crank the engine via starter to spin the prop until it catches air, restart, and oil pressure builds. Time-consuming and stressful in flight." },
            { q: "If the BLUE prop control is full forward, you've commanded:", a: ["Feather", "Maximum RPM (low pitch — max governor oil pressure overcoming counterweights)", "Idle cutoff", "Mid-range RPM"], correct: 1, explain: "Forward = max RPM = low pitch. Governor oil pressure max-pushes against counterweights. Setting for takeoff and climb (max thrust available)." },
          ],
        },
        {
          id: "pitot-static",
          title: "Pitot-Static System & Errors",
          raiderQuote: "Know which instruments use which port, what happens when a port is blocked, and the alternate static source.",
          definition: "Three primary instruments use the pitot-static system: ASI (uses BOTH pitot ram-air pressure and static), Altimeter (uses ONLY static), VSI (uses ONLY static). Pitot or static blockage produces specific erroneous indications you must recognize and compensate for. Alternate static source is the panel-mounted backup.",
          keyPoints: [
            "**ASI uses BOTH:** pitot supplies ram (dynamic + static) air; static supplies static reference. ASI shows the difference (dynamic pressure) which is airspeed.",
            "**Altimeter uses ONLY static.** Pressure altitude = static pressure converted to altitude.",
            "**VSI uses ONLY static.** It compares current static pressure to a small calibrated leak; the rate of change = vertical speed.",
            "**Pitot blockage (e.g., bug or ice in pitot tube):** ASI behaves like an ALTIMETER. Climbs INCREASE indicated airspeed (lower static, but trapped pitot pressure stays same → larger differential). Descents DECREASE indicated airspeed.",
            "**Static blockage:** ASI reads LOW in climbs (rising true airspeed but trapped static pressure makes pitot side relatively smaller compared to ambient → differential too small) and HIGH in descents. Altimeter FREEZES at the altitude of blockage. VSI freezes at zero.",
            "**Alternate static source:** small panel valve. Opens to cabin static pressure. Cabin static is typically LOWER than ambient (Bernoulli effect over cabin). Result: ASI reads SLIGHTLY HIGHER than actual. Altimeter reads HIGHER than actual.",
            "**On the runup, briefly verify pitot heat works** (if equipped) — listen for current draw or feel pitot tube warm. Pitot heat is the primary defense against in-flight pitot icing.",
          ],
          quiz: [
            { q: "Which instruments use BOTH pitot and static?", a: ["Airspeed indicator only", "Airspeed indicator (uses both); altimeter and VSI use static only", "All three use both", "Only the altimeter"], correct: 1, explain: "ASI: pitot (ram + static) and static (reference) → differential = airspeed. Altimeter: static only. VSI: static only." },
            { q: "Pitot tube blockage. ASI behavior:", a: ["Reads correctly", "Behaves like an ALTIMETER: increases in climb, decreases in descent", "Reads zero", "Reads max"], correct: 1, explain: "Pitot blockage traps pressure in the pitot line. As you climb, ambient static drops, so the trapped pitot pressure now creates a LARGER differential vs static — indicated airspeed climbs (incorrectly). Reverse for descent." },
            { q: "Static port blockage. ASI behavior in a climb:", a: ["Reads correctly", "Reads LOW (trapped static pressure stays the same as you climb; pitot ram pressure drops with thinner air, so differential decreases incorrectly)", "Reads HIGH", "Reads zero"], correct: 1, explain: "Static blockage traps the static reference. As you climb, true outside static drops, but the static line stays at the blockage-altitude reading. Pitot pressure (ram + ambient static) drops. The differential the ASI sees is too small → indicated airspeed reads LOW. Reverse for descent." },
            { q: "Static blockage in a descent. ASI reads:", a: ["Correctly", "HIGH (trapped static pressure too low compared to actual; pitot pressure increases as you descend; differential too big)", "LOW", "Zero"], correct: 1, explain: "Reverse of climb. Trapped static is too low compared to actual ambient (which is higher at lower altitudes). Pitot side gets more ram pressure. Differential too big → ASI over-reads. Same trapped-air principle, opposite direction." },
            { q: "Static port blockage. Altimeter behavior:", a: ["Continues to indicate correctly", "FREEZES at the altitude of blockage", "Reads zero", "Reads max"], correct: 1, explain: "Altimeter is purely static-driven. Trapped static = trapped altitude reading. Frozen until you open the alternate static source." },
            { q: "Static port blockage. VSI behavior:", a: ["Reads correctly", "Reads zero (no rate of change in trapped static pressure)", "Reads max climb", "Reads max descent"], correct: 1, explain: "VSI shows rate of static-pressure change. Static is trapped → no change → VSI reads zero throughout the climb or descent." },
            { q: "Alternate static source effect on indicated airspeed?", a: ["No effect", "Slightly INCREASES indicated airspeed (cabin static is lower than ambient due to Bernoulli effect, making the differential larger)", "Decreases by 10 mph", "ASI reads zero"], correct: 1, explain: "Cabin static is typically slightly lower than ambient (airflow over the fuselage reduces cabin pressure). Pitot pressure measured against a slightly lower static reference → larger differential → slightly HIGHER indicated airspeed. The altimeter likewise reads slightly higher than actual." },
            { q: "When would you open the alternate static source?", a: ["Every flight", "Only when you suspect static port blockage (frozen altimeter, frozen VSI, ASI reading wrong)", "Above 10,000 ft", "Never"], correct: 1, explain: "Alternate static is for static blockage emergencies. If altimeter freezes or VSI reads zero in a climb/descent, open the alternate. Calibration error from cabin pressure is acceptable for the troubleshooting case." },
            { q: "Pitot heat is primarily for:", a: ["Cabin warmth", "Preventing ice from forming inside the pitot tube — primary defense against pitot-tube icing in flight", "Preventing engine icing", "Cosmetic"], correct: 1, explain: "Pitot tube exposed to outside air can ice over in icing conditions. Pitot heat melts/prevents ice. Required for IFR flight in icing conditions per 91.205. Verify on runup." },
            { q: "If you're in IMC and notice your altimeter has frozen but VSI continues to register changes, the likely issue is:", a: ["Static port blockage", "Pitot blockage (altimeter is static-only, so it shouldn't freeze if static works; but VSI likewise depends on static — this combination is anomalous)", "Both pitot and static blocked", "Loss of vacuum"], correct: 2, explain: "Both pitot and static problems cause specific patterns. Frozen altimeter + working VSI is anomalous because both are static-driven. More likely scenario: partial static blockage with intermittent flow. Consider alternate static + cross-check. The question highlights why understanding what each instrument uses matters for diagnosis." },
          ],
        },
        {
          id: "electrical",
          title: "Electrical System",
          raiderQuote: "Know your alternators, what's on each bus, and what to do if you lose one.",
          definition: "PA-30 has DUAL alternators (one driven by each engine), single battery, master switch, and per-engine alternator switches. Loss of one alternator: the other carries full load (consider load-shedding non-essentials). Loss of both: battery only, limited time, land soonest.",
          keyPoints: [
            "**14V DC system** (verify against POH — some PA-30s are 14V).",
            "**Dual alternators**, one per engine. Each with its own switch and indicator on the panel/CGR-30C.",
            "**Single battery** (typical), engine-cranking and emergency reservoir.",
            "**Master switch** controls battery + alternator field. Avionics master typically separate.",
            "**One alternator fails:** the other handles full electrical load. Consider load-shedding (non-essential lights, second COM, etc.) for safety margin and battery preservation.",
            "**Both alternators fail:** battery only. Limited time (~30 minutes of full panel before voltage drops). LAND ASAP at nearest suitable airport. Load-shed aggressively to extend battery.",
            "**Alternator failure annunciation:** typically an ammeter reading zero or a low-voltage warning. CGR-30C shows individual alternator output.",
            "**N1100L specifics:** dual G5s have internal battery backup (~4 hr) — they survive total electrical loss. GNS 430W and other panel mount avionics do NOT have battery backup.",
          ],
          quiz: [
            { q: "PA-30 electrical system voltage?", a: ["12V DC", "14V DC", "24V DC", "115V AC"], correct: 1, explain: "14V DC system on most PA-30s. Verify against this aircraft's POH — voltage matters for replacing components and understanding load capacity." },
            { q: "Number of alternators on a PA-30?", a: ["One (shared)", "Two (one per engine)", "Three", "None — magneto-only"], correct: 1, explain: "Dual alternators, one driven by each engine. Each has its own switch. Provides redundancy: lose one engine, you still have one alternator on the live engine." },
            { q: "If LEFT alternator fails in flight, your action?", a: ["Land immediately", "Continue using the right alternator (handles full load); consider load-shedding non-essentials; troubleshoot when convenient", "Pull all circuit breakers", "Shut down the right alternator"], correct: 1, explain: "One alternator can handle full electrical load. Continue safely. Load-shed non-essentials (extra lights, second radio, DME) to protect battery in case of second failure. Document and address on ground." },
            { q: "If BOTH alternators fail (rare), the immediate action is:", a: ["Continue to original destination", "Land at nearest suitable airport — battery alone gives ~30 min of full panel; load-shed aggressively", "Cycle the master switch", "Add full power"], correct: 1, explain: "Battery only. Time is short — turn off non-essentials immediately (one COM only, extinguish nav lights if VFR, transponder to standby for short stretches if not under ATC). Land soonest." },
            { q: "What does loss of vacuum cost you on N1100L (dual G5 panel)?", a: ["Both attitude indicators", "Loss of any vacuum-driven backup AI/DG IF installed; G5s are electric and unaffected — vacuum loss is annoying, not catastrophic in N1100L", "All instruments", "Engine instruments"], correct: 1, explain: "On N1100L: dual G5s are ELECTRIC with battery backup. Turn coordinator is electric. Vacuum loss only affects any vacuum-driven steam AI/DG (if still present as backup). Far less critical than in a vacuum-only panel." },
            { q: "Master switch position effect:", a: ["No effect on alternators", "Master ON enables battery and alternator field; OFF kills both", "Master only controls cabin lights", "Master only controls avionics"], correct: 1, explain: "Master switch energizes the battery contactor AND the alternator field circuit. Off = battery and alternators offline (engine still runs on its mags). Pre-flight master-off check confirms stall warning is INOP without master — that's why the placard." },
            { q: "Both alternator gauges read 0.0 amps in the parked photo of N1100L. What's the likely interpretation?", a: ["Catastrophic dual failure", "Engines are OFF (alternators only output when engines are running) — normal for parked condition", "Battery dead", "Master fuse blown"], correct: 1, explain: "Engines off = alternators not turning = no output. Both showing 0.0 with engines off is NORMAL. The N1100L cockpit photo shows this — examiner trick question to make sure you understand alternators only work when engines run." },
            { q: "G5 internal battery backup on N1100L provides approximately:", a: ["10 minutes", "~4 hours of attitude/HSI data after loss of all aircraft electrical power", "10 hours", "Indefinite — no battery limit"], correct: 1, explain: "G5 backup battery is rated ~4 hours. Critical for survival in dual-alternator failure scenarios — even after the aircraft battery dies and panel goes dark, your G5 attitude and HSI keep working long enough to land." },
            { q: "Load-shed priorities in dual-alternator failure (battery-only):", a: ["Keep everything on, you'll be fine", "Turn off non-essential: extra lights, second COM, DME, reduce transponder use; KEEP essential: G5s, GNS 430W (for nav), one COM", "Turn off the master switch", "Increase electrical loads"], correct: 1, explain: "Strict prioritization: keep nav (GNS 430W), one comm (talk to ATC), G5 attitude (fly the airplane). Shed lights, DME, second COM. Buys battery time for landing." },
            { q: "Why is the alternator FIELD circuit important?", a: ["It's not", "Alternators don't produce power without field current. Master switch controls field — without master, alternators are dead even if engines turn.", "It controls fuel flow", "It's only for night flight"], correct: 1, explain: "Modern alternators need DC field current to generate AC (which is then rectified to DC for the bus). Master switch energizes the field. No field = no output. That's why master-off kills all alternator output even with engines running." },
          ],
        },
        {
          id: "heater",
          title: "Combustion Heater",
          raiderQuote: "PA-30 has a Janitrol or similar combustion heater. Know how it works, the CO risk, and the operational limits.",
          definition: "PA-30 has a gasoline-burning combustion heater (Janitrol or South Wind type) drawing fuel from the airplane's fuel system. Provides cabin heat in flight. Fuel consumption is roughly 0.5-1 GPH while operating. Over-temperature switch shuts it off automatically. CO awareness is critical.",
          keyPoints: [
            "**Combustion heater = burns gasoline** in a small combustion chamber to heat cabin air. Different from exhaust-shroud heaters used in many singles.",
            "**Fuel source:** drawn from the airplane's main fuel system. Adds to total fuel burn at ~0.5-1 GPH while running.",
            "**Operation:** typically a switch + thermostat. Igniter starts combustion; sustained operation requires fuel flow + ignition.",
            "**CO risk:** any combustion in close proximity to the cabin = CO leak risk. Carry a CO detector in the cockpit. CO is odorless, colorless, deadly. Headache + drowsiness = land immediately.",
            "**Overheat switch:** safety feature. If combustion chamber gets too hot, shuts off the heater automatically. Manual reset typically required.",
            "**Operational limits:** continuous-run limits per POH (often unlimited for cabin heat at altitude where ambient is cold; specific procedures for ground operation). Verify in this aircraft's POH.",
            "**If heater quits or smells off (smoke, fuel smell):** turn OFF immediately. Use cabin vents for fresh air. Open windows if necessary. Consider it an emergency if smoke or strong smells.",
            "**Pre-flight:** verify combustion heater fuel line integrity, no smell of fuel in cabin, drain checks.",
          ],
          quiz: [
            { q: "PA-30 cabin heater type?", a: ["Exhaust-shroud heater (heat from engine exhaust)", "Gasoline combustion heater (Janitrol or similar) — burns fuel from the airplane's fuel system", "Electric resistance heater", "Steam heater"], correct: 1, explain: "Combustion heater. Burns fuel in a dedicated combustion chamber to heat cabin air. Adds to fuel burn at roughly 0.5-1 GPH while operating." },
            { q: "Typical fuel consumption of the cabin heater while operating?", a: ["No fuel consumed", "About 0.5-1 GPH (small but not negligible on long flights)", "5 GPH", "10 GPH"], correct: 1, explain: "Roughly 0.5-1 GPH. Negligible for short flights, can matter on long cross-countries when planning fuel reserves." },
            { q: "Primary safety concern with combustion heaters?", a: ["Excess cabin heat", "CO (carbon monoxide) leak — odorless, colorless, deadly. Always carry a CO detector and recognize symptoms (headache, drowsiness, nausea)", "Excessive noise", "Fuel pressure surge"], correct: 1, explain: "Any combustion near the cabin = CO leak risk. CO is undetectable without a detector. Symptoms: headache, drowsiness, nausea, confusion. Carry a CO detector. If symptoms or alarm: heater OFF, vents OPEN, land soonest." },
            { q: "Overheat protection on a combustion heater:", a: ["None", "An overheat switch shuts off the heater automatically if combustion-chamber temperature exceeds a threshold; manual reset typically required", "The pilot must monitor temperature gauges constantly", "Ice crystals form to prevent overheat"], correct: 1, explain: "Overheat switch is the safety mechanism. If it triggers, heater shuts off; you typically need to cycle a switch or the system manually before it'll run again. Don't assume the heater is functional after an overheat event without troubleshooting." },
            { q: "If you smell fuel in the cabin during combustion-heater operation, your action?", a: ["Continue normally", "Heater OFF immediately. Vents open for fresh air. Treat as potentially serious — fuel leak in heater can mean fire risk. Land at nearest suitable airport.", "Increase heater output", "Cycle the heater on and off"], correct: 1, explain: "Fuel smell = potential fuel line leak in the heater system. Combustion chamber is hot. Risk of fire or explosion. Heater OFF, ventilate, treat as urgent — land soonest. Investigate on ground; do NOT troubleshoot in flight." },
            { q: "Symptoms of CO poisoning:", a: ["No symptoms — it's harmless", "Headache, drowsiness, nausea, confusion, eventually loss of consciousness", "Sneezing only", "Sharp pain"], correct: 1, explain: "Insidious progression: mild headache → drowsiness → confusion → unconsciousness → death. By the time you're confused you may not be able to make good decisions. Carry a CO detector." },
            { q: "What's the operational difference between a Janitrol-style combustion heater and an exhaust-shroud heater?", a: ["No difference", "Exhaust-shroud heater uses heat from engine exhaust gases (no extra fuel burn, but no heat with engine off and CO risk if exhaust system leaks). Combustion heater burns its own fuel (independent of engine, but adds fuel burn).", "Combustion heater is electric", "Exhaust-shroud heater requires no engines"], correct: 1, explain: "Singles often use exhaust-shroud heaters: free heat from engine exhaust, but tied to engine operation and dependent on exhaust system integrity (leak = CO into cabin). Combustion heaters in twins burn their own fuel and operate independently — different failure modes, different fuel costs." },
            { q: "Does the heater consume fuel from a specific tank?", a: ["No, it has its own fuel reservoir", "It draws from the airplane's main fuel system — counts toward total fuel consumption planning", "Only from aux tanks", "It uses oil instead of fuel"], correct: 1, explain: "Heater draws from the main fuel system. Plan fuel reserves accordingly on long, cold flights." },
            { q: "Pre-flight inspection of the heater system should include:", a: ["Just turning it on", "Checking for fuel leaks at heater fuel line/pump, no fuel smell in cabin, drain checks per POH, verify ducts and vents are clear", "Only ground operations", "Nothing — heaters are sealed"], correct: 1, explain: "Pre-flight: walk the heater area on the airframe, look for fuel leaks, check the heater drain (per POH), verify ducts/vents in the cabin are unobstructed, sniff for fuel smell. Catches leaks before they become in-flight emergencies." },
            { q: "If the heater quits in cruise on a cold day, your reaction:", a: ["Try to relight repeatedly until it works", "Heater off, cabin layered with extra clothing, plan a divert if cabin temp drops to safety-impacting levels (cold-fingers = poor flight controls)", "Land immediately", "Increase engine power for radiant heat"], correct: 1, explain: "Heater fails in cruise: don't attempt repeated relights (multiple ignition cycles increase fuel pooling/combustion-chamber risk). Bundle up, plan a divert if conditions deteriorate. Cold cockpit = degraded pilot performance — treat as a real factor in ADM." },
          ],
        },
      ],
    },
    {
      id: "scenarios",
      label: "CROSS-TOPIC SCENARIOS",
      blurb: "Applied integration — multi-step examiner-style scenarios.",
      topics: [
        {
          id: "hot-day-f49",
          title: "Hot Day at F49",
          raiderQuote: null,
          setup: "It's late May at F49 (Slaton). 2 PM local. OAT 92°F. Field elevation 3,124 ft. Runway 4,600 ft. Wind 180 at 18 kt. You're at gross weight (3,600 lbs). Your destination is KAUS (Austin), 4 hours away.",
          crossTopics: ["performance", "vmc-aerodynamics", "adm"],
          questions: [
            "Density altitude for these conditions?",
            "Single-engine climb rate at gross weight from the chart?",
            "What's accelerate-stop distance? Margin against runway available?",
            "Engine fails on takeoff roll at 60 mph — action?",
            "Engine fails airborne at 200 ft AGL with half the runway still ahead — action?",
            "Engine fails airborne at 1,000 ft AGL after liftoff with no runway remaining — action?",
            "Could you legally take off? Should you?",
          ],
        },
        {
          id: "ifr-engine-out",
          title: "IFR Engine-Out to Lubbock",
          raiderQuote: null,
          setup: "You're cruising at 8,000 ft IFR from Albuquerque to Lubbock. 50 NM west of KLBB, in IMC, the right engine starts running rough then loses oil pressure and seizes. Weather at KLBB: 600 OVC, 3 SM visibility, ILS 17R available.",
          crossTopics: ["vmc-aerodynamics", "ifr", "adm", "performance"],
          questions: [
            "Walk me through your procedure from the moment you notice the failure.",
            "Why right engine — was it the critical engine?",
            "What's your altitude after feather and zero sideslip established?",
            "How do you brief the ILS in this situation?",
            "On the approach, you're slightly above glidepath at the FAF but performance is degrading. What's your decision?",
            "If you go missed at minimums, what's your plan?",
          ],
        },
        {
          id: "passenger-emergency",
          title: "Passenger Medical Emergency",
          raiderQuote: null,
          setup: "You're VFR at 6,500 ft, 30 NM north of Lubbock, returning from a $300 hamburger trip with 2 passengers. Your front-seat passenger has a sudden severe chest pain and difficulty breathing.",
          crossTopics: ["adm", "regulations", "ifr"],
          questions: [
            "Walk me through your decision-making.",
            "What ATC service do you use, and what do you say?",
            "Emergency descent procedure?",
            "If KLBB has a 30 minute hold for arrivals due to weather, what do you do?",
            "Could you declare a medical emergency on flight following frequency, or do you need a different freq?",
          ],
        },
        {
          id: "thunderstorm-divert",
          title: "Thunderstorm Pop-Up",
          raiderQuote: null,
          setup: "VFR cross-country, 30 minutes from F49 (Slaton). You see a fast-developing line of thunderstorms 25 NM ahead, blocking your route. Forecast didn't call for them. Fuel: 1.5 hours.",
          crossTopics: ["weather", "adm"],
          questions: [
            "What's your first action?",
            "How far do you stay from a thunderstorm?",
            "What information do you need to make a divert decision?",
            "If conditions deteriorate to where you can't see ahead, options?",
          ],
        },
        {
          id: "checkride-day-discontinuance",
          title: "Checkride Day Decision",
          raiderQuote: null,
          setup: "You're on your checkride. Engine failure simulation goes well. You're on the single-engine ILS at KLBB. At 600 ft AGL (200 ft above DA), your simulated dead engine 'comes back' (instructor restoring power). You're slightly low on glidepath and 5 kt slow.",
          crossTopics: ["adm", "ifr"],
          questions: [
            "Continue the approach or go missed?",
            "If you continue and get back on glidepath by 200 ft AGL, is that a pass?",
            "What does the examiner look for in this exact situation?",
          ],
        },
      ],
    },
  ],
};

// ---------- QUICK REFERENCE ----------
const REFERENCE = {
  regulations: [
    { reg: "91.213", title: "Inoperative Equipment", note: "Three-step test: type cert/KOEL → 91.205 → MEL? If none required, deactivate + placard + logbook = okay" },
    { reg: "91.205", title: "Required Equipment", note: "VFR day: ATOMATOFLAMES. Add FLAPS for night. Add GRABCARDD for IFR." },
    { reg: "91.107", title: "Seatbelts", note: "Use during taxi, takeoff, landing. Each occupant in own seat." },
    { reg: "91.211", title: "Supplemental Oxygen", note: "Required: crew above 12,500-14,000 ft for 30+ min. All occupants above 14,000. All occupants above 15,000." },
    { reg: "91.151", title: "VFR Fuel Reserves", note: "Day: enough to destination + 30 min at normal cruise. Night: + 45 min." },
    { reg: "91.167", title: "IFR Fuel Reserves", note: "Destination + alternate (if required) + 45 min at normal cruise." },
    { reg: "91.169", title: "Alternate Required", note: "1-2-3 rule: from 1 hour before to 1 hour after ETA, ceiling at least 2,000 ft AGL and visibility at least 3 SM. If not, alternate required." },
    { reg: "61.31", title: "Type & Class Ratings", note: "Class rating add-on: training + endorsements + practical test. No new written required at same cert level." },
    { reg: "61.57", title: "Recent Flight Experience", note: "3 T/Os and landings in 90 days for passengers, in same category and class. Multi-engine separate from single." },
    { reg: "61.56", title: "Flight Review", note: "Every 24 calendar months, with a CFI. 1 hour ground + 1 hour flight." },
    { reg: "61.23", title: "Medical", note: "Class 3 valid 60 mo under age 40, 24 mo at 40+. BasicMed alternative for private privileges." },
    { reg: "91.17", title: "Alcohol & Drugs", note: "8 hours bottle to throttle. BAC below 0.04. No drugs that affect faculties." },
    { reg: "91.103", title: "Preflight Action", note: "Become familiar with all available info concerning the flight: NOTAMs, weather, fuel, alternates, performance." },
    { reg: "91.111", title: "Operating Near Other Aircraft", note: "Can't operate so close as to create collision hazard. Formation flight only by arrangement, never with passengers for hire." },
    { reg: "91.117", title: "Speed Limits", note: "Below 10,000 ft MSL: 250 kt indicated. Below 2,500 ft AGL within 4 NM of Class C/D: 200 kt indicated. Under shelf of B: 200 kt." },
    { reg: "91.119", title: "Minimum Safe Altitudes", note: "Anywhere: enough altitude to land safely. Congested area: 1,000 ft above highest obstacle within 2,000 ft. Other than congested: 500 ft AGL, 500 ft from any person/structure/vehicle/vessel." },
    { reg: "91.155", title: "VFR Cloud Clearance", note: "Class B: clear of clouds. Class C/D/E below 10,000: 500 below, 1,000 above, 2,000 horizontal, 3 SM viz. Class E at and above 10,000: 1,000/1,000/1 SM/5 SM viz. Class G varies by altitude/day-night." },
    { reg: "91.183", title: "IFR Position Reports", note: "Required reports: missed approach, leaving altitude, unable to climb 500 fpm, etc. Practice this list." },
  ],
  weightBalance: {
    procedure: "1. Look up empty weight + arm in W&B record (in aircraft documents). 2. Add pilot, passengers, baggage with their weights × arms = moments. 3. Add fuel (mains + aux) with its arm × weight = moment. 4. Sum all moments. 5. Total moment / total weight = CG location. 6. Compare CG to forward and aft limits at that weight from the CG envelope chart. CG must be within envelope at takeoff AND landing.",
    pa30typical: "PA-30 typical empty weight ~2,180 lbs. Max gross 3,600 lbs. Useful load ~1,420 lbs. Max takeoff and landing weight typically same. CG range narrow — load thoughtfully.",
    examinerWillAsk: [
      "Compute W&B for the day's flight (you and instructor + fuel)",
      "What's the most forward CG limit? Most aft?",
      "What happens if you load aft of CG aft limit? (loss of control authority, possible stall recovery problems)",
      "How does fuel burn affect CG during flight?",
    ],
  },
  emergencyMemoryItems: [
    { emergency: "Engine Failure on Takeoff (below Vmc)", items: ["Throttles — IDLE", "Brakes — MAXIMUM", "Maintain directional control"] },
    { emergency: "Engine Failure in Flight", items: ["Maintain control (pitch blue line, rudder, ~2° bank toward live)", "Mixtures/Props/Throttles — FORWARD", "Flaps/Gear — UP", "IDENTIFY (dead foot)", "VERIFY (slow throttle pull)", "FEATHER", "SECURE (mixture cutoff, mags off, fuel off, electrical off on dead side)"] },
    { emergency: "Engine Fire in Flight", items: ["Mixture — IDLE CUTOFF (affected engine)", "Fuel selector — OFF", "Mags — OFF", "Prop — FEATHER", "Cabin heat — OFF (if from affected engine)", "Land soonest"] },
    { emergency: "Cabin Fire", items: ["Cabin heat/vent — CLOSE", "Master switch — OFF (if electrical fire)", "Fire extinguisher — USE", "Land soonest", "If smoke continues: emergency descent"] },
    { emergency: "Electrical Fire", items: ["Master — OFF", "All switches — OFF", "Fire extinguisher", "Land soonest", "Once on ground: investigate"] },
    { emergency: "Gear Fails to Extend", items: ["Verify gear circuit breaker — IN", "Reset gear handle if applicable", "Emergency extension procedure per POH (manual hand-pump or mechanical release)", "If unable: prepare for gear-up landing — runway with foam if available, no flaps, off engines on touchdown to minimize fire risk"] },
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
              "**For deeper mastery:** open the dedicated **Vmc Mastery** tab from the header. 120 questions across 3 tiers — Foundations, Reasoning, and Examiner Mode — designed to develop transfer (the ability to handle unfamiliar phrasings of these concepts).",
            ],
            quiz: [
              { q: "Effect of HIGH DENSITY ALTITUDE on Vmc?", a: ["Vmc increases", "Vmc decreases (less power, less PAST)", "No effect", "Only changes with weight"], correct: 1, explain: "Less air = less power available from operating engine = less asymmetric thrust = less rudder needed. Vmc decreases. The trap: actual Vmc may drop below stall speed, so airplane stalls before losing directional control." },
              { q: "Effect of MAX GROSS WEIGHT on Vmc?", a: ["Vmc increases", "Vmc decreases (more inertia + horizontal lift when banked)", "No effect", "Doubles Vmc"], correct: 1, explain: "Heavier airplane = more inertia resisting yaw + larger horizontal lift component when banked toward operating engine. Both lower Vmc. But performance also tanks. Vmc and performance moving opposite directions on weight is a key examiner trap." },
              { q: "Effect of AFT CG on Vmc?", a: ["Vmc decreases", "Vmc increases (shorter rudder arm)", "No effect", "Same as forward CG"], correct: 1, explain: "Aft CG shortens the moment arm between CG and rudder. Less rudder authority for the same deflection. Need more airspeed to generate enough rudder force = higher Vmc." },
              { q: "Effect of BANK 5° TOWARD OPERATING ENGINE on Vmc?", a: ["Vmc increases", "Vmc decreases (horizontal lift component opposes yaw)", "No effect", "Only matters above 5,000 ft"], correct: 1, explain: "Banking creates a horizontal lift component that physically opposes the asymmetric yaw. Plus reduces sideslip drag. The ONE factor that helps both Vmc AND performance." },
              { q: "Vmc is marked on the airspeed indicator as a:", a: ["Blue radial line", "Red radial line", "Yellow arc", "White arc"], correct: 1, explain: "RED radial line. Mnemonic: Red = Dead (below Vmc with engine out, the airplane becomes uncontrollable). Blue = Best (Vyse, single-engine best rate of climb)." },
              { q: "P-A-S-T stands for:", a: ["P-factor, Asymmetric thrust, Slipstream, Torque", "P-factor, Accelerated slipstream, Spiraling slipstream, Torque", "Power, Airflow, Spin, Throttle", "Pitch, Angle, Speed, Trim"], correct: 1, explain: "The four left-yawing tendencies in any propeller airplane. In a twin, these are why the LEFT engine is critical and why operating engine power affects controllability." },
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
            summary: "Bridge — full content lives in the dedicated ORAL section.",
            teach: [
              "All oral exam content has been consolidated into the dedicated **ORAL** section in the header.",
              "Click the **ORAL** button at the top of the page for the full Raider Aviation-aligned curriculum: 9 core topics, 6 PA-30 systems topics, and cross-topic scenarios.",
              "The current section is preserved here only as a syllabus marker for Day 4 ground lesson sequencing.",
            ],
            quiz: [],
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

function Header({ progress, view, setView, userId, syncStatus, isOnline }) {
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

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className={`me-button ${view === "home" ? "active" : ""}`} onClick={() => setView("home")}>
              <ListChecks size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Syllabus
            </button>
            <button className={`me-button ${view === "aircraft" || view === "aircraftquiz" ? "active" : ""}`} onClick={() => setView("aircraft")}>
              <Plane size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />N1100L
            </button>
            <button className={`me-button cyan ${view === "vmctable" ? "active" : ""}`} onClick={() => setView("vmctable")}>
              <AlertTriangle size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Vmc Table
            </button>
            <button className={`me-button cyan ${view === "vmc-mastery" || view === "vmc-mastery-drill" ? "active" : ""}`} onClick={() => setView("vmc-mastery")}>
              <Award size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Vmc Mastery
            </button>
            <button className={`me-button ${view === "performance" || view === "performancequiz" ? "active" : ""}`} onClick={() => setView("performance")}>
              <BarChart3 size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Perf
            </button>
            <button className={`me-button cyan ${view === "maneuvers" || view === "maneuverquiz" ? "active" : ""}`} onClick={() => setView("maneuvers")}>
              <ClipboardCheck size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Maneuvers
            </button>
            <button className={`me-button cyan ${view === "oral" ? "active" : ""}`} onClick={() => setView("oral")}>
              <MessageSquare size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Oral
            </button>
            <button className={`me-button cyan ${view === "drillall" ? "active" : ""}`} onClick={() => setView("drillall")}>
              <Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Drill All
            </button>
            <button className={`me-button cyan ${view === "reference" ? "active" : ""}`} onClick={() => setView("reference")}>
              <FileText size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Reference
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, letterSpacing: "0.18em", color: TEXT_DIM, fontWeight: 700, alignSelf: "center" }}>OPERATIONAL</span>
            <button className={`me-button cyan ${view === "checklist" || view === "checklist-phase" ? "active" : ""}`} onClick={() => setView("checklist")}>
              <ListChecks size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Checklist
            </button>
            <button
              className="me-button"
              onClick={() => setView("emergency")}
              style={{
                color: RED,
                borderColor: RED,
                fontWeight: 700,
                background: (view === "emergency" || view === "emergency-procedure") ? "rgba(255,82,82,0.15)" : undefined,
              }}
            >
              <AlertOctagon size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Emergency
            </button>
            <button className={`me-button cyan ${view === "speeds" ? "active" : ""}`} onClick={() => setView("speeds")}>
              <Gauge size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Speeds
            </button>
          </div>
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 9, letterSpacing: "0.12em", color: TEXT_DIM, gap: 12, flexWrap: "wrap" }}>
        <span>YOUR URL: <span style={{ color: AMBER, fontFamily: "monospace" }}>me-study.vercel.app/u/{userId}</span></span>
        <span style={{ color: syncStatus === "offline" ? RED : syncStatus === "synced" ? "#40dc8c" : AMBER }}>
          {syncStatus === "loading" && "⟳ LOADING"}
          {syncStatus === "saving" && "⟳ SAVING…"}
          {syncStatus === "synced" && "✓ SYNCED"}
          {syncStatus === "offline" && "⚠ OFFLINE"}
        </span>
      </div>

      {!isOnline && (
        <div style={{
          background: 'rgba(255, 184, 74, 0.12)',
          border: '1px solid #ffb84a',
          borderLeft: '3px solid #ffb84a',
          padding: '6px 12px',
          marginTop: 8,
          fontSize: 10,
          letterSpacing: '0.12em',
          color: '#ffb84a',
          textAlign: 'center',
          fontFamily: 'inherit',
        }}>
          ⚠ OFFLINE — CHECKLISTS, EMERGENCY, SPEEDS, AND STUDY CONTENT AVAILABLE · CHANGES SYNC WHEN ONLINE
        </div>
      )}
    </div>
  );
}

function SpeedsView({ onBack }) {
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>SPEEDS</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 14, letterSpacing: "0.15em" }}>
        N1100L · PA-30 TWIN COMANCHE · KTS + MPH
      </div>
      <div style={{ fontSize: 12.5, color: TEXT_DIM, marginBottom: 20, lineHeight: 1.6, fontStyle: "italic" }}>
        {SPEEDS.intro}
      </div>

      {/* V-SPEEDS TABLE */}
      <div style={{ fontSize: 11, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 10 }}>V-SPEEDS</div>
      <div style={{ overflowX: "auto", marginBottom: 24 }}>
        <table className="me-table">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Code</th>
              <th>Definition</th>
              <th style={{ width: 70, textAlign: "center" }}>KTS</th>
              <th style={{ width: 70, textAlign: "center" }}>MPH</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {SPEEDS.vSpeeds.map((v, i) => {
              const accent = v.accent === "blue" ? "#4a9eff" : v.accent === "red" ? RED : "transparent";
              return (
                <tr key={i} style={{ borderLeft: v.accent ? `3px solid ${accent}` : undefined }}>
                  <td>
                    <span className="me-glow-amber" style={{ fontWeight: 700, fontSize: 13 }}>{v.code}</span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{v.label}</td>
                  <td style={{ textAlign: "center", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: v.accent === "blue" ? "#4a9eff" : v.accent === "red" ? RED : CYAN }}>{v.kts}</td>
                  <td style={{ textAlign: "center", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: TEXT }}>{v.mph}</td>
                  <td style={{ color: TEXT_DIM, fontSize: 11 }}>{v.note || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* DEPARTURE / CRUISE / ARRIVAL CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 22 }}>
        <SpeedsCard
          title="DEPARTURE"
          accent={CYAN}
          rows={SPEEDS.departure.map((d) => ({
            label: d.phase,
            primary: `${d.kts} kts / ${d.mph} mph`,
            secondary: `Flaps ${d.flaps}`,
          }))}
          notes={SPEEDS.departureNotes}
        />
        <SpeedsCard
          title="CRUISE"
          accent={AMBER}
          rows={SPEEDS.cruise.map((c) => ({
            label: c.mode,
            primary: `${c.kts} kts / ${c.mph} mph`,
            secondary: c.note,
          }))}
          notes={SPEEDS.cruiseNotes}
        />
        <SpeedsCard
          title="ARRIVAL"
          accent={"#4a9eff"}
          rows={SPEEDS.arrival.map((a) => ({
            label: a.phase,
            primary: `${a.kts} kts / ${a.mph} mph`,
            secondary: `Flaps ${a.flaps} · ${a.note}`,
          }))}
          notes={[]}
        />
      </div>

      {/* COUNTER-ROTATING NOTE */}
      <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${TEXT_DIM}`, borderRadius: "0 3px 3px 0", padding: "12px 14px", fontSize: 12.5, lineHeight: 1.6, color: TEXT_DIM }}>
        <span style={{ fontWeight: 700, color: TEXT, letterSpacing: "0.05em" }}>Counter-Rotating Variant: </span>
        Vmca = 70 KIAS / 80 MPH (PA-39 only — N1100L is a conventional twin, both props rotate clockwise from cockpit view).
      </div>
    </div>
  );
}

function SpeedsCard({ title, accent, rows, notes }) {
  return (
    <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${accent}`, borderRadius: "0 3px 3px 0", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.15em", color: accent, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ paddingTop: i === 0 ? 0 : 6, paddingBottom: 6, borderTop: i === 0 ? "none" : `1px dashed ${BORDER}` }}>
          <div style={{ fontSize: 12, color: TEXT_DIM, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>{r.label}</div>
          <div className="me-glow-amber" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700 }}>{r.primary}</div>
          {r.secondary && (
            <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 2, lineHeight: 1.45 }}>{r.secondary}</div>
          )}
        </div>
      ))}
      {notes && notes.length > 0 && (
        <div style={{ marginTop: 4, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
          {notes.map((n, i) => (
            <div key={i} style={{ fontSize: 10.5, color: TEXT_DIM, lineHeight: 1.5, marginBottom: i === notes.length - 1 ? 0 : 4, fontStyle: "italic" }}>
              {n}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistView({ onBack, checklistProgress, onSelectPhase }) {
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>CHECKLIST</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 14, letterSpacing: "0.15em" }}>
        PA-30 TWIN COMANCHE · 14 PHASES · TAP A PHASE TO BEGIN
      </div>
      <div style={{ fontSize: 12.5, color: TEXT_DIM, marginBottom: 20, lineHeight: 1.6, fontStyle: "italic" }}>
        {CHECKLIST.intro}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {CHECKLIST.phases.map((phase, idx) => {
          const progress = checklistProgress?.[phase.id] || {};
          const checks = progress.checks || {};
          const checkable = phase.items.filter((it) => !it.text.startsWith("—"));
          const checkedCount = checkable.filter((_, i) => {
            const realIdx = phase.items.indexOf(_);
            return checks[realIdx];
          }).length;
          const totalCheckable = checkable.length;
          const allDone = totalCheckable > 0 && checkedCount === totalCheckable;
          const lastCompleted = progress.lastCompletedAt;
          const accent = allDone ? "#40dc8c" : checkedCount > 0 ? AMBER : BORDER;
          return (
            <button
              key={phase.id}
              onClick={() => onSelectPhase(phase.id)}
              style={{
                background: PANEL_2,
                border: `1px solid ${BORDER}`,
                borderLeft: `4px solid ${accent}`,
                borderRadius: "0 3px 3px 0",
                padding: "14px 16px",
                cursor: "pointer",
                color: TEXT,
                fontFamily: "JetBrains Mono, monospace",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: "0.12em" }}>{String(idx + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 10, color: allDone ? "#40dc8c" : checkedCount > 0 ? AMBER : TEXT_DIM, letterSpacing: "0.1em", fontWeight: 700 }}>
                  {totalCheckable === 0 ? "" : `${checkedCount}/${totalCheckable}${allDone ? " ✓" : ""}`}
                </span>
              </div>
              <div className="me-glow-amber" style={{ fontWeight: 700, fontSize: 14 }}>{phase.label}</div>
              <div style={{ fontSize: 10.5, color: TEXT_DIM, lineHeight: 1.4 }}>
                {allDone && lastCompleted ? `Last completed: ${formatRelativeTime(lastCompleted)}` : checkedCount > 0 ? "In progress" : "Not started"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ChecklistPhaseView({ phaseId, checklistProgress, setChecklistProgress, onBack, onSelectPhase }) {
  const phase = CHECKLIST.phases.find((p) => p.id === phaseId);
  const [openTooltip, setOpenTooltip] = useState(null);
  if (!phase) return null;
  const progress = checklistProgress?.[phaseId] || {};
  const checks = progress.checks || {};
  const checkableItems = phase.items.filter((it) => !it.text.startsWith("—"));
  const checkableTotal = checkableItems.length;
  const checkedTotal = phase.items.filter((it, i) => !it.text.startsWith("—") && checks[i]).length;
  const allDone = checkableTotal > 0 && checkedTotal === checkableTotal;
  const nextPhase = phase.next ? CHECKLIST.phases.find((p) => p.id === phase.next) : null;

  function toggleItem(idx) {
    setChecklistProgress((prev) => {
      const cur = prev?.[phaseId] || { checks: {}, lastCompletedAt: null };
      const newChecks = { ...(cur.checks || {}) };
      if (newChecks[idx]) delete newChecks[idx];
      else newChecks[idx] = true;
      const allChecked = checkableItems.every((it) => newChecks[phase.items.indexOf(it)]);
      return {
        ...(prev || {}),
        [phaseId]: {
          checks: newChecks,
          lastCompletedAt: allChecked ? Date.now() : cur.lastCompletedAt,
        },
      };
    });
  }

  function markAllComplete() {
    setChecklistProgress((prev) => {
      const newChecks = {};
      phase.items.forEach((it, i) => {
        if (!it.text.startsWith("—")) newChecks[i] = true;
      });
      return {
        ...(prev || {}),
        [phaseId]: { checks: newChecks, lastCompletedAt: Date.now() },
      };
    });
  }

  function clearPhase() {
    if (!confirm(`Clear all checks in ${phase.label}?`)) return;
    setChecklistProgress((prev) => ({
      ...(prev || {}),
      [phaseId]: { checks: {}, lastCompletedAt: null },
    }));
  }

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
        <button className="me-button" onClick={onBack}>
          <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back to Phases
        </button>
        <button className="me-button" onClick={clearPhase} style={{ borderColor: BORDER, color: TEXT_DIM }}>
          <RotateCcw size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Clear
        </button>
      </div>

      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>{phase.label}</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 6, letterSpacing: "0.15em" }}>
        {checkedTotal} / {checkableTotal} COMPLETE
      </div>
      {phase.blurb && (
        <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 16, fontStyle: "italic" }}>{phase.blurb}</div>
      )}
      {allDone && progress.lastCompletedAt && (
        <div style={{ fontSize: 11, color: "#40dc8c", marginBottom: 16, letterSpacing: "0.1em", fontWeight: 700 }}>
          ✓ COMPLETED · {formatRelativeTime(progress.lastCompletedAt)}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
        {phase.items.map((item, i) => {
          const isDivider = item.text.startsWith("—");
          if (isDivider) {
            return (
              <div key={i} style={{ padding: "10px 0 4px", fontSize: 10, color: TEXT_DIM, letterSpacing: "0.18em", fontWeight: 700, textAlign: "center" }}>
                {item.text}
              </div>
            );
          }
          const checked = !!checks[i];
          return (
            <div key={i} style={{ position: "relative" }}>
              <button
                onClick={() => toggleItem(i)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  background: checked ? "rgba(64,220,140,0.08)" : PANEL_2,
                  border: `1px solid ${BORDER}`,
                  borderLeft: `3px solid ${checked ? "#40dc8c" : AMBER}`,
                  borderRadius: "0 3px 3px 0",
                  cursor: "pointer",
                  color: TEXT,
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 13.5,
                  textAlign: "left",
                  fontWeight: 500,
                  opacity: checked ? 0.75 : 1,
                  textDecoration: checked ? "line-through" : "none",
                }}
              >
                {checked ? (
                  <CheckSquare size={16} style={{ color: "#40dc8c", flexShrink: 0 }} />
                ) : (
                  <Square size={16} style={{ color: TEXT_DIM, flexShrink: 0 }} />
                )}
                <span style={{ flex: 1 }}>{item.text}</span>
                {item.tooltip && (
                  <span
                    onClick={(e) => { e.stopPropagation(); setOpenTooltip(openTooltip === i ? null : i); }}
                    style={{
                      flexShrink: 0,
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      border: `1px solid ${CYAN}`,
                      color: CYAN,
                      fontSize: 11,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      background: openTooltip === i ? "rgba(93,213,230,0.15)" : "transparent",
                    }}
                  >
                    ?
                  </span>
                )}
              </button>
              {item.tooltip && openTooltip === i && (
                <div style={{
                  marginTop: 4,
                  marginLeft: 28,
                  padding: "10px 12px",
                  background: PANEL,
                  borderLeft: `3px solid ${CYAN}`,
                  borderRadius: "0 3px 3px 0",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: TEXT,
                }}>
                  {item.tooltip}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!allDone && (
          <button className="me-button cyan" onClick={markAllComplete}>
            <Check size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Mark All Complete
          </button>
        )}
        {nextPhase && (
          <button className="me-button" onClick={() => onSelectPhase(nextPhase.id)}>
            Next: {nextPhase.label} <ChevronRight size={11} style={{ display: "inline", marginLeft: 4, verticalAlign: "-2px" }} />
          </button>
        )}
      </div>
    </div>
  );
}

function EmergencyView({ onBack, emergencyLastViewed, onSelectProcedure }) {
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>EMERGENCY</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 14, letterSpacing: "0.15em" }}>
        PA-30 EMERGENCY PROCEDURES · TAP TO EXPAND
      </div>
      <div style={{ fontSize: 12.5, color: TEXT_DIM, marginBottom: 20, lineHeight: 1.6, fontStyle: "italic" }}>
        {EMERGENCY.intro}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {EMERGENCY.procedures.map((proc) => {
          const accent = proc.severity === "critical" ? RED : proc.severity === "high" ? AMBER : CYAN;
          const lastViewed = emergencyLastViewed?.[proc.id];
          return (
            <button
              key={proc.id}
              onClick={() => onSelectProcedure(proc.id)}
              style={{
                background: PANEL_2,
                border: `1px solid ${BORDER}`,
                borderLeft: `4px solid ${accent}`,
                borderRadius: "0 3px 3px 0",
                padding: "14px 16px",
                cursor: "pointer",
                color: TEXT,
                fontFamily: "JetBrains Mono, monospace",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 10, color: accent, letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase" }}>
                {proc.severity}
              </div>
              <div className="me-glow-amber" style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{proc.label}</div>
              {proc.subtitle && (
                <div style={{ fontSize: 11, color: TEXT_DIM, lineHeight: 1.4 }}>{proc.subtitle}</div>
              )}
              {lastViewed && (
                <div style={{ fontSize: 10, color: TEXT_DIM, marginTop: 2 }}>
                  Last viewed: {formatRelativeTime(lastViewed)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmergencyProcedureView({ procedureId, emergencyLastViewed, setEmergencyLastViewed, onBack }) {
  const proc = EMERGENCY.procedures.find((p) => p.id === procedureId);

  useEffect(() => {
    if (!proc) return;
    setEmergencyLastViewed((prev) => ({ ...(prev || {}), [proc.id]: Date.now() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procedureId]);

  if (!proc) return null;
  const accent = proc.severity === "critical" ? RED : proc.severity === "high" ? AMBER : CYAN;
  const lastViewed = emergencyLastViewed?.[proc.id];

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back to Emergencies
      </button>

      <div style={{ fontSize: 10, letterSpacing: "0.18em", color: accent, fontWeight: 700, marginBottom: 4, textTransform: "uppercase" }}>
        <AlertOctagon size={12} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />
        {proc.severity}
      </div>
      <div className="me-display" style={{ fontSize: 24, color: AMBER, marginBottom: 4, letterSpacing: "0.04em", lineHeight: 1.2 }}>
        {proc.label.toUpperCase()}
      </div>
      {proc.subtitle && (
        <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 18, fontStyle: "italic" }}>{proc.subtitle}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
        {(() => {
          let stepNum = 0;
          return proc.steps.map((step, i) => {
            const isDivider = step.startsWith("—");
            const isSubStep = step.startsWith("*");
            if (isDivider) {
              return (
                <div key={i} style={{ padding: "12px 0 6px", fontSize: 11, color: TEXT_DIM, letterSpacing: "0.18em", fontWeight: 700, textAlign: "center" }}>
                  {step}
                </div>
              );
            }
            if (!isSubStep) stepNum += 1;
            const num = isSubStep ? "→" : `${stepNum}.`;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: isSubStep ? "8px 12px 8px 32px" : "10px 12px",
                  background: PANEL_2,
                  border: `1px solid ${BORDER}`,
                  borderLeft: `3px solid ${isSubStep ? TEXT_DIM : accent}`,
                  borderRadius: "0 3px 3px 0",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: isSubStep ? 13 : 14,
                  lineHeight: 1.5,
                  color: TEXT,
                  fontWeight: isSubStep ? 400 : 600,
                }}
              >
                <span style={{ color: isSubStep ? TEXT_DIM : accent, flexShrink: 0, fontWeight: 700 }}>{num}</span>
                <span>{isSubStep ? step.replace(/^\*\s*/, "") : step}</span>
              </div>
            );
          });
        })()}
      </div>

      {lastViewed && (
        <div style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: "0.12em", textAlign: "center" }}>
          LAST VIEWED · {formatRelativeTime(lastViewed)}
        </div>
      )}
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

function VmcMasteryView({ onBack, vmcMastery, setVmcMastery }) {
  // selection: null = entry view; { tierId } = active drill (tierId or "freeform")
  const [activeTier, setActiveTier] = useState(null);
  const [resumeKey, setResumeKey] = useState(0);

  const tier1Complete = !!vmcMastery?.tier1Complete;
  const tier2Complete = !!vmcMastery?.tier2Complete;
  const tier3Complete = !!vmcMastery?.tier3Complete;

  const tierLocked = (level) => {
    if (level === 1) return false;
    if (level === 2) return !tier1Complete;
    if (level === 3) return !tier2Complete;
    return true;
  };

  function startTier(tierId) {
    setActiveTier(tierId);
    setResumeKey(k => k + 1);
  }
  function resumeTier(tierId) {
    setActiveTier(tierId);
  }

  if (activeTier) {
    const tierObj = activeTier === "freeform"
      ? null
      : VMC_MASTERY.tiers.find(t => t.id === activeTier);
    return (
      <VmcMasteryDrill
        key={`${activeTier}-${resumeKey}`}
        tierId={activeTier}
        tierObj={tierObj}
        vmcMastery={vmcMastery}
        setVmcMastery={setVmcMastery}
        onExit={() => setActiveTier(null)}
      />
    );
  }

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>VMC MASTERY DRILL</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.15em" }}>
        TIERED DRILL · 100% TO ADVANCE
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        {VMC_MASTERY.tiers.map((tier) => {
          const locked = tierLocked(tier.level);
          const completeFlag = vmcMastery?.[`tier${tier.level}Complete`];
          const session = vmcMastery?.currentSession;
          const hasResume = session && session.tierId === tier.id && session.queue && session.queue.length > 0;
          const masteredCount = session && session.tierId === tier.id ? (session.masteredIds || []).length : 0;
          const accent = completeFlag ? "#40dc8c" : locked ? BORDER : AMBER;
          return (
            <div key={tier.id} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${accent}`, padding: "14px 16px", borderRadius: "0 3px 3px 0", opacity: locked ? 0.55 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <div className="me-glow-amber" style={{ fontSize: 15, fontWeight: 700 }}>{tier.name}</div>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", color: completeFlag ? "#40dc8c" : locked ? TEXT_DIM : CYAN, fontWeight: 700 }}>
                  {completeFlag ? "✓ 100% MASTERED" : locked ? `🔒 LOCKED — Tier ${tier.level - 1} required` : `${tier.questions.length} QUESTIONS`}
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: TEXT_DIM, marginTop: 6, lineHeight: 1.55 }}>
                {tier.blurb}
              </div>
              {!locked && (
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {hasResume && !completeFlag && (
                    <button className="me-button cyan" onClick={() => resumeTier(tier.id)}>
                      <RotateCcw size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
                      Resume ({masteredCount}/{tier.questions.length} mastered)
                    </button>
                  )}
                  <button className="me-button cyan" onClick={() => startTier(tier.id)}>
                    <Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
                    {hasResume && !completeFlag ? "Restart" : completeFlag ? "Drill Again" : "Start Drill"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${CYAN}`, padding: "14px 16px", borderRadius: "0 3px 3px 0" }}>
        <div className="me-glow-cyan" style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em" }}>FREEFORM PRACTICE</div>
        <div style={{ fontSize: 12.5, color: TEXT_DIM, marginTop: 6, lineHeight: 1.55 }}>
          Random questions from every <strong style={{ color: TEXT }}>unlocked</strong> tier. No completion threshold. Cycles indefinitely.
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="me-button" onClick={() => startTier("freeform")}>
            <Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Start Freeform
          </button>
        </div>
      </div>
    </div>
  );
}

function vmcShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function VmcMasteryDrill({ tierId, tierObj, vmcMastery, setVmcMastery, onExit }) {
  const isFreeform = tierId === "freeform";

  // Build the question pool for this drill (with stable indices)
  const pool = useMemo(() => {
    if (isFreeform) {
      const unlockedTiers = VMC_MASTERY.tiers.filter((t) => {
        if (t.level === 1) return true;
        if (t.level === 2) return !!vmcMastery?.tier1Complete;
        if (t.level === 3) return !!vmcMastery?.tier2Complete;
        return false;
      });
      const out = [];
      unlockedTiers.forEach((t) => {
        t.questions.forEach((q, i) => {
          out.push({ ...q, _key: `${t.id}__${i}` });
        });
      });
      return out;
    }
    return tierObj.questions.map((q, i) => ({ ...q, _key: `${tierObj.id}__${i}` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierId]);

  const totalCount = pool.length;
  const session = vmcMastery?.currentSession;
  const canResume = !isFreeform && session && session.tierId === tierId && Array.isArray(session.queue) && session.queue.length > 0;

  // Initial state — try to resume tier session, else fresh shuffle
  const [queue, setQueue] = useState(() => {
    if (canResume) return session.queue;
    return vmcShuffle(pool.map((q) => q._key));
  });
  const [masteredIds, setMasteredIds] = useState(() => {
    if (canResume) return new Set(session.masteredIds || []);
    return new Set();
  });
  const [missedCount, setMissedCount] = useState(() => canResume ? (session.missedCount || 0) : 0);
  const [picked, setPicked] = useState(null);
  const [done, setDone] = useState(false);

  const keyToQuestion = useMemo(() => {
    const m = {};
    pool.forEach((q) => { m[q._key] = q; });
    return m;
  }, [pool]);

  // Persist tier sessions (not freeform) to vmcMastery so resume works after navigation
  useEffect(() => {
    if (isFreeform) return;
    if (done) return;
    setVmcMastery((prev) => ({
      ...(prev || {}),
      currentSession: {
        tierId,
        queue,
        missedCount,
        masteredIds: Array.from(masteredIds),
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, masteredIds, missedCount, done]);

  const currentKey = queue[0];
  const q = currentKey ? keyToQuestion[currentKey] : null;

  function pick(i) {
    if (picked !== null || !q) return;
    setPicked(i);
    if (i === q.correct) {
      setMasteredIds((prev) => {
        const next = new Set(prev);
        next.add(currentKey);
        return next;
      });
    } else {
      setMissedCount((n) => n + 1);
    }
  }

  function next() {
    if (!q) return;
    const wasCorrect = picked === q.correct;
    let nextQueue;
    if (isFreeform) {
      // Freeform: missed → re-queue 4-5 later; correct → drop, append fresh from full pool
      nextQueue = queue.slice(1);
      if (!wasCorrect) {
        const insertAt = Math.min(nextQueue.length, 4 + Math.floor(Math.random() * 2));
        nextQueue = [...nextQueue.slice(0, insertAt), currentKey, ...nextQueue.slice(insertAt)];
      }
      // Keep the queue at least somewhat full — when low, refill with shuffled pool
      if (nextQueue.length < 5 && pool.length > 0) {
        const replenish = vmcShuffle(pool.map((p) => p._key)).filter((k) => !nextQueue.includes(k));
        nextQueue = [...nextQueue, ...replenish];
      }
      setQueue(nextQueue);
      setPicked(null);
      return;
    }

    // Tier mode: missed → re-inject 4-5 ahead; correct → drop
    if (wasCorrect) {
      nextQueue = queue.slice(1);
    } else {
      const tail = queue.slice(1);
      const insertAt = Math.min(tail.length, 4 + Math.floor(Math.random() * 2));
      nextQueue = [...tail.slice(0, insertAt), currentKey, ...tail.slice(insertAt)];
    }
    setQueue(nextQueue);
    setPicked(null);

    // Tier complete: queue empty AND every original key mastered
    const everyMastered = pool.every((p) => masteredIds.has(p._key) || (wasCorrect && p._key === currentKey));
    if (nextQueue.length === 0 && everyMastered) {
      setDone(true);
      setVmcMastery((prev) => {
        const updated = { ...(prev || {}) };
        updated[`tier${tierObj.level}Complete`] = true;
        updated.currentSession = null;
        return updated;
      });
    }
  }

  function pauseAndExit() {
    onExit();
  }

  function abandonAndExit() {
    if (!isFreeform) {
      setVmcMastery((prev) => ({
        ...(prev || {}),
        currentSession: null,
      }));
    }
    onExit();
  }

  if (done && !isFreeform) {
    const tierLevel = tierObj.level;
    const allDone = tierLevel === 3 || (tierLevel === 1 && vmcMastery?.tier1Complete) /* defensive */;
    const nextTierName = tierLevel < 3 ? VMC_MASTERY.tiers[tierLevel].name : null;
    return (
      <div className="me-panel" style={{ padding: 20 }}>
        <button className="me-button" onClick={onExit} style={{ marginBottom: 16 }}>
          <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
        </button>
        <div style={{ textAlign: "center", padding: "30px 0" }}>
          <div className="me-display" style={{ fontSize: 18, color: TEXT_DIM, letterSpacing: "0.15em" }}>
            {tierObj.name.toUpperCase()}
          </div>
          <div className="me-display" style={{ fontSize: 88, lineHeight: 1, margin: "16px 0", color: "#40dc8c", textShadow: "0 0 24px rgba(64,220,140,0.5)" }}>
            100%
          </div>
          <div style={{ fontSize: 14, color: "#40dc8c", marginBottom: 8, letterSpacing: "0.12em", fontWeight: 700 }}>
            MASTERY ACHIEVED
          </div>
          <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 24, letterSpacing: "0.1em" }}>
            {totalCount} QUESTIONS · {missedCount} MISS{missedCount === 1 ? "" : "ES"} ALONG THE WAY
          </div>
          {tierLevel < 3 && (
            <div style={{ fontSize: 13, color: CYAN, marginBottom: 18, letterSpacing: "0.05em" }}>
              UNLOCKED: <span className="me-glow-cyan" style={{ fontWeight: 700 }}>{nextTierName}</span>
            </div>
          )}
          {tierLevel === 3 && (
            <div style={{ fontSize: 13, color: AMBER, marginBottom: 18, letterSpacing: "0.05em" }}>
              <span className="me-glow-amber" style={{ fontWeight: 700 }}>ALL TIERS MASTERED</span>
            </div>
          )}
          <button className="me-button cyan" onClick={onExit}>
            BACK TO MASTERY
          </button>
        </div>
      </div>
    );
  }

  if (!q) {
    return (
      <div className="me-panel" style={{ padding: 20 }}>
        <button className="me-button" onClick={onExit} style={{ marginBottom: 16 }}>
          <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
        </button>
        <div className="me-display" style={{ fontSize: 22, color: AMBER }}>No questions available — unlock a tier first.</div>
      </div>
    );
  }

  const wasCorrect = picked === q.correct;
  const masteredCount = masteredIds.size;
  const progressPct = isFreeform ? 0 : (masteredCount / totalCount) * 100;
  const headerLabel = isFreeform ? "FREEFORM PRACTICE" : tierObj.name.toUpperCase();

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
        <button className="me-button" onClick={pauseAndExit}>
          <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
          {isFreeform ? "Exit" : "Pause / Exit"}
        </button>
        {!isFreeform && (
          <button
            className="me-button"
            onClick={() => { if (confirm("Abandon this drill? Progress for this session will be lost.")) abandonAndExit(); }}
            style={{ borderColor: BORDER, color: TEXT_DIM }}
          >
            Abandon
          </button>
        )}
      </div>

      <div className="me-display" style={{ fontSize: 22, color: AMBER, marginBottom: 4 }}>{headerLabel}</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 14, letterSpacing: "0.12em" }}>
        {isFreeform ? "RANDOM · UNLOCKED TIERS · NO GATE" : "100% REQUIRED FOR MASTERY · MISSES RE-QUEUE"}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, letterSpacing: "0.12em", color: TEXT_DIM, marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        {isFreeform ? (
          <>
            <span>QUEUE {queue.length}  ·  POOL {pool.length}</span>
            <span className="me-glow-cyan">MISSES: {missedCount}</span>
          </>
        ) : (
          <>
            <span>MASTERED {masteredCount} / {totalCount}  ·  QUEUE {queue.length}</span>
            <span className="me-glow-cyan">MISSES: {missedCount}</span>
          </>
        )}
      </div>
      {!isFreeform && (
        <div className="me-progress-bar" style={{ marginBottom: 18 }}>
          <div className="me-progress-fill" style={{ width: `${progressPct}%` }}></div>
        </div>
      )}

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
        const willFinish = !isFreeform && wasCorrect && queue.length === 1 && masteredIds.size + 1 >= totalCount;
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

function PerformanceView({ onBack, onStartQuiz, onOpenCalculator }) {
  const [openScenario, setOpenScenario] = useState(null);
  const ctx = PERFORMANCE.context;
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>

      {onOpenCalculator && (
        <button
          onClick={onOpenCalculator}
          className="me-button cyan"
          style={{ width: "100%", padding: "12px", marginBottom: 16, fontSize: 12, letterSpacing: "0.15em" }}
        >
          <BarChart3 size={12} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />
          OPEN CALCULATOR ↗
        </button>
      )}

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

function ManeuversView({ onBack, onDrillTask }) {
  const [openTask, setOpenTask] = useState(null);
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>MANEUVERS</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.15em" }}>
        PRIVATE AMEL ACS · TASK BREAKDOWN
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {MANEUVERS.tasks.map((task, i) => {
          const isOpen = openTask === task.id;
          return (
            <div key={task.id} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${AMBER}`, borderRadius: "0 3px 3px 0" }}>
              <button
                onClick={() => setOpenTask(isOpen ? null : task.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  padding: "12px 14px",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  fontFamily: "JetBrains Mono, monospace",
                  color: TEXT,
                }}
              >
                <span>
                  <span style={{ color: TEXT_DIM, fontSize: 10, letterSpacing: "0.12em", marginRight: 8 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="me-glow-amber" style={{ fontWeight: 700, fontSize: 14 }}>{task.name}</span>
                </span>
                <ChevronRight size={14} style={{ color: TEXT_DIM, transform: isOpen ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s", flexShrink: 0 }} />
              </button>
              {isOpen && (
                <div style={{ padding: "0 14px 14px 14px", borderTop: `1px solid ${BORDER}` }}>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 6 }}>ACS STANDARDS</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: TEXT, fontWeight: 500 }}>
                      {task.acs.standards.map((s, j) => <li key={j}>{s}</li>)}
                    </ul>
                    <div style={{ marginTop: 8, fontSize: 12, color: TEXT_DIM, fontStyle: "italic" }}>
                      <span style={{ color: AMBER, letterSpacing: "0.08em", fontWeight: 700, fontStyle: "normal" }}>TOLERANCES: </span>
                      {task.acs.tolerances}
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 6 }}>PROCEDURE FLOW</div>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.65, color: TEXT, fontWeight: 500 }}>
                      {task.flow.map((step, j) => (
                        step === "" ? <li key={j} style={{ listStyle: "none", height: 4 }} /> :
                        <li key={j} style={{ marginBottom: 2 }}>{step}</li>
                      ))}
                    </ol>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.15em", color: RED, fontWeight: 700, marginBottom: 6 }}>COMMON ERRORS</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: TEXT, fontWeight: 500 }}>
                      {task.commonErrors.map((e, j) => <li key={j}>{e}</li>)}
                    </ul>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.15em", color: AMBER, fontWeight: 700, marginBottom: 6 }}>EXAMINER GOTCHAS</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: TEXT, fontWeight: 500 }}>
                      {task.examinerGotchas.map((e, j) => <li key={j}>{e}</li>)}
                    </ul>
                  </div>

                  {task.quiz && task.quiz.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <button className="me-button cyan" onClick={() => onDrillTask(task.id)}>
                        <Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
                        Drill {task.name} ({task.quiz.length} {task.quiz.length === 1 ? "question" : "questions"})
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ManeuverQuizView({ taskId, onBack }) {
  const task = useMemo(() => MANEUVERS.tasks.find(t => t.id === taskId), [taskId]);
  const topic = useMemo(() => ({
    id: `maneuver-quiz-${taskId}`,
    title: task ? task.name : "Maneuver",
    summary: "Maneuver-specific drill",
    quiz: task ? task.quiz : [],
  }), [taskId, task]);

  if (!task) return null;
  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back to Maneuvers
      </button>
      <div className="me-display" style={{ fontSize: 24, color: AMBER, marginBottom: 4 }}>{task.name.toUpperCase()} · DRILL</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.12em" }}>
        ACS TASK · QUESTIONS DRAWN FROM PROCEDURE FLOW + COMMON ERRORS
      </div>
      <DrillMode topic={topic} onQuizComplete={() => {}} />
    </div>
  );
}

function OralPrepView({ onBack, perTopicProgress, onOralTopicComplete }) {
  const [groupId, setGroupId] = useState("core-oral");
  const [activeTopicId, setActiveTopicId] = useState(null);
  const [drillTopicId, setDrillTopicId] = useState(null);
  const [scenarioStatus, setScenarioStatus] = useState({});
  const [openSQ, setOpenSQ] = useState({});

  const group = ORAL.groups.find((g) => g.id === groupId);
  const activeTopic = group?.topics.find((t) => t.id === activeTopicId);

  function oralTopicKey(gid, tid) {
    return `oral_${gid}__${tid}`;
  }
  function isTopicMastered(gid, tid) {
    return perTopicProgress?.[oralTopicKey(gid, tid)]?.quizScore === 1.0;
  }

  if (drillTopicId) {
    const drillTopic = group?.topics.find((t) => t.id === drillTopicId);
    if (drillTopic && drillTopic.quiz && drillTopic.quiz.length > 0) {
      const drillKey = oralTopicKey(groupId, drillTopic.id);
      const topicForDrill = {
        id: drillKey,
        title: drillTopic.title,
        summary: drillTopic.definition || "",
        quiz: drillTopic.quiz,
      };
      return (
        <div className="me-panel" style={{ padding: 20 }}>
          <button className="me-button" onClick={() => setDrillTopicId(null)} style={{ marginBottom: 16 }}>
            <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back to Topic
          </button>
          <div className="me-display" style={{ fontSize: 24, color: AMBER, marginBottom: 4 }}>{drillTopic.title.toUpperCase()} · DRILL</div>
          <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.12em" }}>
            ORAL · 100% REQUIRED · MISSES RE-QUEUE
          </div>
          <DrillMode
            topic={topicForDrill}
            onQuizComplete={(scorePct) => {
              if (onOralTopicComplete) onOralTopicComplete(drillKey, scorePct);
            }}
          />
        </div>
      );
    }
  }

  if (activeTopic) {
    const isScenario = groupId === "scenarios";
    const status = scenarioStatus[activeTopic.id];
    return (
      <div className="me-panel" style={{ padding: 20 }}>
        <button className="me-button" onClick={() => setActiveTopicId(null)} style={{ marginBottom: 16 }}>
          <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back to {group.label}
        </button>

        <div className="me-display" style={{ fontSize: 24, color: AMBER, marginBottom: 6, letterSpacing: "0.04em" }}>{activeTopic.title.toUpperCase()}</div>

        {activeTopic.raiderQuote && (
          <div style={{ marginBottom: 16, padding: "12px 14px", background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${CYAN}`, borderRadius: "0 3px 3px 0" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 6 }}>RAIDER PDF QUOTE</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: TEXT, fontStyle: "italic" }}>"{activeTopic.raiderQuote}"</div>
          </div>
        )}

        {!isScenario && activeTopic.definition && (
          <div style={{ marginBottom: 16, padding: "12px 14px", background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${AMBER}`, borderRadius: "0 3px 3px 0" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", color: AMBER, fontWeight: 700, marginBottom: 6 }}>MODEL ANSWER</div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: TEXT, fontWeight: 500 }}>{activeTopic.definition}</div>
          </div>
        )}

        {!isScenario && activeTopic.keyPoints && activeTopic.keyPoints.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 8 }}>KEY POINTS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activeTopic.keyPoints.map((pt, i) => (
                <div key={i} style={{ display: "flex", gap: 10, fontSize: 13.5, lineHeight: 1.7, color: TEXT, fontWeight: 500 }}>
                  <span className="me-bullet" style={{ flexShrink: 0, fontFamily: "monospace" }}>›</span>
                  <span><RichText line={pt} /></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isScenario && activeTopic.setup && (
          <div style={{ marginBottom: 16, padding: "12px 14px", background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${AMBER}`, borderRadius: "0 3px 3px 0" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", color: AMBER, fontWeight: 700, marginBottom: 6 }}>SCENARIO SETUP</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: TEXT, fontStyle: "italic" }}>{activeTopic.setup}</div>
          </div>
        )}

        {isScenario && activeTopic.crossTopics && (
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: TEXT_DIM, marginBottom: 12 }}>
            CROSS-TOPICS: <span style={{ color: CYAN, fontWeight: 700 }}>{activeTopic.crossTopics.join(" · ")}</span>
          </div>
        )}

        {isScenario && activeTopic.questions && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
            {activeTopic.questions.map((q, i) => {
              const key = `${activeTopic.id}__${i}`;
              const qOpen = !!openSQ[key];
              return (
                <div key={i}>
                  <button
                    onClick={() => setOpenSQ((prev) => ({ ...prev, [key]: !prev[key] }))}
                    style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "6px 0", cursor: "pointer", color: TEXT, fontFamily: "JetBrains Mono, monospace", fontSize: 13.5, lineHeight: 1.5, fontWeight: 500, display: "flex", gap: 8, alignItems: "flex-start" }}
                  >
                    <span style={{ color: AMBER, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                    <span>{q}</span>
                  </button>
                  {qOpen && (
                    <div style={{ marginTop: 4, marginLeft: 18, padding: "10px 12px", background: PANEL, borderLeft: `3px solid ${CYAN}`, borderRadius: "0 3px 3px 0", fontSize: 12.5, lineHeight: 1.65, color: TEXT_DIM, fontStyle: "italic" }}>
                      Synthesize topics: <span style={{ color: CYAN, fontStyle: "normal", fontWeight: 700 }}>{(activeTopic.crossTopics || []).join(", ")}</span>. Walk through aloud as if responding to the examiner.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {isScenario && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="me-button"
              style={{ borderColor: status === "got" ? "#40dc8c" : BORDER, color: status === "got" ? "#40dc8c" : TEXT }}
              onClick={() => setScenarioStatus((prev) => ({ ...prev, [activeTopic.id]: prev[activeTopic.id] === "got" ? null : "got" }))}
            >
              <Check size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />I got this
            </button>
            <button
              className="me-button"
              style={{ borderColor: status === "review" ? AMBER : BORDER, color: status === "review" ? AMBER : TEXT }}
              onClick={() => setScenarioStatus((prev) => ({ ...prev, [activeTopic.id]: prev[activeTopic.id] === "review" ? null : "review" }))}
            >
              <RotateCcw size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Need to review
            </button>
          </div>
        )}

        {!isScenario && activeTopic.quiz && activeTopic.quiz.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button className="me-button cyan" onClick={() => setDrillTopicId(activeTopic.id)}>
              <Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
              {isTopicMastered(groupId, activeTopic.id) ? "Drill Again" : "Drill"} {activeTopic.title} ({activeTopic.quiz.length} questions)
            </button>
            {isTopicMastered(groupId, activeTopic.id) && (
              <span style={{ fontSize: 11, color: "#40dc8c", letterSpacing: "0.15em", fontWeight: 700 }}>
                ✓ MASTERED
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>ORAL EXAM PREP</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 12, letterSpacing: "0.15em" }}>
        RAIDER AVIATION-ALIGNED · 9 CORE + 6 SYSTEMS + SCENARIOS
      </div>
      {ORAL.intro && (
        <div style={{ fontSize: 13, color: TEXT_DIM, lineHeight: 1.6, marginBottom: 18, fontStyle: "italic" }}>
          {ORAL.intro}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {ORAL.groups.map((g) => (
          <button
            key={g.id}
            className={`me-button ${g.id === "core-oral" ? "" : "cyan "}${groupId === g.id ? "active" : ""}`}
            onClick={() => setGroupId(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {group && (
        <>
          <div style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.6, marginBottom: 14, fontStyle: "italic" }}>
            {group.blurb}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {group.topics.map((topic, i) => {
              const status = scenarioStatus[topic.id];
              const mastered = isTopicMastered(groupId, topic.id);
              const accent = mastered ? "#40dc8c" : status === "got" ? "#40dc8c" : status === "review" ? AMBER : (groupId === "scenarios" ? CYAN : AMBER);
              const qCount = (topic.quiz || []).length;
              return (
                <button
                  key={topic.id}
                  onClick={() => setActiveTopicId(topic.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: PANEL_2,
                    border: `1px solid ${BORDER}`,
                    borderLeft: `3px solid ${accent}`,
                    borderRadius: "0 3px 3px 0",
                    padding: "12px 14px",
                    cursor: "pointer",
                    color: TEXT,
                    fontFamily: "JetBrains Mono, monospace",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: TEXT_DIM, fontSize: 10, letterSpacing: "0.12em" }}>{String(i + 1).padStart(2, "0")}</span>
                    <span className="me-glow-amber" style={{ fontWeight: 700, fontSize: 14 }}>{topic.title}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {mastered && (
                      <span style={{ fontSize: 10, color: "#40dc8c", letterSpacing: "0.12em", fontWeight: 700 }}>
                        ✓ MASTERED
                      </span>
                    )}
                    {!mastered && status && (
                      <span style={{ fontSize: 10, color: status === "got" ? "#40dc8c" : AMBER, letterSpacing: "0.12em", fontWeight: 700 }}>
                        {status === "got" ? "✓" : "⟳"}
                      </span>
                    )}
                    {qCount > 0 && (
                      <span style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: "0.12em" }}>{qCount} Q</span>
                    )}
                    <ChevronRight size={14} style={{ color: TEXT_DIM }} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ReferenceView({ onBack }) {
  const [section, setSection] = useState("regs");
  const [filter, setFilter] = useState("");
  const filteredRegs = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return REFERENCE.regulations;
    return REFERENCE.regulations.filter(r =>
      r.reg.toLowerCase().includes(f) ||
      r.title.toLowerCase().includes(f) ||
      r.note.toLowerCase().includes(f)
    );
  }, [filter]);

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>
      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>QUICK REFERENCE</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.15em" }}>
        REGS · W&amp;B · EMERGENCY MEMORY ITEMS
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        <button className={`me-button ${section === "regs" ? "active" : ""}`} onClick={() => setSection("regs")}>Regulations</button>
        <button className={`me-button cyan ${section === "wb" ? "active" : ""}`} onClick={() => setSection("wb")}>Weight &amp; Balance</button>
        <button className={`me-button cyan ${section === "emergency" ? "active" : ""}`} onClick={() => setSection("emergency")}>Emergency Memory</button>
      </div>

      {section === "regs" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 12px", background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 3 }}>
            <Search size={14} style={{ color: TEXT_DIM, flexShrink: 0 }} />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by reg, title, or content..."
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: TEXT, fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}
            />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="me-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Reg</th>
                  <th style={{ width: 200 }}>Title</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredRegs.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: AMBER }}>§{r.reg}</td>
                    <td style={{ fontWeight: 600, color: TEXT, fontSize: 12.5 }}>{r.title}</td>
                    <td style={{ fontSize: 12, color: TEXT, lineHeight: 1.55, fontWeight: 500 }}>{r.note}</td>
                  </tr>
                ))}
                {filteredRegs.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ fontSize: 12, color: TEXT_DIM, fontStyle: "italic", textAlign: "center", padding: 18 }}>
                      No regulations match "{filter}".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "wb" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${CYAN}`, padding: "14px 16px", borderRadius: "0 3px 3px 0" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 8 }}>PROCEDURE</div>
            <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.7, fontWeight: 500, whiteSpace: "pre-wrap" }}>
              {REFERENCE.weightBalance.procedure}
            </div>
          </div>

          <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${AMBER}`, padding: "14px 16px", borderRadius: "0 3px 3px 0" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.15em", color: AMBER, fontWeight: 700, marginBottom: 8 }}>PA-30 TYPICAL NUMBERS</div>
            <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.7, fontWeight: 500 }}>
              {REFERENCE.weightBalance.pa30typical}
            </div>
          </div>

          <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${RED}`, padding: "14px 16px", borderRadius: "0 3px 3px 0" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.15em", color: RED, fontWeight: 700, marginBottom: 8 }}>EXAMINER WILL ASK</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: TEXT, lineHeight: 1.7, fontWeight: 500 }}>
              {REFERENCE.weightBalance.examinerWillAsk.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        </div>
      )}

      {section === "emergency" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, letterSpacing: "0.12em", marginBottom: 4 }}>
            MEMORIZE EVERY ITEM. BOLD MEANS COMMIT TO MUSCLE MEMORY.
          </div>
          {REFERENCE.emergencyMemoryItems.map((em, i) => (
            <div key={i} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${RED}`, padding: "14px 16px", borderRadius: "0 3px 3px 0" }}>
              <div style={{ fontSize: 14, color: TEXT, fontWeight: 700, marginBottom: 10, letterSpacing: "0.04em" }}>
                <AlertTriangle size={14} style={{ display: "inline", color: RED, marginRight: 8, verticalAlign: "-2px" }} />
                {em.emergency.toUpperCase()}
              </div>
              <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13, color: TEXT, lineHeight: 1.75, fontWeight: 500 }}>
                {em.items.map((step, j) => <li key={j}>{step}</li>)}
              </ol>
            </div>
          ))}
        </div>
      )}
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
  // Include per-maneuver questions
  MANEUVERS.tasks.forEach((task) => {
    (task.quiz || []).forEach((q, qi) => {
      all.push({
        ...q,
        _id: `maneuver_${task.id}__${qi}`,
        _topic: task.name,
        _day: "Maneuvers",
        _kind: "maneuver",
      });
    });
  });
  // Include Vmc Mastery tier questions
  VMC_MASTERY.tiers.forEach((tier) => {
    tier.questions.forEach((q, qi) => {
      all.push({
        ...q,
        _id: `vmc_${tier.id}__${qi}`,
        _topic: `Vmc Mastery — ${tier.name}`,
        _day: "Vmc Mastery",
        _kind: "vmc-mastery",
      });
    });
  });
  // Include Raider-aligned ORAL questions
  ORAL.groups.forEach((group) => {
    group.topics.forEach((topic) => {
      (topic.quiz || []).forEach((q, qi) => {
        all.push({
          ...q,
          _id: `oral_${group.id}__${topic.id}__${qi}`,
          _topic: `Oral — ${topic.title}`,
          _day: "Oral",
          _kind: "oral",
        });
      });
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
// PERFORMANCE CALCULATOR (live-updating, calls /api/compute-performance)
// =====================================================================

const FIELD_PRESETS = [
  { name: "KLBB", elev: 3282 },
  { name: "F49", elev: 3124 },
  { name: "KMAF", elev: 2871 },
];

function PerformanceCalculator({ onBack }) {
  const [weight, setWeight] = useState(2800);
  const [fieldElev, setFieldElev] = useState(3282);
  const [fieldElevText, setFieldElevText] = useState("3282");
  const [oat, setOat] = useState(75);
  const [windKt, setWindKt] = useState(0);
  const [runwayLen, setRunwayLen] = useState(11500);
  const [runwaySlope, setRunwaySlope] = useState(0.0);

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [history, setHistory] = useState([]);

  function selectPreset(elev) {
    setFieldElev(elev);
    setFieldElevText(String(elev));
  }
  function handleFieldElevText(v) {
    setFieldElevText(v);
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 0 && n <= 14000) setFieldElev(n);
  }

  function loadScenario(s) {
    setWeight(s.weight);
    setFieldElev(s.fieldElev);
    setFieldElevText(String(s.fieldElev));
    setOat(s.oat);
    setWindKt(s.windKt);
    setRunwayLen(s.runwayLen);
    setRunwaySlope(s.runwaySlope);
  }

  // Debounced API call
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setCalculating(true);
      try {
        const res = await fetch("/api/compute-performance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenario: {
              weight_lbs: weight,
              field_elevation_ft: fieldElev,
              oat_f: oat,
              wind_component_kt: windKt,
              runway_length_ft: runwayLen,
              runway_slope_pct: runwaySlope,
            },
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;
        setResult(data);
        setError(null);
        const verdict = data?.go_no_go?.result || "?";
        const roc = data?.single_engine_safety?.roc_at_departure_da_fpm;
        const summary = `${weight.toLocaleString()} lb · ${fieldElev.toLocaleString()} ft · ${oat}°F → ${verdict}${roc != null ? ` ${roc} fpm` : ""}`;
        setHistory(prev => {
          const entry = {
            ts: new Date().toLocaleTimeString(),
            weight, fieldElev, oat, windKt, runwayLen, runwaySlope,
            verdict, summary,
          };
          // Avoid logging duplicate consecutive scenarios
          if (prev[0] && prev[0].summary === summary) return prev;
          return [entry, ...prev].slice(0, 5);
        });
      } catch (e) {
        if (cancelled) return;
        setError(e.message || "Calculation failed");
      } finally {
        if (!cancelled) setCalculating(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [weight, fieldElev, oat, windKt, runwayLen, runwaySlope]);

  const verdict = result?.go_no_go?.result;
  const verdictColor = verdict === "GO" ? CYAN : verdict === "CAUTION" ? AMBER : verdict === "NO-GO" ? RED : TEXT_DIM;

  const dep = result?.departure || {};
  const ses = result?.single_engine_safety || {};
  const flags = result?.flags || [];
  const da = dep.da_ft;
  const seCeiling = ses.service_ceiling_da_ft;
  const seRoc = ses.roc_at_departure_da_fpm;
  const aStop = dep.accelerate_stop_ft;
  const aStopMargin = dep.runway_margin_accel_stop;
  const toGround = dep.takeoff_ground_roll_ft;
  const toRwy = dep.runway_length_ft;

  const seCeilingCritical = da != null && seCeiling != null && seCeiling <= da;
  const seRocCritical = seRoc != null && seRoc < 100;
  const aStopCritical = toRwy != null && aStop != null && aStop > 0.8 * toRwy;

  return (
    <div className="me-panel" style={{ padding: 20 }}>
      <style>{`
        .perfcalc-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          background: ${PANEL_2};
          border: 1px solid ${BORDER};
          border-radius: 3px;
          outline: none;
        }
        .perfcalc-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: ${AMBER};
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(255,184,74,0.4);
          transition: transform 0.1s;
        }
        .perfcalc-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
        .perfcalc-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: ${AMBER};
          border: none;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(255,184,74,0.4);
        }
        .perfcalc-slider::-moz-range-thumb:hover { transform: scale(1.2); }
      `}</style>
      <button className="me-button" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />Back
      </button>

      <div className="me-display" style={{ fontSize: 26, color: AMBER, marginBottom: 4, letterSpacing: "0.05em" }}>PERFORMANCE CALCULATOR</div>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 20, letterSpacing: "0.15em" }}>
        N1100L · PA-30 · LIVE GO/NO-GO
      </div>

      {/* INPUTS */}
      <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${CYAN}`, borderRadius: "0 3px 3px 0", padding: "16px 18px", marginBottom: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 14 }}>SCENARIO INPUTS</div>

        <PerfSliderRow label="Weight" value={`${weight.toLocaleString()} lb`}>
          <input type="range" min={2400} max={3600} step={50} value={weight} onChange={(e) => setWeight(parseInt(e.target.value, 10))} className="perfcalc-slider" />
        </PerfSliderRow>

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, fontSize: 11, letterSpacing: "0.12em", color: TEXT_DIM }}>
            <span>FIELD ELEVATION</span>
            <span className="me-glow-amber" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 700 }}>{fieldElev.toLocaleString()} ft</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {FIELD_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => selectPreset(p.elev)}
                className={`me-button ${fieldElev === p.elev ? "active" : ""}`}
                style={{ fontSize: 10, padding: "6px 10px" }}
              >
                {p.name} · {p.elev.toLocaleString()}'
              </button>
            ))}
            <input
              type="text"
              inputMode="numeric"
              value={fieldElevText}
              onChange={(e) => handleFieldElevText(e.target.value)}
              placeholder="custom"
              style={{
                flex: 1, minWidth: 90, background: PANEL, border: `1px solid ${BORDER}`,
                color: TEXT, fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                padding: "6px 10px", borderRadius: 2, outline: "none",
              }}
            />
          </div>
        </div>

        <PerfSliderRow label="OAT" value={`${oat}°F`}>
          <input type="range" min={30} max={110} step={1} value={oat} onChange={(e) => setOat(parseInt(e.target.value, 10))} className="perfcalc-slider" />
        </PerfSliderRow>

        <PerfSliderRow label="Wind component" value={`${windKt > 0 ? "+" : ""}${windKt} kt${windKt > 0 ? " HW" : windKt < 0 ? " TW" : ""}`}>
          <input type="range" min={-20} max={30} step={1} value={windKt} onChange={(e) => setWindKt(parseInt(e.target.value, 10))} className="perfcalc-slider" />
        </PerfSliderRow>

        <PerfSliderRow label="Runway length" value={`${runwayLen.toLocaleString()} ft`}>
          <input type="range" min={2500} max={13000} step={100} value={runwayLen} onChange={(e) => setRunwayLen(parseInt(e.target.value, 10))} className="perfcalc-slider" />
        </PerfSliderRow>

        <PerfSliderRow label="Runway slope" value={`${runwaySlope > 0 ? "+" : ""}${runwaySlope.toFixed(1)}%`}>
          <input type="range" min={-2.0} max={2.0} step={0.1} value={runwaySlope} onChange={(e) => setRunwaySlope(parseFloat(e.target.value))} className="perfcalc-slider" />
        </PerfSliderRow>
      </div>

      {/* STATUS */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10, fontSize: 10, color: calculating ? AMBER : TEXT_DIM, letterSpacing: "0.15em" }}>
        {calculating ? "⟳ CALCULATING…" : error ? `⚠ ${error}` : result ? "✓ UP TO DATE" : "—"}
      </div>

      {/* RESULTS */}
      {result && (
        <>
          <div style={{
            background: PANEL_2,
            border: `2px solid ${verdictColor}`,
            borderRadius: 4,
            padding: "16px 20px",
            marginBottom: 18,
            textAlign: "center",
            boxShadow: `0 0 24px ${verdictColor === RED ? "rgba(255,82,82,0.25)" : verdictColor === AMBER ? "rgba(255,184,74,0.25)" : verdictColor === CYAN ? "rgba(93,213,230,0.25)" : "transparent"}`,
          }}>
            <div className="me-display" style={{ fontSize: 56, lineHeight: 1, color: verdictColor, letterSpacing: "0.08em" }}>{verdict || "—"}</div>
            <div style={{ fontSize: 11, color: TEXT_DIM, letterSpacing: "0.12em", marginTop: 4 }}>
              {result?.go_no_go?.blocker_count ?? 0} BLOCKER{(result?.go_no_go?.blocker_count ?? 0) === 1 ? "" : "S"} · {result?.go_no_go?.advisory_count ?? 0} ADVISOR{(result?.go_no_go?.advisory_count ?? 0) === 1 ? "Y" : "IES"}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 18 }}>
            <PerfMetric
              label="Density Altitude"
              value={da != null ? `${da.toLocaleString()} ft` : "—"}
              accent={CYAN}
            />
            <PerfMetric
              label="SE Climb @ Field DA"
              value={seRoc != null ? `${seRoc} fpm` : "—"}
              accent={seRocCritical ? RED : seRoc != null && seRoc < 200 ? AMBER : "#40dc8c"}
              critical={seRocCritical}
              note={seRocCritical ? "<100 fpm: engine failure on departure is critical" : undefined}
            />
            <PerfMetric
              label="SE Service Ceiling"
              value={seCeiling != null ? `${seCeiling.toLocaleString()} ft DA` : "—"}
              accent={seCeilingCritical ? RED : CYAN}
              critical={seCeilingCritical}
              note={seCeilingCritical ? "At/below current DA: cannot maintain altitude single-engine" : undefined}
            />
            <PerfMetric
              label="Accelerate-Stop"
              value={aStop != null && toRwy != null ? `${aStop.toLocaleString()} / ${toRwy.toLocaleString()} ft` : "—"}
              accent={aStopCritical ? RED : aStopMargin != null && aStopMargin < 1.10 ? AMBER : "#40dc8c"}
              critical={aStopCritical}
              note={aStopMargin != null ? `margin ${aStopMargin.toFixed(2)}×` : undefined}
            />
            <PerfMetric
              label="Takeoff Ground Roll"
              value={toGround != null ? `${toGround.toLocaleString()} ft` : "—"}
              accent={AMBER}
            />
            <PerfMetric
              label="50 ft Obstacle"
              value={dep.takeoff_over_50ft_ft != null ? `${dep.takeoff_over_50ft_ft.toLocaleString()} ft` : "—"}
              accent={AMBER}
            />
          </div>

          {flags.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.15em", color: AMBER, fontWeight: 700, marginBottom: 8 }}>FLAGGED CONCERNS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {flags.map((f, i) => {
                  const isBlocker = typeof f === "string" && f.includes("⚠️");
                  return (
                    <div key={i} style={{
                      background: PANEL_2,
                      border: `1px solid ${BORDER}`,
                      borderLeft: `3px solid ${isBlocker ? RED : AMBER}`,
                      padding: "10px 12px",
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: TEXT,
                      borderRadius: "0 3px 3px 0",
                      fontWeight: 500,
                    }}>
                      {f}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {!result && error && (
        <div style={{
          background: PANEL_2,
          border: `1px solid ${RED}`,
          borderLeft: `3px solid ${RED}`,
          padding: "12px 14px",
          fontSize: 12.5,
          lineHeight: 1.5,
          color: TEXT,
          borderRadius: "0 3px 3px 0",
          marginBottom: 18,
        }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: RED, fontWeight: 700, marginBottom: 6 }}>
            CALCULATION ERROR
          </div>
          {error}
        </div>
      )}

      {/* HISTORY */}
      {history.length > 0 && (
        <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, padding: "14px 16px", borderRadius: 3 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.15em", color: TEXT_DIM, fontWeight: 700, marginBottom: 10 }}>RECENT CALCULATIONS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {history.map((h, i) => {
              const c = h.verdict === "GO" ? CYAN : h.verdict === "CAUTION" ? AMBER : h.verdict === "NO-GO" ? RED : TEXT_DIM;
              return (
                <button
                  key={i}
                  onClick={() => loadScenario(h)}
                  style={{
                    background: "transparent",
                    border: `1px solid ${BORDER}`,
                    borderLeft: `3px solid ${c}`,
                    padding: "8px 10px",
                    color: TEXT,
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 12,
                    cursor: "pointer",
                    textAlign: "left",
                    borderRadius: "0 3px 3px 0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span>{h.summary}</span>
                  <span style={{ color: TEXT_DIM, fontSize: 10, flexShrink: 0 }}>{h.ts}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PerfSliderRow({ label, value, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, fontSize: 11, letterSpacing: "0.12em", color: TEXT_DIM }}>
        <span>{label.toUpperCase()}</span>
        <span className="me-glow-amber" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 700 }}>{value}</span>
      </div>
      {children}
    </div>
  );
}

function PerfMetric({ label, value, accent, critical, note }) {
  return (
    <div style={{
      background: PANEL_2,
      border: `1px solid ${BORDER}`,
      borderLeft: `3px solid ${accent}`,
      padding: "10px 12px",
      borderRadius: "0 3px 3px 0",
    }}>
      <div style={{ fontSize: 10, letterSpacing: "0.15em", color: TEXT_DIM, marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div className="me-display" style={{ fontSize: 22, lineHeight: 1.1, color: critical ? accent : TEXT, letterSpacing: "0.04em", fontWeight: critical ? 700 : 400 }}>{value}</div>
      {note && (
        <div style={{ fontSize: 10.5, color: critical ? accent : TEXT_DIM, marginTop: 4, lineHeight: 1.4, fontStyle: critical ? "normal" : "italic", fontWeight: critical ? 600 : 400 }}>{note}</div>
      )}
    </div>
  );
}

// =====================================================================
// MAIN APP
// =====================================================================

export default function App() {
  const [view, setView] = useState("home");
  const [activeTopic, setActiveTopic] = useState(null);
  const [activeKind, setActiveKind] = useState(null);
  const [activeManeuverId, setActiveManeuverId] = useState(null);
  const [mode, setMode] = useState("learn");
  const [userId] = useState(() => {
    const fromUrl = getUserIdFromUrl();
    if (fromUrl) return fromUrl;
    const newId = generateUserId();
    setUserIdInUrl(newId);
    return newId;
  });
  const [perTopicProgress, setPerTopicProgress] = useState({});
  const [vmcMastery, setVmcMastery] = useState({});
  const [checklistProgress, setChecklistProgress] = useState({});
  const [emergencyLastViewed, setEmergencyLastViewed] = useState({});
  const [activeChecklistPhase, setActiveChecklistPhase] = useState(null);
  const [activeEmergencyProc, setActiveEmergencyProc] = useState(null);
  const [syncStatus, setSyncStatus] = useState("loading"); // "loading" | "synced" | "saving" | "offline"
  const [showWelcome, setShowWelcome] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Load progress on mount / userId change. Try remote first, fall back to localStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = loadProgressLocal(userId);
      const remote = await loadProgressRemote(userId);
      if (cancelled) return;

      if (remote.ok && remote.progress) {
        if (remote.progress.perTopicProgress) setPerTopicProgress(remote.progress.perTopicProgress);
        if (remote.progress.vmcMastery) setVmcMastery(remote.progress.vmcMastery);
        if (remote.progress.checklistProgress) setChecklistProgress(remote.progress.checklistProgress);
        if (remote.progress.emergencyLastViewed) setEmergencyLastViewed(remote.progress.emergencyLastViewed);
        if (!remote.progress.perTopicProgress && !remote.progress.vmcMastery && !remote.progress.checklistProgress) setShowWelcome(true);
        setSyncStatus("synced");
        return;
      }

      if (!remote.ok && local) {
        // Remote unreachable — restore from local cache, mark offline
        if (local.perTopicProgress) setPerTopicProgress(local.perTopicProgress);
        if (local.vmcMastery) setVmcMastery(local.vmcMastery);
        if (local.checklistProgress) setChecklistProgress(local.checklistProgress);
        if (local.emergencyLastViewed) setEmergencyLastViewed(local.emergencyLastViewed);
        setSyncStatus("offline");
        return;
      }

      // No remote data and no local cache — first-time visitor
      setShowWelcome(true);
      setSyncStatus(remote.ok ? "synced" : "offline");
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Save progress on change (debounced). Always write localStorage, then try remote.
  useEffect(() => {
    if (syncStatus === "loading") return;
    const payload = { perTopicProgress, vmcMastery, checklistProgress, emergencyLastViewed };
    saveProgressLocal(userId, payload);
    const handle = setTimeout(async () => {
      setSyncStatus("saving");
      const ok = await saveProgressRemote(userId, payload);
      setSyncStatus(ok ? "synced" : "offline");
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perTopicProgress, vmcMastery, checklistProgress, emergencyLastViewed, userId]);

  // Total topic count — includes CURRICULUM topics + ORAL topics that have quizzes
  const allTopics = useMemo(() => {
    const arr = [];
    CURRICULUM.forEach(d => d.blocks.forEach(b => b.topics.forEach(t => arr.push({ id: t.id }))));
    ORAL.groups.forEach(g => g.topics.forEach(t => {
      if (t.quiz && t.quiz.length > 0) arr.push({ id: `oral_${g.id}__${t.id}` });
    }));
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

  function oralTopicComplete(key, scorePct) {
    if (!key) return;
    if (scorePct < 1.0) return;
    setPerTopicProgress(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || { studied: true }),
        studied: true,
        quizScore: 1.0,
      }
    }));
  }

  function reset() {
    if (confirm("Clear all progress for this account? This affects every device using this URL.")) {
      setPerTopicProgress({});
      setVmcMastery({});
      setChecklistProgress({});
      setEmergencyLastViewed({});
    }
  }

  return (
    <div className="me-app">
      <StyleSheet />
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Header progress={progress} view={view} setView={setView} userId={userId} syncStatus={syncStatus} isOnline={isOnline} />
        {showWelcome && (
          <div style={{
            background: "linear-gradient(90deg, rgba(93,213,230,0.15), rgba(255,184,74,0.10))",
            border: `1px solid ${CYAN}`,
            borderLeft: `3px solid ${CYAN}`,
            padding: "14px 18px",
            marginBottom: 16,
            borderRadius: "0 4px 4px 0",
            fontSize: 13,
            lineHeight: 1.6,
          }}>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", color: CYAN, fontWeight: 700, marginBottom: 6 }}>
              👋 WELCOME — BOOKMARK THIS URL ON EVERY DEVICE
            </div>
            <div style={{ color: TEXT }}>
              Your unique study URL is <strong style={{ color: AMBER, fontFamily: "monospace" }}>me-study.vercel.app/u/{userId}</strong>
            </div>
            <div style={{ color: TEXT_DIM, marginTop: 6, fontSize: 12 }}>
              Bookmark it on your laptop, phone, and tablet. Progress syncs automatically across every device that uses this URL. <strong>Save the URL somewhere safe</strong> — it's your only way to recover progress if you lose all your bookmarks.
            </div>
            <button onClick={() => setShowWelcome(false)} style={{
              marginTop: 10,
              background: "transparent",
              border: `1px solid ${CYAN}`,
              color: CYAN,
              padding: "6px 14px",
              fontSize: 10,
              letterSpacing: "0.15em",
              cursor: "pointer",
              borderRadius: 2,
              fontFamily: "inherit",
            }}>
              GOT IT
            </button>
          </div>
        )}
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
          <PerformanceView
            onBack={() => setView("home")}
            onStartQuiz={() => setView("performancequiz")}
            onOpenCalculator={() => setView("perf-calc")}
          />
        )}
        {view === "performancequiz" && (
          <PerformanceQuizView onBack={() => setView("performance")} />
        )}
        {view === "perf-calc" && (
          <PerformanceCalculator onBack={() => setView("performance")} />
        )}
        {view === "maneuvers" && (
          <ManeuversView
            onBack={() => setView("home")}
            onDrillTask={(taskId) => { setActiveManeuverId(taskId); setView("maneuverquiz"); }}
          />
        )}
        {view === "maneuverquiz" && activeManeuverId && (
          <ManeuverQuizView taskId={activeManeuverId} onBack={() => setView("maneuvers")} />
        )}
        {view === "oral" && (
          <OralPrepView
            onBack={() => setView("home")}
            perTopicProgress={perTopicProgress}
            onOralTopicComplete={oralTopicComplete}
          />
        )}
        {view === "reference" && (
          <ReferenceView onBack={() => setView("home")} />
        )}
        {view === "drillall" && (
          <DrillAllView onBack={() => setView("home")} />
        )}
        {view === "speeds" && (
          <SpeedsView onBack={() => setView("home")} />
        )}
        {view === "checklist" && (
          <ChecklistView
            onBack={() => setView("home")}
            checklistProgress={checklistProgress}
            onSelectPhase={(id) => { setActiveChecklistPhase(id); setView("checklist-phase"); }}
          />
        )}
        {view === "checklist-phase" && activeChecklistPhase && (
          <ChecklistPhaseView
            phaseId={activeChecklistPhase}
            checklistProgress={checklistProgress}
            setChecklistProgress={setChecklistProgress}
            onBack={() => setView("checklist")}
            onSelectPhase={(id) => setActiveChecklistPhase(id)}
          />
        )}
        {view === "emergency" && (
          <EmergencyView
            onBack={() => setView("home")}
            emergencyLastViewed={emergencyLastViewed}
            onSelectProcedure={(id) => { setActiveEmergencyProc(id); setView("emergency-procedure"); }}
          />
        )}
        {view === "emergency-procedure" && activeEmergencyProc && (
          <EmergencyProcedureView
            procedureId={activeEmergencyProc}
            emergencyLastViewed={emergencyLastViewed}
            setEmergencyLastViewed={setEmergencyLastViewed}
            onBack={() => setView("emergency")}
          />
        )}
        {view === "vmctable" && (
          <VmcTableView onBack={() => setView("home")} />
        )}
        {view === "vmc-mastery" && (
          <VmcMasteryView
            onBack={() => setView("home")}
            vmcMastery={vmcMastery}
            setVmcMastery={setVmcMastery}
          />
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
        <div style={{ textAlign: "center", marginTop: 20, marginBottom: 20 }}>
          <button
            onClick={reset}
            style={{
              background: "transparent",
              border: `1px solid ${BORDER}`,
              color: TEXT_DIM,
              padding: "6px 14px",
              fontSize: 9,
              letterSpacing: "0.15em",
              cursor: "pointer",
              borderRadius: 2,
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = RED; e.currentTarget.style.borderColor = RED; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = TEXT_DIM; e.currentTarget.style.borderColor = BORDER; }}
          >
            CLEAR ALL PROGRESS
          </button>
        </div>
      </div>
    </div>
  );
}
