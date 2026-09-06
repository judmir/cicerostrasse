# Cicerostraße

A minimal JavaScript app: an overhead Three.js floor plan and a separate image gallery for each room. It runs in a browser or Electron.

Public app: [Cicerostraße room journal](https://cicerostrasse.sharp-amber-1311.chatgpt.site). Each visitor has a separate collection stored on their device; photos are not shared between visitors.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Choose a room from the sidebar or floor plan, then select or drop source images to upload them together. The flat image gallery uses an image icon and number for each original, and a stack icon for its generated-version count. Open an original to see it anchored beside a smaller result grid, connected by an arrow. The toolbar's **plus / sparkle** button creates a version. On narrow windows the arrow runs downward from the original to the results, and a room selector replaces the sidebar. The progress bar tracks large upload batches.

The image icon identifies an uploaded original, sparkles identify AI-generated results, and a flask identifies mock previews. A warning triangle means the result needs review. Hover an image for its full name and provenance; these details are also available to screen readers. Numbered versions retain their order, and a small arrow plus a number identifies a parent version. Pencil icons refine a version. Opening an image keeps the full viewer, editing, comparison, and download tools available.

Click the source image or a version to enlarge it. Use arrow buttons, left/right keyboard arrows, horizontal swipes, or thumbnails to browse that source’s family. Home/End jump to the first/last image; Escape closes the viewer. **Versions** returns to the source page. **Compare** opens a generated version beside its saved input snapshot, with geometry findings and the style summary or refinement instruction. **Restyle** uses an original as the base; **Refine** works from a generated version. The **…** menu holds editing, replacement, download, and deletion. **Room info** opens the measured room plan with its dimensions and area.

For Electron:

```sh
npm start
```

For Electron with live development updates (stop the web development server first, since both use port 5173):

```sh
npm run dev:desktop
```

## Restyle a design (local browser and Electron)

Restyle is part of this app. Run `npm run dev` for a local browser, `npm run dev:desktop` for desktop development, or `npm start` for the desktop app. Restart an already-running development server after installing this update so it loads the new backend routes. The published static website does not include the Restyle backend.

The Restyle wizard has a **Mock / Real AI** toggle. **Mock** is the default; your choice is remembered on this device. Mock mode needs the local backend but no API key, and never calls OpenAI or spends tokens. It simulates extraction (1.8 seconds), rendering (6 seconds), and checking (1.8 seconds), followed by a visible local save. The result is a color-adjusted copy of your source with an example style, saved as a **Mock preview** with separate mock provenance and a `mock-restyle-` download filename. No AI geometry check is performed. You can cancel during the simulation and test comparison, version navigation, downloading, and saving normally.

Choose **Real AI** to use OpenAI. Copy `.env.example` to `.env.local` in this project and set `OPENAI_API_KEY` there. An existing environment variable takes precedence. The key is read only by the local server or Electron main process; it is never included in the web build or saved in browser storage. `.env.local` is ignored by Git. Use **Check again** in the wizard after configuring the key. Real AI uses your API credits. Switching modes keeps the selected images; the toggle is locked during a request and while viewing its result. Start another version to change modes after completion. Mock failures never fall back to Real AI.

1. Open a room, add one or more source images, and click the source you want to explore. Its page shows the original and all its saved versions, including versions derived from another version.
2. Click the **plus / sparkle** button in the toolbar. The original is already selected; choose, drop, or paste exactly one inspiration image with **⌘V / Ctrl+V**, then press **Restyle**. Pasting another image replaces the inspiration preview. Supported formats are JPG, PNG, WebP, GIF, and AVIF, up to 25 MB and 40 megapixels per image. Animated images use their first frame.
3. In Real AI mode, the backend uses `gpt-6-astra` to extract a structured style spec, `gpt-image-2` to edit the selected design using that spec, and Astra again to check geometry. Only the style extractor sees the inspiration; the image renderer receives the source design and the spec. Selected images are sent to OpenAI when generation starts. Your API project needs access and available billing for these models.
4. The result saves automatically beneath its source. **Back to versions** returns to the source page, where the new version is appended to the gallery. **Create another version** keeps the same source selected. Colors, finishes, textures, materials, and lighting mood may change; all shapes, object positions, architecture, and camera framing are instructed to remain fixed.

During generation, the source and inspiration stay visible, with **Extracting style → Rendering → Checking geometry → Saving** listed underneath. The current step follows actual progress and completed steps show checkmarks. Refinement uses the selected version and your written instruction, then follows rendering, checking, and saving.

The geometry check reports **No changes detected**, **Changes detected**, **Uncertain**, or **Unchecked**. It is an automated visual assessment and can miss changes. Review flagged results before relying on them. A failed check still saves the completed render as unchecked. Inputs are oriented and scaled to a 1536-pixel long edge; padding required by the image API is removed from the result without stretching the design.

Cancellation stops the active local request. Provider usage may already have been incurred. Active requests do not resume after closing the backend. If saving fails, keep the app open and use **Retry save** or **Download**; neither generates another image. A failed-save result remains available when you reopen the wizard in the same session. Generated image bytes cannot be replaced in place; you can rename, delete, or restyle that version.

### Local storage

Original image files and their metadata are saved in IndexedDB on this device. New uploads also save a small thumbnail for faster grids; originals remain unchanged. Existing photos are preserved during automatic database upgrades. Each browser profile and the Electron app have separate collections; there is no server or account synchronization. Clearing browser/site/app data deletes that collection. Use **Download photo** in the viewer’s **…** menu to keep original copies. Notes saved by the earlier interface remain in the database.

Restyled versions also retain their inspiration image, an immutable source snapshot, parent/root links, style spec, model names, render prompt, and geometry findings. Source snapshots remain with descendants after the source is edited or deleted, so comparisons stay accurate. Deleting a restyled image also deletes its own provenance; other versions keep their own snapshots. Database upgrades preserve existing images and notes.

Use **Delete source** on a room's source card or beneath the source image on its page to remove an uploaded source. Confirm with **Delete source**, or choose **Keep source** to cancel. Restyled versions and their saved source snapshots stay available; the gallery marks their original source as deleted. A source without versions disappears from the gallery.

Routes use URL hashes (`#/room/kuche`), so browser refresh, back navigation, and Electron's local file loading all work without a routing server.

Source pages use `#/room/kuche/design/<source-id>`. Existing uploads become source cards and existing restyles are grouped using their saved root links; this redesign does not rewrite the database. If an original was deleted, its saved snapshot is shown when available. Surviving versions remain accessible even when no source snapshot remains.

The apartment overview is traced from the first supplied plan. Geometry lives in `src/rooms.js`; that reference is `public/original-floorplan.jpeg`. The second drawing, `public/measured-floorplan.jpeg`, supplies the dimensions and printed areas for the room sidebar (`src/room-plan.js`). Each sidebar diagram uses a uniform scale for its labelled width/depth. Doors, windows, fittings, and entrance recesses are schematic because their individual dimensions are not supplied.

The second drawing numbers rooms differently. IDs and gallery assignments are preserved by location: `raum3` on the left is Zimmer 1 in that drawing; `raum1` on the right is Zimmer 2; `raum2` in the middle is Zimmer 3. Area values are transcribed from the drawing instead of multiplying bounding dimensions for rooms with recesses. The left room is labelled 4.52 m above and 4.40 m below; the sidebar explains this difference.

## Validation

```sh
npm test
npm run build
npm run test:desktop
```

Tests cover room picking and image storage, isolation, updates, replacement, deletion, and input validation. The production web build is in `dist/`. Optional WebMCP room-list/navigation tools register only when a supported context exists; they have not been verified in a supported WebMCP host.

Restyle tests cover model sequencing, structured output validation, geometry findings, cancellation, HTTP/IPC parity, database migration, atomic/idempotent version saves, and wizard interactions. The desktop smoke test runs the actual built UI and sandboxed preload with an isolated temporary profile and mocked model responses. Tests never call OpenAI or read a real API key. A live generation requires configuring your own key.
