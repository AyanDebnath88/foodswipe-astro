# Food Swipe v2 — design language overhaul

Files
- Food Swipe Mobile v2.dc.html — 8 screens at 390x844 + spec/motion panels
- Food Swipe Desktop v2.dc.html — marketing home, swipe app, reveal, results at 1320 + deltas
- tokens-v2.css — the whole system
- v1 boards are kept alongside for comparison

## What the reference set actually does (and what I took)

Chipotle, Kitchen Stories, Subway and Honest Greens share five moves. All five are now the system:

1. **Photography is the surface, not content.** Images run full-bleed to the device edge; type sits
   on the image behind a CSS scrim. v1's "photo inside a rounded card on a parchment page" is gone.
2. **Display type does the shouting.** Archivo 800 uppercase at -.025 to -.04em, 46-82px. Fraunces
   is demoted to one job: the dish name and editorial section titles — the warm, human word.
3. **Floating nav pill.** An ink pill inset 20px, 26px above the home indicator, hovering over
   content. Active item is a terracotta pill, not an underline. On desktop it flattens into a
   68px ink app bar; below 1024px the pill returns.
4. **One CTA shape: ink pill + terracotta circular arrow.** Reads as forward motion instantly, and
   gives a 46px target inside a 58px row. One per screen, always floating.
5. **Data is chips, not prose.** 9.5px Archivo caps: forest for mode (PICKUP), gold for distance
   (0.6 MI), neutral cream for SPONSORED, forest tint for DONE. Two chip registers — solid on
   light, glass (18% white + blur) on photography — never mixed.

## Palette

Warmer and deeper than v1: cream #F7F1E8, ink #171310, terracotta #C4562F (was #D97757 — the old
tint couldn't carry white type), forest #2F6B42, gold #E9C23F. The celebration is now ink rather
than a separate wine/void colour, so there is no second brand hiding in the app.

## Contrast, computed

All figures are WCAG relative-luminance calculations, not estimates.

On cream #F7F1E8: ink #171310 16.5:1 - #3D362E 11.6:1 - #574E43 7.3:1 - #6B6155 5.4:1 -
#7A6E5E 4.6:1 (the smallest AA-passing muted value, usable at any size) - #8A7B67 3.6:1
(large text only). Over-scrim, measured at the lightest gradient stop: #FFF8F2 17.6:1 -
#EBDFD2 14.1:1 - #E4D8CB 12.5:1 - #C6B8AB 9.5:1. Ink on gold 10.8:1.

Two corrections from the first pass, both in the failing direction:
- #8C7F6E was published as 4.6:1; it is actually 3.48:1 on cream and was carrying 11-12.5px meta
  text ("3 of 5 voted", "6 places - open now"). Replaced everywhere with #7A6E5E (4.6:1).
- #FFF8F2 on terracotta #C4562F is 4.23:1, not 5.4:1. Terracotta is now split: #C4562F is
  icon-only (arrow circle, heart, dots) and #B14A26 (4.9:1) is used wherever a text label sits on
  the fill. Placeholder #A79781 (2.53:1) was replaced with #7A6E5E.

Gold never carries white; chips never carry information that isn't also in the row's text line.

## Non-negotiables for build

- >=300px of usable scrim area at the bottom of every full-bleed image; brief photographers for
  negative space there. Never scrim more than 60% of image height. Scrims are CSS, never baked in.
- One arrow-pill CTA per screen. If a screen appears to need two, the second is an outline button.
- Swipe card capped at 480px on desktop — drag ergonomics do not scale with a monitor. Width buys
  context (room roster, rounds, activity), not size.
- Four breakpoints: 375 / 768 / 1120 / 1440. Below 1120 the rails drop to the mobile stack.
- Motion: 120/150/220/300/420/520ms, ease-out cubic-bezier(.22,1,.36,1) by default. Overshoot is
  allowed on exactly two elements (match heart, save heart). Glow pulses 3x then holds — nothing
  loops. Reduced motion collapses everything to a 150ms fade; drag stays 1:1.
- Animate transform and opacity only.
