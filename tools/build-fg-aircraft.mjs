#!/usr/bin/env node
/**
 * build-fg-aircraft.mjs
 *
 * Regenerates fgAircraft.data.js: which FlightGear AI aircraft the map's 3D
 * engine draws for each type, and which of their liveries for each airline.
 *
 *     node tools/build-fg-aircraft.mjs [path/to/fgdata]
 *
 * The models are FlightGear's own AI traffic, from fgdata's AI/Aircraft
 * (https://gitlab.com/flightgear/fgdata/-/tree/next/AI/Aircraft): low-poly
 * AC3D files, one per type, each with a texture per airline. None of it is
 * copied into this repository. The map fetches a model and a livery from
 * GitLab, pinned to FG_COMMIT, the first time an aeroplane of that type and
 * airline is on screen (see aircraftModels.js). This script only writes down
 * what is there: each model's file, size and textures, and each livery's
 * folder, keyed by the airline's ICAO code.
 *
 * Without a path it makes a sparse, blob-less clone of fgdata at FG_COMMIT
 * in the system temp folder: the XML and .ac files only (~160 MB), never the
 * textures — their names come from the tree.
 *
 * Airlines are matched by name: a livery folder ("AmericanAirlines",
 * "KLM-BXA") is split into words and looked up in flight.js's
 * AIRLINE_LIVERY_ICAO, the same table Infinite Flight's livery names are
 * read with, with LIVERY_ICAO below for the ones it does not name. Liveries
 * that match no airline (paint kits, alliances, demonstrators) are left out.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'fgAircraft.data.js');

// Bump to take newer models. Every URL the map fetches is pinned to it, so
// nothing upstream can change what is drawn until this is regenerated.
const FG_COMMIT = '8cd4e78990e54da3561179be1190d453471614a7';
const AI = 'AI/Aircraft';

// Which model serves which ICAO type designators. A model listed against a
// designator another model already has (a freighter, a winglet variant) is
// used only for an airline the first one has no livery for.
const MODELS = [
    ['220', 'Models/223.ac', ['BCS3', 'BCS1']],
    ['339', 'Models/339.ac', ['A339', 'A338']],
    ['717', 'Models/717.ac', ['B712']],
    ['727', 'Models/727-200.ac', ['B722', 'B721']],
    ['733', 'Models/733.ac', ['B733', 'B732']],
    ['733', 'Models/73C.ac', ['B733']],
    ['733', 'Models/73F.ac', ['B733']],
    ['734', 'Models/73P.ac', ['B734']],
    ['735', 'Models/735.ac', ['B735']],
    ['736', 'Models/736.ac', ['B736']],
    ['738', 'Models/737-800.ac', ['B738']],
    ['739', 'Models/73J.ac', ['B739']],
    ['747', 'Models/744.ac', ['B744', 'B743', 'B742', 'B741', 'B74S']],
    ['747', 'Models/74Y.ac', ['B744']],
    ['747', 'Models/74F.ac', ['B744']],
    ['747', 'Models/74N.ac', ['B748']],
    ['757', 'Models/757-200.ac', ['B752']],
    ['757', 'Models/757-300.ac', ['B753']],
    ['767', 'Models/763.ac', ['B763', 'B764']],
    ['767', 'Models/76W.ac', ['B763']],
    ['767', 'Models/76Y.ac', ['B763']],
    ['767', 'Models/767.ac', ['B762']],
    ['777', 'Models/77W.ac', ['B77W', 'B773', 'B779', 'B778']],
    ['777', 'Models/77L.ac', ['B77L', 'B772']],
    ['777', 'Models/77F.ac', ['B77L']],
    ['787', 'Models/788.ac', ['B788']],
    ['787', 'Models/789.ac', ['B789', 'B78X']],
    ['A300', 'Models/AB6.ac', ['A306']],
    ['A300', 'Models/ABY.ac', ['A306']],
    ['A300', 'Models/A300.ac', ['A30B']],
    ['A310', 'Models/A310.ac', ['A310']],
    ['A319', 'Models/A319.ac', ['A319', 'A19N', 'A318']],
    ['A320', 'Models/A320.ac', ['A320', 'A20N']],
    ['A321', 'Models/A321.ac', ['A321', 'A21N']],
    ['A332', 'Models/A332.ac', ['A332']],
    ['A332', 'Models/A33X.ac', ['A332']],
    ['A333', 'Models/A333.ac', ['A333']],
    ['A342', 'Models/A342.ac', ['A342']],
    ['A343', 'Models/A343.ac', ['A343']],
    ['A345', 'Models/A345.ac', ['A345']],
    ['A346', 'Models/A346.ac', ['A346']],
    ['A350', 'Models/359.ac', ['A359', 'A35K']],
    ['A380', 'Models/388.ac', ['A388']],
    ['AT4', 'Models/AT4.ac', ['AT45', 'AT43', 'AT44', 'AT46']],
    ['AT7', 'Models/AT7.ac', ['AT76', 'AT75', 'AT72', 'AT73']],
    ['BAE146-300', 'Models/BAE146-300.ac', ['B463', 'RJ1H']],
    ['Bae146-200', 'Models/bae146-200.ac', ['B462', 'B461', 'RJ85', 'RJ70']],
    ['BAe-125', 'Models/bae125.ac', ['H25B']],
    ['BNI', 'Models/BNI.ac', ['BN2P']],
    ['Bombardier-Challenger', 'Models/chal604.ac', ['CL60', 'CL35', 'CL30']],
    ['CCX', 'Models/bomb-5000.ac', ['GLEX', 'GL5T', 'GL7T']],
    ['CR2', 'Models/CR2.ac', ['CRJ2', 'CRJ1']],
    ['CR7', 'Models/CR7.ac', ['CRJ7']],
    ['CR9', 'Models/CR9.ac', ['CRJ9', 'CRJX']],
    ['Cessna-421-Golden-Eagle', 'Models/c421.ac', ['C421']],
    ['Cessna337', 'Models/Cessna337_SkymasterEC-ISD.ac', ['C337']],
    ['Citation-Bravo', 'Models/bravo.ac', ['C550', 'C560']],
    ['Cub', 'Models/Cub.ac', ['J3']],
    ['DH3', 'Models/DH3.ac', ['DH8C']],
    ['DH4', 'Models/DH4.ac', ['DH8D']],
    ['DH7', 'Models/dh7.ac', ['DHC7']],
    ['DH82', 'Models/DH82.ac', ['DH82']],
    ['DHT', 'Models/DHT.ac', ['DHC6']],
    ['DR400', 'Models/dr400.ac', ['DR40']],
    ['Diamond-Da42', 'Models/da42.ac', ['DA42']],
    ['Dromader', 'Models/M18B_Dromader.ac', ['M18']],
    ['E70', 'Models/ERJ170.ac', ['E170']],
    ['E70', 'Models/ERJ175.ac', ['E175', 'E75L', 'E75S']],
    ['E90', 'Models/E90.ac', ['E190', 'E290']],
    ['E95', 'Models/E95.ac', ['E195', 'E295']],
    ['ERJ145', 'Models/ERJ-145.ac', ['E145', 'E135', 'E45X']],
    ['Embraer-Legacy', 'Models/legacy.ac', ['E35L']],
    ['Fokker-100', 'Models/fokker100.ac', ['F100']],
    ['Fokker-100', 'Models/100.ac', ['F100']],
    ['Fokker-50', 'Models/fokker50.ac', ['F50']],
    ['Fokker-70', 'Models/F70.ac', ['F70']],
    ['Fokker-70', 'Models/fokker70.ac', ['F70']],
    ['JS41', 'Models/JS41.ac', ['JS41']],
    ['M11', 'Models/M1F.ac', ['MD11']],
    ['MD80', 'Models/md-80.ac', ['MD82', 'MD81', 'MD83', 'MD87', 'MD88']],
    ['MD90', 'Models/md-90.ac', ['MD90']],
    ['SF3', 'Models/SF3.ac', ['SF34']],
    ['Saab-2000', 'Models/Saab-2000.ac', ['SB20']],
    ['b1900d', 'Models/b1900d.ac', ['B190']],
    ['beech-200', 'Models/beech-200.ac', ['BE20', 'B350']],
    ['beech99', 'Models/beech99.ac', ['BE99']],
    ['c172', 'Models/c172p.ac', ['C172', 'C152']],
    ['c177', 'Models/c177.ac', ['C177']],
    ['c182', 'Models/c182.ac', ['C182']],
    ['c182rg', 'Models/c182rg.ac', ['C82R']],
    ['c310', 'Models/c310-dpm.ac', ['C310']],
    ['ercoupe', 'Models/ercoupe.ac', ['ERCO']],
    ['pa-28', 'Models/pa-28.ac', ['P28A', 'P28B', 'P28R']],
    ['tu154b', 'Model/tu154B.ac', ['T154']],
];

// Livery folders whose name AIRLINE_LIVERY_ICAO does not read, or reads
// wrongly. null drops one that is not an airline.
const LIVERY_ICAO = {
    AeroMexico: 'AMX', Aeromexico: 'AMX', AeroflotNordic: 'NWS', AirAsiaIndia: 'IAD', AirAsiaX: 'XAX',
    AirBerlin: 'BER', AirCalin: 'ACI', AirCorsica: 'CCM', AirEuropa: 'AEA', AirMadagascar: 'MDG',
    AirMoldova: 'MLD', AirNiugini: 'ANG', AirSerbia: 'ASL', AirVanuatu: 'AVN', AmazonAir: 'ATN',
    AnadoluJet: 'THY', Armavia: 'RNV', AviaTraffic: 'AVJ', Azerbaijan: 'AHY', Belavia: 'BRU',
    BlueAir: 'BMS', BritishMidland: 'BMA', Brussels: 'BEL', Cebu: 'CEB', Corendon: 'CAI',
    Croatia: 'CTN', Cyprus: 'CYP', Detur: 'TRA', Dragonair: 'HDA', Ellinair: 'ELB',
    IsrairAirlines: 'ISR', 'KLM-BXA': null, KLMCityhopper: 'KLC', LionAir: 'LNI', Meridiana: 'ISS',
    NordStar: 'TYA', Pobeda: 'PBD', Rossiya: 'SDM', Rwandair: 'RWD', Siberian: 'SBI',
    SkyUp: 'SQP', SmartWings: 'TVS', SolaseedAir: 'SNJ', StarAlliance: null, TravelService: 'TVS',
    Tuifly: 'TUI', UP: 'ELY', UTair: 'UTA', UkraineIntl: 'AUI', Westjet: 'WJA', Default: '',
    'ACT-Cargo': 'RUN', ASL: 'ABR', ATI: 'ATN', Adria: 'ADR', Aegean: 'AEE', AeroMexicoConnect: 'SLI',
    AeroUnion: 'TNO', Aeromar: 'TAO', AirBridgeCargo: 'ABW', AirCaledonie: 'TPC', AirCaraibes: 'FWI',
    AirDolomiti: 'DLA', AirMalta: 'AMC', AirNauru: 'RON', AirTahiti: 'VTA', Airtran: 'TRS', Amerijet: 'AJT',
    Arik: 'ARA', ArkiaIsraeliAirlines: 'AIZ', Asiana: 'AAR', AstraAirlines: 'AZE', AtlanticAirways: 'FLI',
    Austrian: 'AUA', AzoresAirlines: 'RZO', BinterCanarias: 'IBB', Blue1: 'BLF', BlueIslands: 'BCI',
    BraathensRegional: 'BRX', BulgariaAir: 'LZB', CSA: 'CSA', CanaryFly: 'CNF', CargoLogicAir: 'CLU',
    Cargolux: 'CLX', CargoluxItalia: 'ICV', Cathay: 'CPA', ChinaExpress: 'HXA', Comair: 'CAW',
    DHL: 'DHK', ELAL: 'ELY', EasternAirways: 'EZE', Edelweiss: 'EDW', Ethiopian: 'ETH', EuroAtlantic: 'MMZ',
    FlyBe: 'BEE', Flybe: 'BEE', Frenchbee: 'FBU', Garuda: 'GIA', Germania: 'GMI', Hainan: 'CHH',
    Hawaiian: 'HAL', Helvetic: 'OAW', Hop: 'HOP', 'Hop!': 'HOP', IcelandAir: 'ICE', 'IcelandAir-cargo': 'ICE',
    IranAir: 'IRA', IraqiAirways: 'IAW', JAL: 'JAL', Jambojet: 'JMA', JetAirways: 'JAI', Korean: 'KAL',
    Kuwait: 'KAC', LOT: 'LOT', 'LOT-Nordica': 'LOT', LanChile: 'LAN', LoganAir: 'LOG', Loganair: 'LOG',
    MEA: 'MEA', Malaysia: 'MAS', Malev: 'MAH', MandarinAirlines: 'MDA', Martinair: 'MPH', Monarch: 'MON',
    Montenegro: 'MGX', MontenegroAirlines: 'MGX', Nordavia: 'NRV', Nordica: 'EST', NorthernAirCargo: 'NAC',
    NouvelAir: 'LBT', Olympic: 'OAL', OnurAir: 'OHY', PIA: 'PIA', Pegasus: 'PGT', Philippines: 'PAL',
    PolarAirCargo: 'PAC', Qatar: 'QTR', RegionalExpress: 'RXA', RoyalBrunei: 'RBA', RusLine: 'RLU',
    SATA: 'SAT', Scandinavian: 'SAS', SilkAir: 'SLK', Singapore: 'SIA', SkyLeaseCargo: 'KYE',
    SouthAfrican: 'SAA', SouthWestAirlines: 'SWA', SouthernAir: 'SOO', Spanair: 'JKK', Srilankan: 'ALK',
    StarPeru: 'SRU', SunExpress: 'SXS', SyrianAir: 'SYR', TACV: 'TCV', TAP: 'TAP', Tap: 'TAP', Tarom: 'ROT',
    Thai: 'THA', ThomasCook: 'TCX', TigerAirways: 'TGW', TransStatesAirlines: 'LOF', Transaero: 'TSO',
    TunisAir: 'TAR', Tunisair: 'TAR', TunisAirExpress: 'TAJ', Turkish: 'THY', Turkmenistan: 'TUA',
    UNIAir: 'UIA', Ukraine: 'AUI', UralAirlines: 'SVR', VLMAirlines: 'VLM', WesternGlobal: 'WGN',
    Wideroe: 'WIF', Wizz: 'WZZ', WowAir: 'WOW', Yemenia: 'IYE', airHongkong: 'AHK',
};

function sh(cmd, args, cwd) {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'] });
}

function checkout() {
    const given = process.argv[2];
    if (given) return path.resolve(given);
    const dir = path.join(os.tmpdir(), `fgdata-${FG_COMMIT.slice(0, 12)}`);
    if (!fs.existsSync(path.join(dir, '.git'))) {
        console.log(`Cloning fgdata (XML and .ac only) into ${dir}`);
        sh('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', '--branch', 'next',
            'https://gitlab.com/flightgear/fgdata.git', dir]);
    }
    sh('git', ['sparse-checkout', 'set', '--no-cone', `/${AI}/**/*.xml`, `/${AI}/**/*.ac`], dir);
    sh('git', ['checkout', '-q', FG_COMMIT], dir);
    return dir;
}

// <PropertyList include="..."> chains, read for <path>, <texture-path> and
// <author>. Paths come back relative to the aircraft's folder.
export function textureName(texture) {
    return String(texture || '').split(/[\\/]/).pop();
}

function readXml(file, folderDir, depth = 0) {
    if (depth > 6 || !fs.existsSync(file)) return {};
    const text = fs.readFileSync(file, 'latin1');
    const top = text.match(/<PropertyList([^>]*)>/);
    let out = {};
    const inc = top && top[1].match(/include\s*=\s*"([^"]+)"/);
    if (inc) out = readXml(path.join(path.dirname(file), inc[1]), folderDir, depth + 1);
    // Only the top level: a nested <model><path> is a light or an effect.
    const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(model|animation|effect|sound)\b[\s\S]*?<\/\1>/g, '');
    for (const tag of ['path', 'texture-path', 'author']) {
        const m = body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        if (!m) continue;
        const value = m[1].trim();
        out[tag] = tag === 'author' ? value
            : path.relative(folderDir, path.join(path.dirname(file), value)).split(path.sep).join('/');
    }
    return out;
}

async function airlineTable() {
    const src = fs.readFileSync(path.join(ROOT, 'flight.js'), 'utf8');
    const start = src.indexOf('const AIRLINE_LIVERY_ICAO = {');
    const end = src.indexOf('\n};', start);
    if (start < 0 || end < 0) throw new Error('AIRLINE_LIVERY_ICAO not found in flight.js');
    return new Function(src.slice(start, end + 3) + '\nreturn AIRLINE_LIVERY_ICAO;')();
}

function liveryIcao(name, table) {
    if (Object.prototype.hasOwnProperty.call(LIVERY_ICAO, name)) return LIVERY_ICAO[name];
    const words = name
        .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .toLowerCase().split(/\s+/).filter(Boolean);
    for (let n = Math.min(words.length, 5); n >= 1; n--) {
        const icao = table[words.slice(0, n).join(' ')];
        if (icao) return icao;
    }
    const joined = table[words.join('')];
    return joined || undefined;
}

async function main() {
    const repo = checkout();
    const { parseAC3D } = await import(pathToFileURL(path.join(ROOT, 'ac3d.js')).href);
    const table = await airlineTable();
    const tree = new Set(sh('git', ['ls-tree', '-r', '--name-only', FG_COMMIT, AI], repo).split('\n').filter(Boolean));
    const has = (folder, rel) => tree.has(`${AI}/${folder}/${rel}`);

    const unmatched = new Map();
    const models = [];
    for (const [folder, file, designators] of MODELS) {
        const folderDir = path.join(repo, AI, folder);
        const acFile = path.join(folderDir, file);
        if (!fs.existsSync(acFile)) throw new Error(`Missing ${folder}/${file}`);

        // Every XML in the folder that draws this model is one livery.
        const rows = [];
        for (const x of fs.readdirSync(folderDir).filter((f) => f.endsWith('.xml')).sort()) {
            const r = readXml(path.join(folderDir, x), folderDir);
            if (r.path === file) rows.push({ xml: x, ...r });
        }
        const author = (rows.find((r) => r.author) || readXml(path.join(folderDir, `${folder}-main.xml`), folderDir)).author || '';

        const ac = parseAC3D(fs.readFileSync(acFile, 'latin1'));
        const modelDir = path.posix.dirname(file);
        // FlightGear looks a texture up by its file name, in the livery's
        // folder and then beside the model: some files carry the modeller's
        // own absolute path ("F:/My FlightGear/…/223-tex.png").
        const textures = [...new Set(ac.parts.map((p) => textureName(p.texture)).filter(Boolean))];

        const liveries = {};
        let fallbackDir = null;
        for (const r of rows) {
            const dir = r['texture-path'];
            if (!dir) continue;
            const name = path.posix.basename(dir);
            const icao = liveryIcao(name, table);
            if (icao === undefined) {
                unmatched.set(name, (unmatched.get(name) || 0) + 1);
                continue;
            }
            if (icao === null) continue;
            // Which of the model's textures this livery repaints.
            let mask = 0;
            textures.forEach((t, i) => { if (has(folder, `${dir}/${t}`)) mask |= 1 << i; });
            if (!mask) continue;
            if (icao === '' || /default/i.test(name)) fallbackDir = fallbackDir || [dir, mask];
            if (icao && !(icao in liveries)) liveries[icao] = mask === (1 << textures.length) - 1 ? dir : [dir, mask];
        }

        // Where each texture comes from when a livery does not repaint it:
        // beside the model, or failing that the default livery.
        const base = textures.map((t, i) => {
            const given = ac.parts.map((p) => p.texture).find((x) => textureName(x) === t);
            for (const rel of [given, t]) {
                if (rel && !/^[a-z]:|^\//i.test(rel) && has(folder, path.posix.normalize(`${modelDir}/${rel}`))) {
                    return path.posix.normalize(`${modelDir}/${rel}`);
                }
            }
            if (fallbackDir && fallbackDir[1] & (1 << i)) return `${fallbackDir[0]}/${t}`;
            // None: drawn plain white, the colour most of these paint kits start from.
            return null;
        });

        const size = ac.max.map((v, i) => Math.round((v - ac.min[i]) * 10) / 10);
        models.push({
            id: `${folder}/${path.posix.basename(file, '.ac')}`.toLowerCase(),
            folder, file, designators, author,
            length: size[0], span: size[2],
            textures, base, liveries,
        });
    }

    const body = `// Generated by tools/build-fg-aircraft.mjs — do not edit by hand.
//
// FlightGear's AI aircraft (fgdata AI/Aircraft, GNU GPL v2), pinned to one
// commit: each model's file, size in metres and textures, and each livery's
// folder by airline ICAO code. A livery given as [folder, mask] repaints only
// the textures whose bit is set; the rest come from \`base\`.

export const FG_COMMIT = '${FG_COMMIT}';

export const FG_MODELS = ${JSON.stringify(models, null, 0).replace(/},{"id"/g, '},\n{"id"')};
`;
    fs.writeFileSync(OUT, body);
    const liveryCount = models.reduce((a, m) => a + Object.keys(m.liveries).length, 0);
    console.log(`Wrote ${path.relative(ROOT, OUT)}: ${models.length} models, ${liveryCount} airline liveries.`);
    if (unmatched.size) {
        console.log(`Liveries matching no airline (left out): ${[...unmatched.keys()].sort().join(', ')}`);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
