---
name: Tayyar
description: The interface of a live Certificate Transparency stream and its look-alike alerts, Arabic first with a complete English twin.
colors:
  ground: "#0f1822"
  surface: "#16222e"
  raise: "#1c2a38"
  rule: "#25374a"
  line: "#34495e"
  ink: "#e3eaf0"
  muted-ink: "#8a9cac"
  knob: "#f4f7f9"
  issued-sea-green: "#56c8b8"
  precert-amber: "#e6b04c"
  match-coral: "#ff7c6a"
  on-accent: "#0f1822"
  scrim: "rgb(5 9 14 / 0.62)"
  float-shadow: "rgb(0 0 0 / 0.36)"
  light-ground: "#f4f6f8"
  light-surface: "#ffffff"
  light-raise: "#eef2f5"
  light-rule: "#d7dfe6"
  light-line: "#b9c5d0"
  light-ink: "#13212e"
  light-muted-ink: "#56687a"
  light-issued-sea-green: "#087266"
  light-precert-amber: "#8f5c00"
  light-match-coral: "#c42d3f"
  light-on-accent: "#ffffff"
  light-scrim: "rgb(19 33 46 / 0.32)"
  light-float-shadow: "rgb(19 33 46 / 0.18)"
typography:
  figure:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
  section:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  ui:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.45
  identifier:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Menlo, Consolas, Readex Pro Arabic, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
rounded:
  mark: "2px"
  tag: "4px"
  control: "6px"
  panel: "8px"
  pill: "999px"
spacing:
  sp-0: "2px"
  sp-1: "4px"
  sp-2: "8px"
  sp-3: "12px"
  sp-4: "16px"
  sp-5: "20px"
  sp-6: "24px"
  sp-8: "32px"
  sp-10: "40px"
  sp-12: "48px"
components:
  button:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-primary:
    backgroundColor: "{colors.issued-sea-green}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-quiet:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
  button-ghost:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  segment-selected:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  tag:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.tag}"
    padding: "0 8px"
  badge:
    backgroundColor: "{colors.match-coral}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    height: "20px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "20px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.panel}"
    padding: "8px 16px"
---

# Design System: Tayyar

## Overview

**Creative North Star: "The Current Meter"**

Tayyar (تيّار) means a current, and the interface is the instrument that reads it: a quiet, dark dial face where every figure is exact, every mark means one thing, and nothing moves unless the data or the person moved it. It is an Operate surface for security teams who triage names that imitate their brands, so precision and restraint carry the brand: the wave mark, three colours that each mean one thing, one typeface for both languages, and figures that hold still while they count.

Arabic comes first and reads right to left; English is a complete twin, never a translation layer. Both share Readex Pro, so the two languages speak in one voice, and both carry the same density. The default is dark, for long sessions in a monitoring room; the light theme is complete and follows the system setting. Density is medium to dense: 14px rows on a 4px spacing step, with generous gutters around the bands so the screen stays calm while hundreds of certificates a second pass through it.

The one element only Tayyar has is the evidence ribbon: the name drawn with the brand letters underlined, the look-alike characters tinted and the lure words dotted, so every alert shows why on the name itself.

**Key Characteristics:**
- Colour goes on data and meaning, not on chrome: sea green for an issued certificate, amber for a precertificate, coral for a match or a high severity alert.
- Severity is always carried by a word and a position as well as a colour.
- One typeface for both languages, with digits on one width so live numbers never jump.
- Flat surfaces separated by 1px rules and one tone step; only things that float carry a shadow.
- Every value comes from a token; a test fails the build when a size, space, radius, colour or timing is picked by eye.
- Motion is feedback and continuity only: short, ease-out, interruptible, transform and opacity, and none on keyboard triage.

## Colors

A deep blue-black ground with three meaning colours, each kept to its meaning; everything else is ink, grey and hairlines.

