# Desktop redesign — finish record

## Follow-up: visual lineage, minimal labels

The user found source versus generated imagery unclear and explicitly rejected adding more labels. The follow-up replaces repeated image headings, filenames, style captions and action words with a larger anchored original, directional connector, smaller result grid, role icons and numeric indices. Original, AI, mock and review states retain distinct indicators; complete descriptions remain in hover titles, accessible names and viewer details. No stored names, images or relationships were changed.

Fresh reviewer `/root/visual_lineage_reviewer` returned **ship**, with no required fixes across the current desktop, actual-window, mobile and gallery captures (`visual-lineage-*.png`). Unit tests remain 70/70; production build and isolated Electron workflow passed after the follow-up. The documenter verified the narrow system delta; DESIGN.md, its sidecar and README were updated. No public deployment or live AI call was performed.

## Implemented direction

User-pinned restrained macOS / Linear / Raycast application. Quiet graphite surfaces, system type, compact controls and flat image contact sheets. Information architecture is room → source → versions, with measurements in an optional inspector. No new product claims or data migrations were introduced by the visual redesign.

## Critique → distill → polish

The independent first critique scored 28/40. This is the first recorded run for this target, so there is no score trend. The archived assessment is `critique/2026-09-06T13-48-53Z__src-main-js.md`; its priority backlog is closed, not rescored.

Resolved issues:

- Saved comparison now has an independent action, including the immutable parent input and geometry findings or refinement instruction.
- Generated-image actions say Refine; viewer identity and repeated action labels identify the version.
- Sidebar counts identify sources; floor-plan counts still represent all images.
- Removed repeated mock wording, decorative generation dots, oversized Restyle tile and obsolete overridden CSS.
- Aligned controls, neutralized chrome, adjusted narrow-window layout and replaced the last text close glyph with the SVG icon treatment.

## Final independent review

The fresh reviewer checked eight valid captures at 1440×900, 1054×998 and 390×844, plus sampled source. It found the direction contract matched and requested one P2 icon consistency fix. Its follow-up disposition was **ship**, scoring that fix **resolved**. The follow-up verdict is limited to that listed fix; the preceding full review found no other material issue in its evidence.

Review captures are local-only under `.impeccable/review/`, excluded from Git because they contain existing user images. Source-detail mobile captures show the initial viewport, with content continuing below. Malformed full-page captures were replaced with valid viewport captures before review.

## Verification and limits

- `npm test`: 70/70 passed after the final correction.
- `npm run build`: passed after the final correction.
- `npm run test:desktop`: passed with an isolated temporary Electron profile before the icon-only correction. Covers sandboxed IPC, wizard, three mocked model calls, saving, comparison and history.
- `git diff --check`: passed.
- No live Real AI generation, photo upload or deletion was performed during visual verification. Existing user data and unrelated worktree edits were preserved.
- No public deployment was performed. The local development preview remains available.

## Impeccable run notes

Assessment A and detector assessment B ran independently; detector findings were withheld until A completed. The CLI scan ran once. Its sole missing-initial-image-src warning is a verified false positive: viewer draw assigns the blob URL and alt text before display. No ignore rule was added. Browser overlay injection was unavailable through the read-only evaluate API, so source and rendered-image evidence were used.

The critique snapshot write, trend read and exact-snapshot close succeeded. Assessment agents closed their temporary browser tabs. Temporary text/CSS-processing helpers were removed. The retained preview tab is the user-facing deliverable and its viewport override was reset. No new shipping raster assets were created; existing reference images were left unchanged.

The documenter extracted the finished cascade and five representative primitives. The owner reviewed and applied its drafts as `DESIGN.md` and `.impeccable/design.json`, verified the sidecar JSON, and removed the temporary copies. The sidecar's tonal ramps are illustrative metadata only, not new application colors.
