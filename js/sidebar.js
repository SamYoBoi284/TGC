// ===========================================
// The Glitchcore Chronicle
// js/sidebar.js
// MILESTONE 1: Foundation
// ===========================================
//
// Owns sidebar nav interaction only: clicking an item marks it
// active and swaps the visible route view. No feature logic for
// individual routes lives here — each route's own module (added in
// later milestones) is responsible for populating its view.

export function initSidebar() {
    const navItems = document.querySelectorAll(".sidebarNavItem");
    const backBtn = document.getElementById("mobileBackBtn");
    const appShell = document.getElementById("appShell");

    // Matches the touch-device breakpoint in css/layout.css. Using
    // (hover:none)+(pointer:coarse) instead of a width cutoff means
    // this stays true across rotation — a phone in landscape is
    // often 700-900px wide (past any reasonable width breakpoint)
    // but is obviously still a phone.
    const mobileQuery = window.matchMedia("(hover: none) and (pointer: coarse)");

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const route = item.dataset.route;
            if (!route) return;
            setActiveRoute(route);

            // On a phone, picking a route from the menu drills into
            // it full-screen (like tapping a row in Android Settings)
            // rather than showing sidebar + content side by side.
            if (mobileQuery.matches) {
                appShell?.classList.add("mobileRouteOpen");
            }
        });
    });

    // Tapping back just returns to the menu list — it does NOT
    // change the active route, so whatever section you were in is
    // still there (scrolled to the same place, still populated) if
    // you tap back into it again.
    backBtn?.addEventListener("click", () => {
        appShell?.classList.remove("mobileRouteOpen");
    });

    // If the screen crosses the breakpoint (rotation, resize) while
    // a route is open, drop back to the un-drilled-down desktop
    // layout automatically rather than leaving mobileRouteOpen set
    // and having it do nothing on a wide screen.
    mobileQuery.addEventListener("change", (e) => {
        if (!e.matches) appShell?.classList.remove("mobileRouteOpen");
    });

    // Home is active by default on first load. On a phone this just
    // means "Home" is what you land on if you tap into the menu —
    // the menu itself (not Home) is still what's shown first, same
    // as Android Settings opens on its category list, not a page.
    setActiveRoute("home");
}

function setActiveRoute(route) {
    document.querySelectorAll(".sidebarNavItem").forEach(item => {
        item.classList.toggle("sidebarNavItemActive", item.dataset.route === route);
    });

    document.querySelectorAll(".routeView").forEach(view => {
        view.classList.toggle("routeViewActive", view.id === `${route}Page`);
    });

    const mainContent = document.getElementById("mainContent");
    if (mainContent) mainContent.dataset.activeRoute = route;

    const footerStatus = document.getElementById("footerStatusText");
    if (footerStatus) footerStatus.textContent = "Ready";
}
