# Desktop workspace

Mode: Operate. Scope: src/main.js, src/design-gallery.js, src/photo-viewer.js, src/restyle-wizard.js and their styles.

## Direction contract

THESIS: A room-based image workspace with a persistent place to navigate and one place to work.

OWN-WORLD: Graphite neutral surfaces, system type, fine separators, compact rectangular controls, no decoration.

STORY: Choose a room, open a source, compare versions, and restyle or refine without losing context.

FIRST VIEWPORT: A 204px room sidebar, compact toolbar and flat image contact sheet. The source-detail view anchors one larger original on the left, with a directional connector to smaller generated images. On narrow windows it becomes a top-to-bottom flow. Primary actions sit at the upper right. Measurements are a collapsible inspector.

USER REFINEMENT: The first design's text-heavy image labels did not make original versus generated content intuitive. The user explicitly requested visual indicators instead of more labels. Repeated filenames, style descriptions and action labels are now progressively disclosed through hover titles, accessible names and the image viewer. Image, sparkle and flask icons distinguish uploaded originals, AI output and mock previews; version numbers preserve order and parent references. Comparison and warning details remain available.

FORM: User-pinned macOS / Linear / Raycast canon overrides seed b1d9cbfb (degraded: no catalog). Code-first for this implementation request; no standing preference recorded. Direct room switching retains selection and source-family navigation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Closure: final reviewer disposition ship; its one requested icon-consistency fix was scored resolved. DESIGN.md and .impeccable/design.json record the built world. See .impeccable/finish.md for evidence and verification scope. No new shipping raster was created.

## Design inspiration extension

Scope: `src/inspiration-gallery.js`, `src/inspiration.css`, room routing in `src/main.js`, `src/storage.js` and `src/inspiration-image.js`. The existing Operate direction and identity remain authoritative.

Each room exposes Sources / Design inspiration beneath its toolbar. The inspiration collection has a compact Add inspiration action and flat image entries with a title, optional room note and source/edit/delete controls. The inline composer places an image preview or paste area beside image URL, optional title and note fields; upload and paste are alternatives to downloading a direct image URL. The Save action and image-ready/loading status sit below the fields. Empty, loading, error/retry, edit and inline delete-confirmation states share the same workspace; full images open in a dialog.

Built composition: desktop auto-fill grid from 220px with 4:3 cover previews and 28px × 20px gaps. The two-column composer is capped at 900px and stacks at 900px. At 620px the gallery becomes one column, controls reach 40px and field text becomes 16px. Small system type, graphite surfaces and thin separators extend the incumbent world without introducing decorative cards or a new token scale.

Closure: the fresh finish review returned disposition ship with no material fixes. Review evidence covers populated, composer and empty states at desktop and mobile sizes in `.impeccable/review/desktop.png`, `mobile.png`, `desktop-composer.png`, `mobile-composer.png`, `desktop-empty.png` and `mobile-empty.png`. Main-task verification reports 78 passing tests, a passing build, and production inspiration plus existing generation smoke checks. The single detector pass left two intentional advisories: incumbent error text color and mobile 16px fields for iOS zoom prevention. No shipping raster assets were generated.


## Editable room-name extension

Scope: `src/room-name-editor.js`, `src/room-name.css`, display-name getters in `src/rooms.js`, IndexedDB version 4 in `src/storage.js`, and propagation through `src/main.js`, `src/floorplan.js`, `src/room-plan.js` and `src/photo-viewer.js`. The existing graphite macOS / Linear / Raycast Operate direction remains authoritative.

A pencil beside the room heading opens a compact inline form beneath the toolbar and above the room collections. Save name / Enter commits a trimmed single-line name of 1–60 characters; Cancel / Escape closes, and Reset to original removes the override. The original name remains visible as guidance. Opening selects and focuses the field; closing returns focus to the pencil. Saving disables the form and announces progress; invalid input and storage failures retain an inline correction or retry path.

Built composition: the border-separated form is capped at 680px with a flexible field and wrapping action group. At 620px the editor uses 16px insets, input text becomes 16px to avoid iOS focus zoom, and Save, Cancel and the pencil reach 40px targets. Long headings wrap; sidebar and floor-plan names truncate with their full accessible labels retained. Room-diagram text shortens after 16 characters with the full name in the SVG title. Existing surface, type and control tokens remain authoritative.

Names persist locally in the separate `roomNames` store and update sidebar navigation, the mobile selector, headings and document title, apartment floor-plan labels, room diagrams, inspiration context and photo-viewer room options. Stable IDs, routes, measurements and existing collections keep their assignments.

Closure: the fresh finish review returned disposition ship with no material fixes. Four valid captures cover ordinary and long names on desktop and mobile: `.impeccable/review/room-name-desktop.png`, `room-name-mobile.png`, `room-name-long-desktop.png` and `room-name-long-mobile.png`. Main-task verification reports 82 passing tests, a passing build, and room-name, inspiration and existing generation smoke checks. A single detector pass identified the intentional mobile 16px input; its dynamic viewer-image and floor-plan-color findings predate this extension. No new shipping raster or global token was introduced.
