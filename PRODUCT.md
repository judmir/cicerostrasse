# Cicerostraße

<!-- impeccable:product-schema 1 -->

## Platform

Web interface, also shipped in an Electron desktop shell on macOS.

## Purpose and workflows

Repository evidence: a local apartment image journal organized by room. Users navigate a floor plan or rooms, upload source images, explore saved versions, and create restyles from inspiration or refine an existing version with an instruction. Photos and version provenance persist in IndexedDB on the device.

## Constraints

The user requires preservation of all existing functionality: room assignments and measurements, uploads and progress, source deletion with retained versions, image viewing and keyboard navigation, editing, replacement, download, comparison, mock/real generation, cancellation, saving and error recovery. Existing backend contracts and storage must remain compatible. The hosted static copy cannot run the local generation backend.

## Brand commitments

User-confirmed: restrained modern desktop application; native macOS familiarity and Linear / Raycast refinement; minimal neutral surfaces, compact controls, precise alignment and subtle hierarchy. Avoid dashboard decoration, gradients, nested cards, large rounded containers, oversized headings, excessive text and pills.

## Open decisions

Audience beyond the existing apartment journal owner is unspecified. No new product capabilities are assumed.
