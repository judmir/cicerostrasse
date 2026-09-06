# Cicerostraße

A minimal JavaScript app: an overhead Three.js floor plan and a separate image gallery for each room. It runs in a browser or Electron.

Public app: [Cicerostraße room journal](https://cicerostrasse.sharp-amber-1311.chatgpt.site). Each visitor has a separate collection stored on their device; photos are not shared between visitors.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Open a room, then select or drop multiple photos to upload them together. The progress bar tracks large batches. Click a photo to open the full-screen album: use arrow buttons, left/right keyboard arrows, horizontal swipes, or the thumbnail strip. Home/End jump to the first/last photo; Escape closes the viewer. The **…** menu holds editing, replacement, download, and deletion. The carousel follows the room gallery order. The collapsible room plan retains its dimensions and area.

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

Copy `.env.example` to `.env.local` in this project and set `OPENAI_API_KEY` there. An existing environment variable takes precedence. The key is read only by the local server or Electron main process; it is never included in the web build or saved in browser storage. `.env.local` is ignored by Git. Use **Check again** in the wizard after configuring the key.

1. Open a room and choose **Restyle**, then select a saved design. You can also choose **Restyle** from a photo’s **…** menu to preselect it.
2. Upload exactly one inspiration image and press **Restyle**. Supported formats are JPG, PNG, WebP, GIF, and AVIF, up to 25 MB and 40 megapixels per image. Animated images use their first frame.
3. The backend uses `gpt-6-astra` to extract a structured style spec, `gpt-image-2` to edit the selected design using that spec, and Astra again to check geometry. Only the style extractor sees the inspiration; the image renderer receives the source design and the spec. Selected images are sent to OpenAI when generation starts. Your API project needs access and available billing for these models.
4. The result saves automatically as a new image in the same room. Open **Versions** in the photo viewer to compare it with its source and navigate related versions. Colors, finishes, textures, materials, and lighting mood may change; all shapes, object positions, architecture, and camera framing are instructed to remain fixed.

The geometry check reports **No changes detected**, **Changes detected**, **Uncertain**, or **Unchecked**. It is an automated visual assessment and can miss changes. Review flagged results before relying on them. A failed check still saves the completed render as unchecked. Inputs are oriented and scaled to a 1536-pixel long edge; padding required by the image API is removed from the result without stretching the design.

Cancellation stops the active local request. Provider usage may already have been incurred. Active requests do not resume after closing the backend. If saving fails, keep the app open and use **Retry save** or **Download**; neither generates another image. A failed-save result remains available when you reopen the wizard in the same session. Generated image bytes cannot be replaced in place; you can rename, delete, or restyle that version.

### Local storage

Original image files and their metadata are saved in IndexedDB on this device. New uploads also save a small thumbnail for faster grids; originals remain unchanged. Existing photos are preserved during automatic database upgrades. Each browser profile and the Electron app have separate collections; there is no server or account synchronization. Clearing browser/site/app data deletes that collection. Use **Download photo** in the viewer’s **…** menu to keep original copies. Notes saved by the earlier interface remain in the database.

Restyled versions also retain their inspiration image, an immutable source snapshot, parent/root links, style spec, model names, render prompt, and geometry findings. Source snapshots remain with descendants after the source is edited or deleted, so comparisons stay accurate. Deleting a restyled image also deletes its own provenance; other versions keep their own snapshots. Database upgrades preserve existing images and notes.

Routes use URL hashes (`#/room/kuche`), so browser refresh, back navigation, and Electron's local file loading all work without a routing server.

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
