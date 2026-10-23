import { useState, type CSSProperties } from "react";
import { birthdayToStored, formatBirthdayRoc } from "@/lib/patientSearch";

type Props = {
  value: string;
  onChange: (stored: string) => void;
  readOnly?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Empty string keeps a blank field blank. Birthday still shows the example. */
  placeholder?: string;
};

/** Stored value stays the 7-digit form. Blank stays blank. */
export function RocBirthdayInput({
  value,
  onChange,
  readOnly,
  className,
  style,
  placeholder = "82.01.17",
}: Props) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const shown = focused ? draft : formatBirthdayRoc(value);

  return (
    <input
      style={style}
      className={className}
      maxLength={10}
      placeholder={placeholder}
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
