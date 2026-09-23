/**
 * pilotProfiles.js
 *
 * Read-only access to the InFlight pilot profiles the iOS app lets people make
 * (handle, picture, banner). The join from an aircraft on the map to a profile
 * is the Infinite Flight username the profile claims — unverified by design,
 * see PROFILES.md in the iOS repo.
 *
 * Everything here goes through public, anon-callable Supabase functions and
 * public storage buckets, so it works signed out.
 */

const SUPABASE_URL = 'https://lcgaoiqwwpyqndaucyzu.supabase.co';
// The public anon key (the same one flight.js ships). Row access is decided
// server-side by pilot_profile_visible(); this key grants nothing more.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjZ2FvaXF3d3B5cW5kYXVjeXp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNjkyOTksImV4cCI6MjA4NzY0NTI5OX0.9TO21knXR_P9E80pea7gUOu-gTjb17sCGk7BYgRRe3U';

// Matches the app's cache. A profile changes rarely; an aircraft window
// re-renders often.
const TTL_MS = 10 * 60 * 1000;

// The painted banners (BannerPreset in the iOS app), top to bottom.
const BANNER_PRESETS = {
    dusk:         ['#2b336b', '#944f70', '#eb8c5c'],
    dawn:         ['#1f3d70', '#5c8cb8', '#facc99'],
    flight_level: ['#0d1c45', '#295999', '#9ecced'],
    night:        ['#080a1f', '#1a2147', '#404773'],
    desert:       ['#6b4229', '#c28547', '#f2d499'],
    ocean:        ['#05334c', '#0d6b82', '#70c2bf'],
};

const cache = new Map(); // lowercased IF username -> { at, profile|null, promise? }

function publicUrl(bucket, path) {
    if (!path) return null;
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encoded}`;
}

function shape(row) {
    if (!row || !row.handle) return null;
    const preset = BANNER_PRESETS[row.banner_preset] ? row.banner_preset : 'dusk';
    return {
        handle: row.handle,
        displayName: row.display_name || row.handle,
        avatarUrl: publicUrl('pilot-avatars', row.avatar_path),
        // Only served while the owner is Pro; the server blanks it otherwise.
        bannerUrl: publicUrl('pilot-banners', row.banner_path),
        bannerGradient: `linear-gradient(180deg, ${BANNER_PRESETS[preset].join(', ')})`,
        accent: row.accent || null,
        isPro: !!row.is_pro,
    };
}

export const PilotProfiles = {
    /** Cached profile for an IF username: a profile, null (none), or undefined (unknown). */
    peek(ifUsername) {
        const key = String(ifUsername || '').trim().toLowerCase();
        const hit = key && cache.get(key);
        if (!hit || hit.promise || Date.now() - hit.at > TTL_MS) return undefined;
        return hit.profile;
    },

    /** Resolves to the profile claiming this IF username, or null. Never rejects. */
    byIfUsername(ifUsername) {
        const key = String(ifUsername || '').trim().toLowerCase();
        if (!key) return Promise.resolve(null);
        const hit = cache.get(key);
        if (hit && hit.promise) return hit.promise;
        if (hit && Date.now() - hit.at <= TTL_MS) return Promise.resolve(hit.profile);

        const promise = fetch(`${SUPABASE_URL}/rest/v1/rpc/pilot_profile_by_if_username`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_username: key }),
        })
            .then(r => (r.ok ? r.json() : []))
            .then(rows => shape(Array.isArray(rows) ? rows[0] : rows))
            .catch(() => null)
            .then(profile => {
                cache.set(key, { at: Date.now(), profile });
                return profile;
            });
        cache.set(key, { at: 0, profile: null, promise });
        return promise;
    },
};
