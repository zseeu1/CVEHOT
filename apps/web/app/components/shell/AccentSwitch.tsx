import { useEffect, useState } from "react";
import { ACCENTS, DEFAULT_ACCENT, applyAccent, setAccentPreference, useAccentPreference, type Accent } from "../../lib/local-state";

const LABELS: Record<Accent, string> = {
  teal: "青",
  azure: "靛蓝",
  violet: "紫",
  rose: "玫红",
  graphite: "石墨",
};

/**
 * Theme-colour picker: one dot per palette, each filled with that palette's own accent. The dot reads
 * the colour through a `data-accent` of its own, so a swatch always shows the exact colour it would
 * put on the page, in whichever theme is showing. The default needs no rule of its own — it is the
 * accent the stylesheet already carries. Shaped like the appearance switch it sits above.
 */
export function AccentSwitch({ className = "" }: { className?: string }) {
  const accent = useAccentPreference();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current: Accent = mounted ? accent : DEFAULT_ACCENT;

  const choose = (next: Accent) => {
    setAccentPreference(next);
    applyAccent(next);
  };

  return (
    <div role="radiogroup" aria-label="主题色" className={`grid h-[34px] grid-cols-5 rounded-full border border-line bg-bg-sunk p-[3px] ${className}`}>
      {ACCENTS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={current === a}
          title={LABELS[a]}
          onClick={() => choose(a)}
          className={`flex items-center justify-center rounded-full transition-colors duration-150 ${
            current === a ? "border border-line bg-surface shadow-[var(--shadow-card)]" : "border border-transparent"
          }`}
        >
          <span data-accent={a} aria-hidden="true" className="size-3.5 rounded-full ring-1 ring-black/10 ring-inset" style={{ background: "var(--accent)" }} />
          <span className="sr-only">{LABELS[a]}</span>
        </button>
      ))}
    </div>
  );
}
