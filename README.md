# Wallpaper Changer

A browser app that shows the pictures in the `img/` folder full screen, like a
desktop wallpaper, and switches between them with a randomly chosen animation
each time.

## Use it

1. Put your pictures (jpg, png, webp, gif, avif, bmp, svg) in the `img` folder.
2. Double-click `update-images.bat` (Windows) or run `./update-images.sh`
   (macOS / Linux). This writes `img/images.js`, the list of pictures the page
   reads. Run it again whenever you add or remove pictures.
3. Open `index.html` in your browser. No server or install needed.

You can also click the folder button (or drag pictures or a folder onto the
window) to use any folder right away without running the script.

If you serve the folder with a web server that lists directories (for example
`python -m http.server`), the app reads `img/` directly and the script is not
needed.

## Controls

| Action | Mouse / touch | Key |
| --- | --- | --- |
| Next / previous | click the picture, swipe, or the arrow buttons | → / ← |
| Pause / play | play button | Space |
| Full screen | full screen button | F |
| Shuffle order | shuffle button | S |
| Fill screen / show whole picture | frame button | Z |
| Hide the controls | | H |

The bar at the bottom also sets how long each wallpaper stays up and lets you
pin one effect instead of random. Settings are remembered in the browser. The
controls and cursor hide after a few seconds without mouse movement.

## Effects

Crossfade, Slide, Parallax push, Zoom through, Blur dissolve, Spin, 3D flip,
Cube, Circle reveal, Diamond, Wipe, Barn doors, Blinds, Rain, Tiles, Shatter,
Curtain and Glitch. Many of them also pick a random direction, origin or
pattern, so the same effect rarely looks the same twice.

To add one, add a function to the `effects` object in `app.js`. It gets the old
and new layers and returns a promise that resolves when the animation ends.
