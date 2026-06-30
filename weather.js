// weather.js

/**
 * Parses a raw METAR string into a more readable object.
 *
 * Returns a backwards-compatible object (wind / temp / condition / raw are
 * unchanged) enriched with the structured fields the airport "instrument
 * panel" needs: numeric wind direction & speed, visibility, cloud layers,
 * ceiling and altimeter in both inHg and hPa.
 *
 * @param {string} metarString - The raw METAR data.
 * @returns {object} Parsed weather object.
 */
const parseMetar = (metarString) => {
    const empty = {
        wind: '---', temp: '---', condition: '---', raw: 'Not Available',
        windDir: null, windSpeed: 0, windGust: null, windVariable: false,
        visibility: '—', visibilityMeters: null,
        clouds: [], ceiling: null,
        altimeterInHg: null, altimeterHpa: null, qnh: null,
        tempC: null, dewpointC: null
    };
    if (!metarString || typeof metarString !== 'string') {
        return empty;
    }

    const parts = metarString.trim().split(/\s+/);

    // --- Wind --------------------------------------------------------------
    const windToken = parts.find(p => /^(\d{3}|VRB)\d{2,3}(G\d{2,3})?(KT|MPS)$/.test(p));
    let windDir = null, windSpeed = 0, windGust = null, windVariable = false;
    if (windToken) {
        const m = windToken.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/);
        if (m) {
            const toKt = (v) => m[4] === 'MPS' ? Math.round(v * 1.94384) : v;
            if (m[1] === 'VRB') { windVariable = true; windDir = null; }
            else windDir = parseInt(m[1], 10);
            windSpeed = toKt(parseInt(m[2], 10));
            windGust = m[3] ? toKt(parseInt(m[3], 10)) : null;
        }
    }

    // --- Visibility --------------------------------------------------------
    let visibility = '—', visibilityMeters = null;
    if (/\bCAVOK\b/.test(metarString)) {
        visibility = 'CAVOK'; visibilityMeters = 10000;
    } else {
        const sm = parts.find(p => /^(M)?\d+(\/\d+)?SM$/.test(p));
        const metersTok = parts.find(p => /^\d{4}$/.test(p));
        if (sm) {
            const num = sm.replace('SM', '').replace('M', '');
            let miles;
            if (num.includes('/')) { const [a, b] = num.split('/'); miles = parseInt(a, 10) / parseInt(b, 10); }
            else miles = parseInt(num, 10);
            visibility = `${num} mi`;
            visibilityMeters = Math.round(miles * 1609.34);
        } else if (metersTok) {
            const mtr = parseInt(metersTok, 10);
            visibilityMeters = mtr;
            visibility = mtr >= 9999 ? '10+ km' : (mtr >= 1000 ? `${(mtr / 1000).toFixed(mtr % 1000 ? 1 : 0)} km` : `${mtr} m`);
        }
    }

    // --- Clouds & ceiling --------------------------------------------------
    const coverNames = { FEW: 'Few clouds', SCT: 'Scattered', BKN: 'Broken', OVC: 'Overcast', VV: 'Obscured' };
    const clouds = [];
    let ceiling = null;
    parts.forEach(p => {
        const cm = p.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/);
        if (cm) {
            const base = parseInt(cm[2], 10) * 100;
            clouds.push({ cover: cm[1], base, label: coverNames[cm[1]] || cm[1] });
            if ((cm[1] === 'BKN' || cm[1] === 'OVC' || cm[1] === 'VV') && (ceiling === null || base < ceiling)) {
                ceiling = base;
            }
        }
    });
    const clearTok = parts.find(p => /^(SKC|CLR|NSC|NCD)$/.test(p));
    let conditionLabel = clouds.length ? (coverNames[clouds[0].cover] || clouds[0].cover) : (clearTok ? 'Clear' : '—');

    // --- Temperature / dewpoint -------------------------------------------
    const tempMatch = metarString.match(/\b(M?\d{2})\/(M?\d{2})\b/);
    let tempC = null, dewpointC = null, tempDisplay = '---';
    if (tempMatch) {
        tempC = parseInt(tempMatch[1].replace('M', '-'), 10);
        dewpointC = parseInt(tempMatch[2].replace('M', '-'), 10);
        tempDisplay = `${tempC}°C`;
    }

    // --- Altimeter ---------------------------------------------------------
    let altimeterInHg = null, altimeterHpa = null;
    const aTok = parts.find(p => /^A\d{4}$/.test(p));
    const qTok = parts.find(p => /^Q\d{3,4}$/.test(p));
    if (aTok) {
        altimeterInHg = parseInt(aTok.slice(1), 10) / 100;
        altimeterHpa = Math.round(altimeterInHg * 33.8639);
    }
    if (qTok) {
        altimeterHpa = parseInt(qTok.slice(1), 10);
        if (altimeterInHg === null) altimeterInHg = +(altimeterHpa / 33.8639).toFixed(2);
    }

    // Legacy condition string (raw cloud tokens), kept for existing callers.
    const condition = parts.filter(p => /^(FEW|SCT|BKN|OVC|SKC|CLR|NSC)/.test(p)).join(' ');

    return {
        // Legacy fields (unchanged shape) ----------------------------------
        wind: windToken || '---',
        temp: tempDisplay,
        condition: condition || '---',
        raw: metarString,
        visibility,
        qnh: altimeterHpa,
        // Structured fields -------------------------------------------------
        windDir, windSpeed, windGust, windVariable,
        visibilityMeters,
        clouds, ceiling,
        conditionLabel,
        altimeterInHg, altimeterHpa,
        tempC, dewpointC
    };
};

/**
 * Fetches and parses the latest METAR for a given airport ICAO from the VATSIM network.
 * @param {string} icao - The ICAO code of the airport (e.g., "KJFK").
 * @returns {Promise<object>} A promise that resolves to the parsed weather object.
 */
const fetchAndParseMetar = async (icao) => {
    if (!icao || icao.length < 3) {
        return parseMetar(null); // Return default empty object if ICAO is invalid
    }
    try {
        const response = await fetch(`https://metar.vatsim.net/metar.php?id=${icao}`);
        if (!response.ok) {
            throw new Error('Weather data not available for this location.');
        }
        const rawMetar = await response.text();
        return parseMetar(rawMetar);
    } catch (error) {
        console.error(`Failed to fetch METAR for ${icao}:`, error);
        return parseMetar(null); // Return default on error
    }
};

// Expose the service to be used by other scripts
window.WeatherService = {
    fetchAndParseMetar,
    parseMetar
};
