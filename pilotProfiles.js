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

export const BANNER_PRESET_LABELS = {
    dusk: 'Dusk', dawn: 'Dawn', flight_level: 'Flight level',
    night: 'Night', desert: 'Desert', ocean: 'Ocean',
};

export function presetGradient(preset) {
    const stops = BANNER_PRESETS[preset] || BANNER_PRESETS.dusk;
    return `linear-gradient(180deg, ${stops.join(', ')})`;
}

// The profile-image Edge Function is the only writer to the picture buckets
// (they refuse anon writes). It checks the file is really an image, caps size
// and dimensions, enforces Pro for banners, and records the path on the row.
async function callProfileImage(accessToken, body) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/profile-image`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    let answer = {};
    try { answer = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) {
        const err = new Error(answer.error || 'That picture could not be saved.');
        err.needsPro = answer.pro === true || res.status === 402;
        throw err;
    }
    return answer;
}

export const PilotProfiles = {
    presets: Object.keys(BANNER_PRESETS),

    /** Drop a cached lookup (after the owner changes their picture or banner). */
    forget(ifUsername) {
        cache.delete(String(ifUsername || '').trim().toLowerCase());
    },

    /**
     * The signed-in user's own row, read with their session. Filtered by id:
     * the select policy also returns every public profile, so an unfiltered
     * read would hand back a stranger's. Resolves to null when there is none.
     */
    async mine(supabase) {
        const { data: { session } = {} } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return null;
        const { data, error } = await supabase
            .from('pilot_profiles').select('*').eq('user_id', uid).limit(1).maybeSingle();
        if (error || !data) return null;
        return { ...shape(data), row: data, bannerPreset: data.banner_preset || 'dusk' };
    },

    /** kind: 'avatar' | 'banner'; base64 is a JPEG. Resolves to the stored path. */
    async upload(supabase, kind, base64) {
        const { data: { session } = {} } = await supabase.auth.getSession();
        if (!session) throw new Error('Sign in to add a picture.');
        const answer = await callProfileImage(session.access_token, { kind, contentType: 'image/jpeg', data: base64 });
        return answer.path;
    },

    async remove(supabase, kind) {
        const { data: { session } = {} } = await supabase.auth.getSession();
        if (!session) throw new Error('Sign in first.');
        await callProfileImage(session.access_token, { kind, remove: true });
    },

    publicUrl,
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
