// File: netlify/functions/sigmets.js
//
// Server-side proxy for NOAA Aviation Weather Center hazard advisories.
// The AWC data API does not send CORS headers, so a direct browser fetch
// fails. Proxying here adds CORS + light caching, and merges international
// SIGMETs with US AIRMET/SIGMETs so the hazard layer actually has data to
// show (international SIGMETs alone are often sparse or empty).
//
// All sources are free and key-less.

const fetch = require('node-fetch');

const SOURCES = [
    'https://aviationweather.gov/api/data/isigmet?format=geojson',
    'https://aviationweather.gov/api/data/airsigmet?format=geojson',
];

exports.handler = async () => {
    const features = [];

    await Promise.all(SOURCES.map(async (url) => {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'indgo-va-weather/1.0 (+netlify-function)' },
            });
            if (!res.ok) {
                console.warn(`SIGMET source ${url} -> HTTP ${res.status}`);
                return;
            }
            const data = await res.json();
            if (data && Array.isArray(data.features)) {
                // Keep only features with usable geometry.
                features.push(...data.features.filter((f) => f && f.geometry));
            }
        } catch (err) {
            console.warn(`SIGMET source ${url} failed:`, err.message);
        }
    }));

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            // Advisories update slowly; cache for 5 min to spare the upstream API.
            'Cache-Control': 'public, max-age=300',
        },
        body: JSON.stringify({ type: 'FeatureCollection', features }),
    };
};
