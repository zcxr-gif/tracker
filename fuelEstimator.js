/**
 * fuelEstimator.js — hypothetical fuel-burn model for the flight-info windows.
 *
 * Infinite Flight's live API never transmits fuel: not the load at pushback,
 * not the quantity remaining, not the engine fuel flow. So there is nothing to
 * read — the only honest way to put a fuel figure in front of a pilot is to
 * *model* it, and to be candid that it is a model.
 *
 * This module does that as carefully as the available telemetry allows. Rather
 * than multiplying a flat "kg per hour" by elapsed time (which is wrong by 3x
 * between a taxiing 737 and the same 737 at max climb thrust), it reconstructs
 * the thrust the aeroplane must have been producing at every point of its
 * recorded track and integrates the corresponding fuel flow:
 *
 *   1. ISA atmosphere at each sample gives density, temperature and speed of
 *      sound (corrected by the live OAT when the host has sampled one).
 *   2. Ground speed is turned into true airspeed by subtracting the wind
 *      vector along the segment's own track.
 *   3. Lift equals weight, so CL follows from mass, density, TAS and wing area.
 *   4. A drag polar (CD0 + CL²/(pi·AR·e), plus a Mach wave-drag term and a
 *      configuration penalty for gear/flaps) gives drag.
 *   5. Thrust = drag + weight·sin(flight path angle) + mass·acceleration,
 *      clamped between flight idle and the thrust actually available at that
 *      altitude and Mach.
 *   6. Fuel flow = thrust · TSFC, with TSFC scaled by sqrt(temperature) and by
 *      Mach the way a high-bypass turbofan really behaves. Turboprops and
 *      pistons go through a shaft-power/PSFC path instead; helicopters through
 *      an induced + profile + parasite power model.
 *   7. Mass is decremented as fuel burns, so the aeroplane genuinely gets
 *      lighter and cheaper to fly as the leg goes on.
 *
 * The same integrator then flies a synthetic version of the *planned* mission
 * (taxi, climb, cruise at the type's optimum, descent, taxi) to work out what
 * the block fuel would plausibly have been at pushback, which is what makes
 * "fuel remaining", "endurance" and "reserve on arrival" possible at all. When
 * the pilot filed a dispatch plan through the app, its `fuel_used` figure wins
 * over the model.
 *
 * Everything it produces is an estimate, and the UI says so — see the
 * confidence block, which degrades when the airframe is unknown, the trail is
 * short or gappy, or no filed plan anchors the block fuel.
 *
 * Dependency-free and shared by all three flight-info windows exactly like
 * flight-graph.js: the numbers are computed host-side (flight.js) where the
 * telemetry lives, and the plain result is rendered identically in the full
 * avionics window and inside the simple / card window iframes.
 *
 * Exposes window.FuelEstimator = { estimate, renderHTML, resolveModel, AIRCRAFT }.
 */
