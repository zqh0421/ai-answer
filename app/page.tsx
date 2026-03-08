import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_45%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.06),_transparent_40%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] p-8">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 p-4 md:p-6">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-white md:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Portal</p>
          <h1 className="mt-3 text-2xl font-bold text-slate-900 md:text-3xl">Learning & Management Portal</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
            Choose an entry point to continue.
          </p>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm ring-1 ring-white md:p-5">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-slate-900">Available Entrances</h2>
            <p className="mt-1 text-sm text-slate-500">Student flow is marked for release later.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <article className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-white">
              <div className="flex h-full flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Students</p>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      Coming Soon
                    </span>
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">Custom Practice</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Student-customized question practice is under preparation and not yet available.
                  </p>
                </div>
                <button
                  type="button"
                  disabled
                  className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-500"
                >
                  Coming Soon
                </button>
              </div>
            </article>

            <Link
              href="/manage"
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-white transition hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-md"
            >
              <div className="flex h-full flex-col justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Educators</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900 group-hover:text-blue-800">
                    Resource Management
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Access educator resource management for courses and related content.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 group-hover:text-blue-700">
                  Open
                  <span aria-hidden="true">→</span>
                </div>
              </div>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
