# Cicerostraße

<!-- impeccable:product-schema 1 -->

## Platform

Web interface, also shipped in an Electron desktop shell on macOS.

## Purpose and workflows

Repository evidence: a private apartment image journal organized by room. Users navigate a floor plan or rooms, upload source images, explore saved versions, and create restyles from inspiration or refine an existing version with an instruction. When configured, metadata and image files persist in Supabase behind per-user Row Level Security; IndexedDB remains the one-time migration source and offline fallback.

Each room also has a separate Design inspiration collection beside Sources. Users save an image by upload, clipboard paste, or a direct image URL, with an optional title (160 characters), source link, and room note (500 characters). Saved image bytes and thumbnails persist locally per room in the separate `inspirations` store introduced in IndexedDB version 3. Entries appear newest first; users can view the full image, open its source, edit its text/link, or delete it with confirmation. URL loading downloads image bytes; page links can be retained alongside an uploaded or pasted image. Existing source/version records and generation workflows remain separate.

Room names are editable from the pencil beside the room heading. A compact inline form saves a single-line name of 1–60 characters after trimming, supports Save/Enter and Cancel/Escape, and can reset to the original name. Overrides use the active Supabase store or the local `roomNames` fallback. Saving disables the form and announces progress; validation and storage failures remain inline for correction or retry. Display names propagate to room navigation, the mobile selector, headings and document title, floor-plan labels, room diagrams, inspiration context and photo-viewer room choices. Stable room IDs, routes, measurements and source/version/inspiration assignments remain unchanged.

## Constraints

The user requires preservation of all existing functionality: room assignments and measurements, uploads and progress, source deletion with retained versions, image viewing and keyboard navigation, editing, replacement, download, comparison, mock/real generation, cancellation, saving and error recovery. Existing backend contracts and storage must remain compatible. The hosted static copy cannot run the local generation backend.

Supabase browser access uses only the publishable key. Private records and Storage objects must remain scoped to the authenticated user; service-role and secret keys never enter the client bundle. Existing IndexedDB content is not deleted after migration.

## Brand commitments

User-confirmed: restrained modern desktop application; native macOS familiarity and Linear / Raycast refinement; minimal neutral surfaces, compact controls, precise alignment and subtle hierarchy. Avoid dashboard decoration, gradients, nested cards, large rounded containers, oversized headings, excessive text and pills.

## Open decisions

Audience beyond the existing apartment journal owner is unspecified. No new product capabilities are assumed.
