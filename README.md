# MetaGallery

A standalone, **frontend-only**, **PWA-enabled** web app to edit metadata
(EXIF) of your **local** picture files. Nothing is uploaded — all reading
and writing happens in your browser.

## Features

- 📁 Open a whole folder (Chromium browsers via the File System Access API)
    or pick individual files (works in any browser).
- 🖼 Thumbnail gallery + sidebar file list with filter.
- ✏ Edit EXIF fields:
    - Title / Description, User comment
    - Artist / Author, Copyright, Software
    - Date taken (DateTimeOriginal)
    - Camera Make / Model
    - GPS Latitude / Longitude / Altitude (with one-click clear)
- 💾 **Save back to the original file** (Chromium) **or** ⬇ download an edited copy
    (any browser, including Firefox/Safari).
- 📲 Installable PWA — works offline once loaded.
- 🔒 100% client-side. No server, no tracking, no upload.

## Run it

It's pure static files. Any static server works. From this folder:

```powershell
# Python
python -m http.server 5173
# or Node
npx serve .
```

Then open <http://localhost:5173>.

### Dev with auto-reload + HTTPS (for testing PWA install on a phone)

The repo is set up for [`mkcert`](https://github.com/FiloSottile/mkcert)
so you get a real green-padlock cert for `localhost` and your LAN IP — required
for testing the PWA install prompt on Android Chrome.

One-time setup:

```powershell
winget install FiloSottile.mkcert
mkcert -install                                      # adds local CA to Windows trust store
mkdir .certs ; cd .certs
mkcert -cert-file dev.pem -key-file dev-key.pem `
       localhost 127.0.0.1 <YOUR-LAN-IP>             # e.g. 192.168.0.5
```

Then start the dev server:

```powershell
npx live-server --port=5173 --host=0.0.0.0 --no-browser `
                --https=./live-server-https.cjs
```

- Desktop: <https://localhost:5173>
- Phone (same Wi-Fi): `https://<YOUR-LAN-IP>:5173`

To make the phone trust the cert, copy `%LOCALAPPDATA%\mkcert\rootCA.pem`
to the phone and install it under **Settings → Security → Encryption & credentials
→ Install a certificate → CA certificate**. From then on every cert mkcert
issues on this PC will be trusted on that phone.

> ⚠ The File System Access API requires a **secure context**
> (`https://` or `http://localhost`).
>
> Saving back to the original file currently works in Chrome / Edge / Brave / Opera.
> In Firefox / Safari you'll get the **Download copy** flow automatically.

## One-time setup: vendor `piexifjs`

Download `piexif.js` (or the minified `piexif.min.js`) from
<https://github.com/hMatoba/piexifjs> and place it at:

```
vendor/piexif.min.js
```

(That file is loaded by `index.html`.)

## Optional: PNG icons for the install prompt

For the best PWA install prompt, add `icons/icon-192.png` and
`icons/icon-512.png`. The SVG icon already shipped works for the in-app UI.

## File structure

```
index.html
styles.css
app.js
sw.js
manifest.webmanifest
icons/icon.svg
vendor/piexif.min.js   (you provide)
```

## Notes & limitations

- EXIF read/write is supported for **JPEG** only (via `piexifjs`).
    PNG/WebP/AVIF are previewed but not yet editable.
- Editing strips the existing thumbnail-IFD only if you remove all metadata;
    otherwise the structure is preserved.
- The “Pick files” fallback cannot write back to the original location
    (browser security). Use **Download copy** in that case.
