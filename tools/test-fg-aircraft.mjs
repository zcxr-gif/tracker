#!/usr/bin/env node
// test-fg-aircraft.mjs — which FlightGear model and livery the 3D map draws.
//
// The models themselves have to be looked at; this checks the choosing:
// that Infinite Flight's names land on a model, that an airline gets its own
// paint when the type has it, that nothing turns into a different kind of
// aircraft, and that the generated data still says what the engine reads.
//
//     node tools/test-fg-aircraft.mjs

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);

const { designatorForName, chooseModel, texturePath, fileUrl } = await load('aircraftModels.js');
const { FG_MODELS, FG_COMMIT } = await load('fgAircraft.data.js');
const { AircraftEngine } = await load('aircraftEngine.js');

let failures = 0;
const check = (name, fn) => {
    try { fn(); console.log(`ok  ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.message}`); }
};

check('Infinite Flight names read into designators', () => {
    const cases = {
        'Boeing 737-800': 'B738', 'Boeing 737 MAX 8': 'B38M', 'Airbus A320neo': 'A20N', 'Airbus A321': 'A321',
        'Boeing 777-300ER': 'B77W', 'Boeing 777F': 'B77L', 'Boeing 787-10': 'B78X', 'Airbus A350-1000': 'A35K',
        'Bombardier CRJ-900': 'CRJ9', 'Dash 8 Q400': 'DH8D', 'Embraer E175': 'E175', 'Cessna 172': 'C172',
        'McDonnell Douglas MD-11': 'MD11', 'Airbus A220-300': 'BCS3',
    };
    for (const [name, want] of Object.entries(cases)) assert.equal(designatorForName(name), want, name);
});

check('no airliner for a fighter, a balloon or a blimp', () => {
    for (const name of ['F-16C', 'F/A-18E Super Hornet', 'Hot Air Balloon', 'Blimp']) {
        assert.equal(chooseModel(designatorForName(name), 'DAL'), null, name);
    }
});

check('an airline gets its own paint when the type has it', () => {
    const delta = chooseModel('B738', 'DAL');
    assert.equal(delta.model.folder, '738');
    assert.equal(delta.livery, 'DAL');
    assert.match(texturePath(delta.model, delta.livery, 0), /^Textures\/Delta\//);
});

check('an unknown airline gets the plain paint', () => {
    const plain = chooseModel('A320', 'ZZZ');
    assert.equal(plain.livery, '');
    assert.equal(texturePath(plain.model, '', 0), plain.model.base[0]);
});

check('a type with no model of its own takes the nearest one', () => {
    assert.equal(chooseModel('B38M', '').model.designators.includes('B738'), true);
    assert.equal(chooseModel('A20N', '').model.folder, 'A320');
    assert.equal(chooseModel('E75L', '').model.file, 'Models/ERJ175.ac');
});

check('a freighter model is only reached for an airline the main one lacks', () => {
    const main = chooseModel('B744', '');
    assert.equal(main.model.file, 'Models/744.ac');
    const cargo = FG_MODELS.find((m) => m.file === 'Models/74Y.ac');
    const only = Object.keys(cargo.liveries).find((icao) => !main.model.liveries[icao]);
    if (only) assert.equal(chooseModel('B744', only).model.file, 'Models/74Y.ac');
});

check('generated data is what the engine reads', () => {
    assert.match(FG_COMMIT, /^[0-9a-f]{40}$/);
    const ids = new Set();
    for (const m of FG_MODELS) {
        assert.ok(!ids.has(m.id), `duplicate id ${m.id}`);
        ids.add(m.id);
        assert.ok(m.designators.length, `${m.id} has no designators`);
        assert.ok(m.length > 3 && m.length < 90, `${m.id} is ${m.length} m long`);
        assert.equal(m.base.length, m.textures.length, `${m.id} base/textures`);
        for (const [icao, entry] of Object.entries(m.liveries)) {
            assert.match(icao, /^[A-Z0-9]{2,4}$/, `${m.id} livery key ${icao}`);
            assert.ok(typeof entry === 'string' || (Array.isArray(entry) && entry.length === 2), `${m.id}/${icao}`);
        }
        assert.ok(fileUrl(m, m.file).endsWith(`/raw?ref=${FG_COMMIT}`));
    }
});

check('size: real size close in, the curve far out, small on the ground', () => {
    const { magnification } = AircraftEngine._internals;
    // Street level: an A320 at 2 px/m is drawn real size.
    assert.equal(magnification(37.6, 2, 40, 10000), 1);
    // A continent: drawn larger than life, about 8 px long at zoom 5.
    const ppm = 1 / (40075016.686 * Math.cos(40 * Math.PI / 180) / (512 * 2 ** 5));
    const px = 37.6 * magnification(37.6, ppm, 40, 10000) * ppm;
    assert.ok(px > 7 && px < 9, `${px} px`);
    // Parked: never longer than 150 m, whatever the zoom.
    assert.ok(37.6 * magnification(37.6, ppm, 40, 0) <= 150.0001);
});

check('heading turns the nose clockwise from north', () => {
    const { attitudeMatrix } = AircraftEngine._internals;
    const R = attitudeMatrix(90, 0, 0);
    // The nose is model −Z: R · (0, 0, −1) is due east.
    assert.deepEqual([-R[2], -R[5], -R[8]].map((v) => Math.round(v * 1e6) / 1e6 + 0), [1, 0, 0]);
});

if (failures) {
    console.log(`\n${failures} failed`);
    process.exit(1);
}
console.log('\nall passed');
