import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchStaff, saveStaff, deleteStaff, ApiStaffRecord } from "@/api/clinicApi";
import { HisField, HisPageFrame, hisInputClass } from "@/components/clinic/HisPageFrame";
import { HIS } from "@/lib/hisTheme";
import { useListNav } from "@/hooks/useListNav";
import { useEscLayer } from "@/hooks/useEscLayer";

export function StaffPage() {
  const navigate = useNavigate();
  const [staffList, setStaffList] = useState<ApiStaffRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const staffListRef = useRef<HTMLDivElement>(null);
  const staffRowsRef = useRef(staffList);
  staffRowsRef.current = staffList;
  const onStaffIndex = useCallback((i: number) => {
    const row = staffRowsRef.current[i];
    if (row) setSelectedId(row.id);
  }, []);
  const staffIndex = staffList.findIndex((s) => s.id === selectedId);
  useListNav({
    active: !showModal,
    length: staffList.length,
    index: staffIndex,
    onIndex: onStaffIndex,
    scrollerRef: staffListRef,
  });
  useEscLayer([
    { open: showModal, close: () => setShowModal(false) },
    { open: true, close: () => navigate("/") },
  ]);

  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [formData, setFormData] = useState<ApiStaffRecord>({
    id: "",
    name: "",
    role: "",
    nhiId: "",
    certNo: "",
    pin: "",
    status: "\u5728\u8077",
  });

  const loadStaff = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchStaff();
      setStaffList(data);
      if (!selectedId && data[0]) setSelectedId(data[0].id);
    } catch (err) {
      console.error(err);
      setError(
        "\u8f09\u5165\u91ab\u4e8b\u4eba\u54e1\u6e05\u55ae\u5931\u6557\uff1a" +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenAdd = () => {
    setModalMode("add");
    setFormData({
      id: "",
      name: "",
      role: "",
      nhiId: "",
      certNo: "",
      pin: "",
      status: "\u5728\u8077",
    });
    setError("");
    setSuccess("");
    setShowModal(true);
  };

  const handleOpenEdit = (record: ApiStaffRecord) => {
    setModalMode("edit");
    setFormData({ ...record });
    setSelectedId(record.id);
    setError("");
    setSuccess("");
    setShowModal(true);
  };

  const handleDeleteStaff = async (id: string, name: string) => {
    if (!confirm(`\u78ba\u5b9a\u8981\u522a\u9664\u54e1\u5de5\u3010${name}\u3011\u7684\u7d00\u9304\u55ce\uff1f`)) {
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await deleteStaff(id);
      setSuccess(`\u6210\u529f\u522a\u9664\u54e1\u5de5\u3010${name}\u3011\u3002`);
      loadStaff();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message.replace(/^\d+\s+/, "") : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await saveStaff(formData);
      setSuccess(`\u54e1\u5de5\u3010${formData.name}\u3011\u8cc7\u6599\u5df2\u6210\u529f\u5b58\u6a94\u3002`);
      setShowModal(false);
      loadStaff();
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg.replace(/^\d+\s+/, ""));
    } finally {
      setLoading(false);
    }
  };

  const notice = error || success || (loading ? "..." : null);

  return (
    <HisPageFrame
      title={"人事基本資料庫"}
      notice={notice}
      onEsc={() => navigate("/")}
      footer={
        <div
          className="flex shrink-0 flex-wrap items-center justify-center gap-1 border-t px-1 py-1"
          style={{ borderColor: HIS.chromeDark, background: HIS.chrome }}
        >
          {(
            [
              ["新增[A]", handleOpenAdd],
              [
                "刪除[D]",
                () => {
                  const s = staffList.find((x) => x.id === selectedId);
                  if (s) void handleDeleteStaff(s.id, s.name);
                },
              ],
              ["過濾[F]", () => setSuccess("過濾：請在表格點選後編輯（殼）")],
              ["尋找[L]", () => setSuccess("尋找：點列後編輯（殼）")],
              ["列印[P]", () => setSuccess("列印尚未接")],
              ["處方[R]", () => undefined],
              ["權限[H]", () => setSuccess("權限設定尚未接")],
              ["離開[X]", () => navigate("/")],
            ] as const
          ).map(([lab, fn]) => (
            <button
              key={lab}
              type="button"
              disabled={lab.startsWith("處方")}
              className="min-w-[4.5rem] border px-2 py-1 text-[11px] font-bold disabled:opacity-40"
              style={{
                borderColor: HIS.chromeDark,
                background: HIS.chrome,
                boxShadow: "inset 1px 1px 0 #fff, inset -1px -1px 0 #808080",
              }}
              onClick={fn}
            >
              {lab}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={staffListRef} className="min-h-0 flex-1 overflow-auto bg-white">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 text-[11px] font-bold" style={{ background: "#C0C0C0" }}>
              <tr>
                {[
                  "使用者",
                  "代碼",
                  "密碼",
                  "姓名",
                  "身份證號",
                  "職稱",
                  "核定天數",
                  "科別",
                  "診間",
                  "專科執照",
                  "執照期限",
                  "醫師群組",
                  "執照號碼",
                  "管制證號",
                  "電話",
                  "住址",
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border px-1 py-0.5 text-left"
                    style={{ borderColor: HIS.chromeDark }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staffList.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-1 py-4 text-center text-[#808080]">
                    目前暫無登錄醫事人員紀錄。
                  </td>
                </tr>
              ) : (
                staffList.map((s) => {
                  const sel = selectedId === s.id;
                  return (
                    <tr
                      key={s.id}
                      data-list-row=""
                      className="cursor-pointer"
                      style={{
                        background: sel ? "#000080" : "#fff",
                        color: sel ? "#fff" : "#000",
                      }}
                      onClick={() => setSelectedId(s.id)}
                      onDoubleClick={() => handleOpenEdit(s)}
                    >
                      <td className="border px-1 py-0.5 font-mono" style={{ borderColor: "#C0C0C0" }}>
                        {s.id}
                      </td>
                      <td className="border px-1 py-0.5 font-mono" style={{ borderColor: "#C0C0C0" }}>
                        {s.nhiId || "—"}
                      </td>
                      <td className="border px-1 py-0.5 font-mono text-sky-300" style={{ borderColor: "#C0C0C0" }}>
                        **********
                      </td>
                      <td className="border px-1 py-0.5 font-bold" style={{ borderColor: "#C0C0C0" }}>
                        {s.name}
                      </td>
                      <td className="border px-1 py-0.5 font-mono" style={{ borderColor: "#C0C0C0" }}>
                        —
                      </td>
                      <td className="border px-1 py-0.5" style={{ borderColor: "#C0C0C0" }}>
                        {s.role || "—"}
                      </td>
                      <td className="border px-1 py-0.5 text-center font-mono" style={{ borderColor: "#C0C0C0" }}>
                        0.0
                      </td>
                      <td className="border px-1 py-0.5" style={{ borderColor: "#C0C0C0" }}>
                        —
                      </td>
                      <td className="border px-1 py-0.5 text-center" style={{ borderColor: "#C0C0C0" }}>
                        —
                      </td>
                      <td className="border px-1 py-0.5" style={{ borderColor: "#C0C0C0" }}>
                        —
                      </td>
                      <td className="border px-1 py-0.5 font-mono" style={{ borderColor: "#C0C0C0" }}>
                        . .
                      </td>
                      <td className="border px-1 py-0.5" style={{ borderColor: "#C0C0C0" }}>
                        —
                      </td>
                      <td className="border px-1 py-0.5 font-mono" style={{ borderColor: "#C0C0C0" }}>
                        {s.certNo || "—"}
                      </td>
                      <td className="border px-1 py-0.5" style={{ borderColor: "#C0C0C0" }}>
                        —
                      </td>
                      <td className="border px-1 py-0.5" style={{ borderColor: "#C0C0C0" }}>
                        —
                      </td>
                      <td className="border px-1 py-0.5" style={{ borderColor: "#C0C0C0" }}>
                        —
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="w-[26rem] border text-[12px] shadow"
            style={{ borderColor: HIS.chromeDark, background: HIS.chrome }}
          >
            <div
              className="flex items-center justify-between border-b px-2 py-0.5 text-[12px] font-bold"
              style={{ borderColor: HIS.chromeDark, background: "#ECE9D8" }}
            >
              <span>
                {modalMode === "add" ? "\u65b0\u589e\u91ab\u4e8b\u4eba\u54e1" : "\u7de8\u8f2f\u91ab\u4e8b\u4eba\u54e1"}
              </span>
              <button type="button" className="font-bold" onClick={() => setShowModal(false)}>
                X
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-1 p-2">
              <HisField label={"\u4ee3\u78bc"}>
                <input
                  type="text"
                  disabled={modalMode === "edit"}
                  className={`${hisInputClass} font-mono disabled:bg-[#E8E8E8]`}
                  value={formData.id}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value.trim() })}
                />
              </HisField>
              <HisField label={"\u59d3\u540d"}>
                <input
                  type="text"
                  className={hisInputClass}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </HisField>
              <HisField label={"\u8077\u7a31"}>
                <input
                  type="text"
                  className={hisInputClass}
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                />
              </HisField>
              <HisField label={"\u8eab\u5206\u8b49"}>
                <input
                  type="text"
                  className={`${hisInputClass} font-mono`}
                  value={formData.nhiId || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, nhiId: e.target.value.toUpperCase().trim() })
                  }
                />
              </HisField>
              <HisField label={"\u8b49\u66f8"}>
                <input
                  type="text"
                  className={`${hisInputClass} font-mono`}
                  value={formData.certNo || ""}
                  onChange={(e) => setFormData({ ...formData, certNo: e.target.value })}
                />
              </HisField>
              <HisField label="PIN">
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={6}
                  className={`${hisInputClass} font-mono`}
                  value={formData.pin}
                  onChange={(e) =>
                    setFormData({ ...formData, pin: e.target.value.replace(/\D/g, "") })
                  }
                />
              </HisField>
              <HisField label={"\u72c0\u614b"}>
                <select
                  className={hisInputClass}
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value={"\u5728\u8077"}>{"\u5728\u8077"}</option>
                  <option value={"\u96e2\u8077"}>{"\u96e2\u8077"}</option>
                </select>
              </HisField>
              <div className="flex gap-1 pt-1">
                <button
                  type="submit"
                  className="border px-2 py-0.5 text-[11px] font-bold"
                  style={{ borderColor: HIS.chromeDark, background: "#7FFFD4" }}
                >
                  {"\u5b58\u6a94"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="border px-2 py-0.5 text-[11px] font-bold"
                  style={{ borderColor: HIS.chromeDark, background: "#fff" }}
                >
                  {"\u95dc\u9589"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </HisPageFrame>
  );
}
