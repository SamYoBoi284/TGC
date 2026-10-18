// ===========================================
// The Glitchcore Chronicle
// js/ambient-effects.js — ambient background particles
// ===========================================
//
// Adapted from a separate project's "GlitchOS" atmosphere effect.
// Ported over: the particle field + gradient wash and the
// reduced-motion awareness. Left out: the boot-pulse ring, since it
// was synced to a #gos-desktop boot animation this app doesn't have.
//
// A small, fixed count — enough to read as "atmosphere" without
// asking the compositor to track dozens of animated layers.
const PARTICLE_COUNT = 16;

function prefersReducedMotion() {
    return (
        document.documentElement.classList.contains("chronicle-reduced-motion") ||
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    );
}

function buildParticles(fieldEl) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const el = document.createElement("span");
        el.className = "ambientParticle";
        // Randomize per-particle so the field doesn't look like one
        // repeating tile: horizontal position, float distance/
        // duration, delay, and size all vary within a tasteful range
        // set by these custom properties (see ambient-effects.css).
        el.style.setProperty("--particle-left", `${Math.random() * 100}%`);
        el.style.setProperty("--particle-size", `${1.5 + Math.random() * 2.5}px`);
        el.style.setProperty("--particle-dur", `${18 + Math.random() * 22}s`);
        el.style.setProperty("--particle-delay", `${-Math.random() * 30}s`);
        el.style.setProperty("--particle-drift", `${(Math.random() - 0.5) * 60}px`);
        el.style.setProperty("--particle-opacity", `${0.25 + Math.random() * 0.4}`);
        frag.appendChild(el);
    }
    fieldEl.appendChild(frag);
}

// Called once at boot (see app.js's bootApp()). Safe to call more
// than once — clears and rebuilds rather than duplicating layers.
export function initAmbientEffects() {
    const layerEl = document.getElementById("ambientLayer");
    if (!layerEl) return;

    layerEl.innerHTML = "";

    const gradientEl = document.createElement("div");
    gradientEl.className = "ambientGradient";
    layerEl.appendChild(gradientEl);

    const fieldEl = document.createElement("div");
    fieldEl.className = "ambientParticleField";
    layerEl.appendChild(fieldEl);

    function render() {
        fieldEl.innerHTML = "";
        if (!prefersReducedMotion()) buildParticles(fieldEl);
    }

    render();

    // js/settings.js toggles .chronicle-reduced-motion on <html> at
    // any time via the Settings > Appearance > "Reduced motion"
    // checkbox — react live instead of only checking once at boot.
    const observer = new MutationObserver(render);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}
