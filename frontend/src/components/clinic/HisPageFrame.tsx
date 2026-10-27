import { useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { HIS, HIS_FONT, hisFontStyle } from "@/lib/hisTheme";
import { useEscLayer } from "@/hooks/useEscLayer";
import { useListNav } from "@/hooks/useListNav";

type Props = {
  title: string;
  notice?: string | null;
  onEsc?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** status line under title (white bar) */
  statusLine?: ReactNode;
};

/** Luna blue title bar */
export function HisWinTitle({
  title,
  trailing,
  fontSize = HIS.fs.title,
}: {
  title: string;
  trailing?: ReactNode;
  fontSize?: number;
}) {
  const scaled = fontSize !== HIS.fs.title;
  return (
    <div
      className={scaled ? "flex shrink-0 items-center text-white" : "flex shrink-0 items-center gap-2 px-2 py-0.5 text-white"}
      style={{
        background: `linear-gradient(180deg,${HIS.titleBarFrom},${HIS.titleBarTo} 40%,${HIS.titleBarFrom})`,
        borderBottom: `1px solid ${HIS.titleBarBorder}`,
        fontFamily: HIS_FONT,
        fontSize,
        fontWeight: 700,
        minHeight: scaled ? Math.round(fontSize * 1.9) : 22,
        ...(scaled
          ? {
              gap: Math.round(fontSize * 0.5),
              padding: `${Math.round(fontSize * 0.15)}px ${Math.round(fontSize * 0.5)}px`,
            }
          : {}),
      }}
    >
      <span className="truncate">{title}</span>
      {trailing ? <div className="ml-auto flex items-center gap-1">{trailing}</div> : null}
    </div>
  );
}

/** 醫聖風格頁框：Luna 標題列 + 內容區 + 可選底欄 */
export function HisPageFrame({ title, notice, onEsc, children, footer, statusLine }: Props) {
  return (
    <div
      className="flex h-screen flex-col overflow-hidden text-black"
      style={{ ...hisFontStyle, background: HIS.chrome, fontSize: HIS.fs.body }}
    >
      <HisWinTitle
        title={title}
        trailing={
          onEsc ? (
            <button
              type="button"
              className="border border-white/40 bg-white/15 px-1.5 py-0 text-[10px] font-bold hover:bg-white/25"
              onClick={onEsc}
            >
              Esc 回
            </button>
          ) : null
        }
      />
      {statusLine ? (
        <div
          className="shrink-0 border-b bg-white px-2 py-0.5"
          style={{ borderColor: HIS.chromeBorder, fontSize: HIS.fs.secondary }}
        >
          {statusLine}
        </div>
      ) : null}
      {notice ? (
        <p
          className="shrink-0 border-b bg-[#FFFFCC] px-1.5 leading-none"
          style={{
            borderColor: HIS.chromeBorder,
            fontSize: HIS.fs.secondary,
            height: HIS.row.formField,
            lineHeight: `${HIS.row.formField}px`,
          }}
        >
          {notice}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
      {footer}
    </div>
  );
}

type FBarItem = {
  key: string;
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: string;
};

/** 目錄／清單底欄 F 鍵列 */
export function HisCatalogFBar({ items }: { items: FBarItem[] }) {
  return (
    <div
      className="flex shrink-0 items-stretch gap-0.5 border-t px-0.5 py-0.5"
      style={{
        borderColor: HIS.chromeBorder,
        background: "linear-gradient(180deg,#f4f2e8,#ece9d8)",
        fontFamily: HIS_FONT,
      }}
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          disabled={it.disabled}
          onClick={it.onClick}
          className="flex flex-col items-center justify-center rounded-none border px-1 leading-none disabled:opacity-40"
          style={{
            borderColor: "#404040",
            background: it.color,
            color: "#000080",
            minWidth: 64,
            height: HIS.row.fbarPrimary,
            boxShadow:
              "inset 1px 1px 0 rgba(255,255,255,.55), inset -1px -1px 0 rgba(0,0,0,.3)",
          }}
        >
          {it.icon ? <span className="text-[14px] leading-none">{it.icon}</span> : null}
          <span className="font-mono font-bold" style={{ fontSize: HIS.fs.secondary }}>
            {it.key}
          </span>
          <span className="font-bold" style={{ fontSize: HIS.fs.fbar }}>
            {it.label}
          </span>
        </button>
      ))}
    </div>
  );
}

type FieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  labelWidth?: string;
};

/** 標籤 + 輸入框一列 */
export function HisField({
  label,
  children,
  className = "",
  wide,
  labelWidth = HIS.labelW,
}: FieldProps) {
  return (
    <label
      className={`flex items-stretch gap-0 ${wide ? "col-span-full" : ""} ${className}`}
      style={{ minHeight: HIS.row.formField, fontFamily: HIS_FONT }}
    >
      <span
        className="flex shrink-0 items-center justify-end border px-0.5 font-bold leading-none"
        style={{
          width: labelWidth,
          borderColor: HIS.chromeBorder,
          background: HIS.labelBg,
          color: HIS.labelText,
          fontSize: HIS.fs.secondary,
        }}
      >
        {label}
      </span>
      <span className="flex min-w-0 flex-1 items-stretch">{children}</span>
    </label>
  );
}

