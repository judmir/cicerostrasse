# Editable room names — finish record

Local Operate-surface extension. A pencil beside the room heading opens a compact inline name editor with Save name, Cancel, and Reset to original. Enter saves, Escape cancels, and blank, multiline, or names longer than 60 Unicode code points are rejected. Names persist in the independent IndexedDB v4 `roomNames` store. Stable room IDs, routing, geometry and all photo/inspiration/version relationships remain unchanged.

Saved display names propagate through the heading, sidebar and accessible navigation names, mobile selector, floor-plan buttons, room inspector, document title, photo viewer and room selector, inspiration copy, room-specific messages and optional WebMCP room results. Historical names in supplied reference drawings remain unchanged. Long visual map labels are abbreviated, with full accessible names retained.

## Validation

- 82 tests pass, including all earlier source/inspiration/generation tests, v1/v2/v3 migration coverage, isolated name persistence/reset, validation and escaping, save-error retry, Escape, and navigation during pending save.
- Production build passes.
- Production Electron room-name smoke passes native Return plus character event / Escape, invalid names, save/reset/reload, stable route, name propagation, literal markup safety and long-name layout checks.
- Existing production Electron generation smoke also renames its room before creating a version and verifies the new name in the full-image viewer and photo room selector. Sandbox IPC, mocked generation, version saving, comparison and history continue to pass.
- Production inspiration smoke passes all three import paths and its existing persistence/interaction checks.
- Bounded full-document desktop/mobile visual review: `.impeccable/review/room-name-desktop.png`, `room-name-mobile.png`, `room-name-long-desktop.png`, `room-name-long-mobile.png`, at 1440px and 390px CSS widths. Valid and no horizontal overflow. Failed harness attempts before inspection were corrected to send the complete native Return sequence and use an in-limit long-name fixture.
- One detector run. Mobile 16px field is intentional. Floor-plan color advisory and dynamically assigned viewer image-src warning are pre-existing and unchanged.
- Fresh finish reviewer disposition **ship**, no material fixes. Generic fresh subagent used Impeccable's degraded reviewer instructions because the harness has no dedicated named reviewer type.

No new shipping raster, real AI call, publication, or deployment. Persistence remains local to the existing browser/Electron profile; names appear in other open instances on reload.
