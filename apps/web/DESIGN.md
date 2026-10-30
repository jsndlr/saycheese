---
name: saycheese
description: A photo booth for smiles. Curtain red, flash-white paper, ink black, one lamp-yellow light.
colors:
  curtain: "oklch(0.46 0.185 26)"
  curtain-dark: "oklch(0.4 0.165 25)"
  primary: "oklch(0.52 0.205 27)"
  primary-text: "oklch(0.47 0.19 27)"
  lamp: "oklch(0.88 0.16 95)"
  ink: "oklch(0.17 0.02 22)"
  paper: "oklch(0.999 0.002 60)"
  background: "oklch(0.982 0.004 60)"
  foreground: "oklch(0.2 0.02 22)"
  muted: "oklch(0.958 0.007 55)"
  muted-foreground: "oklch(0.48 0.02 25)"
  border: "oklch(0.9 0.01 40)"
  destructive: "oklch(0.5 0.19 15)"
  success: "oklch(0.5 0.12 155)"
  background-dark: "oklch(0.155 0.012 22)"
  card-dark: "oklch(0.205 0.014 22)"
  primary-dark: "oklch(0.68 0.2 28)"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(3rem, 8.2vw, 6rem)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Bricolage Grotesque, Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Bricolage Grotesque, Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
rounded:
  frame: "3px"
  input: "12px"
  card: "24px"
  pill: "9999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "32px"
  xl: "80px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 20px"
  button-lamp:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "52px"
    padding: "0 32px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.input}"
    height: "48px"
    padding: "0 16px"
---

# Design System: saycheese

## Overview

**Creative North Star: "The Photo Booth"**

Everything is the booth and its strip. A deep red curtain frames the moment, an ink-black housing holds the slot and the one yellow lamp, and results come out as a flash-white paper strip with a soft lifted shadow. The landing is the curtain and the strip; the product screens keep the same parts and drop the drama: neutral paper surfaces, the ink slot as the one dark focal object, the lamp yellow as the single call to act.

It is playful in tone and modest in claim. The score is the hero, set large in the display face; chrome stays out of its way. Both themes ship: light is the lit booth after the flash, dark is the inside of the booth with the curtain drawn.

**Key Characteristics:**
- Committed colour: curtain red owns whole regions on the landing and auth screens, never an accent sprinkled over neutral.
- One object per screen: the strip on the landing, the ink slot on the app screen, the printed photo on the detail screen.
- Numerals are display type and tabular, so a changing score never shifts the layout.
- Motion is authored once per view: the strip prints, frames flash in order, the score lands.

## Colors

A saturated curtain red, a near-black ink, flash-white paper, and one lamp yellow. Neutrals are tinted toward the red (hue 20 to 60), never grey.

### Primary
- **Curtain Red** (`oklch(0.46 0.185 26)` curtain, `oklch(0.52 0.205 27)` primary): the landing and auth ground, primary buttons, focus ring, large score numerals (`primary-text`, `oklch(0.47 0.19 27)`, for text on paper).

### Secondary
- **Lamp Yellow** (`oklch(0.88 0.16 95)`): the booth's ready light and the single action on a red or ink ground ("Score my smile", "Choose a photo"). Also the active-status chip.

### Neutral
- **Ink** (`oklch(0.17 0.02 22)`): the slot housing, photo frames, text on lamp yellow.
- **Flash White Paper** (`oklch(0.999 0.002 60)`): the strip, photo prints, cards in light theme.
- **Page White** (`oklch(0.982 0.004 60)`): the light background; dark theme uses `oklch(0.155 0.012 22)`.
- **Muted Paper / Border** (`oklch(0.958 0.007 55)`, `oklch(0.9 0.01 40)`): quiet panels and hairlines.

### Named Rules
**The Lamp Rule.** Lamp yellow is the only action colour on red or ink grounds, and appears once per view as an action. It is also the ready light; nothing else is yellow.

**The Green Means Scored Rule.** Green appears only on a chip for a photo that received a score. No face, multiple faces and unavailable are neutral, failed is destructive, in progress is lamp.

## Typography

**Display Font:** Bricolage Grotesque (optical-size and width axes, self-hosted through next/font)
**Body Font:** Figtree (self-hosted through next/font)

**Character:** a chunky grotesk with a quirky edge for headings and every numeral, paired with a friendly humanist sans for reading text.

