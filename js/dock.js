// ===========================================
// The Glitchcore Chronicle
// js/dock.js
// MILESTONE 1: Foundation
// ===========================================
//
// Renders the "most used" dock, phone-recents style. There's no
// usage-tracking system yet (that belongs to whichever future
// milestone introduces real routes with real activity) — for now
// this reads a small static list so the dock isn't empty, and is
// built so swapping in real usage data later is a one-line change.

const PLACEHOLDER_ITEMS = [
    { icon: "📖", route: "entries" },
    { icon: "🧠", route: "braindump" },
    { icon: "⭐", route: "milestones" }
];

export function initDock() {
    renderDock(PLACEHOLDER_ITEMS);
}

function renderDock(items) {
    const list = document.getElementById("dockItemList");
    if (!list) return;

    if (!items.length) {
        list.innerHTML = `<span class="dockEmptyHint">Nothing used yet</span>`;
        return;
    }

    list.innerHTML = items.map(item => `
        <div class="dockItem" data-route="${item.route}" title="${item.route}">
            ${item.icon}
        </div>
    `).join("");

    list.querySelectorAll(".dockItem").forEach(el => {
        el.addEventListener("click", () => {
            document.querySelector(`.sidebarNavItem[data-route="${el.dataset.route}"]`)?.click();
        });
    });
}