(function (global) {
    'use strict';

    // ── Physical constants ────────────────────────────────────────────────
    const G0        = 9.80665;      // m/s²
    const R_AIR     = 287.053;      // J/(kg·K)
    const GAMMA     = 1.4;
    const T0        = 288.15;       // K, ISA sea level
    const P0        = 101325;       // Pa
    const RHO0      = 1.225;        // kg/m³
    const LAPSE     = 0.0065;       // K/m
    const TROPO_M   = 11000;        // m
    const T_TROPO   = 216.65;       // K
    const P_TROPO   = 22632.06;     // Pa

    const FT_TO_M   = 0.3048;
    const KT_TO_MS  = 0.514444;
    const NM_TO_M   = 1852;
    const KG_TO_LB  = 2.20462;

    // Jet A-1 at 15 °C. Fuel is uplifted by volume and burned by mass, so the
    // density matters whenever we quote litres or convert a published tank
    // capacity.
    const JET_KG_PER_L   = 0.804;
    const AVGAS_KG_PER_L = 0.72;

    // Combustion of kerosene: every kilogram burned puts ~3.16 kg of CO2 into
    // the air (the carbon in the fuel plus the oxygen it grabs).
    const CO2_PER_KG_JET   = 3.16;
    const CO2_PER_KG_AVGAS = 3.10;

    // ── Model assumptions the user can reason about ───────────────────────
    const LOAD_FACTOR      = 0.82;   // typical revenue load on a scheduled leg
    const PAX_PLUS_BAG_KG  = 100;    // industry standard body + checked bag
    const TAXI_OUT_MIN     = 12;     // minutes of engine-running taxi before roll
    const TAXI_IN_MIN      = 5;
    const CONTINGENCY_PCT  = 0.05;   // 5 % of trip fuel, ICAO Annex 6
    const ALTERNATE_NM     = 150;    // a plausible diversion leg
    const FINAL_RESERVE_MIN = 30;    // 30 min holding at 1500 ft
    const LEG_SPLIT_MIN    = 20;     // ground time that ends a leg and starts a new one

    // ── Aircraft performance database ─────────────────────────────────────
    // One row per airframe the sim flies. Sources are the manufacturers'
    // published airport-planning documents and type certificate data sheets;
    // where a figure varies by operator (tank options, engine choice) the most
    // common configuration is used and noted.
    //
    //   mtow/oew/maxFuel  kg          | s      wing area, m²
    //   b                 span, m     | cd0    zero-lift drag coefficient, clean
    //   e                 Oswald span efficiency
    //   eng               engine count
    //   thrust            SLS thrust per engine, N        (jets)
    //   tsfc              cruise TSFC, kg/(N·h), at FL350 ISA and Mcr
    //   powerKw           SLS shaft power per engine, kW  (props)
    //   psfc              shaft SFC, kg/(kW·h)            (props)
    //   propEff           cruise propulsive efficiency    (props)
    //   mcr               design cruise Mach (jets) or cruise TAS ratio anchor
    //   optAlt            typical optimum cruise altitude, ft
    //   pax               typical two-class seat count
    //   payload           typical revenue payload at LOAD_FACTOR, kg
    const A = (o) => o;
    const AIRCRAFT = {
        // ── Airbus narrowbody ────────────────────────────────────────────
        A318: A({ label: 'Airbus A318-100', kind: 'jet', mtow: 68000, oew: 39500, maxFuel: 19200, s: 122.6, b: 34.1, cd0: 0.0216, e: 0.82, eng: 2, thrust: 96000, tsfc: 0.0600, mcr: 0.78, optAlt: 37000, pax: 107, payload: 9400 }),
        A319: A({ label: 'Airbus A319-100', kind: 'jet', mtow: 75500, oew: 40800, maxFuel: 19180, s: 122.6, b: 34.1, cd0: 0.0212, e: 0.82, eng: 2, thrust: 104500, tsfc: 0.0595, mcr: 0.78, optAlt: 37000, pax: 124, payload: 10800 }),
        A320: A({ label: 'Airbus A320-200', kind: 'jet', mtow: 78000, oew: 42600, maxFuel: 19180, s: 122.6, b: 34.1, cd0: 0.0208, e: 0.82, eng: 2, thrust: 120000, tsfc: 0.0590, mcr: 0.78, optAlt: 37000, pax: 150, payload: 13100 }),
        A20N: A({ label: 'Airbus A320neo',  kind: 'jet', mtow: 79000, oew: 44300, maxFuel: 19180, s: 122.6, b: 35.8, cd0: 0.0202, e: 0.85, eng: 2, thrust: 120600, tsfc: 0.0530, mcr: 0.78, optAlt: 38000, pax: 165, payload: 14400 }),
        A321: A({ label: 'Airbus A321-200', kind: 'jet', mtow: 93500, oew: 48500, maxFuel: 24140, s: 122.6, b: 34.1, cd0: 0.0214, e: 0.82, eng: 2, thrust: 147000, tsfc: 0.0600, mcr: 0.78, optAlt: 36000, pax: 185, payload: 16200 }),
        A21N: A({ label: 'Airbus A321neo',  kind: 'jet', mtow: 97000, oew: 50100, maxFuel: 26700, s: 122.6, b: 35.8, cd0: 0.0206, e: 0.85, eng: 2, thrust: 147000, tsfc: 0.0535, mcr: 0.78, optAlt: 37000, pax: 200, payload: 17500 }),

        // ── Airbus widebody ──────────────────────────────────────────────
        A333: A({ label: 'Airbus A330-300', kind: 'jet', mtow: 242000, oew: 129400, maxFuel: 78400, s: 361.6, b: 60.3, cd0: 0.0182, e: 0.85, eng: 2, thrust: 316000, tsfc: 0.0565, mcr: 0.82, optAlt: 37000, pax: 277, payload: 26000 }),
        A339: A({ label: 'Airbus A330-900neo', kind: 'jet', mtow: 251000, oew: 132500, maxFuel: 89500, s: 361.6, b: 64.0, cd0: 0.0174, e: 0.87, eng: 2, thrust: 324000, tsfc: 0.0510, mcr: 0.82, optAlt: 39000, pax: 287, payload: 27000 }),
        A346: A({ label: 'Airbus A340-600', kind: 'jet', mtow: 380000, oew: 177000, maxFuel: 164400, s: 439.4, b: 63.45, cd0: 0.0186, e: 0.84, eng: 4, thrust: 249000, tsfc: 0.0570, mcr: 0.83, optAlt: 37000, pax: 326, payload: 32000 }),
        A359: A({ label: 'Airbus A350-900', kind: 'jet', mtow: 280000, oew: 142400, maxFuel: 113400, s: 442.0, b: 64.75, cd0: 0.0180, e: 0.87, eng: 2, thrust: 374500, tsfc: 0.0495, mcr: 0.85, optAlt: 39000, pax: 315, payload: 30000 }),
        A388: A({ label: 'Airbus A380-800', kind: 'jet', mtow: 575000, oew: 277000, maxFuel: 257000, s: 845.0, b: 79.75, cd0: 0.0150, e: 0.88, eng: 4, thrust: 311000, tsfc: 0.0530, mcr: 0.85, optAlt: 39000, pax: 545, payload: 52000 }),

        // ── Boeing narrowbody ────────────────────────────────────────────
        B712: A({ label: 'Boeing 717-200',  kind: 'jet', mtow: 54900, oew: 31000, maxFuel: 13900, s: 92.97, b: 28.45, cd0: 0.0205, e: 0.80, eng: 2, thrust: 82300, tsfc: 0.0640, mcr: 0.77, optAlt: 34000, pax: 106, payload: 9300 }),
        B737: A({ label: 'Boeing 737-700',  kind: 'jet', mtow: 70080, oew: 38150, maxFuel: 20890, s: 124.6, b: 34.3, cd0: 0.0212, e: 0.82, eng: 2, thrust: 101000, tsfc: 0.0605, mcr: 0.785, optAlt: 37000, pax: 126, payload: 11000 }),
        B738: A({ label: 'Boeing 737-800',  kind: 'jet', mtow: 79010, oew: 41410, maxFuel: 20890, s: 124.6, b: 34.3, cd0: 0.0210, e: 0.82, eng: 2, thrust: 117000, tsfc: 0.0610, mcr: 0.785, optAlt: 37000, pax: 162, payload: 14200 }),
        B739: A({ label: 'Boeing 737-900ER', kind: 'jet', mtow: 85130, oew: 44680, maxFuel: 25820, s: 124.6, b: 34.3, cd0: 0.0214, e: 0.82, eng: 2, thrust: 121000, tsfc: 0.0615, mcr: 0.785, optAlt: 36000, pax: 178, payload: 15600 }),
        B38M: A({ label: 'Boeing 737 MAX 8', kind: 'jet', mtow: 82190, oew: 45070, maxFuel: 20820, s: 127.0, b: 35.9, cd0: 0.0201, e: 0.85, eng: 2, thrust: 130000, tsfc: 0.0530, mcr: 0.79, optAlt: 38000, pax: 178, payload: 15600 }),
        B752: A({ label: 'Boeing 757-200',  kind: 'jet', mtow: 115680, oew: 58390, maxFuel: 34970, s: 185.25, b: 38.05, cd0: 0.0186, e: 0.84, eng: 2, thrust: 178000, tsfc: 0.0600, mcr: 0.80, optAlt: 38000, pax: 200, payload: 17500 }),

        // ── Boeing widebody ──────────────────────────────────────────────
        B742: A({ label: 'Boeing 747-200B', kind: 'jet', mtow: 377800, oew: 174000, maxFuel: 160100, s: 511.0, b: 59.6, cd0: 0.0192, e: 0.82, eng: 4, thrust: 222400, tsfc: 0.0700, mcr: 0.84, optAlt: 35000, pax: 366, payload: 34000 }),
        B744: A({ label: 'Boeing 747-400',  kind: 'jet', mtow: 396900, oew: 183500, maxFuel: 174300, s: 541.2, b: 64.4, cd0: 0.0178, e: 0.85, eng: 4, thrust: 282000, tsfc: 0.0605, mcr: 0.855, optAlt: 35000, pax: 416, payload: 39000 }),
        B748: A({ label: 'Boeing 747-8',    kind: 'jet', mtow: 447700, oew: 220100, maxFuel: 195400, s: 554.0, b: 68.4, cd0: 0.0170, e: 0.87, eng: 4, thrust: 296000, tsfc: 0.0530, mcr: 0.86, optAlt: 37000, pax: 467, payload: 44000 }),
        B763: A({ label: 'Boeing 767-300ER', kind: 'jet', mtow: 186880, oew: 90010, maxFuel: 72980, s: 283.3, b: 47.57, cd0: 0.0173, e: 0.85, eng: 2, thrust: 273000, tsfc: 0.0590, mcr: 0.80, optAlt: 37000, pax: 261, payload: 24000 }),
        B772: A({ label: 'Boeing 777-200ER', kind: 'jet', mtow: 297560, oew: 138100, maxFuel: 137600, s: 427.8, b: 60.9, cd0: 0.0185, e: 0.84, eng: 2, thrust: 415000, tsfc: 0.0555, mcr: 0.84, optAlt: 37000, pax: 313, payload: 30000 }),
        B77L: A({ label: 'Boeing 777-200LR', kind: 'jet', mtow: 347450, oew: 145150, maxFuel: 162900, s: 427.8, b: 64.8, cd0: 0.0184, e: 0.85, eng: 2, thrust: 489000, tsfc: 0.0545, mcr: 0.84, optAlt: 38000, pax: 317, payload: 30000 }),
        B77W: A({ label: 'Boeing 777-300ER', kind: 'jet', mtow: 351530, oew: 167800, maxFuel: 145800, s: 427.8, b: 64.8, cd0: 0.0188, e: 0.85, eng: 2, thrust: 513000, tsfc: 0.0550, mcr: 0.84, optAlt: 36000, pax: 396, payload: 38000 }),
        B788: A({ label: 'Boeing 787-8',    kind: 'jet', mtow: 227930, oew: 119950, maxFuel: 101600, s: 377.0, b: 60.12, cd0: 0.0178, e: 0.87, eng: 2, thrust: 280000, tsfc: 0.0495, mcr: 0.85, optAlt: 39000, pax: 248, payload: 23000 }),
        B789: A({ label: 'Boeing 787-9',    kind: 'jet', mtow: 254010, oew: 128850, maxFuel: 101600, s: 377.0, b: 60.12, cd0: 0.0178, e: 0.87, eng: 2, thrust: 320000, tsfc: 0.0495, mcr: 0.85, optAlt: 39000, pax: 296, payload: 27000 }),
        B78X: A({ label: 'Boeing 787-10',   kind: 'jet', mtow: 254010, oew: 135500, maxFuel: 101600, s: 377.0, b: 60.12, cd0: 0.0181, e: 0.87, eng: 2, thrust: 340000, tsfc: 0.0500, mcr: 0.85, optAlt: 38000, pax: 336, payload: 31000 }),

        // ── Regional jets ────────────────────────────────────────────────
        CRJ2: A({ label: 'Bombardier CRJ-200', kind: 'jet', mtow: 24040, oew: 13835, maxFuel: 6489, s: 48.35, b: 21.21, cd0: 0.0215, e: 0.81, eng: 2, thrust: 38800, tsfc: 0.0730, mcr: 0.74, optAlt: 35000, pax: 50, payload: 4400 }),
        CRJ7: A({ label: 'Bombardier CRJ-700', kind: 'jet', mtow: 34020, oew: 19731, maxFuel: 8888, s: 70.61, b: 23.24, cd0: 0.0205, e: 0.82, eng: 2, thrust: 61300, tsfc: 0.0680, mcr: 0.78, optAlt: 37000, pax: 70, payload: 6100 }),
        CRJ9: A({ label: 'Bombardier CRJ-900', kind: 'jet', mtow: 38330, oew: 21845, maxFuel: 8888, s: 70.61, b: 24.85, cd0: 0.0205, e: 0.82, eng: 2, thrust: 64500, tsfc: 0.0680, mcr: 0.78, optAlt: 37000, pax: 86, payload: 7500 }),
        CRJX: A({ label: 'Bombardier CRJ-1000', kind: 'jet', mtow: 41640, oew: 23179, maxFuel: 8888, s: 77.4, b: 26.18, cd0: 0.0207, e: 0.82, eng: 2, thrust: 64500, tsfc: 0.0685, mcr: 0.78, optAlt: 37000, pax: 100, payload: 8700 }),
        E175: A({ label: 'Embraer E175',  kind: 'jet', mtow: 40370, oew: 21810, maxFuel: 9335, s: 72.72, b: 26.0, cd0: 0.0200, e: 0.83, eng: 2, thrust: 62300, tsfc: 0.0675, mcr: 0.78, optAlt: 37000, pax: 78, payload: 6800 }),
        E190: A({ label: 'Embraer E190',  kind: 'jet', mtow: 51800, oew: 28080, maxFuel: 12971, s: 92.53, b: 28.72, cd0: 0.0195, e: 0.83, eng: 2, thrust: 82300, tsfc: 0.0660, mcr: 0.78, optAlt: 37000, pax: 100, payload: 8700 }),

        // ── Trijets ──────────────────────────────────────────────────────
        DC10: A({ label: 'McDonnell Douglas DC-10-30', kind: 'jet', mtow: 259450, oew: 121200, maxFuel: 87600, s: 367.7, b: 50.4, cd0: 0.0192, e: 0.82, eng: 3, thrust: 233500, tsfc: 0.0680, mcr: 0.82, optAlt: 33000, pax: 285, payload: 27000 }),
        MD11: A({ label: 'McDonnell Douglas MD-11', kind: 'jet', mtow: 285990, oew: 132500, maxFuel: 94400, s: 338.9, b: 51.66, cd0: 0.0188, e: 0.84, eng: 3, thrust: 273500, tsfc: 0.0620, mcr: 0.82, optAlt: 35000, pax: 293, payload: 28000 }),

        // ── Turboprops ───────────────────────────────────────────────────
        DH8D: A({ label: 'De Havilland Dash 8 Q400', kind: 'prop', mtow: 29574, oew: 17819, maxFuel: 5318, s: 63.08, b: 28.42, cd0: 0.0270, e: 0.80, eng: 2, powerKw: 3781, psfc: 0.245, propEff: 0.82, mcr: 0.50, optAlt: 25000, pax: 78, payload: 6800 }),
        C208: A({ label: 'Cessna 208 Caravan', kind: 'prop', mtow: 3629, oew: 2145, maxFuel: 1010, s: 25.96, b: 15.88, cd0: 0.0340, e: 0.78, eng: 1, powerKw: 503, psfc: 0.360, propEff: 0.80, mcr: 0.28, optAlt: 12000, pax: 9, payload: 800 }),

        // ── Piston / light ───────────────────────────────────────────────
        C172: A({ label: 'Cessna 172', kind: 'piston', mtow: 1157, oew: 767, maxFuel: 153, s: 16.2, b: 11.0, cd0: 0.0320, e: 0.75, eng: 1, powerKw: 134, psfc: 0.320, propEff: 0.78, mcr: 0.18, optAlt: 8000, pax: 3, payload: 220, fuelKgPerL: AVGAS_KG_PER_L }),
        SR22: A({ label: 'Cirrus SR22', kind: 'piston', mtow: 1633, oew: 1034, maxFuel: 251, s: 13.46, b: 11.68, cd0: 0.0260, e: 0.78, eng: 1, powerKw: 231, psfc: 0.310, propEff: 0.80, mcr: 0.28, optAlt: 12000, pax: 3, payload: 260, fuelKgPerL: AVGAS_KG_PER_L }),
        XCUB: A({ label: 'CubCrafters XCub', kind: 'piston', mtow: 998, oew: 590, maxFuel: 98, s: 16.6, b: 10.5, cd0: 0.0450, e: 0.72, eng: 1, powerKw: 134, psfc: 0.330, propEff: 0.76, mcr: 0.16, optAlt: 6000, pax: 1, payload: 110, fuelKgPerL: AVGAS_KG_PER_L }),
        SPIT: A({ label: 'Supermarine Spitfire', kind: 'piston', mtow: 3000, oew: 2300, maxFuel: 278, s: 22.5, b: 11.23, cd0: 0.0215, e: 0.78, eng: 1, powerKw: 1096, psfc: 0.340, propEff: 0.80, mcr: 0.45, optAlt: 20000, pax: 0, payload: 100, fuelKgPerL: AVGAS_KG_PER_L }),

        // ── Business jet ─────────────────────────────────────────────────
        C750: A({ label: 'Cessna Citation X', kind: 'jet', mtow: 16375, oew: 9979, maxFuel: 5987, s: 48.96, b: 21.09, cd0: 0.0210, e: 0.81, eng: 2, thrust: 28900, tsfc: 0.0680, mcr: 0.90, optAlt: 43000, pax: 9, payload: 800 }),

        // ── Military ─────────────────────────────────────────────────────
        F16:  A({ label: 'F-16 Fighting Falcon', kind: 'jet', mtow: 19187, oew: 8570, maxFuel: 3200, s: 27.87, b: 9.96, cd0: 0.0220, e: 0.72, eng: 1, thrust: 76300, tsfc: 0.0800, mcr: 0.90, optAlt: 36000, pax: 0, payload: 1500, military: true }),
        F18:  A({ label: 'F/A-18 Super Hornet', kind: 'jet', mtow: 29937, oew: 14552, maxFuel: 6530, s: 46.5, b: 13.62, cd0: 0.0230, e: 0.72, eng: 2, thrust: 62300, tsfc: 0.0810, mcr: 0.90, optAlt: 36000, pax: 0, payload: 2000, military: true }),
        F22:  A({ label: 'F-22 Raptor', kind: 'jet', mtow: 38000, oew: 19700, maxFuel: 8200, s: 78.04, b: 13.56, cd0: 0.0210, e: 0.74, eng: 2, thrust: 116000, tsfc: 0.0800, mcr: 0.95, optAlt: 40000, pax: 0, payload: 2000, military: true }),
        F14:  A({ label: 'F-14 Tomcat', kind: 'jet', mtow: 33720, oew: 18190, maxFuel: 7348, s: 54.5, b: 19.55, cd0: 0.0250, e: 0.72, eng: 2, thrust: 73000, tsfc: 0.0860, mcr: 0.90, optAlt: 35000, pax: 0, payload: 2000, military: true }),
        A10:  A({ label: 'A-10 Thunderbolt II', kind: 'jet', mtow: 23000, oew: 11321, maxFuel: 4990, s: 47.0, b: 17.53, cd0: 0.0320, e: 0.78, eng: 2, thrust: 40300, tsfc: 0.0720, mcr: 0.55, optAlt: 25000, pax: 0, payload: 3000, military: true }),
        C130: A({ label: 'C-130 Hercules', kind: 'prop', mtow: 79380, oew: 34274, maxFuel: 20820, s: 162.1, b: 40.4, cd0: 0.0310, e: 0.78, eng: 4, powerKw: 3458, psfc: 0.270, propEff: 0.80, mcr: 0.58, optAlt: 28000, pax: 0, payload: 15000, military: true }),
        C17:  A({ label: 'C-17 Globemaster III', kind: 'jet', mtow: 265350, oew: 128100, maxFuel: 102614, s: 353.0, b: 51.75, cd0: 0.0250, e: 0.80, eng: 4, thrust: 180100, tsfc: 0.0620, mcr: 0.77, optAlt: 33000, pax: 0, payload: 45000, military: true }),

        // ── Rotary ───────────────────────────────────────────────────────
        HELI: A({ label: 'Rotorcraft', kind: 'heli', mtow: 9979, oew: 5224, maxFuel: 1360, rotorR: 8.18, eng: 2, powerKw: 1447, psfc: 0.330, flatPlate: 2.3, s: 20, b: 16, cd0: 0.05, e: 0.7, mcr: 0.22, optAlt: 5000, pax: 11, payload: 1000 })
    };

    // Ordered name matchers. Ordering matters: "737 MAX 8" must be tested
    // before the generic "737", and "747-8" before "747". The API sends the
    // manufacturer's marketing name ("Boeing 787-9", "Airbus A350"), and the
    // community aircraft database sometimes sends the ICAO code instead, so
    // both spellings are accepted.
    const MATCHERS = [
        [/A318/,                                   'A318'],
        [/A319/,                                   'A319'],
        [/A320\s*NEO|A20N/,                        'A20N'],
        [/A321\s*NEO|A21N/,                        'A21N'],
        [/A320|A32[0]?-?200/,                      'A320'],
        [/A321/,                                   'A321'],
        [/A330-?900|A330\s*NEO|A339|A338/,         'A339'],
        [/A330|A333|A332/,                         'A333'],
        [/A340|A346|A343/,                         'A346'],
        [/A350|A359|A35K/,                         'A359'],
        [/A380|A388/,                              'A388'],
        [/717|B712/,                               'B712'],
        [/737\s*MAX|B3[78]M|MAX\s*8/,              'B38M'],
        [/737-?900|B739/,                          'B739'],
        [/737-?800|B738/,                          'B738'],
        [/737-?700|B737/,                          'B737'],
        [/737/,                                    'B738'],
        [/747-?8|B748/,                            'B748'],
        [/747-?400|B744/,                          'B744'],
        [/747-?200|B742/,                          'B742'],
        [/747/,                                    'B744'],
        [/757|B75/,                                'B752'],
        [/767|B76/,                                'B763'],
        [/777-?300|B77W/,                          'B77W'],
        [/777-?200\s*LR|B77L/,                     'B77L'],
        [/777-?200|B772|777F|B77F/,                'B772'],
        [/777/,                                    'B77W'],
        [/787-?10|B78X/,                           'B78X'],
        [/787-?9|B789/,                            'B789'],
        [/787-?8|B788|787/,                        'B788'],
        [/CRJ-?1000|CRJX/,                         'CRJX'],
        [/CRJ-?900|CRJ9/,                          'CRJ9'],
        [/CRJ-?700|CRJ7/,                          'CRJ7'],
        [/CRJ-?200|CRJ2|CRJ/,                      'CRJ2'],
        [/E19[05]|E-?JET\s*190|EMBRAER\s*190|ERJ-?190/, 'E190'],
        [/E17[05]|EMBRAER\s*17[05]|ERJ-?17[05]/,   'E175'],
        [/DASH\s*8|Q400|DH8/,                      'DH8D'],
        [/MD-?11|MD11/,                            'MD11'],
        [/DC-?10|KC-?10|DC10/,                     'DC10'],
        [/CARAVAN|C208|208B/,                      'C208'],
        [/CITATION|C750|CIT\s*X/,                  'C750'],
        [/SR-?22|SR22|CIRRUS/,                     'SR22'],
        [/XCUB|CUB/,                               'XCUB'],
        [/SPITFIRE/,                               'SPIT'],
        [/C-?172|CESSNA\s*172|SKYHAWK|C172/,       'C172'],
        [/F-?22|RAPTOR/,                           'F22'],
        [/F-?18|F\/A-?18|HORNET/,                  'F18'],
        [/F-?16|FALCON|VIPER/,                     'F16'],
        [/F-?14|TOMCAT/,                           'F14'],
        [/A-?10|WARTHOG|THUNDERBOLT/,              'A10'],
        [/C-?130|HERCULES|AC-?130/,                'C130'],
        [/C-?17|GLOBEMASTER/,                      'C17'],
        [/EUROCOPTER|HELICOPTER|ROTORCRAFT|UH-?60|AH-?64|CHINOOK|LYNX|EC-?135|H1[235]/, 'HELI']
    ];

    /**
     * Map an aircraft name onto a performance model.
     * `source` records how confident that mapping is, which the confidence
     * score below reads: an exact hit on the matcher table is worth far more
     * than the generic narrowbody fallback.
     */
    function resolveModel(aircraftName) {
        const raw = String(aircraftName || '').toUpperCase().trim();
        if (!raw) return { key: 'A320', model: AIRCRAFT.A320, source: 'generic', input: '' };
        // Collapse punctuation so "A350-900", "A350 900" and "A350900" all match.
        const name = raw.replace(/[_.]/g, ' ').replace(/\s+/g, ' ');
        for (const [re, key] of MATCHERS) {
            if (re.test(name)) return { key, model: AIRCRAFT[key], source: 'exact', input: raw };
        }
        // Nothing recognised — fall back to a mid-size narrowbody, which is the
        // most common thing in the sky and the least wrong average guess.
        return { key: 'A320', model: AIRCRAFT.A320, source: 'generic', input: raw };
    }

    // ── Atmosphere ────────────────────────────────────────────────────────
    /**
     * ISA properties at a pressure altitude, optionally shifted by a measured
     * outside air temperature or by a temperature deviation from standard.
     * Density is what the aerodynamics care about, so a hot day genuinely shows
     * up as more thrust needed for the same lift.
     *
     * `isaDevC` exists because we only ever get one OAT reading — the one at
     * the aircraft's present altitude. Deviation from ISA is roughly constant
     * through an airmass, so carrying the *deviation* down the trail is right
     * where carrying the absolute temperature would be badly wrong.
     */
    function atmosphere(altFt, oatC, isaDevC) {
        const h = Math.max(-500, altFt) * FT_TO_M;
        let tIsa, p;
        if (h < TROPO_M) {
            tIsa = T0 - LAPSE * h;
            p = P0 * Math.pow(tIsa / T0, G0 / (LAPSE * R_AIR));
        } else {
            tIsa = T_TROPO;
            p = P_TROPO * Math.exp(-G0 * (h - TROPO_M) / (R_AIR * T_TROPO));
        }
        // A reported OAT replaces the standard-day temperature; pressure stays
        // as measured by the altimeter, so density follows the real gas law.
        let t = tIsa;
        if (typeof oatC === 'number' && isFinite(oatC) && oatC > -100 && oatC < 60) {
            t = oatC + 273.15;
        } else if (typeof isaDevC === 'number' && isFinite(isaDevC)) {
            t = tIsa + Math.max(-40, Math.min(40, isaDevC));
        }
        const rho = p / (R_AIR * t);
        return {
            t, tIsa, p, rho,
            sigma: rho / RHO0,
            theta: t / T0,
            a: Math.sqrt(GAMMA * R_AIR * t),
            deltaIsa: t - tIsa
        };
    }

    // ── Propulsion ────────────────────────────────────────────────────────
    /** Thrust available from one engine at this density ratio and Mach. */
    function thrustAvailable(m, atm, mach) {
        if (m.kind === 'jet') {
            // High-bypass turbofans lapse roughly with sigma^0.75 and lose
            // static thrust with forward speed; low-bypass military engines
            // lapse less steeply and recover some ram thrust at high Mach.
            const n = m.military ? 0.85 : 0.75;
            const machLoss = m.military
                ? Math.max(0.55, 1 - 0.25 * mach)
                : Math.max(0.35, 1 - 0.40 * mach + 0.06 * mach * mach);
            return m.thrust * Math.pow(Math.max(0.02, atm.sigma), n) * machLoss;
        }
        return 0; // props are handled through shaft power
    }

    /** Shaft power available from one engine, W. */
    function powerAvailable(m, atm) {
        return (m.powerKw || 0) * 1000 * Math.pow(Math.max(0.02, atm.sigma), 0.8);
    }

    /**
     * Cruise-referenced TSFC scaled to the current condition. TSFC rises with
     * the square root of inlet temperature and grows with Mach as the engine
     * has to accelerate faster-moving air; that is why a jet at FL100 and
     * 250 kt is far thirstier per unit thrust than the same jet in the cruise.
     */
    function tsfcAt(m, atm, mach) {
        const tRef = T0 - LAPSE * (35000 * FT_TO_M); // FL350 ISA
        const tempTerm = Math.sqrt(atm.t / tRef);
        const machTerm = 0.55 + 0.45 * (mach / Math.max(0.2, m.mcr));
        return m.tsfc * tempTerm * Math.max(0.45, machTerm); // kg/(N·h)
    }

    /** Per-engine idle fuel flow, kg/h. Falls off with density like the core. */
    function idleFlowKgH(m, atm) {
        const base = m.kind === 'jet'
            ? Math.max(35, 0.0010 * m.thrust)
            : Math.max(12, 0.055 * (m.powerKw || 100));
        return base * (0.25 + 0.75 * Math.max(0.05, Math.min(1, atm.sigma)));
    }

    /** APU burn while the aircraft sits on the ground, kg/h. */
    function apuFlowKgH(m) {
        return Math.max(30, Math.min(250, 0.00035 * m.mtow));
    }

    // ── Aerodynamics ──────────────────────────────────────────────────────
    /**
     * Reference speeds derived from the type's own wing loading, cached on the
     * model. "Slow" has to mean slow *for this aeroplane* — 120 kt is a
     * flaps-and-gear approach in an A320 and a brisk cruise in a Cub — so
     * every speed-based heuristic below is scaled against these instead of
     * against a fixed number of knots.
     */
    function refSpeeds(m) {
        if (m.__ref) return m.__ref;
        const clMaxLdg = (m.kind === 'jet' && !m.military) ? 2.4 : (m.kind === 'prop' ? 2.2 : 1.9);
        const vAppMs = Math.sqrt((2 * 0.85 * m.mtow * G0) / (RHO0 * m.s * clMaxLdg));
        const cruiseAtm = atmosphere(m.optAlt);
        m.__ref = {
            vAppKt: vAppMs / KT_TO_MS,
            vCruiseKt: (m.mcr * cruiseAtm.a) / KT_TO_MS,
            vCruiseMs: m.mcr * cruiseAtm.a
        };
        return m.__ref;
    }

    /**
     * Drag coefficient from the type's polar: induced drag from the lift it is
     * currently making, wave drag once it pushes past its drag-divergence
     * Mach, and a configuration penalty when it is slow and low enough to be
     * flying with flaps and gear extended.
     */
    function dragCoefficient(m, cl, mach, altFt, tasKt) {
        const ar = (m.b * m.b) / m.s;
        let cd = m.cd0 + (cl * cl) / (Math.PI * ar * m.e);

        // Drag-divergence Mach falls as the wing is asked to work harder, so a
        // heavy aeroplane high up hits the rise earlier than a light one.
        const mdd = m.mcr + 0.015 - 0.10 * Math.max(0, cl - 0.45);
        if (mach > mdd) {
            // Lock's fourth-power law for the transonic drag rise, bounded so a
            // bad telemetry sample can't produce an absurd number.
            cd += Math.min(0.08, 20 * Math.pow(mach - mdd, 4));
        }

        // Approach / departure configuration. Without a radio altimeter the
        // only proxy is speed, judged against this type's own approach speed.
        if (altFt < 10000 && m.kind !== 'heli') {
            const va = refSpeeds(m).vAppKt;
            if (tasKt < va * 1.80) cd += 0.020;                            // flaps
            if (tasKt < va * 1.45 && altFt < 4000) cd += 0.015;            // gear
        }
        return cd;
    }

    // ── Core: fuel flow at a single flight condition ──────────────────────
    /**
     * The heart of the model. Given where the aeroplane is, how fast, how
     * heavy and how hard it is climbing or accelerating, work out the thrust
     * it must be making and therefore how fast it is burning fuel.
     *
     * @returns {{kgPerHr:number, thrustN:number, dragN:number, cl:number,
     *            mach:number, throttle:number, mode:string}}
     */
    function fuelFlowAt(m, st) {
        const altFt  = st.altFt || 0;
        const massKg = Math.max(1, st.massKg);
        const atm    = atmosphere(altFt, st.oatC, st.isaDevC);
        const tas    = Math.max(0, st.tasKt || 0);
        const v      = tas * KT_TO_MS;
        const mach   = v / atm.a;

        // ── On the ground ────────────────────────────────────────────────
        // Below taxi speed there is no useful aerodynamic model; engines are
        // at or near idle and the APU is typically running.
        if (st.onGround) {
            const idle = idleFlowKgH(m, atm) * (m.eng || 1);
            const moving = tas > 3;
            const kgPerHr = idle * (moving ? 1.0 : 0.55) + apuFlowKgH(m);
            return { kgPerHr, thrustN: 0, dragN: 0, cl: 0, mach, throttle: 0.05, mode: moving ? 'taxi' : 'ground' };
        }

        if (m.kind === 'heli') return heliFlow(m, st, atm, tas);

        // ── Airborne ─────────────────────────────────────────────────────
        // Flight path angle from vertical speed against the air-mass velocity.
        const vsMs  = (st.vsFpm || 0) * FT_TO_M / 60;
        const gamma = v > 5 ? Math.asin(Math.max(-1, Math.min(1, vsMs / v))) : 0;

        // Lift balances the component of weight perpendicular to the path.
        const q = 0.5 * atm.rho * v * v;
        const cl = (q > 1 && m.s) ? (massKg * G0 * Math.cos(gamma)) / (q * m.s) : 0.5;
        const clSafe = Math.max(0, Math.min(2.2, cl));

        const cd    = dragCoefficient(m, clSafe, mach, altFt, tas);
        const dragN = cd * q * m.s;

        // Thrust = drag + the weight component being climbed against + the
        // force going into accelerating. Acceleration is clamped because it is
        // differentiated from noisy ground-speed samples.
        const accel = Math.max(-1.5, Math.min(1.5, st.accelMs2 || 0));
        let thrustN = dragN + massKg * G0 * Math.sin(gamma) + massKg * accel;

        const perEngMax = (m.kind === 'jet')
            ? thrustAvailable(m, atm, mach)
            : (powerAvailable(m, atm) * (m.propEff || 0.8)) / Math.max(30, v);
        const maxThrust = perEngMax * (m.eng || 1);
        const clamped   = Math.max(0, Math.min(maxThrust, thrustN));
        const throttle  = maxThrust > 0 ? clamped / maxThrust : 0;

        let kgPerHr, mode;
        if (m.kind === 'jet') {
            kgPerHr = clamped * tsfcAt(m, atm, mach);
            // A jet gliding down still burns flight idle; the thrust equation
            // can ask for zero or negative thrust in a descent, and pretending
            // that costs nothing would understate the leg by several hundred kg.
            const idleFloor = idleFlowKgH(m, atm) * (m.eng || 1) * 0.85;
            if (kgPerHr < idleFloor) { kgPerHr = idleFloor; mode = 'idle'; }
        } else {
            // Props: convert required thrust back into shaft power through the
            // propeller, then burn fuel at the engine's shaft SFC. Propulsive
            // efficiency is poor when the disc is barely moving through the air
            // and peaks around the type's own cruise speed.
            const vRef = refSpeeds(m).vCruiseMs;
            const eff = Math.max(0.35, (m.propEff || 0.8) * Math.min(1, 0.45 + 0.55 * (v / Math.max(20, vRef))));
            const shaftW = (clamped * v) / eff;
            kgPerHr = (shaftW / 1000) * (m.psfc || 0.3);
            const idleFloor = idleFlowKgH(m, atm) * (m.eng || 1) * 0.9;
            if (kgPerHr < idleFloor) { kgPerHr = idleFloor; mode = 'idle'; }
        }

        if (!mode) {
            mode = (st.vsFpm > 300) ? 'climb' : (st.vsFpm < -300 ? 'descent' : 'cruise');
        }
        return { kgPerHr, thrustN: clamped, dragN, cl: clSafe, mach, throttle, mode };
    }

    /**
     * Rotorcraft power model: induced power to push air down through the disc,
     * profile power to drag the blades round, and parasite power to push the
     * fuselage through the air. Unlike a wing, a helicopter is thirstiest in
     * the hover and cheapest around 60–80 kt.
     */
    function heliFlow(m, st, atm, tasKt) {
        const massKg = Math.max(1, st.massKg);
        const w = massKg * G0;
        const area = Math.PI * m.rotorR * m.rotorR;
        const v = tasKt * KT_TO_MS;

        // Hover induced velocity, then the forward-flight solution of
        // v_i = v_h² / sqrt(V² + v_i²) by fixed-point iteration.
        const vh = Math.sqrt(w / (2 * atm.rho * area));
        let vi = vh;
        for (let i = 0; i < 12; i++) vi = (vh * vh) / Math.sqrt(v * v + vi * vi);

        const pInduced = 1.15 * w * vi;
        const pProfile = 0.085 * w * vh * (1 + 3.0 * Math.pow(v / Math.max(1, vh), 2));
        const pParasite = 0.5 * atm.rho * v * v * v * (m.flatPlate || 2.0);
        const pClimb = w * ((st.vsFpm || 0) * FT_TO_M / 60);

        const shaftW = Math.max(0.15 * pInduced, (pInduced + pProfile + pParasite + pClimb) / 0.97);
        const kgPerHr = (shaftW / 1000) * (m.psfc || 0.33);
        return {
            kgPerHr, thrustN: w, dragN: pParasite / Math.max(1, v), cl: 0,
            mach: v / atm.a, throttle: Math.min(1, shaftW / ((m.powerKw || 1000) * 1000 * (m.eng || 1))),
            mode: st.vsFpm > 300 ? 'climb' : (tasKt < 20 ? 'hover' : 'cruise')
        };
    }

    // ── Trail parsing (mirrors flight-graph.js / flight-legs.js) ──────────
    function pickNum() {
        for (let i = 0; i < arguments.length; i++) {
            const v = arguments[i];
            if (typeof v === 'number' && isFinite(v)) return v;
        }
        return null;
    }
    function pickTime() {
        for (let i = 0; i < arguments.length; i++) {
            const v = arguments[i];
            if (typeof v === 'number' && isFinite(v)) return v;
            if (typeof v === 'string' && v) { const t = Date.parse(v); if (!isNaN(t)) return t; }
        }
        return null;
    }
    function readPoint(p) {
        if (!p) return null;
        const o = p.position || {};
        const t = pickTime(p.date, p.time, p.timestamp, p.lastReportMs, o.lastReportMs, o.lastReport);
        if (t == null) return null;
        return {
            t,
            lat: pickNum(o.lat, o.latitude, p.lat, p.latitude),
            lon: pickNum(o.lon, o.longitude, p.lon, p.longitude),
            alt: pickNum(o.alt_ft, o.altitude, p.alt_ft, p.altitude, p.alt),
            gs:  pickNum(o.gs_kt, o.groundSpeed, p.gs_kt, p.groundSpeed, p.gs, p.speed),
            vs:  pickNum(o.vs_fpm, o.verticalSpeed, p.vs_fpm, p.verticalSpeed, p.vs)
        };
    }

    function greatCircleNm(lat1, lon1, lat2, lon2) {
        const toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / 1.852;
    }
    function bearingDeg(lat1, lon1, lat2, lon2) {
        const toRad = Math.PI / 180;
        const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
        const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad)
            - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    /**
     * Ground speed → true airspeed using a single sampled wind vector.
     *
     * We only ever get one wind reading (the aircraft's current position), so
     * applying it across the whole trail is an approximation — but it is the
     * same approximation every flight-planning system makes when it has one
     * forecast level, and it is far better than pretending the air is still.
     * Wind is tapered below FL100 where the boundary layer slows it down.
     */
    function tasFromGs(gsKt, trackDeg, altFt, wind) {
        if (!wind || !isFinite(wind.dirDeg) || !isFinite(wind.spdKt) || wind.spdKt <= 0 || trackDeg == null) {
            return gsKt;
        }
        const scale = altFt >= 10000 ? 1 : Math.sqrt(Math.max(0.15, altFt / 10000));
        const w = wind.spdKt * scale;
        // Meteorological convention: wind *from* dirDeg. The component along
        // the aircraft's track is a tailwind when it blows the way we're going.
        const tail = -w * Math.cos((wind.dirDeg - trackDeg) * Math.PI / 180);
        return Math.max(0, gsKt - tail);
    }

    // ── Trail integration ─────────────────────────────────────────────────
    /**
     * Walk the recorded track and accumulate fuel. Returns totals for the
     * whole trail plus the current leg, where a leg boundary is a sustained
     * ground stop — a pilot who flew A→B, parked, then flew B→C should see the
     * fuel for the leg they are on, not the sum of the day.
     */
    function integrateTrail(m, points, opts) {
        opts = opts || {};
        const startFuel = opts.startFuelKg;
        const zfw = opts.zfwKg;

        const pts = [];
        for (const raw of (points || [])) {
            const p = readPoint(raw);
            if (p && p.alt != null && p.gs != null) pts.push(p);
        }
        pts.sort((a, b) => a.t - b.t);

        const empty = {
            samples: pts.length, journeyKg: 0, legKg: 0, legStartMs: null,
            phases: { ground: 0, taxi: 0, climb: 0, cruise: 0, descent: 0, idle: 0, hover: 0 },
            gapMinutes: 0, spanMinutes: 0, airborneMinutes: 0, legs: 1, endMassKg: zfw + startFuel
        };
        if (pts.length < 2) return empty;

        const phases = { ground: 0, taxi: 0, climb: 0, cruise: 0, descent: 0, idle: 0, hover: 0 };
        let journeyKg = 0, legKg = 0, legStartMs = pts[0].t;
        let gapMs = 0, airborneMs = 0, legs = 1;
        let groundRunMs = 0, splitArmed = true;
        let mass = zfw + startFuel;

        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            let dtS = (b.t - a.t) / 1000;
            if (dtS <= 0) continue;
            // A gap longer than this is a dropped connection or a session
            // change rather than real flying. We still integrate it (the
            // aeroplane was somewhere burning something) but record it so the
            // confidence score can tell the user the trail has holes.
            if (dtS > 900) { gapMs += (dtS - 900) * 1000; }
            if (dtS > 7200) dtS = 7200;

            const altFt = (a.alt + b.alt) / 2;
            const gsKt  = (a.gs + b.gs) / 2;

            // Prefer a vertical speed derived from the altitude the aircraft
            // actually gained: reported v/s is instantaneous and noisy, while
            // the trail's own slope is exactly the climb that had to be paid for.
            const vsFpm = (b.alt - a.alt) / (dtS / 60);

            let track = null;
            if (a.lat != null && b.lat != null) track = bearingDeg(a.lat, a.lon, b.lat, b.lon);
            const tasKt = tasFromGs(gsKt, track, altFt, opts.wind);

            // Longitudinal acceleration over the segment, m/s².
            const accelMs2 = ((b.gs - a.gs) * KT_TO_MS) / dtS;

            // Ground detection without a radio altimeter: slow, level and low.
            const onGround = gsKt < 45 && Math.abs(vsFpm) < 250 && altFt < 15000;
            if (onGround) {
                groundRunMs += dtS * 1000;
                // A long stop ends the leg: reset the leg accumulator so the
                // headline number is the leg being flown right now. `splitArmed`
                // makes that fire once per stop — without it a 50-minute
                // turnaround would split the leg twice.
                if (splitArmed && groundRunMs > LEG_SPLIT_MIN * 60000 && legKg > 0) {
                    legs++; legKg = 0; legStartMs = b.t; splitArmed = false;
                }
            } else {
                groundRunMs = 0;
                splitArmed = true;
                airborneMs += dtS * 1000;
            }

            const r = fuelFlowAt(m, {
                altFt, tasKt, vsFpm, massKg: mass, accelMs2, onGround,
                isaDevC: opts.isaDevC
            });

            const burn = r.kgPerHr * (dtS / 3600);
            journeyKg += burn;
            legKg += burn;
            phases[r.mode] = (phases[r.mode] || 0) + burn;
            mass = Math.max(zfw, mass - burn);
        }

        return {
            samples: pts.length,
            journeyKg, legKg, legStartMs,
            phases,
            gapMinutes: gapMs / 60000,
            spanMinutes: (pts[pts.length - 1].t - pts[0].t) / 60000,
            airborneMinutes: airborneMs / 60000,
            legs,
            endMassKg: mass
        };
    }

    // ── Synthetic mission (planned block fuel) ────────────────────────────
    /**
     * Fly a textbook profile for a given distance so we know what the tanks
     * plausibly held at pushback. Without this there is no "remaining", no
     * endurance and no reserve — only "burned so far".
     *
     * The profile is deliberately conventional: taxi out, climb at the type's
     * normal rate to its optimum level (stepped down for short sectors), cruise
     * at Mcr, idle descent, taxi in.
     */
    function simulateMission(m, distanceNm, zfwKg, blockFuelGuessKg) {
        const dist = Math.max(1, distanceNm);
        // Short sectors never reach the optimum level; a 150 nm hop tops out
        // around FL240 no matter what the aeroplane could do.
        const cruiseAlt = Math.min(m.optAlt, 8000 + dist * 95);
        const cruiseMach = m.mcr;
        let mass = zfwKg + Math.max(0, blockFuelGuessKg);
        let fuel = 0;

        const burnFor = (minutes, state) => {
            const steps = Math.max(1, Math.ceil(minutes / 3));
            for (let i = 0; i < steps; i++) {
                const r = fuelFlowAt(m, Object.assign({ massKg: mass }, state));
                const b = r.kgPerHr * (minutes / steps) / 60;
                fuel += b; mass -= b;
            }
        };

        // Taxi out.
        burnFor(TAXI_OUT_MIN, { altFt: 0, tasKt: 12, vsFpm: 0, onGround: true });
        const taxiOutKg = fuel;

        // Climb: integrate in 2000 ft slices so the thinning air, rising TAS
        // and shrinking climb rate are all accounted for individually.
        let alt = 0, climbNm = 0, climbMin = 0;
        const slice = 2000;
        while (alt < cruiseAlt) {
            const top = Math.min(cruiseAlt, alt + slice);
            const midAlt = (alt + top) / 2;
            const atm = atmosphere(midAlt);
            // Climb TAS ramps from a 250 kt low-level restriction up to the
            // cruise Mach number.
            const machTarget = Math.min(cruiseMach, 0.42 + 0.45 * (midAlt / Math.max(1, cruiseAlt)));
            const tasKt = Math.max(160, (machTarget * atm.a) / KT_TO_MS);
            // Typical jet climb rate decays with altitude.
            const roc = Math.max(300, (m.kind === 'jet' ? 2400 : 1500) * (1 - 0.75 * midAlt / Math.max(1, m.optAlt)));
            const min = (top - alt) / roc;
            burnFor(min, { altFt: midAlt, tasKt, vsFpm: roc, onGround: false });
            climbNm += tasKt * (min / 60);
            climbMin += min;
            alt = top;
        }

        // Descent: idle from cruise, roughly a 3° path.
        const descAtm = atmosphere(cruiseAlt * 0.6);
        const descTas = Math.max(200, (cruiseMach * 0.85 * descAtm.a) / KT_TO_MS);
        const descRate = m.kind === 'jet' ? -1800 : -1200;
        const descMin = cruiseAlt / Math.abs(descRate);
        const descNm = descTas * (descMin / 60);

        // Cruise fills whatever distance climb and descent didn't cover.
        const cruiseAtm = atmosphere(cruiseAlt);
        const cruiseTas = (cruiseMach * cruiseAtm.a) / KT_TO_MS;
        const cruiseNm = Math.max(0, dist - climbNm - descNm);
        const cruiseMin = (cruiseNm / Math.max(50, cruiseTas)) * 60;
        burnFor(cruiseMin, { altFt: cruiseAlt, tasKt: cruiseTas, vsFpm: 0, onGround: false });

        // Descent burn, stepped so the idle-flow floor is applied per altitude.
        let dAlt = cruiseAlt;
        while (dAlt > 0) {
            const bot = Math.max(0, dAlt - slice);
            const midAlt = (dAlt + bot) / 2;
            const min = (dAlt - bot) / Math.abs(descRate);
            const atm = atmosphere(midAlt);
            const tasKt = Math.max(180, Math.min(descTas, (cruiseMach * 0.85 * atm.a) / KT_TO_MS));
            burnFor(min, { altFt: midAlt, tasKt, vsFpm: descRate, onGround: false });
            dAlt = bot;
        }

        // Trip fuel is brakes-off to brakes-on, so the taxi at either end sits
        // outside it — that is the split every dispatch release uses, and it
        // keeps the contingency and alternate calculations honest.
        const tripKg = fuel - taxiOutKg;
        burnFor(TAXI_IN_MIN, { altFt: 0, tasKt: 10, vsFpm: 0, onGround: true });

        return {
            tripKg, taxiKg: taxiOutKg + (fuel - tripKg - taxiOutKg),
            blockKg: fuel,
            cruiseAlt,
            cruiseTas,
            timeMin: TAXI_OUT_MIN + climbMin + cruiseMin + descMin + TAXI_IN_MIN
        };
    }

    /**
     * Performance at the type's own cruise condition for a given weight.
     *
     * The forward-looking numbers — endurance, still-flyable range, specific
     * range — have to be quoted against this rather than against whatever the
     * aircraft happens to be doing right now. An aeroplane in an idle descent
     * shows a fuel flow a quarter of its cruise figure and a specific range
     * three times better; extrapolating that would promise six hours of
     * endurance to an aeroplane that has twenty minutes of fuel once it levels
     * off. Cruise is the honest, stable reference.
     */
    function cruisePerformance(m, massKg, isaDevC) {
        const altFt = m.optAlt;
        const atm = atmosphere(altFt, undefined, isaDevC);
        const tasKt = (m.mcr * atm.a) / KT_TO_MS;
        const r = fuelFlowAt(m, { altFt, tasKt, vsFpm: 0, massKg, onGround: false, isaDevC });
        return {
            flowKgH: r.kgPerHr, tasKt, altFt,
            srNmPerKg: r.kgPerHr > 1 ? tasKt / r.kgPerHr : null,
            burnPerNmKg: tasKt > 1 ? r.kgPerHr / tasKt : null
        };
    }

    /**
     * Fuel still needed to reach the destination, by flying the rest of the
     * arrival rather than multiplying a rate by a distance.
     *
     * The remaining track splits into a level portion at the present cruise
     * level and a descent on a nominal 3° path (about 318 ft per nautical
     * mile), then an approach allowance and the taxi in. Mass is decremented
     * through it, so the aeroplane arrives lighter and cheaper exactly as it
     * would in the air.
     */
    function fuelToGo(m, massKg, altFt, remainingNm, isaDevC) {
        if (!(remainingNm > 0)) return 0;
        let mass = Math.max(1, massKg), fuel = 0;
        const burn = (minutes, state) => {
            const r = fuelFlowAt(m, Object.assign({ massKg: mass, isaDevC }, state));
            const b = r.kgPerHr * (minutes / 60);
            fuel += b; mass -= b;
        };

        // Descent profile from wherever the aircraft is now down to 1500 ft.
        const descentFromFt = Math.max(0, altFt - 1500);
        const descentNm = Math.min(remainingNm, descentFromFt / 318);
        const levelNm = Math.max(0, remainingNm - descentNm);

        // Level portion at the present level (or the type's optimum when the
        // aircraft hasn't climbed yet, e.g. still on the ground).
        if (levelNm > 0) {
            const cruiseAlt = altFt > 12000 ? altFt : m.optAlt;
            const atm = atmosphere(cruiseAlt, undefined, isaDevC);
            const tas = Math.max(60, (m.mcr * atm.a) / KT_TO_MS);
            const stepNm = levelNm / 6;
            for (let i = 0; i < 6; i++) {
                burn((stepNm / tas) * 60, { altFt: cruiseAlt, tasKt: tas, vsFpm: 0, onGround: false });
            }
        }

        // Descent, sliced by altitude so the idle floor is applied per level.
        if (descentFromFt > 0) {
            const rate = m.kind === 'jet' ? 1800 : 1200;
            const steps = 5;
            for (let i = 0; i < steps; i++) {
                const top = altFt - descentFromFt * (i / steps);
                const bot = altFt - descentFromFt * ((i + 1) / steps);
                const mid = (top + bot) / 2;
                const atm = atmosphere(mid, undefined, isaDevC);
                const tas = Math.max(refSpeeds(m).vAppKt * 1.5, (m.mcr * 0.85 * atm.a) / KT_TO_MS);
                burn((top - bot) / rate, { altFt: mid, tasKt: tas, vsFpm: -rate, onGround: false });
            }
        }

        // Approach, landing and the taxi to the gate.
        burn(5, { altFt: 1200, tasKt: refSpeeds(m).vAppKt * 1.15, vsFpm: -700, onGround: false });
        burn(TAXI_IN_MIN, { altFt: 0, tasKt: 10, vsFpm: 0, onGround: true });
        return fuel;
    }

    /** Fuel for a straight-and-level hold at 1500 ft, kg. */
    function holdingFuelKg(m, massKg, minutes) {
        const atm = atmosphere(1500);
        // Green-dot / best-endurance speed is close to minimum-drag speed.
        const clOpt = Math.sqrt(m.cd0 * Math.PI * ((m.b * m.b) / m.s) * m.e);
        const tasKt = m.kind === 'heli' ? 70
            : Math.sqrt((2 * massKg * G0) / (atm.rho * m.s * Math.max(0.25, clOpt))) / KT_TO_MS;
        const r = fuelFlowAt(m, { altFt: 1500, tasKt, vsFpm: 0, massKg, onGround: false });
        return r.kgPerHr * (minutes / 60);
    }

    /**
     * Work out the block fuel the aircraft plausibly left the gate with.
     * A filed dispatch plan wins outright; otherwise the synthetic mission is
     * flown three times, feeding each answer back as the next take-off weight,
     * because a heavier aeroplane burns more and therefore needs more fuel.
     */
    // The planner flies three full synthetic missions plus an alternate and a
    // hold — a few thousand evaluations. The whole estimate re-runs on every
    // three-second telemetry tick, but its inputs (type, route length, weight)
    // barely move between ticks, so the answer is memoised on a coarse key.
    // The trail integration is left uncached: it grows every tick and is the
    // part that actually has to be fresh.
    const _planCache = new Map();
    function planBlockFuel(m, distanceNm, zfwKg, filedKg) {
        const key = m.label + '|' + Math.round(distanceNm / 25) + '|' + Math.round(zfwKg / 500)
            + '|' + (filedKg == null ? '' : Math.round(filedKg));
        const hit = _planCache.get(key);
        if (hit) return hit;
        const out = computeBlockFuel(m, distanceNm, zfwKg, filedKg);
        // Bounded: a session only ever watches a handful of flights.
        if (_planCache.size > 60) _planCache.clear();
        _planCache.set(key, out);
        return out;
    }

    function computeBlockFuel(m, distanceNm, zfwKg, filedKg) {
        if (typeof filedKg === 'number' && isFinite(filedKg) && filedKg > 50 && filedKg <= m.maxFuel * 1.02) {
            const sim = simulateMission(m, distanceNm, zfwKg, filedKg);
            return { blockKg: Math.min(filedKg, m.maxFuel), tripKg: sim.tripKg, source: 'filed', sim };
        }
        let guess = Math.min(m.maxFuel, 0.25 * m.maxFuel + distanceNm * (m.mtow / 30000));
        let sim = null;
        for (let i = 0; i < 3; i++) {
            sim = simulateMission(m, distanceNm, zfwKg, guess);
            const reserves = sim.tripKg * CONTINGENCY_PCT
                + simulateMission(m, ALTERNATE_NM, zfwKg, guess * 0.3).tripKg
                + holdingFuelKg(m, zfwKg + guess * 0.15, FINAL_RESERVE_MIN);
            let next = sim.blockKg + reserves;
            // Never more than the tanks hold, and never so much that the
            // aeroplane would be over its maximum take-off weight.
            next = Math.min(next, m.maxFuel, Math.max(0, m.mtow - zfwKg));
            guess = next;
        }
        return { blockKg: guess, tripKg: sim ? sim.tripKg : guess * 0.8, source: 'modelled', sim };
    }

    // ── Public entry point ────────────────────────────────────────────────
    /**
     * Produce the full fuel picture for a flight.
     *
     * @param {Object} input
     *   aircraftName  string  as reported by the live API
     *   trail         Array   position history (any of the shapes the app uses)
     *   position      Object  { alt_ft, gs_kt, vs_fpm, heading_deg }
     *   distFlownNm / distRemainingNm  numbers from the route calculation
     *   filedFuelKg   number  dispatch plan block fuel, if the pilot filed one
     *   paxFiled      number  dispatch plan passenger count, if filed
     *   oatC, windDirDeg, windSpdKt   live environmental sample
     *   onGround      boolean host's own ground determination, if it has one
     */
    function estimate(input) {
        input = input || {};
        const resolved = resolveModel(input.aircraftName);
        const m = resolved.model;
        const pos = input.position || {};

        // ── Weights ──────────────────────────────────────────────────────
        // Payload from the filed passenger count when we have it, otherwise
        // the type's typical revenue load.
        let payloadKg, payloadSource;
        if (typeof input.paxFiled === 'number' && input.paxFiled > 0) {
            payloadKg = input.paxFiled * PAX_PLUS_BAG_KG;
            payloadSource = 'filed';
        } else {
            payloadKg = m.payload; // table figures already sit at LOAD_FACTOR
            payloadSource = 'typical';
        }
        payloadKg = Math.max(0, Math.min(payloadKg, m.mtow - m.oew));
        const zfwKg = m.oew + payloadKg;

        // ── Route length ─────────────────────────────────────────────────
        const flown = Number(input.distFlownNm);
        const remaining = Number(input.distRemainingNm);
        const routeNm = (isFinite(flown) ? Math.max(0, flown) : 0)
            + (isFinite(remaining) ? Math.max(0, remaining) : 0);
        const haveRoute = routeNm > 20;

        // ── Block fuel at pushback ───────────────────────────────────────
        const plan = planBlockFuel(m, haveRoute ? routeNm : 400, zfwKg, input.filedFuelKg);
        const blockKg = Math.max(0, plan.blockKg);

        // ── Burn so far ──────────────────────────────────────────────────
        const wind = (isFinite(input.windDirDeg) && isFinite(input.windSpdKt) && input.windSpdKt > 0)
            ? { dirDeg: Number(input.windDirDeg), spdKt: Number(input.windSpdKt) } : null;

        // Turn the single live OAT reading into an ISA deviation we can carry
        // down the whole trail (see atmosphere()).
        let isaDevC;
        if (typeof input.oatC === 'number' && isFinite(input.oatC) && Number(pos.alt_ft) != null) {
            isaDevC = atmosphere(Number(pos.alt_ft) || 0, input.oatC).deltaIsa;
        }

        const trail = integrateTrail(m, input.trail, {
            startFuelKg: blockKg, zfwKg, wind, isaDevC
        });

        let usedKg = trail.legKg;
        let journeyKg = trail.journeyKg;
        // No usable trail yet (just spawned, or /history hasn't landed): fall
        // back to the planned profile scaled by how far along the route the
        // aircraft is, so the panel says something sensible instead of zero.
        let usedSource = 'integrated';
        if (trail.samples < 3 && haveRoute && flown > 5) {
            const frac = Math.max(0, Math.min(1, flown / routeNm));
            usedKg = journeyKg = plan.tripKg * (0.10 + 0.90 * frac);
            usedSource = 'route-scaled';
        }
        usedKg = Math.max(0, Math.min(usedKg, blockKg));
        journeyKg = Math.max(usedKg, journeyKg);

        const onboardKg = Math.max(0, blockKg - usedKg);
        const massNowKg = zfwKg + onboardKg;

        // ── Instantaneous flow at the current condition ──────────────────
        const altFt = Number(pos.alt_ft) || 0;
        const gsKt = Number(pos.gs_kt) || 0;
        const vsFpm = Number(pos.vs_fpm) || 0;
        const onGroundNow = (typeof input.onGround === 'boolean')
            ? input.onGround
            : (gsKt < 45 && Math.abs(vsFpm) < 250 && altFt < 15000);
        const tasNow = tasFromGs(gsKt, Number(pos.heading_deg), altFt, wind);
        const now = fuelFlowAt(m, {
            altFt, tasKt: tasNow, vsFpm, massKg: massNowKg,
            onGround: onGroundNow, oatC: input.oatC, isaDevC
        });

        // ── Derived operational numbers ──────────────────────────────────
        // The instantaneous flow is what the engines are doing right now and
        // belongs on the live readout. Everything forward-looking is quoted
        // against the cruise condition instead — see cruisePerformance().
        const flowKgH = now.kgPerHr;
        const cruise = cruisePerformance(m, massNowKg, isaDevC);
        const enduranceHrs = cruise.flowKgH > 1 ? onboardKg / cruise.flowKgH : null;
        const rangeNm = (enduranceHrs != null) ? enduranceHrs * cruise.tasKt : null;
        // Specific range: how far the aeroplane travels per kilogram. This is
        // the number that actually tells you whether it is being flown well.
        const specificRangeNmPerKg = cruise.srNmPerKg;
        const burnPerNmKg = cruise.burnPerNmKg;

        // Fuel to complete the flight, and what would be left in the tanks on
        // arrival — flown forward rather than extrapolated from a rate.
        let toDestKg = null, arrivalKg = null, reserveMin = null, status = null;
        if (isFinite(remaining) && remaining > 0) {
            toDestKg = fuelToGo(m, massNowKg, altFt, remaining, isaDevC);
            arrivalKg = onboardKg - toDestKg;
            const holdKgH = holdingFuelKg(m, zfwKg + Math.max(0, arrivalKg), 60);
            reserveMin = holdKgH > 1 ? (Math.max(0, arrivalKg) / holdKgH) * 60 : null;
            status = arrivalKg <= 0 ? 'critical'
                : (reserveMin != null && reserveMin < FINAL_RESERVE_MIN) ? 'tight' : 'ok';
        }

        // ── Environmental figures ────────────────────────────────────────
        const co2Factor = m.fuelKgPerL === AVGAS_KG_PER_L ? CO2_PER_KG_AVGAS : CO2_PER_KG_JET;
        const co2Kg = usedKg * co2Factor;
        const paxCount = (typeof input.paxFiled === 'number' && input.paxFiled > 0)
            ? input.paxFiled : Math.round(m.pax * LOAD_FACTOR);
        const flownNm = isFinite(flown) ? flown : 0;
        const perPaxPerKmG = (paxCount > 0 && flownNm > 1)
            ? (usedKg * 1000) / (paxCount * flownNm * 1.852) : null;

        // ── Confidence ───────────────────────────────────────────────────
        const notes = [];
        let score = 100;
        if (resolved.source !== 'exact') { score -= 30; notes.push('Airframe not recognised — modelled as an A320'); }
        if (plan.source === 'filed') notes.push('Block fuel from the filed dispatch plan');
        else { score -= 12; notes.push('Block fuel modelled from a standard mission profile'); }
        if (payloadSource === 'filed') notes.push('Payload from the filed passenger count');
        else { score -= 8; notes.push('Payload assumed at a ' + Math.round(LOAD_FACTOR * 100) + '% load factor'); }
        if (usedSource === 'route-scaled') { score -= 25; notes.push('No position history yet — burn scaled from route progress'); }
        else if (trail.samples < 20) { score -= 15; notes.push('Short position history (' + trail.samples + ' points)'); }
        if (trail.gapMinutes > 5) { score -= Math.min(20, trail.gapMinutes / 3); notes.push(Math.round(trail.gapMinutes) + ' min of gaps in the tracked path'); }
        if (!wind) { score -= 6; notes.push('No wind sample — true airspeed assumed equal to ground speed'); }
        if (!haveRoute) { score -= 10; notes.push('No flight plan — route length assumed'); }
        if (trail.legs > 1) notes.push(trail.legs + ' legs detected; figures are for the current leg');
        score = Math.max(5, Math.min(99, Math.round(score)));
        const level = score >= 78 ? 'high' : (score >= 55 ? 'medium' : 'low');

        return {
            ok: true,
            generatedAt: Date.now(),
            aircraft: {
                key: resolved.key, label: m.label, matched: resolved.source,
                input: resolved.input, kind: m.kind, engines: m.eng,
                capacityKg: m.maxFuel, mtowKg: m.mtow, oewKg: m.oew
            },
            mass: { zfwKg, payloadKg, payloadSource, currentKg: massNowKg, mtowKg: m.mtow },
            block: { kg: blockKg, source: plan.source, tripKg: plan.tripKg, pctOfCapacity: (blockKg / m.maxFuel) * 100 },
            used: {
                kg: usedKg, journeyKg, source: usedSource,
                phases: trail.phases, legs: trail.legs, legStartMs: trail.legStartMs
            },
            onboard: {
                kg: onboardKg,
                pctOfBlock: blockKg > 0 ? (onboardKg / blockKg) * 100 : 0,
                pctOfCapacity: (onboardKg / m.maxFuel) * 100
            },
            flow: {
                kgPerHr: flowKgH,
                kgPerHrPerEngine: flowKgH / Math.max(1, m.eng),
                mode: now.mode, throttlePct: now.throttle * 100, mach: now.mach
            },
            performance: {
                specificRangeNmPerKg, burnPerNmKg,
                enduranceHrs, rangeNm,
                cruiseFlowKgH: cruise.flowKgH, cruiseTasKt: cruise.tasKt, cruiseAltFt: cruise.altFt,
                lOverD: now.dragN > 0 ? (massNowKg * G0) / now.dragN : null
            },
            arrival: { toDestKg, arrivalKg, reserveMin, status },
            environment: { co2Kg, perPaxPerKmG, paxCount },
            confidence: { score, level, notes },
            trail: {
                samples: trail.samples, spanMinutes: trail.spanMinutes,
                airborneMinutes: trail.airborneMinutes, gapMinutes: trail.gapMinutes
            }
        };
    }

    // ── Rendering ─────────────────────────────────────────────────────────
    // Self-contained markup with inline styles (the same approach
    // flight-legs.js takes) so the card looks identical in the host page and
    // inside both iframes. Colours read the host's CSS variables where they
    // exist and fall back to the shared palette otherwise.
    const SURFACE = 'var(--card-bg, rgba(15,23,42,0.40))';
    const BORDER  = 'var(--border-glass, rgba(255,255,255,0.08))';
    // Neutral-grey overlays rather than white ones: the simple window ships a
    // light theme, where a white wash over a white card is invisible.
    const FILL    = 'rgba(128,128,128,0.14)';
    const HAIR    = 'rgba(128,128,128,0.22)';
    const TRACK   = 'rgba(128,128,128,0.28)';
    const ACCENT  = 'var(--color-brand, #38bdf8)';
    const TXT     = 'var(--text-primary, #ffffff)';
    const DIM     = 'var(--text-secondary, #9a9aa2)';
    const FAINT   = 'var(--text-dim, #64748b)';
    const OK_C    = 'var(--color-success, #34d399)';
    const WARN_C  = 'var(--color-warning, #fbbf24)';
    const BAD_C   = 'var(--color-danger, #ef4444)';
    const MONO    = "'JetBrains Mono', ui-monospace, monospace";

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtMass(kg, unit) {
        if (kg == null || !isFinite(kg)) return '—';
        const v = unit === 'lb' ? kg * KG_TO_LB : kg;
        return Math.round(v).toLocaleString();
    }
    function fmtHrs(h) {
        if (h == null || !isFinite(h) || h < 0) return '—';
        if (h > 99) return '99+';
        const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
        return mm === 60 ? (hh + 1) + ':00' : hh + ':' + String(mm).padStart(2, '0');
    }
    // Holding endurance runs from single-digit minutes to several hours;
    // "214 min" is harder to read at a glance than "3.6 h".
    function fmtHold(min) {
        if (min == null || !isFinite(min)) return '';
        return min >= 100 ? (min / 60).toFixed(1) + ' h hold' : Math.round(min) + ' min hold';
    }
    function fmtNum(v, dp) {
        if (v == null || !isFinite(v)) return '—';
        return v.toFixed(dp == null ? 0 : dp);
    }

    const PHASE_COLORS = {
        ground: '#64748b', taxi: '#94a3b8', climb: '#34d399',
        cruise: '#38bdf8', descent: '#fbbf24', idle: '#a78bfa', hover: '#fb923c'
    };
    const PHASE_LABELS = {
        ground: 'Parked', taxi: 'Taxi', climb: 'Climb',
        cruise: 'Cruise', descent: 'Descent', idle: 'Idle', hover: 'Hover'
    };

    /**
     * Render the fuel card.
     * @param {Object} res      the object returned by estimate()
     * @param {Object} [opts]   { unit: 'kg'|'lb', compact: boolean, title: string }
     */
    function renderHTML(res, opts) {
        opts = opts || {};
        if (!res || !res.ok) return '';
        const unit = opts.unit === 'lb' ? 'lb' : 'kg';
        const U = unit;
        const compact = !!opts.compact;

        const conf = res.confidence;
        const confColor = conf.level === 'high' ? OK_C : (conf.level === 'medium' ? WARN_C : BAD_C);

        // Tank bar: how much of the departure load is left, with the point at
        // which the aircraft would land on final reserve marked on the scale.
        const pct = Math.max(0, Math.min(100, res.onboard.pctOfBlock));
        const st = res.arrival.status;
        const barColor = st === 'critical' ? BAD_C : (st === 'tight' ? WARN_C : ACCENT);
        const reserveMarkPct = (res.arrival.toDestKg != null && res.block.kg > 0)
            ? Math.max(0, Math.min(100, (res.arrival.toDestKg / res.block.kg) * 100)) : null;

        // Phase split — where the fuel actually went.
        const ph = res.used.phases || {};
        const phTotal = Object.keys(ph).reduce((s, k) => s + (ph[k] || 0), 0);
        let phaseBar = '', phaseKeys = [];
        if (phTotal > 1) {
            phaseKeys = Object.keys(ph).filter(k => (ph[k] || 0) / phTotal > 0.005);
            phaseBar = `<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;margin:12px 0 8px;background:${FILL};">`
                + phaseKeys.map(k =>
                    `<span title="${esc(PHASE_LABELS[k] || k)}" style="width:${((ph[k] / phTotal) * 100).toFixed(2)}%;background:${PHASE_COLORS[k] || '#64748b'};"></span>`
                ).join('')
                + '</div>'
                + '<div style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:9.5px;color:' + DIM + ';font-weight:600;">'
                + phaseKeys.map(k =>
                    `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:2px;background:${PHASE_COLORS[k] || '#64748b'};"></span>`
                    + `${esc(PHASE_LABELS[k] || k)} <span style="font-family:${MONO};color:${TXT};">${fmtMass(ph[k], unit)}</span></span>`
                ).join('')
                + '</div>';
        }

        const tile = (label, value, sub, color) => ''
            + `<div style="flex:1 1 0;min-width:0;background:${FILL};border:1px solid ${BORDER};border-radius:10px;padding:9px 10px;">`
            + `<div style="font-size:8.5px;letter-spacing:.7px;text-transform:uppercase;color:${FAINT};font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(label)}</div>`
            + `<div style="font-family:${MONO};font-size:15px;font-weight:600;color:${color || TXT};margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${value}</div>`
            + (sub ? `<div style="font-size:9px;color:${DIM};margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(sub)}</div>` : '')
            + '</div>';

        const row = (label, value, color) => ''
            + `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:7px 0;border-top:1px solid ${HAIR};">`
            + `<span style="font-size:12px;color:${DIM};font-weight:500;">${esc(label)}</span>`
            + `<span style="font-family:${MONO};font-size:12.5px;font-weight:600;color:${color || TXT};text-align:right;">${value}</span>`
            + '</div>';

        const unitTag = (u) => `<span style="font-size:9.5px;color:${DIM};font-weight:500;margin-left:3px;">${u}</span>`;

        // ── Header ──────────────────────────────────────────────────────
        let html = ''
            + `<div class="fuel-card" data-fuel-card style="background:${SURFACE};border:1px solid ${BORDER};border-radius:var(--radius-lg, 14px);padding:14px;overflow:hidden;">`
            + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            +   `<i class="fa-solid fa-gas-pump" style="color:${ACCENT};font-size:12px;"></i>`
            +   `<span style="font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:${TXT};">${esc(opts.title || 'Fuel')}</span>`
            +   `<span style="font-size:9px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:${FAINT};border:1px solid ${BORDER};border-radius:999px;padding:1px 6px;">Estimated</span>`
            +   `<button type="button" data-fuel-unit="${U === 'kg' ? 'lb' : 'kg'}" title="Switch to ${U === 'kg' ? 'pounds' : 'kilograms'}" style="margin-left:auto;cursor:pointer;background:${FILL};border:1px solid ${BORDER};color:${DIM};border-radius:999px;padding:2px 8px;font-size:9px;font-weight:800;letter-spacing:.5px;font-family:inherit;">${U.toUpperCase()}</button>`
            + '</div>';

        // ── Headline: burned this leg + tank state ──────────────────────
        html += '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-top:12px;">'
            +   '<div style="min-width:0;">'
            +     `<div style="font-family:${MONO};font-size:26px;font-weight:400;color:${TXT};line-height:1;white-space:nowrap;">${fmtMass(res.used.kg, unit)}${unitTag(U)}</div>`
            +     `<div style="font-size:11px;color:${DIM};margin-top:4px;">Burned${res.used.legs > 1 ? ' this leg' : ' so far'}</div>`
            +   '</div>'
            +   '<div style="text-align:right;min-width:0;">'
            +     `<div style="font-family:${MONO};font-size:18px;font-weight:400;color:${barColor};line-height:1;white-space:nowrap;">${fmtMass(res.onboard.kg, unit)}${unitTag(U)}</div>`
            +     `<div style="font-size:11px;color:${DIM};margin-top:4px;">Remaining · ${Math.round(pct)}%</div>`
            +   '</div>'
            + '</div>';

        // Tank bar with the "landing on final reserve" mark.
        html += `<div style="position:relative;height:6px;border-radius:3px;background:${TRACK};margin:12px 0 6px;overflow:visible;">`
            +   `<div style="position:absolute;left:0;top:0;bottom:0;width:${pct.toFixed(2)}%;border-radius:3px;background:${barColor};box-shadow:0 0 10px ${barColor}55;"></div>`
            +   (reserveMarkPct != null
                ? `<span title="Fuel needed to reach the destination" style="position:absolute;top:-3px;left:${reserveMarkPct.toFixed(2)}%;width:2px;height:12px;background:${TXT};opacity:.55;border-radius:1px;"></span>`
                : '')
            + '</div>'
            + `<div style="display:flex;justify-content:space-between;font-size:9.5px;color:${FAINT};font-weight:600;">`
            +   `<span>Block ${fmtMass(res.block.kg, unit)} ${U}${res.block.source === 'filed' ? ' · filed' : ''}</span>`
            +   `<span>Tanks ${Math.round(res.onboard.pctOfCapacity)}% full</span>`
            + '</div>';

        // ── Live tiles ──────────────────────────────────────────────────
        html += '<div style="display:flex;gap:8px;margin-top:12px;">'
            + tile('Fuel flow', fmtMass(res.flow.kgPerHr, unit) + unitTag(U + '/h'),
                   res.aircraft.engines > 1 ? fmtMass(res.flow.kgPerHrPerEngine, unit) + ' per engine' : res.flow.mode)
            + tile('Endurance', fmtHrs(res.performance.enduranceHrs),
                   res.performance.rangeNm != null
                       ? Math.round(res.performance.rangeNm).toLocaleString() + ' nm at cruise burn'
                       : 'At cruise burn')
            + (compact ? '' : tile('Specific range',
                   res.performance.specificRangeNmPerKg != null
                       ? (unit === 'lb'
                            ? fmtNum(res.performance.specificRangeNmPerKg / KG_TO_LB, 3)
                            : fmtNum(res.performance.specificRangeNmPerKg, 3)) + unitTag('nm/' + U)
                       : '—',
                   'Cruise, at this weight'))
            + '</div>';

        // ── Detail rows ─────────────────────────────────────────────────
        html += '<div style="margin-top:12px;">';
        if (res.arrival.toDestKg != null) {
            const arrColor = st === 'critical' ? BAD_C : (st === 'tight' ? WARN_C : TXT);
            html += row('Fuel to destination', fmtMass(res.arrival.toDestKg, unit) + unitTag(U));
            html += row('On arrival',
                (res.arrival.arrivalKg <= 0 ? '−' : '') + fmtMass(Math.abs(res.arrival.arrivalKg), unit) + unitTag(U)
                + (res.arrival.reserveMin != null
                    ? `<span style="color:${arrColor};font-size:10.5px;margin-left:6px;">${fmtHold(res.arrival.reserveMin)}</span>`
                    : ''),
                arrColor);
        }
        html += row('Cruise burn per nautical mile',
            res.performance.burnPerNmKg != null ? fmtNum(unit === 'lb' ? res.performance.burnPerNmKg * KG_TO_LB : res.performance.burnPerNmKg, 1) + unitTag(U + '/nm') : '—');
        if (!compact) {
            html += row('Zero-fuel weight', fmtMass(res.mass.zfwKg, unit) + unitTag(U));
            html += row('Current weight',
                fmtMass(res.mass.currentKg, unit) + unitTag(U)
                + `<span style="color:${DIM};font-size:10.5px;margin-left:6px;">${Math.round((res.mass.currentKg / res.mass.mtowKg) * 100)}% MTOW</span>`);
            html += row('Planned trip fuel', fmtMass(res.block.tripKg, unit) + unitTag(U));
        }
        html += row('CO₂ produced', fmtMass(res.environment.co2Kg, unit) + unitTag(U));
        if (res.environment.perPaxPerKmG != null && res.environment.paxCount > 0) {
            html += row(`Per passenger (${res.environment.paxCount})`,
                fmtNum(res.environment.perPaxPerKmG, 1) + unitTag('g/pax·km'));
        }
        html += '</div>';

        // ── Where it went ───────────────────────────────────────────────
        if (phaseBar) {
            html += `<div style="margin-top:12px;font-size:9px;letter-spacing:.7px;text-transform:uppercase;color:${FAINT};font-weight:800;">Where it went</div>`
                + phaseBar;
        }

        // ── Method + honesty ────────────────────────────────────────────
        const notes = (conf.notes || []).slice(0, 4).map(n => esc(n)).join(' · ');
        html += `<div style="margin-top:12px;padding-top:10px;border-top:1px solid ${HAIR};">`
            +   '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
            +     `<span style="width:6px;height:6px;border-radius:50%;background:${confColor};"></span>`
            +     `<span style="font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:${confColor};">${esc(conf.level)} confidence</span>`
            +     `<span style="font-family:${MONO};font-size:10px;color:${FAINT};">${conf.score}%</span>`
            +     `<span style="margin-left:auto;font-size:9.5px;color:${FAINT};">${esc(res.aircraft.label)}</span>`
            +   '</div>'
            +   (notes ? `<div style="font-size:9.5px;color:${DIM};margin-top:6px;line-height:1.5;">${notes}</div>` : '')
            +   `<div style="font-size:9.5px;color:${FAINT};margin-top:6px;line-height:1.5;font-style:italic;">`
            +     'Infinite Flight does not transmit fuel data. These figures are modelled from the airframe’s drag polar and engine deck against the flown profile — indicative only, never for real-world planning.'
            +   '</div>'
            + '</div>';

        html += '</div>';
        return html;
    }

    /**
     * Wire the kg/lb toggle inside a rendered card. The choice is shared
     * across all three windows through localStorage, so switching units in the
     * simple window keeps the avionics window in step.
     */
    const UNIT_KEY = 'inflightFuelUnit';
    function readUnit() {
        try { return localStorage.getItem(UNIT_KEY) === 'lb' ? 'lb' : 'kg'; } catch (e) { return 'kg'; }
    }
    function writeUnit(u) {
        try { localStorage.setItem(UNIT_KEY, u === 'lb' ? 'lb' : 'kg'); } catch (e) {}
    }
    /** Delegate the unit button once per host document. */
    function bindUnitToggle(doc, onChange) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d || d.__fuelUnitBound) return;
        d.__fuelUnitBound = true;
        d.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest && e.target.closest('[data-fuel-unit]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            writeUnit(btn.getAttribute('data-fuel-unit'));
            if (typeof onChange === 'function') onChange(readUnit());
        });
    }

    global.FuelEstimator = {
        estimate, renderHTML, resolveModel,
        readUnit, writeUnit, bindUnitToggle,
        fuelFlowAt, atmosphere, simulateMission,
        AIRCRAFT
    };

})(typeof window !== 'undefined' ? window : this);
