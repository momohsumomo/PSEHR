import { useRef } from "react";
import { normalizeClock } from "@/lib/queueOrder";

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

const MAX = [23, 59, 59];

function partsOf(value: string): [string, string, string] {
  const bits = (value || "").split(":");
  return [bits[0] || "", bits[1] || "", bits[2] || ""];
}

/** Hour, minute, second. The colons stay; they are not typed or deleted. */
export function HisFixedClockInput({ value, onChange, className }: Props) {
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const parts = partsOf(value);

  const write = (idx: number, text: string) => {
    const next = partsOf(value);
    next[idx] = text;
    onChange(next.join(":"));
  };

  const commit = (idx: number) => {
    const next = partsOf(normalizeClock(partsOf(value).join(":")));
    const shown = partsOf(value);
    const n = Number.parseInt(shown[idx].replace(/\D/g, ""), 10);
    const v = Number.isFinite(n) ? Math.min(MAX[idx], Math.max(0, n)) : 0;
    next[idx] = String(v).padStart(2, "0");
    onChange(next.join(":"));
  };

  return (
    <span className={`inline-flex items-center font-mono ${className || ""}`}>
      {[0, 1, 2].map((idx) => (
        <span key={idx} className="inline-flex items-center">
          {idx > 0 ? (
            <span className="px-0.5 font-bold text-black" aria-hidden>
              :
            </span>
          ) : null}
          <input
            ref={refs[idx]}
            inputMode="numeric"
            className="w-[2ch] border-0 bg-transparent p-0 text-center outline-none"
            value={parts[idx]}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
              write(idx, digits);
              if (digits.length === 2) refs[idx + 1]?.current?.focus();
            }}
            onBlur={() => commit(idx)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const n = Number.parseInt(parts[idx].replace(/\D/g, "") || "0", 10) || 0;
                const delta = e.key === "ArrowUp" ? 1 : -1;
                const span = MAX[idx] + 1;
                const v = (n + delta + span) % span;
                write(idx, String(v).padStart(2, "0"));
                return;
              }
              if (e.key === ":" || e.key === "ArrowRight") {
                e.preventDefault();
                refs[idx + 1]?.current?.focus();
              }
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                refs[idx - 1]?.current?.focus();
              }
              if (e.key === "Backspace" && parts[idx] === "" && idx > 0) {
                e.preventDefault();
                refs[idx - 1]?.current?.focus();
              }
            }}
          />
        </span>
      ))}
    </span>
  );
}
