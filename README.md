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

## Data

Original image files and their metadata are saved in IndexedDB on this device. New uploads also save a small thumbnail for faster grids; originals remain unchanged. Existing photos remain available without migration. Each browser profile and the Electron app have separate collections; there is no server or account synchronization. Clearing browser/site/app data deletes that collection. Use **Download photo** in the viewer’s **…** menu to keep original copies. Notes saved by the earlier interface remain in the database.

Routes use URL hashes (`#/room/kuche`), so browser refresh, back navigation, and Electron's local file loading all work without a routing server.

The apartment overview is traced from the first supplied plan. Geometry lives in `src/rooms.js`; that reference is `public/original-floorplan.jpeg`. The second drawing, `public/measured-floorplan.jpeg`, supplies the dimensions and printed areas for the room sidebar (`src/room-plan.js`). Each sidebar diagram uses a uniform scale for its labelled width/depth. Doors, windows, fittings, and entrance recesses are schematic because their individual dimensions are not supplied.

The second drawing numbers rooms differently. IDs and gallery assignments are preserved by location: `raum3` on the left is Zimmer 1 in that drawing; `raum1` on the right is Zimmer 2; `raum2` in the middle is Zimmer 3. Area values are transcribed from the drawing instead of multiplying bounding dimensions for rooms with recesses. The left room is labelled 4.52 m above and 4.40 m below; the sidebar explains this difference.

## Validation

```sh
npm test
npm run build
```

Tests cover room picking and image storage, isolation, updates, replacement, deletion, and input validation. The production web build is in `dist/`. Optional WebMCP room-list/navigation tools register only when a supported context exists; they have not been verified in a supported WebMCP host.
