import type { ReactNode } from "react";

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-4 px-1 text-[15px] font-semibold">{children}</h1>;
}
