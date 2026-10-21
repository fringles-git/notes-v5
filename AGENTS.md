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
- Notes styling is plain CSS in src/notes/styles (tokens.css + app.css), not Tailwind, so the look matches the original pixel for pixel.
- Heavy on-device helpers (PDF, OCR, slides, speech) are static files under public/vendor; the speech engine's 11 MB wasm loads from jsDelivr because project files are capped at 10 MB.