/** XP modal dialog shell */
export function HisXpDialog({
  open,
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number | string;
}) {
  useEscLayer([{ open: true, close: onClose ?? (() => undefined) }], Boolean(open && onClose));
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.35)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] flex-col overflow-hidden border-2 shadow-lg"
        style={{
          width,
          maxWidth: "96vw",
          borderColor: "#404040",
          background: HIS.chrome,
          fontFamily: HIS_FONT,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <HisWinTitle
          title={title}
          trailing={
            onClose ? (
              <button
                type="button"
                className="border border-white/40 bg-white/15 px-1 text-[10px] font-bold hover:bg-white/25"
                onClick={onClose}
              >
                X
              </button>
            ) : null
          }
        />
        <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
        {footer ? (
          <div
            className="flex shrink-0 items-center justify-end gap-2 border-t px-2 py-1"
            style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Catalog master: form left / list right (or reverse) */
export function HisCatalogSplit({
  form,
  list,
  formWidth = "42%",
  listFirst = false,
}: {
  form: ReactNode;
  list: ReactNode;
  formWidth?: string;
  listFirst?: boolean;
}) {
  const formPane = (
    <div
      className="min-h-0 overflow-auto border-r p-1"
      style={{
        width: formWidth,
        flexShrink: 0,
        borderColor: HIS.chromeBorder,
        background: HIS.chrome,
      }}
    >
      {form}
    </div>
  );
  const listPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">{list}</div>
  );
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden" style={{ background: HIS.chrome }}>
      {listFirst ? (
        <>
          {listPane}
          {formPane}
        </>
      ) : (
        <>
          {formPane}
          {listPane}
        </>
      )}
    </div>
  );
}

type GridCol = { key: string; label: string; width?: number | string; mono?: boolean };

type HisDataGridProps<T> = {
  columns: GridCol[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  selectedKey?: string | null;
  onSelect?: (row: T) => void;
  onDoubleClick?: (row: T) => void;
  cell: (row: T, colKey: string) => ReactNode;
  finished?: (row: T) => boolean;
  emptyText?: string;
};

/** Sticky header data table (DoctBrw / master list) */
export function HisDataGrid<T>({
  columns,
  rows,
  rowKey,
  selectedKey,
  onSelect,
  onDoubleClick,
  cell,
  finished,
  emptyText = "—",
}: HisDataGridProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onIndex = useCallback((i: number) => {
    const row = rowsRef.current[i];
    if (row) onSelectRef.current?.(row);
  }, []);
  const index = selectedKey == null ? -1 : rows.findIndex((row, i) => rowKey(row, i) === selectedKey);
  useListNav({
    active: rows.length > 0,
    length: rows.length,
    index,
    onIndex,
    scrollerRef,
  });
  return (
    <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto bg-white" style={{ fontFamily: HIS_FONT }}>
      <table className="w-full border-collapse text-left" style={{ fontSize: HIS.fs.secondary }}>
        <thead className="sticky top-0 z-10">
          <tr style={{ height: HIS.row.listHeader, background: HIS.headerBg }}>
            {columns.map((c) => (
              <th
                key={c.key}
                className="border px-0.5 py-0 font-bold leading-none"
                style={{
                  borderColor: HIS.chromeBorder,
                  width: c.width,
                  background: HIS.headerBg,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = rowKey(row, i);
            const sel = selectedKey === key;
            const done = finished?.(row);
            return (
              <tr
                key={key}
                data-list-row=""
                className="cursor-pointer leading-none"
                style={{
                  height: HIS.row.list,
                  background: sel
                    ? HIS.rowSelected
                    : done
                      ? HIS.rowFinished
                      : i % 2
                        ? HIS.rowAlt
                        : "#FFFFFF",
                }}
                onClick={() => onSelect?.(row)}
                onDoubleClick={() => onDoubleClick?.(row)}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`border px-0.5 py-0 ${c.mono ? "font-mono" : ""}`}
                    style={{ borderColor: "#B0B0B0", color: sel ? "#000" : undefined }}
                  >
                    {cell(row, c.key)}
                  </td>
                ))}
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-2 py-6 text-center text-[#808080]"
              >
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** XP inset button */
export function HisBtn({
  children,
  onClick,
  disabled,
  primary,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-none border px-2 py-0.5 text-xs font-bold disabled:opacity-40 ${className}`}
      style={{
        borderColor: HIS.chromeBorder,
        background: primary ? "#FFFF80" : "#D4D0C8",
        color: "#000",
        fontFamily: HIS_FONT,
        boxShadow: "inset 1px 1px 0 #fff, inset -1px -1px 0 #808080",
      }}
    >
      {children}
    </button>
  );
}

export const hisInputClass =
  "h-full w-full border border-[#808080] bg-white px-0.5 leading-none outline-none focus:border-[#000080]";

export const hisInputStyle: CSSProperties = {
  fontFamily: HIS_FONT,
  fontSize: HIS.fs.body,
  height: HIS.row.formField,
  color: HIS.inputBlue,
};

export const hisTextareaClass =
  "w-full resize-none border border-[#808080] bg-white px-0.5 py-0.5 outline-none focus:border-[#800080]";

export const hisTextareaStyle: CSSProperties = {
  fontFamily: HIS_FONT,
  fontSize: HIS.fs.primary,
  color: HIS.ccText,
  lineHeight: 1.25,
  fontWeight: 700,
};

export const hisSecondaryStyle: CSSProperties = {
  fontFamily: HIS_FONT,
  fontSize: HIS.fs.secondary,
  color: HIS.labelText,
};
