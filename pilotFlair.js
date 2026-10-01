/**
 * pilotFlair.js — the Pro flair animations on a pilot's banner.
 *
 * A Pro pilot picks one animation for the banner on their flight window
 * (pilot_profiles.window_flair_style, see supabase/sql/pilot-window-style.sql),
 * and can have a shine follow it: the main animation plays, then a band of
 * light sweeps across, and the cycle repeats. Shared by the flight window
 * (flight.js) and the pilot's own editor preview (pilotCardEditor.js) so both
 * show exactly the same thing.
 *
 * Markup contract: the animated element gets the classes from flairClasses()
 * and must be position: relative (or absolute) with overflow hidden and an
 * isolated stacking context. Its banner image, if any, carries .pflair-bg —
 * Drift moves that. Effects paint on ::before (main) and ::after (shine), so
 * neither pseudo-element may be used for anything else on that element.
 */

export const FLAIR_EFFECTS = [
    { id: 'shine',   label: 'Shine',   hint: 'A band of light sweeps across.' },
    { id: 'glow',    label: 'Glow',    hint: 'The edge breathes in your accent colour.' },
    { id: 'aurora',  label: 'Aurora',  hint: 'A slow wash of colour drifts across.' },
    { id: 'sparkle', label: 'Sparkle', hint: 'Specks of light twinkle on the banner.' },
    { id: 'drift',   label: 'Drift',   hint: 'Your banner slowly zooms and pans.' },
];

const EFFECT_IDS = new Set(FLAIR_EFFECTS.map(e => e.id));

/**
 * Normalise a stored style to { effect, thenShine }. Unknown or empty values
 * fall back to a plain Shine — what Pro flair has always been.
 */
export function parseFlairStyle(value) {
    const [main, extra] = String(value || '').toLowerCase().split('+');
    const effect = EFFECT_IDS.has(main) ? main : 'shine';
    return { effect, thenShine: effect !== 'shine' && extra === 'shine' };
}

/** The stored form of { effect, thenShine }: 'glow', 'glow+shine', 'shine', … */
export function formatFlairStyle(effect, thenShine) {
    const e = EFFECT_IDS.has(effect) ? effect : 'shine';
    return e !== 'shine' && thenShine ? `${e}+shine` : e;
}

/** Classes for the animated element; '' when flair is off. */
export function flairClasses(value, on = true) {
    if (!on) return '';
    const { effect, thenShine } = parseFlairStyle(value);
    return `pflair pflair-${effect}${thenShine ? ' pflair-then-shine' : ''}`;
}

const ALL_CLASSES = ['pflair', 'pflair-then-shine', ...FLAIR_EFFECTS.map(e => `pflair-${e.id}`)];

/** Swap an element's flair classes for those of `value` (or none when off). */
export function applyFlair(el, value, on = true) {
    if (!el) return;
    el.classList.remove(...ALL_CLASSES);
    const cls = flairClasses(value, on);
    if (cls) el.classList.add(...cls.split(' '));
}

// One cycle for a combo: the main effect owns roughly the first 60%, the
// shine the last third, so they read as "this, then that".
const COMBO_S = 9;

