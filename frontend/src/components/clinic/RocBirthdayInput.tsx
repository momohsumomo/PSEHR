import { useState, type CSSProperties } from "react";
import { birthdayToStored, formatBirthdayRoc } from "@/lib/patientSearch";

type Props = {
  value: string;
  onChange: (stored: string) => void;
  readOnly?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** Shows 82.01.17. The stored value stays the 7-digit form. */
export function RocBirthdayInput({ value, onChange, readOnly, className, style }: Props) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const shown = focused ? draft : formatBirthdayRoc(value);

  return (
    <input
      style={style}
      className={className}
      maxLength={10}
      placeholder="82.01.17"
      value={shown}
      readOnly={readOnly}
      onFocus={() => {
        if (readOnly) return;
        setDraft(formatBirthdayRoc(value));
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (readOnly || !focused) return;
        setFocused(false);
        onChange(birthdayToStored(draft));
      }}
    />
  );
}
