import { Rail } from "@/components/nav/rail";
import { requirePageContext } from "@/lib/db/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePageContext();
  return (
    <>
      <Rail userName={user.name ?? user.email} />
      <main className="px-4 pt-5 pb-24 rail:ml-60 rail:px-6 rail:py-6">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </>
  );
}