### Hierarchy
- **Display** (800, `clamp(3rem, 8.2vw, 6rem)`, 0.92): the landing headline; tracking -0.035em.
- **Score** (800, 6rem, 0.85): the result numeral on the detail and app panel.
- **Headline** (800, 2.25rem to 3rem, 1.02): section and page headings.
- **Title** (700, 1.25rem): step titles, panel headings.
- **Body** (400, 1rem, 1.6): copy, capped near 65ch.
- **Label** (600, 0.875rem): chips, buttons, form labels.

### Named Rules
**The Tabular Numerals Rule.** Scores, dates and sizes use tabular lining numerals (`.num`) so counting up never jitters.

## Layout

A centered 72rem container (`max-w-6xl`) with 1rem phone gutters and 1.5rem from 640px. The landing is full-bleed bands (curtain, paper, muted paper, curtain). The app screen is one workspace: a compact full-width ink slot for the upload introduction and action, then a full-width collection of printed photos at roughly 200–240px (two columns on phones, one at 320px, up to five on wide desktop). Vertical rhythm is generous between sections (5 to 7rem on the landing, 2.5rem on app screens) and tight inside groups (0.5 to 1rem).

## Elevation & Depth

Hybrid: tonal layering for surfaces, shadow only for objects that physically sit on top.

### Shadow Vocabulary
- **Strip** (`0 1px 0 oklch(0.2 0.05 25 / 8%), 0 22px 44px -14px oklch(0.2 0.08 25 / 38%)`): the photo strip, form card on the curtain, printed photos.
- **Lift** (`0 1px 0 oklch(0.2 0.05 25 / 6%), 0 10px 24px -10px oklch(0.2 0.08 25 / 28%)`): hovered buttons, thumbnails, menus, the score panel.

### Named Rules
**The One Elevation Rule.** An object has a border or a shadow, never both. Panels are the one exception: they carry the Lift shadow plus a hairline ring that reads as the print edge, not a border. Hard offset shadows are not used.

## Shapes

Two forms. Cut paper: frames, thumbnails and photo prints are near-square (3px) with a 10px white print border. Soft pills and slabs: buttons and chips are fully rounded, inputs are 16px (`rounded-xl`), panels and cards are 24px. The curtain is drawn as soft vertical folds of light (`.curtain`), never stripes.

## Components

### Buttons
- **Shape:** full pill, 44px tall by default, 52px for hero actions.
- **Primary:** curtain red with paper text; on red or ink grounds the lamp-yellow variant with ink text.
- **Hover / Focus / Press:** lifts 1px with the Lift shadow; focus is a 4px ring at 40% of the ring colour plus a 2px offset ring in the background colour; pressing scales to 0.97 (`.press`).
- **Outline / Ghost:** paper with an input-coloured border, or transparent with a muted hover.

### Chips
- **Style:** pill, 12px semibold text. Scored is green on a green tint, in progress is lamp yellow, no face and multiple faces are muted, failed is crimson on a crimson tint.

### Cards / Containers
- **Corner Style:** 24px.
- **Background:** card colour (paper in light, `oklch(0.205 0.014 22)` in dark); muted panels use `muted/60`.
- **Padding:** 1.25rem to 2.5rem.

### Inputs / Fields
- **Style:** 48px tall, 16px radius, card background, 1px input border.
- **Focus:** border shifts to the ring colour with a 4px soft ring. Errors reserve their line so the form never jumps.

### Navigation
- **Style:** a solid header with the wordmark and its lamp dot; the active page is an ink pill (paper text), inactive links are muted pills on hover. The theme toggle is an outline icon button.

### The Strip (signature)
A four-frame photo strip hanging from an ink slot with a glowing lamp. Frames are ink with a widening smile arc and a lamp-yellow example score; the footer reads "saycheese" and "Example scores". It prints top to bottom, frames flash in order, scores count up once.

### The Slot (signature)
The upload target is an ink panel with the lamp in the corner and a lamp-yellow "Choose a photo" pill. Dragging a file lights a lamp-yellow ring and nudges the panel up in scale.

## Do's and Don'ts

### Do:
- **Do** let the score be the biggest thing on any result screen.
- **Do** label demonstration data ("Example scores") wherever it could pass for real results.
- **Do** keep every state specific: say what happened and what to do next.
- **Do** respect reduced motion: show the final state with no animation.

### Don't:
- **Don't** use gradients on text, glass or blur as decoration, or icon tiles in a card grid.
- **Don't** put a coloured side border on cards or list items.
- **Don't** use yellow for anything except the lamp and the one action on a dark or red ground.
- **Don't** claim accuracy, user counts or testimonials: the score is a fun estimate of the smile, not a judgement of a person.
