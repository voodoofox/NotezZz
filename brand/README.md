# NotezZz brand

The mark is **Overlap**: two notes crossing, the shared part a third colour.
The name is "NoteZ": the app's own font (Sofia Sans Condensed, weight 700,
corners rounded), its Z drawn three times, blue in front with warm yellow and
magenta trailing right by half a stroke each (the icon's order, left to right).
Everything is outlined, so no font is needed to display it.

| File | Use |
|---|---|
| `icon.svg`, `icon-1024.png` | App icon (Windows, web, site). `npx tauri icon brand/icon-1024.png` regenerates the Tauri set. |
| `maskable.svg` | Full-bleed version for launchers that apply their own shape (web manifest, Android adaptive). |
| `icon-mono-dark.svg`, `icon-mono-light.svg`, `mark-mono.svg` | One colour: tray, print, stamps. The overlap is cut out. |
| `mark.svg`, `mark-dark.svg` | The logo alone, no tile, cropped to the notes (deeper colours for light grounds). |
| `lockup.svg`, `lockup-dark.svg` | Logo with the name beside it. |
| `lockup-stacked.svg`, `lockup-stacked-dark.svg` | Logo above the name. |
| `wordmark.svg`, `wordmark-dark.svg` | The name alone. |

Colours on dark: cyan `#9BEBFF`, pink `#FF6AD5`, lemon `#FFF6A8`, the Z's warm
yellow `#FFC53D`; ground indigo `#2B1B4D`. On white: cyan `#5FD0F2` / `#1FA3D6`,
pink `#FF5CC8` / `#E0439A`, yellow `#FFE15A` / `#E8A400` (mark / Z).

In the app the logo is `src/lib/components/Lockup.svelte` (themed by CSS); the
website inlines the same outline with classes `nz-*`.

Android launcher icons live in `src-tauri/gen/android/app/src/main/res/mipmap-*`
(adaptive: indigo background, the mark as foreground, a one-colour layer for
themed icons). Sources and the scripts that drew them are in `logo-concepts/final`
next to the repo.
