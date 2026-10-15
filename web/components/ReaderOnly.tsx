// What a restricted reader sees anywhere in the application but a shared run.
//
// They may sign in, and read the restricted runs whose link they were sent;
// the rest (lists, launches, judges, settings) is for members. Nothing here
// names a run: by link only means nothing lists them, this page included.
import { logout } from "@/lib/auth-actions";

export function ReaderOnly({ email }: { email: string | null }) {
  return (
    <main className="mx-auto max-w-[66ch] space-y-4 p-8">
      <h1 className="font-display text-2xl font-semibold text-olive">
        This account opens shared runs only
      </h1>
      <p>
        {email ? (
          <>
            You are signed in as <span className="font-mono text-sm">{email}</span>.{" "}
          </>
        ) : null}
        This account can read the runs whose link it has been sent, and nothing
        else in the playground. Open one of those links to read it.
      </p>
      <p>
        For more access, ask{" "}
        <a href="mailto:sam@polariscollective.org" className="link-underline">
          sam@polariscollective.org
        </a>
        .
      </p>
      <form action={logout}>
        <button
          type="submit"
          className="rounded-full border border-olive px-4 py-1.5 text-sm hover:bg-chartreuse"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
