---
name: Cicerostraße
description: Restrained desktop workspace for room images and versions.
colors:
  ink: "#e8e8ea"
  muted: "#a1a1a8"
  blue: "#ced1dc"
  background: "#1c1c1f"
  surface: "#242427"
  surface-hover: "#303034"
  input: "#1c1c1f"
  border: "#363639"
  sidebar: "#202023"
  selection: "#353539"
  subtle-border: "#2e2e32"
  primary: "#e3e3e8"
  primary-hover: "#f5f5f7"
  primary-text: "#252529"
  secondary: "#27272b"
  secondary-hover: "#333338"
  secondary-text: "#d0d0d6"
  secondary-border: "#424248"
  destructive: "#aa424c"
  focus-ring: "#8e9dcc"
  preview: "#151518"
  nav-hover: "#2a2a2e"
  nav-text: "#b8b8bf"
  nav-active-text: "#f1f1f3"
  review-bg: "#302b25ee"
  review-text: "#ead2aa"
  mock-bg: "#26262dee"
  mock-text: "#dfdfe6"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.2px"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  badge: "3px"
  thumbnail: "4px"
  control: "5px"
  transient: "6px"
  dialog: "8px"
spacing:
  control-gap: "6px"
  action-gap: "8px"
  field-inset: "10px"
  mobile-inset: "16px"
  compact-inset: "20px"
  dialog-inset: "22px"
  content-inset: "28px"
  lineage-connector: "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-text}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "5px 10px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-text}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "5px 10px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  input:
    backgroundColor: "{colors.input}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "{spacing.field-inset}"
  navigation-item:
    textColor: "{colors.nav-text}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  navigation-item-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.nav-active-text}"
  image-item:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  review-indicator:
    backgroundColor: "{colors.review-bg}"
    textColor: "{colors.review-text}"
    typography: "{typography.label}"
    rounded: "{rounded.thumbnail}"
    width: "28px"
    height: "28px"
---

# Design System: Cicerostraße

## Overview

**Creative North Star: "Restrained desktop workspace"**

A compact, neutral image workspace with native macOS familiarity and the restraint the user associates with Linear and Raycast. Images carry the visual interest; system type, fine separators and precise alignment make navigation and editing feel quiet and direct.

The implemented system uses graphite surfaces, pale primary actions and restrained status color. Keep controls compact and content flat. Dashboard decoration, gradients, nested cards, oversized headings or containers, and excessive pills are outside the confirmed direction.

**Key Characteristics:**

- Compact system typography and controls.
- Graphite surfaces separated by fine borders.
- Image-led content with small role indicators and on-demand metadata.

This is a scan of the implemented cascade: `src/theme.css` supplies root tokens; `src/main.js` loads `style.css`, `album.css`, `restyle.css`, `design-gallery.css`, then `desktop.css`. The final stylesheet defines the current desktop direction. Frontmatter keys matching root variables preserve their names; other keys name observed CSS literals, not new runtime variables. The scan did not resample browser computed styles.

## Colors

A graphite neutral palette with pale primary actions and limited functional status color.

### Primary

The pale **primary** surface marks actions such as Add images, Restyle and Save. **Blue** is the incumbent variable name for a muted lavender-gray used by selected utility states and progress; it is not a saturated brand accent.

### Neutral

**Background** is the work area, **sidebar** anchors navigation, and **surface** supports dialogs and editing panels. **Ink** is primary text; **muted** carries metadata. **Subtle-border** separates workspace regions; **border** defines fields and overlays. **Selection** identifies the active room. **Preview** supports source images.

Destructive actions use muted red. Review badges use subdued amber, and mock badges use graphite with pale text. These indicate state without becoming general accents.

**The Image First Rule.** Give images the visual weight; keep navigation, captions and status subordinate.

## Typography

Use the system sans stack in the frontmatter. There is no display type scale: route headings use **headline**, section and image titles use **title**, form content uses **body**, and counts, provenance and help use **label**. The working hierarchy spans (12–15px), with dialog headings at (16–17px). Restyle's desktop dialog title uses weight (550); ordinary section titles use (500).

Keep sentence case and tight hierarchy. Route titles have slightly tightened tracking; long image names truncate where the source already does. Counts and dimensions use tabular numerals. The root monospace variable has no observed component role and is not promoted into the hierarchy.

## Layout

