# allanmontilla.dev

Personal site for Allan Montilla — a one-page Astro site for US/EU recruiters.

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

`npm run build` writes a static site to `dist/`.

## Deploy on Vercel

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com), **Add New Project** and import the repo.
3. Framework preset: **Astro** (or leave defaults). Build command `npm run build`, output `dist`.
4. Deploy. No env vars required.

## Point allanmontilla.dev

1. In the Vercel project: **Settings → Domains** → add `allanmontilla.dev` (and `www` if you want).
2. At your DNS provider, add the records Vercel shows (usually an `A` for the apex and/or a `CNAME` for `www`).
3. Wait for DNS/SSL to finish, then set the apex as primary if both are connected.

## Contact

- Email: [allangmr10@gmail.com](mailto:allangmr10@gmail.com)
- LinkedIn: [allan-montilla](https://www.linkedin.com/in/allan-montilla-00a756b3)
- GitHub: [allangmr](https://github.com/allangmr)
