import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The Notes app reads the browser (storage, gestures, media) as soon as it loads, so it only runs on the device.
const NotesApp = lazy(() => import("@/notes/App").then((m) => ({ default: m.App })));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Notes" },
      { name: "description", content: "Vos notes, listes, photos et messages vocaux, à portée de pouce. Fonctionne hors ligne." },
      { property: "og:title", content: "Notes" },
      { property: "og:description", content: "Vos notes, listes, photos et messages vocaux, à portée de pouce. Fonctionne hors ligne." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly>
      <Suspense fallback={null}>
        <NotesApp />
      </Suspense>
    </ClientOnly>
  );
}
