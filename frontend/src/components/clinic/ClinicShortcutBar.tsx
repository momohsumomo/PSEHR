import type { ReactNode } from "react";
import type { ShortcutBarItem } from "@/types/uiConfig";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

/** Dialog / form: gray square button */
export const HIS_BTN =
  "rounded-none border border-[#808080] bg-[#D4D0C8] px-2 py-0.5 text-xs font-semibold text-black hover:bg-[#E8E4DC] disabled:cursor-not-allowed disabled:border-[#A0A0A0] disabled:bg-[#C8C4BC] disabled:text-[#808080]";

export const HIS_BTN_DENSE =
  "rounded-none border border-[#808080] bg-[#D4D0C8] px-1.5 py-0 text-[11px] font-semibold leading-tight text-black hover:bg-[#E8E4DC] disabled:cursor-not-allowed disabled:border-[#A0A0A0] disabled:bg-[#C8C4BC] disabled:text-[#808080]";

const ACTION_ICON: Partial<Record<ShortcutBarItem["action"], string>> = {
  register: "\uD83C\uDFE5",
  registerEdit: "\u270F\uFE0F",
  clinicMain: "\uD83D\uDC68\u200D\u2695",
  editPatient: "\uD83D\uDC64",
  query: "\uD83D\uDD0D",
  deleteReg: "\uD83D\uDDD1",
  emrLookup: "\uD83D\uDCC2",
  escapeHome: "\uD83D\uDEAA",
  bigPalette: "\uD83D\uDCE6",
  dittoRx: "\uD83D\uDCCB",
  icCard: "\uD83D\uDCB3",
  saveChart: "\uD83D\uDCBE",
  historyChart: "\uD83D\uDCDC",
  readCard: "\uD83D\uDCB3",
  receipt: "\uD83D\uDDA8",
  printVisit: "\uD83D\uDDA8",
  refundDeposit: "\uD83D\uDCB0",
  certificate: "\uD83D\uDCC4",
  otherFunctions: "\uD83D\uDCC4",
};

type Props = {
  items: ShortcutBarItem[];
  activeKey?: string | null;
  disabledKeys?: string[];
  onActivate: (action: ShortcutBarItem["action"]) => void;
  trailing?: ReactNode;
  /** Secondary strip under F-keys (LOOK / suggest / allergy…) */
  thinBar?: ReactNode;
};

/** YiSheng bottom F-key bar: icon + F-key + label */
export function ClinicShortcutBar({
  items,
  activeKey,
  disabledKeys = [],
  onActivate,
  trailing,
  thinBar,
}: Props) {
  return (
    <div className="shrink-0" style={{ fontFamily: HIS_FONT }}>
      <div
        className="flex items-stretch gap-1 border-t px-1 py-1"
        style={{
          borderColor: HIS.chromeDark,
          background: "linear-gradient(180deg,#f4f2e8,#ece9d8)",
          minHeight: HIS.row.fbarPrimary,
        }}
      >
        {items
          .filter((item) => item.enabled !== false)
          .map((item) => {
            const locked = disabledKeys.includes(item.key);
            const active = !locked && activeKey === item.key;
            const icon = ACTION_ICON[item.action] || "";
            return (
              <button
                key={item.key}
                type="button"
                disabled={locked}
                className="flex min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-0 rounded-none border px-0.5 py-0.5 leading-none disabled:cursor-not-allowed"
                style={{
                  height: HIS.row.fbarPrimary,
                  fontFamily: HIS_FONT,
                  borderColor: HIS.chromeDark,
                  background: locked
                    ? "#C8C4BC"
                    : active
                      ? "#FFFF80"
                      : item.key === "Esc"
                        ? "#FFFF80"
                        : item.key === "F9"
                          ? "#C8F0C8"
                          : "#D4D0C8",
                  color: locked ? "#808080" : "#000000",
                  boxShadow: locked
                    ? "none"
                    : "inset 1px 1px 0 #FFFFFF, inset -1px -1px 0 #808080",
                }}
                onClick={() => {
                  if (!locked) onActivate(item.action);
                }}
              >
                {icon ? (
                  <span className="text-[14px] leading-none" aria-hidden>
                    {icon}
                  </span>
                ) : null}
                <span
                  className="font-mono font-extrabold"
                  style={{ fontSize: 10, color: "#000080" }}
                >
                  {item.key}
                </span>
                <span
                  className="font-bold"
                  style={{ fontSize: HIS.fs.fbar, color: locked ? "#808080" : "#000080" }}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        {trailing && <div className="ml-auto flex items-center gap-1 self-center">{trailing}</div>}
      </div>
      {thinBar ? (
        <div
          className="flex items-stretch gap-1 border-t px-1 py-1"
          style={{ borderColor: HIS.chromeDark, background: "#E0DCD0", minHeight: 42 }}
        >
          {thinBar}
        </div>
      ) : null}
    </div>
  );
}
