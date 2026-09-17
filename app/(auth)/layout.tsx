export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-heading font-bold tracking-tight">Owing</div>
        <section className="rounded-card bg-surface px-7 py-7">{children}</section>
      </div>
    </main>
  );
}