The desktop shell has a fixed room sidebar (204px), with the main area offset by the same width. Route toolbars are at least (57px) high; the fullscreen viewer toolbar is (56px). Main gallery and source-detail content uses the content inset. Source contact sheets use a (4:3) preview with cover cropping; version previews use the same ratio with contain sizing.

Source grids auto-fill from (210px), increasing to (240px) at widths of at least (1500px). Version grids auto-fill from (180px). The optional room inspector is (240px) wide. Source detail anchors one larger original in a (240–340px) column, then a (64px) directional connector, then smaller generated images. Its vertical inset is (36px); horizontal inset remains (28px).

At (1100px) and below, the sidebar becomes (184px), the inspector (220px), and source detail uses a (280px) original with a (48px) connector. At (800px), the inspector moves above the gallery, source detail becomes a centered original above a vertical connector, both image grids use two columns, and content padding becomes (20px). At (620px), room navigation becomes a header select and the sidebar loses its fixed position. Mobile content has (16px) horizontal insets; restyle columns stack.

The restyle dialog is capped at (880px) with a (40px) viewport allowance; at (620px) the allowance becomes (20px). The viewer fills the viewport. Older supporting styles retain narrow-screen details at (650px), (600px) and (520px); use the actual cascade when extending these surfaces.

## Elevation & Depth

Depth comes primarily from different surface tones and thin borders. Image items have no outer card surface or shadow. Dialogs, the photo action menu, editor and toasts use restrained black shadows; the sidecar records their exact values. Modal backdrops darken without blur. Fullscreen image viewing uses a continuous dark canvas.

**The Flat at Rest Rule.** Keep workspace content flat; reserve shadows for overlays and transient feedback.

## Shapes

Use the documented small radius vocabulary: badges, thumbnails, controls, transient overlays and dialogs. Preview corners match controls. Content regions stay square and unboxed. Borders are generally (1px); focus is an outline rather than an added container.

## Components

**Buttons.** Primary actions use the pale filled variant; secondary actions have a fine border. Desktop buttons are at least (30px) high, with icons (14px) wide. Icon controls are (30px) square with (16px) icons. Mobile route and restyle actions grow to at least (34px); source-delete targets grow to (40px) wide and (44px) high. Disabled buttons use opacity (0.5). Destructive buttons use the recorded muted red.

**Inputs.** Editing fields use the input surface, a fine border, the control radius and (10px) padding. The refinement textarea instead uses (12px) padding, a minimum height of (146px), and line-height (1.55). Its focus treatment has a muted border shift and (2px) outline; general controls use the focus-ring color with a (3px) offset.

**Navigation.** Sidebar rows are at least (34px) high, with (15px) icons, muted labels, tabular counts and a tonal active background. Use `aria-current` for selection. Mobile navigation uses the native select. Mock/Real AI is a compact segmented choice with an explicit pressed state.

**Images and status.** Image items use numeric, icon-led footers. A photo icon identifies the uploaded original, sparkles identify AI results, and a flask identifies mock previews; these sit in (28px) squares with (4px) corners. Amber triangles identify review warnings. The original-to-results arrow carries the relationship without repeated text headings. Full names, generation provenance and parent relationships remain in hover titles and accessible names; the viewer retains detailed review information. The source gallery pairs its image index with a layers icon and version count. Creation, refinement and deletion use labeled icon controls. The viewer's filmstrip uses reduced opacity for unselected thumbnails and a white border for the current image.

**Feedback and motion.** Fine-pointer controls use a subtle (0.98) press scale with (140ms) easing; image items do not scale. Source previews brighten on hover over (160ms). Filmstrip state transitions take (150ms). Generation status alone uses repeating (2s) pulses. The reduced-motion rule disables animations and transitions.

## Do's and Don'ts

### Do:

- Do use the existing system font, restrained neutral palette and compact control geometry.
- Do retain visible keyboard focus, accessible icon labels and explicit selected states.
- Do use real source imagery and keep version provenance readable.
- Do use a consistent inline SVG icon vocabulary with a 1.6 stroke width.

### Don't:

- Don't add gradients, dashboard decoration or nested cards.
- Don't enlarge headings or wrap ordinary workspace content in large rounded containers.
- Don't turn ordinary metadata into pills or add decorative motion.
- Don't use the illustrative tonal ramps in the sidecar as new runtime colors.
