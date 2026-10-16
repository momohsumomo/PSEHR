import { HisPrintToolShell } from "@/components/clinic/HisPrintToolShell";
import { HIS_FONT } from "@/lib/hisTheme";

export type HisReportLine = { label: string; value: string };

type Props = {
  open: boolean;
  title: string;
  clinicName?: string;
  lines: HisReportLine[];
  bodyText?: string;
  onClose: () => void;
  size?: "report" | "slip" | "wide";
};

/**
 * ????????p?w???G?@?? HisPrintToolShell?]??t?w???C?L?u???^?C
 */
export function HisReportPreview({
  open,
  title,
  clinicName,
  lines,
  bodyText,
  onClose,
  size = "report",
}: Props) {
  const exportText = [
    title,
    clinicName || "",
    ...lines.map((l) => `${l.label}\t${l.value}`),
    bodyText || "",
  ]
    .filter((s) => String(s).trim().length > 0)
    .join("\n");

  return (
    <HisPrintToolShell
      open={open}
      title={title}
      onClose={onClose}
      exportText={exportText}
      fileBaseName={title.replace(/\s+/g, "_") || "report"}
      size={size}
      paper="a4"
      statusText="Preview."
    >
      <h1 style={{ fontSize: 14, margin: "0 0 8px", fontFamily: HIS_FONT }}>{title}</h1>
      {clinicName ? (
        <div style={{ color: "#444", marginBottom: 8, fontFamily: HIS_FONT }}>{clinicName}</div>
      ) : null}
      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 8 }}>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label}>
              <td style={{ padding: "1px 6px", color: "#444", width: "36%" }}>{l.label}</td>
              <td style={{ padding: "1px 6px" }}>{l.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bodyText ? (
        <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{bodyText}</pre>
      ) : null}
    </HisPrintToolShell>
  );
}
