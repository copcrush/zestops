"use client";

import "./globals.css";

/** Last-resort error page if the root layout itself fails. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md rounded-brutal border-2 border-ink bg-white p-8 text-center shadow-brutal-lg">
          <h1 className="text-2xl font-bold">ZestOps hit an unexpected error</h1>
          <p className="mt-2 text-muted">Please try again. If it keeps happening, check the server logs.</p>
          <button type="button" onClick={reset}
                  className="mt-6 rounded-brutal border-2 border-ink bg-lime px-4 py-2 font-semibold shadow-brutal-sm">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
