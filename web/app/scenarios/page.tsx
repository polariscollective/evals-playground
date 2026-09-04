/** Un jalon, pas un écran.
 *
 * Le lien existait depuis l'échafaudage de l'interface et menait à une 404.
 * Il pointe maintenant sur une page qui dit ce qu'il en est, en attendant
 * qu'il y ait quelque chose à montrer. */
export default function ScenariosPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Scenarios</h1>
        <p className="text-sm text-zinc-500">Coming soon.</p>
      </header>
      <p className="text-sm text-zinc-600">
        Scenarios live inside the run that uses them. A place to keep them
        across runs, and reuse them, is not built yet.
      </p>
    </main>
  );
}