### Primary
- **Issued Sea Green** (#56c8b8 dark, #087266 light): an issued certificate (the filled dot, the issued share of the split bar), the brand's wave, the one filled primary button per form, the current tab and the selected segment's line, focus rings, links and the brand part of the evidence ribbon.

### Secondary
- **Precertificate Amber** (#e6b04c dark, #8f5c00 light): a precertificate (the ring mark, the amber share of the split bar), medium severity, the lure words in the ribbon, the Unicode form of an international name, and notes that warn (the regex fallback, a server without a data folder, a lost stream).

### Tertiary
- **Match Coral** (#ff7c6a dark, #c42d3f light): a name that matches the filter, a high severity score, the new-alerts badge, the look-alike characters in the ribbon, a lost connection's dot and every error line.

### Neutral
- **Ground** (#0f1822 dark, #f4f6f8 light): the page, the top bar, the bottom bar and the drawer.
- **Surface** (#16222e dark, #ffffff light): panels, inputs, hovered rows, the selected alert row.
- **Raise** (#1c2a38 dark, #eef2f5 light): the selected segment, evidence values, loading bars.
- **Rule** (#25374a dark, #d7dfe6 light): every hairline between rows, bands and panels.
- **Line** (#34495e dark, #b9c5d0 light): control borders, one step stronger than a rule so a control reads as one.
- **Ink** (#e3eaf0 dark, #13212e light) and **Muted Ink** (#8a9cac dark, #56687a light): the two text tiers, both at 4.5:1 or more on every surface they sit on.
- **Knob** (#f4f7f9 dark, #ffffff light): the switch knob, light in both themes.

Tints are mixed from the meaning colours, never picked: a matched stream row carries coral at 6%, look-alike characters coral at 22%, legend swatches coral at 45%, and text selection sea green at 45%.

### Named Rules
**The Three Meanings Rule.** Sea green, amber and coral each mean what the list above says, in both themes and both languages; a new use must already be that meaning.

**The Never Colour Alone Rule.** A colour is always paired with a shape or a word: the ring and the dot for the certificate types, the severity word under every score, the state word beside every log's dot, an underline on the name of every matched row, with a hidden "matches your filter" for screen readers.

## Typography

**Body Font:** Readex Pro (served from `web/fonts`, with system-ui as fallback)
**Figures:** Readex Pro's digits redrawn on one advance width (`readex-pro-figures.woff2`, the same glyphs centred)
**Identifier Font:** the platform monospace, with Readex Pro Arabic for Arabic letters inside it

**Character:** one open, even sans for every word in both scripts; the monospace has one job, identifiers (domain names, patterns, fingerprints, endpoints, keys), where telling rn from m and 1 from l is the work.

### Hierarchy
- **Figure** (600, 2rem, 1.2, tracking -0.01em; 1.5rem on phones): the meter's rate, seen and match counts.
- **Title** (600, 1.5rem, 1.2): one per view, a noun ("Alerts", "Watchlist", "How it works"); also the alert score.
- **Section** (600, 1rem, 1.2): panel titles, the drawer title, "Last hour", "Logs".
- **Stage figure** (600, 1.25rem, 1.2): the How it works counts and the evidence ribbon.
- **Body** (400, 1rem, 1.5 in English and 1.7 in Arabic): ledes under titles, at most 42rem wide.
- **UI** (400, 0.875rem, 1.5): rows, controls, table cells, field labels (500).
- **Meta** (400, 0.8125rem, 1.45): issuer, log, times, notes, hints, the footer.
- **Label** (500, 0.75rem, 1.45): column heads, drawer section heads, tags, keys, legends, the badge, phone tab labels. Nothing is smaller.

Seven sizes (12, 13, 14, 16, 20, 24, 32px) and four weights (400 body, 500 labels, 600 headings and figures, 700 for the wordmark only). Headings balance their lines; paragraphs avoid a lone last word.

### Named Rules
**The One Voice Rule.** Arabic and English are set in the same family at the same sizes; Arabic only gets more line height.

**The Steady Figures Rule.** Every digit comes from the figures face, so counters, clocks and table columns never shift as they update; `tabular-nums` is declared as well, for any fallback face.

## Layout

The shell is a top bar (56px) over a single centred canvas up to 80rem wide, with a gutter that grows from 16px to 32px with the window. Each view opens with its title and one grey sentence, then its controls, then its content; there is no hero and no greeting.

Space follows a 4px step (2, 4, 8, 12, 16, 20, 24, 32, 40, 48px): tight inside a group (4 to 8px), 12 to 16px between controls, 24px under a title, 32 to 40px between bands. Controls are 36px tall, 44px on touch screens; small row actions 28px, 40px on touch. Column widths are tokens too: the stream's time (4.75rem), issuer (13rem) and log (12rem) columns, the alert score (4.5rem), the insights rail (16rem), the form rail (24rem) and the drawer (32rem).

Two breakpoints, written as literals because media queries cannot read tokens:
- **Up to 64rem (tablet and phone):** the tabs move to a bar at the bottom; grids become one column; stream and search rows become two lines (name, then time, issuer and log); alert actions move under their content; How it works becomes a list; the logs table becomes two-line rows with each figure named.
- **Up to 40rem (phone):** the meter becomes two by two, the filter takes its own row, the stream shows its newest 40 rows, alert actions run across the full row, and the alert toolbar packs severity and export into one row. The phone is the first impression: the first stream row starts in the top 60% of the screen.

Sticky column heads stay under the top bar while long lists scroll. The page never scrolls sideways; a segmented control too wide for a phone scrolls inside itself.

## Elevation & Depth

The system is flat. Depth is a tone step (ground, surface, raise) and a 1px rule, never both a border and a shadow on one thing. Panels and the drawer have a border and no shadow; the drawer sits over the Scrim colour. Only the toast floats, with one soft shadow in the Float Shadow colour.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px` in Float Shadow): the toast only.

### Named Rules
**The Flat Instrument Rule.** Nothing at rest casts a shadow, nothing glows, nothing is blurred; a selected or current thing gets a 2px sea green line or a tone step.

## Shapes

Tight corners, chosen once: 2px for marks inside text (look-alike tints, legend swatches), 4px for tags, keys and code, 6px for controls and the evidence ribbon, 8px for panels and the toast, and full pills only for the badge, the switch and the dots. Lines are 1px rules; 2px strokes are kept for focus rings, selection lines, the ring of a precertificate and the evidence underlines. No coloured side stripes: a matched row is tinted and a high alert carries its colour on its score.

## Components

### Navigation
- **Top bar:** the wave mark and wordmark (20px, 700) at the start, the five tabs, then the connection status, the language switch and sign out at the end. Opaque ground, one rule underneath.
- **Tabs:** 14px, 500, muted with an 18px outline icon; the current tab is ink with a 2px sea green line on the bar's edge. The alerts tab carries a coral count badge.
- **Bottom bar (64rem and below):** the same five tabs as icon over 12px label, the current one marked by a 2px line on its top edge; safe areas respected.
- **Connection status:** a dot and a word; coral and ink when lost. On a phone the word is visually hidden while connecting and live, and a lost connection is said in full on a one line strip under the bar, which moves the page down by its height so it covers no heading.

### Buttons
- **Shape:** 6px corners, 36px tall (44px on touch), 14px 500 labels.
- **Default:** transparent with a Line border; hover fills Surface.
- **Primary:** Sea Green fill with on-accent text, 600; one per form ("Save", "Sign in", "Open the watchlist").
- **Quiet:** borderless ink text, for actions repeated on every row (triage, edit, delete).
- **Ghost:** borderless muted text, for the shell (language, sign out, cancel).
- **Pressed (aria-pressed):** Raise fill, as on Pause.
- **Press feedback:** scale to 0.97 in 120ms on press; disabled controls drop to 60% opacity and never scale.

### Inputs and Fields
- **Style:** Surface fill (Ground inside a panel), Line border, 6px corners, 36px tall; identifiers typed in monospace, placeholders in the sans.
- **Label:** above the field, 14px 500, 8px gap; hints in 13px Muted Ink; errors in coral 13px.
- **Focus:** a 2px Sea Green ring, 2px out, on every focusable thing.

### Switch, segments and tags
- **Switch:** a 32 by 18px pill with a light knob; on is Sea Green, or Coral for "Matches only"; the hit area is 16px larger than the pill.
- **Segmented control:** one Line-bordered group; the selected segment gets Raise, ink text and a 2px Sea Green line at its foot; counts sit inside in 12px.
- **Tags:** 4px corners, Rule border, 12px Muted Ink, never squeezed; the "New" status tag is Sea Green.

### Type marks (signature)
A 10px ring in Amber for a precertificate and a 10px dot in Sea Green for an issued certificate. The same mark appears in the stream, the meter's legend, the search filter and the drawer's type line.

### Meter
Four figures in one band divided by rules: the rate with a one-minute sparkline (a 1.5px Sea Green line on a hairline baseline, labelled "Last minute"), the count since the page opened, the split bar (8px pill, Amber and Sea Green) with its marked legend, and the match count, which turns Coral when it is above zero.

### Certificate rows
Time, type mark, name in monospace (the Unicode form follows in the sans, in Amber), issuer and log in Muted Ink, on a 1px rule. A matched row is tinted Coral at 6% with its name in Coral, and a match that has just arrived fades a second tint out over 1.2s; there is no other per-row motion in the stream.

### Alert rows and the score
A 24px score coloured by severity with its word under it (High, Medium, Low), the domain in 16px monospace, a meta line separated by middle dots, reason tags, and quiet triage actions in a trailing column (under the content from 64rem down). The keyboard cursor is a 2px focus outline on a Surface row. Resolved and false positive rows dim their score and text to 60%, never their actions.

### Evidence ribbon (signature)
The name in 20px monospace on a panel-coloured strip: brand letters underlined in Sea Green, look-alike characters tinted Coral, lure words dotted in Amber, always left to right as an address bar shows it. A legend lists only the marks used, and each reason follows with its explanation and the evidence line.

### How it works
Seven stages in one band divided by rules, each with a 20px figure, a label and one muted sentence; a small chevron on each divider points in the reading direction. From 64rem down it is a list with the figure in its own column.

### Drawer
Opens from the reading end at 32rem wide (full width on phones) over a scrim, with the domain as its title, a close button, and sections divided by rules: why it was flagged, triage, DNS, names, certificate and log entry.

### States
- **Loading:** where the first load takes a moment (Alerts, Logs), the final layout with flat Raise bars where values will be; no shimmer, no spinner, no layout shift when data lands. Watchlist and Search answer from memory and show their content or their sentence directly. A failed first load ends the loading state and shows the error line, never bars under it. A region with bars is marked busy and named Loading until its values come.
- **Empty:** one sentence in the kept frame, with the next action when there is one ("Open the watchlist").
- **Nothing matched:** the filter stays, the empty line says every certificate is still checked.
- **Error:** one line inside the failed view, a Coral dot, what happened and "Try again"; what was loaded stays on screen.
- **Connection lost:** the status turns Coral and ink, and the Live view says the stream stops until it is back.
- **Paused:** Pause shows pressed, and a note says certificates are counted but not listed.
- **Signed out:** the sign-in panel over the Ground, with its own language switch.

### Motion
- **Grammar:** one curve family and four durations: press 120ms, small state changes 160ms, entrances and exits 200ms, the drawer 280ms; ease-out (0.23, 1, 0.32, 1) for entering and leaving, the drawer curve (0.32, 0.72, 0, 1) for the drawer; exits are faster than entrances; transform and opacity only; transitions, not keyframes, for anything that can be triggered twice.
- **Drawer and scrim:** slide and fade in from the reading end when opened with a pointer; open and close at once when opened from the keyboard, where triage is repeated all day.
- **Toast:** rises 8px and fades in over 200ms, holds 3.2s, fades out in 160ms; a second message replaces the text without moving.
- **Arrivals:** a new alert row fades and settles 4px into place with a Coral tint that fades over 1.2s; a new match in the stream fades its tint the same way.
- **Counts:** the alerts badge gives one 200ms pop when its count grows; figures never animate.
- **Sign-in:** the overlay fades in over 200ms while its panel rises 8px over 280ms; an error line fades in over 160ms.
- **How it works:** the first time it is seen, its stages appear in reading order 40ms apart; refreshes never replay it.
- **Reduced motion:** nothing slides or scales; the drawer and toast fade, arrivals keep only their tint, and How it works appears at once.

## Do's and Don'ts

### Do:
- **Do** take every size, space, radius, colour, layer and timing from the tokens in `web/app.css`; the test in `test/i18n.test.js` fails on anything else.
- **Do** pair every meaning colour with a mark or a word, and keep a severity word beside every score.
- **Do** set domain names, patterns, fingerprints and endpoints in the monospace and everything else in Readex Pro.
- **Do** keep a domain left to right inside Arabic text, and keep its Unicode form in a span that takes the page's direction so the gap faces the ASCII form.
- **Do** give every new view its title and lede, its empty sentence and its error line before it ships, and loading bars when its first load takes a moment.
- **Do** check every change at 390px first, then 768px and 1280px, in both languages and both themes.

### Don't:
- **Don't** use a coloured side stripe, a gradient, a glow, a blur or an icon in a tinted square.
- **Don't** add a shadow to anything at rest, or a border and a shadow to the same thing.
- **Don't** use Sea Green, Amber or Coral for decoration or for a meaning outside their own.
- **Don't** animate figures, keyboard actions or the live stream's rows beyond the one tint on a new match.
- **Don't** set text under 12px, or a figure above 32px.
- **Don't** show a real brand or a real third-party domain on an alert, watchlist or example screen; use example.com, example.net, names ending in .test, or مثال.
