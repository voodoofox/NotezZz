# NotezZz brand

The mark is **Overlap**: two notes crossing, the shared part a third colour.
The name is set in the app's own font, Sofia Sans Condensed at weight 700
(as in the app header), outlined so it needs no font to display.

| File | Use |
|---|---|
| `icon.svg`, `icon-1024.png` | App icon (Windows, web, site). `npx tauri icon brand/icon-1024.png` regenerates the Tauri set. |
| `maskable.svg` | Full-bleed version for launchers that apply their own shape (web manifest, Android adaptive). |
| `icon-mono-dark.svg`, `icon-mono-light.svg`, `mark-mono.svg` | One colour: tray, print, stamps. The overlap is cut out. |
| `mark.svg` | The mark alone, no tile. |
| `lockup*.svg` | Icon + name. `-accent` colours the zZz in the icon's pink. |
| `wordmark*.svg` | The name alone. |

Colours: indigo `#2B1B4D` (ground), cyan `#9BEBFF`, pink `#FF6AD5`
(`#E0439A` on white), lemon `#FFF6A8` (the overlap).

Android launcher icons live in `src-tauri/gen/android/app/src/main/res/mipmap-*`
(adaptive: indigo background, the mark as foreground, a one-colour layer for
themed icons). Sources and the scripts that drew them are in `logo-concepts/final`
next to the repo.
