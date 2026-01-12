/**
 * atcHighlights.js
 * Mapbox GL JS version
 */



// 1. Mock Data (Matches your VATSpy.dat IDs)
const MOCK_ATC_DATA = [
    { callsign: "BOS_CTR", frequency: "128.200", fir_id: "KZBW" },
    { callsign: "LON_CTR", frequency: "133.900", fir_id: "EGTT" }
];

/**
 * Updates the Mapbox layer style based on active ATC.
 * @param {object} map - Your Mapbox map instance
 * @param {string} layerId - The ID of the fill layer in your map (e.g., 'fir-fills')
 * @param {Array} atcData - The array of online controllers
 */
export function updateActiveSectors(map, layerId, atcData = MOCK_ATC_DATA) {
    if (!map || !map.getLayer(layerId)) return;

    // Create an array of active IDs (e.g., ["KZBW", "EGTT"])
    const activeIds = atcData
        .map(c => c.fir_id)
        .filter(id => id != null);

    /**
     * Mapbox Expression Logic:
     * 1. Get the 'id' property from the GeoJSON feature.
     * 2. Use 'match' to see if the ID (or the base ID before a hyphen) is in our active list.
     */
    
    // This expression checks if the feature ID is in the active list.
    // To handle sub-sectors (ADR-E), we use a helper to match the prefix.
    const matchExpression = [
        "match",
        // This nested expression gets the part of the ID before the "-"
        ["slice", ["get", "id"], 0, ["index-of", "-", ["concat", ["get", "id"], "-"]]],
        activeIds,
        true, // If it matches an active ID
        false // If it doesn't
    ];

    // Apply Highlight Green if matched, otherwise Dim Gray
    map.setPaintProperty(layerId, 'fill-color', [
        'case',
        matchExpression,
        '#2ecc71', // Active Color
        '#34495e'  // Inactive Color
    ]);

    // Adjust Opacity: 0.6 for active, 0.2 for inactive
    map.setPaintProperty(layerId, 'fill-opacity', [
        'case',
        matchExpression,
        0.6,
        0.2
    ]);
}