<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- The whole app lives in src/notes (ported from the notes-v3 GitHub branch) and is mounted client-only from src/routes/index.tsx; keep it framework-agnostic plain React + zustand so it stays in sync with that source.
- Notes styling is plain CSS in src/notes/styles, not Tailwind. The app has two looks, Paper and Glass (default), chosen in Réglages → Style and set as <html data-look> before the first paint (src/routes/__root.tsx); it no longer matches notes-v3 pixel for pixel, only its logic stays in sync.
- tokens.css is the shared foundation (type 12/14/16/19/23/33, weights 500/600/700, spacing 4/8/12/20/32/48, radius xs/sm/md/lg, shadow-1/2/3, named z-layers, alpha steps, motion); looks.css only re-points tokens per look and accent; app.css reads tokens only — no hex, px radius, z-index number, raw shadow, px font size or numeric weight in components. See docs/design-teardown.md.
- Keep in both looks: amber = create/pinned, blue = selection, red = delete/recording, green = done; 44px targets, 48px dock buttons, 58px +, 16px inputs; muted text ≥7:1; glass only on floating layers, never on glass. Re-check with docs/shots/verify.mjs.
- Heavy on-device helpers (PDF, OCR, slides, speech) are static files under public/vendor; the speech engine's 11 MB wasm loads from jsDelivr because project files are capped at 10 MB.
