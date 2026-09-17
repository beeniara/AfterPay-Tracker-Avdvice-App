import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import type { Advice, AdviceTone } from "@/lib/insights";

const toneLabels: Record<AdviceTone, { label: string; badge: "danger" | "warning" | "neutral" | "success" }> = {
  danger: { label: "Act now", badge: "danger" },
  warning: { label: "Worth fixing", badge: "warning" },
  info: { label: "Consider", badge: "neutral" },
  success: { label: "Going well", badge: "success" },
};

export function AdviceList({ advice }: { advice: Advice[] }) {
  return (
    <ol className="divide-y divide-line">
      {advice.map((item) => {
        const tone = toneLabels[item.tone];
        return (
          <li key={item.id} className="flex flex-wrap items-start gap-x-6 gap-y-3 py-[15px] first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tone.badge}>{tone.label}</Badge>
                <h3 className="text-body font-semibold">{item.title}</h3>
              </div>
              <p className="mt-1.5 text-body text-ink-secondary">{item.body}</p>
            </div>
            {item.href && item.cta ? (
              <ButtonLink href={item.href} variant="ghost" className="shrink-0 max-rail:w-full">
                {item.cta}
              </ButtonLink>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
