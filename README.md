# allanmontilla.dev

Personal site for Allan Montilla — dark cinematic Astro portfolio with a video-ready Panama Canal hero.

Stack: **Astro** + TypeScript + Tailwind CSS. Static output (`dist/`).

## Run locally

```bash
npm install
npm run dev
```

Open the local URL Astro prints (usually `http://localhost:4321`).

```bash
npm run build
npm run preview
```

`npm run build` writes a static site to `dist/`. Requires **Node.js >= 22.12** on your machine (not on the host).

## Hero video

Drop a Grok (or other) MP4 at `public/hero.mp4`. Until then the hero uses `/scene/hero-poster.jpg` as a full-bleed poster. The `<video>` is muted, looping, and plays inline — missing media falls back to the poster without breaking the page.

## Deploy on BanaHosting (cPanel)

The live site is static files in `public_html`. Build on your laptop, then upload.

1. Merge or pull the latest `main`.
2. Use Node.js **>= 22.12** locally.
3. Install and build:

   ```bash
   npm install
   npm run build
   ```

4. **Backup** the current contents of `public_html` first (download a zip or copy aside in File Manager / FTP).
5. Upload the **contents** of `dist/` into `public_html` — `index.html`, `_astro/`, favicons, etc. Do **not** upload a folder named `dist` itself; the files must sit at the root of `public_html`.
6. No Node, env vars, or reverse proxy on the server. The host only serves static files.

After upload, `https://allanmontilla.dev` should serve the new build.

## Contact

- Email: [allangmr10@gmail.com](mailto:allangmr10@gmail.com)
- LinkedIn: [allan-montilla](https://www.linkedin.com/in/allan-montilla-00a756b3)
- GitHub: [allangmr](https://github.com/allangmr)