const CSS = `
.pflair { --pflair-accent: var(--pilot-accent, #f5c451); }
.pflair::before, .pflair::after {
    content: ''; position: absolute; inset: 0; z-index: 0;
    border-radius: inherit; pointer-events: none;
}

/* Shine — on its own, and as the second half of every combo. */
.pflair-shine::after, .pflair-then-shine::after {
    background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,.16) 45%, rgba(255,255,255,.28) 50%, rgba(255,255,255,.16) 55%, transparent 70%);
    background-size: 250% 100%;
    background-position: 130% 0;
}
.pflair-shine::after { animation: pflair-shine 5.5s ease-in-out infinite; }
.pflair-then-shine::after { animation: pflair-shine-late ${COMBO_S}s ease-in-out infinite; }
@keyframes pflair-shine { 0%, 35% { background-position: 130% 0; } 75%, 100% { background-position: -30% 0; } }
@keyframes pflair-shine-late { 0%, 62% { background-position: 130% 0; } 92%, 100% { background-position: -30% 0; } }

/* Glow — the edge breathes in the pilot's accent. */
.pflair-glow::before {
    box-shadow: inset 0 0 0 1px var(--pflair-accent), inset 0 0 22px color-mix(in srgb, var(--pflair-accent) 55%, transparent);
    opacity: 0;
    animation: pflair-glow 4s ease-in-out infinite;
}
.pflair-glow.pflair-then-shine::before { animation: pflair-glow-combo ${COMBO_S}s ease-in-out infinite; }
@keyframes pflair-glow { 0%, 100% { opacity: .15; } 50% { opacity: 1; } }
@keyframes pflair-glow-combo { 0% { opacity: 0; } 15%, 40% { opacity: 1; } 58%, 100% { opacity: 0; } }

/* Aurora — a slow wash of accent and sky blue across the banner. */
.pflair-aurora::before {
    background: linear-gradient(115deg, transparent 20%,
        color-mix(in srgb, var(--pflair-accent) 45%, transparent) 38%,
        rgba(125,211,252,.35) 52%,
        color-mix(in srgb, var(--pflair-accent) 30%, transparent) 66%, transparent 82%);
    background-size: 300% 100%;
    mix-blend-mode: screen;
    animation: pflair-aurora 12s ease-in-out infinite;
}
.pflair-aurora.pflair-then-shine::before { animation: pflair-aurora-combo ${COMBO_S}s ease-in-out infinite; }
@keyframes pflair-aurora { 0%, 100% { background-position: 100% 0; } 50% { background-position: 0% 0; } }
@keyframes pflair-aurora-combo {
    0% { background-position: 100% 0; opacity: 0; } 10% { opacity: 1; }
    50% { background-position: 0% 0; opacity: 1; } 60%, 100% { background-position: 0% 0; opacity: 0; }
}

/* Sparkle — specks of light that twinkle. */
.pflair-sparkle::before {
    background:
        radial-gradient(circle at 12% 30%, #fff 0 1.2px, transparent 2px),
        radial-gradient(circle at 34% 72%, #fff 0 1px, transparent 1.8px),
        radial-gradient(circle at 58% 22%, #fff 0 1.4px, transparent 2.2px),
        radial-gradient(circle at 76% 64%, #fff 0 1px, transparent 1.8px),
        radial-gradient(circle at 90% 34%, #fff 0 1.2px, transparent 2px);
    filter: drop-shadow(0 0 3px var(--pflair-accent));
    opacity: 0;
    animation: pflair-sparkle 3.2s ease-in-out infinite;
}
.pflair-sparkle::after {
    /* A second, offset set so the twinkle never all lands at once. */
    background:
        radial-gradient(circle at 22% 66%, #fff 0 1px, transparent 1.8px),
        radial-gradient(circle at 46% 38%, #fff 0 1.2px, transparent 2px),
        radial-gradient(circle at 68% 80%, #fff 0 1px, transparent 1.8px),
        radial-gradient(circle at 84% 18%, #fff 0 1.3px, transparent 2.1px);
    filter: drop-shadow(0 0 3px var(--pflair-accent));
    opacity: 0;
    animation: pflair-sparkle 3.2s ease-in-out 1.6s infinite;
}
.pflair-sparkle.pflair-then-shine::before { animation: pflair-sparkle-combo ${COMBO_S}s ease-in-out infinite; }
/* In a combo ::after is the shine, not the second twinkle set. */
.pflair-sparkle.pflair-then-shine::after {
    background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,.16) 45%, rgba(255,255,255,.28) 50%, rgba(255,255,255,.16) 55%, transparent 70%);
    background-size: 250% 100%;
    background-position: 130% 0;
    filter: none;
    opacity: 1;
    animation: pflair-shine-late ${COMBO_S}s ease-in-out infinite;
}
@keyframes pflair-sparkle { 0%, 100% { opacity: 0; transform: scale(.96); } 50% { opacity: 1; transform: scale(1); } }
@keyframes pflair-sparkle-combo {
    0%, 100% { opacity: 0; } 10%, 22% { opacity: 1; } 30% { opacity: .2; } 38%, 48% { opacity: 1; } 58% { opacity: 0; }
}

/* Drift — the banner image slowly zooms and pans. */
.pflair-drift .pflair-bg {
    transform-origin: 60% 50%;
    animation: pflair-drift 16s ease-in-out infinite;
}
.pflair-drift.pflair-then-shine .pflair-bg { animation: pflair-drift-combo ${COMBO_S}s ease-in-out infinite; }
@keyframes pflair-drift { 0%, 100% { transform: scale(1) translateX(0); } 50% { transform: scale(1.12) translateX(-3%); } }
@keyframes pflair-drift-combo { 0% { transform: scale(1); } 30% { transform: scale(1.1) translateX(-2%); } 58%, 100% { transform: scale(1); } }

@media (prefers-reduced-motion: reduce) {
    .pflair::before, .pflair::after, .pflair .pflair-bg { animation: none !important; }
    .pflair::before, .pflair::after { opacity: 0 !important; }
}
`;

/** Inject the flair stylesheet once per document. */
export function ensureFlairStyles(doc = document) {
    if (!doc || doc.getElementById('pilot-flair-styles')) return;
    const style = doc.createElement('style');
    style.id = 'pilot-flair-styles';
    style.textContent = CSS;
    doc.head.appendChild(style);
}
