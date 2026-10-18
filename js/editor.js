// ===========================================
// The Glitchcore Chronicle
// js/editor.js
// MILESTONE 2: Journal Entries
// ===========================================
//
// A minimal rich text editor built on a contenteditable surface and
// document.execCommand — no external library, no build step. Kept
// deliberately small: bold, italic, underline, headings, and lists.
// This is a reusable component; entries.js is the only current
// consumer, but Ideas/Milestones can mount their own instance later.

const TOOLBAR_ACTIONS = [
    { command: "bold", label: "B", title: "Bold" },
    { command: "italic", label: "I", title: "Italic" },
    { command: "underline", label: "U", title: "Underline" },
    { command: "formatBlock:h2", label: "H", title: "Heading" },
    { command: "insertUnorderedList", label: "•", title: "Bulleted list" },
    { command: "insertOrderedList", label: "1.", title: "Numbered list" }
];

/**
 * Mounts a rich text editor inside `container`.
 * @param {HTMLElement} container - empty element to mount into
 * @param {Object} options
 * @param {Function} options.onChange - called with the current HTML on every edit (debounced upstream by the caller)
 * @returns {{ getHTML: Function, setHTML: Function, focus: Function, destroy: Function }}
 */
export function mountEditor(container, { onChange } = {}) {
    container.innerHTML = "";
    container.classList.add("richEditor");

    const toolbar = document.createElement("div");
    toolbar.className = "richEditorToolbar";

    const surface = document.createElement("div");
    surface.className = "richEditorSurface";
    surface.contentEditable = "true";
    surface.spellcheck = true;
    surface.dataset.placeholder = "Write freely...";

    TOOLBAR_ACTIONS.forEach(action => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "richEditorButton";
        btn.textContent = action.label;
        btn.title = action.title;
        btn.addEventListener("mousedown", e => {
            // mousedown (not click) so the surface selection isn't lost first
            e.preventDefault();
            runCommand(action.command);
            surface.focus();
        });
        toolbar.appendChild(btn);
    });

    function runCommand(command) {
        if (command.startsWith("formatBlock:")) {
            const tag = command.split(":")[1];
            document.execCommand("formatBlock", false, tag);
            return;
        }
        document.execCommand(command, false, null);
    }

    surface.addEventListener("input", () => {
        toggleEmptyState();
        if (onChange) onChange(surface.innerHTML);
    });

    function toggleEmptyState() {
        const isEmpty = surface.textContent.trim().length === 0;
        surface.classList.toggle("richEditorSurfaceEmpty", isEmpty);
    }

    container.appendChild(toolbar);
    container.appendChild(surface);
    toggleEmptyState();

    return {
        getHTML() {
            return surface.innerHTML;
        },
        setHTML(html) {
            surface.innerHTML = html || "";
            toggleEmptyState();
        },
        focus() {
            surface.focus();
        },
        destroy() {
            container.innerHTML = "";
        }
    };
}
