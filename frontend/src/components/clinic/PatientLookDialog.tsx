import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  fetchLookFolder,
  fetchMediaDataUrl,
  fetchPatientPhotos,
  lookFileUrl,
  removeLookPhoto,
  replaceLookPhoto,
  saveLookPhoto,
  type PatientPhotoIndex,
} from "@/api/clinicApi";
import { isoToRoc } from "@/components/clinic/HisRocDatePicker";
import { useEscLayer } from "@/hooks/useEscLayer";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

type Props = {
  open: boolean;
  patientId: string | null;
  patientName: string;
  medicalNo: string;
  onClose: () => void;
};

type WallPhoto = {
  id: string;
  name: string;
  date: string;
  src: string;
};

type PendingPhoto = {
  key: string;
  file: File;
  url: string;
  date: string;
};

const IMAGE_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp";

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp)$/i.test(file.name);
}

function fileDateRoc(file: File): string {
  const stamp = new Date(file.lastModified);
  if (Number.isNaN(stamp.getTime())) return "";
  const iso = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
  return isoToRoc(iso);
}

function rocFromIso(value: string): string {
  return isoToRoc(value.slice(0, 10));
}

function revokePending(items: PendingPhoto[]) {
  for (const item of items) URL.revokeObjectURL(item.url);
}

export function PatientLookDialog({ open, patientId, patientName, medicalNo, onClose }: Props) {
  const [photos, setPhotos] = useState<WallPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [picked, setPicked] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [photoNote, setPhotoNote] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingPhoto[]>([]);
  pendingRef.current = pending;

  const closePreview = useCallback(() => {
    revokePending(pendingRef.current);
    setPending([]);
    setSelectedKey(null);
    setPreviewNote("");
    setPreviewOpen(false);
  }, []);

  useEscLayer([
    { open: open && viewer != null, close: () => { setViewer(null); setDeleteArmed(false); } },
    { open: open && previewOpen, close: closePreview },
    { open: open && viewer == null && !previewOpen, close: onClose },
  ]);

  const loadWall = useCallback(async () => {
    if (!patientId) {
      setPhotos([]);
      setNote("");
      return [] as WallPhoto[];
    }
    setBusy(true);
    setNote("");
    try {
      const [media, folder] = await Promise.all([
        fetchPatientPhotos(patientId).catch(() => [] as PatientPhotoIndex[]),
        medicalNo ? fetchLookFolder(medicalNo).catch(() => null) : Promise.resolve(null),
      ]);
      const fromFolder: WallPhoto[] = (folder?.entry || []).map((file) => ({
        id: `folder:${file.rel}`,
        name: file.name,
        date: file.modified ? rocFromIso(file.modified) : "",
        src: `${lookFileUrl(file.rel)}&t=${Date.now()}`,
      }));
      let wall = fromFolder;
      if (!fromFolder.length) {
        const mediaPhotos = await Promise.all(
          media.map(async (row) => {
            const src = await fetchMediaDataUrl(row.id).catch(() => null);
            if (!src) return null;
            return {
              id: row.id,
              name: row.siteLabel || "相片",
              date: row.capturedAt ? rocFromIso(row.capturedAt) : "",
              src,
            } satisfies WallPhoto;
          }),
        );
        wall = mediaPhotos.filter((row): row is WallPhoto => row != null);
      }
      setPhotos(wall);
      if (!wall.length) {
        const where = folder?.reachable ? folder.root : "相片資料夾連不上";
        setNote(medicalNo ? `這個病歷號在 ${where} 沒有相片。` : "沒有病歷號，無法對相片資料夾。");
      } else if (folder && !folder.reachable) {
        setNote("相片資料夾目前連不上，只列出已寫進病歷的圖。");
      }
      return wall;
    } catch {
      setPhotos([]);
      setNote("相片清單讀取失敗。");
      return [] as WallPhoto[];
    } finally {
      setBusy(false);
    }
  }, [patientId, medicalNo]);

  useEffect(() => {
    if (!open) {
      closePreview();
      setPhotos([]);
      setNote("");
      return;
    }
    void loadWall();
  }, [open, loadWall, closePreview]);

  const takeFiles = (files: File[], mode: "replace-all" | "replace-one") => {
    const images = files.filter(isImageFile);
    if (!images.length) {
      setPreviewNote("請選圖檔。");
      return;
    }
    if (mode === "replace-all") {
      revokePending(pendingRef.current);
      const next = images.map((file) => ({
        key: `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url: URL.createObjectURL(file),
        date: fileDateRoc(file),
      }));
      setPending(next);
      setSelectedKey(next[0]?.key ?? null);
      setPreviewNote("");
      return;
    }
    const file = images[0];
    const made = {
      key: `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      url: URL.createObjectURL(file),
      date: fileDateRoc(file),
    };
    setPending((prev) => {
      const index = prev.findIndex((item) => item.key === selectedKey);
      if (index < 0) return [...prev, made];
      URL.revokeObjectURL(prev[index].url);
      const next = prev.slice();
      next[index] = made;
      return next;
    });
    setSelectedKey(made.key);
    setPreviewNote("");
  };

  const startAdd = () => {
    if (!medicalNo) {
      setNote("沒有病歷號，無法匯入相片。");
      return;
    }
    flushSync(() => {
      setPreviewOpen(true);
      setPreviewNote("");
    });
    addRef.current?.click();
  };

  const removeSelected = () => {
    const prev = pendingRef.current;
    const index = prev.findIndex((item) => item.key === selectedKey);
    if (index < 0) return;
    URL.revokeObjectURL(prev[index].url);
    const next = prev.filter((item) => item.key !== prev[index].key);
    setPending(next);
    setSelectedKey(next[index]?.key ?? next[index - 1]?.key ?? null);
  };

  const commitPending = async () => {
    if (!medicalNo || !pending.length || saving) return;
    setSaving(true);
    setPreviewNote("");
    const batch = pending.slice();
    const saved = new Set<string>();
    let failed = false;
    for (const item of batch) {
      try {
        await saveLookPhoto(medicalNo, item.file);
        saved.add(item.key);
      } catch {
        failed = true;
        break;
      }
    }
    setPending((prev) => {
      const dropped = prev.filter((item) => saved.has(item.key));
      revokePending(dropped);
      return prev.filter((item) => !saved.has(item.key));
    });
    await loadWall();
    setSaving(false);
    if (failed) {
      setPreviewNote("有相片沒寫進資料夾，還沒匯入的還留在預覽。");
      return;
    }
    closePreview();
  };


  const folderRel = (photo: WallPhoto | undefined) =>
    photo && photo.id.startsWith("folder:") ? photo.id.slice("folder:".length) : "";

  const currentPhoto = viewer != null ? photos[viewer] : undefined;

  const showPhoto = (index: number) => {
    if (index < 0 || index >= photos.length) return;
    setDeleteArmed(false);
    setPhotoNote("");
    setViewer(index);
  };

  const rotateCurrent = async (dir: 1 | -1) => {
    const photo = currentPhoto;
    const rel = folderRel(photo);
    if (!photo || !rel || photoBusy) {
      setPhotoNote("\u9019\u5f35\u4e0d\u5728\u76f8\u7c3f\u8cc7\u6599\u593e\uff0c\u6c92\u8fa6\u6cd5\u8f49\u3002");
      return;
    }
    setPhotoBusy(true);
    setPhotoNote("");
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("load"));
        img.src = photo.src;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      if (dir > 0) {
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
      } else {
        ctx.translate(0, canvas.height);
        ctx.rotate(-Math.PI / 2);
      }
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("blob");
      const saved = await replaceLookPhoto(rel, blob, photo.name.replace(/\.\w+$/, "") + ".jpg");
      const wall = await loadWall();
      const next = wall.findIndex((row) => row.id === `folder:${saved.rel}`);
      setViewer(next >= 0 ? next : 0);
    } catch {
      setPhotoNote("\u8f49\u5411\u6c92\u5beb\u9032\u53bb\u3002");
    } finally {
      setPhotoBusy(false);
    }
  };

  const deleteCurrent = async (index = viewer ?? picked) => {
    const photo = photos[index];
    const rel = folderRel(photo);
    if (!photo || !rel || photoBusy) {
      setPhotoNote("\u9019\u5f35\u4e0d\u5728\u76f8\u7c3f\u8cc7\u6599\u593e\uff0c\u6c92\u8fa6\u6cd5\u79fb\u51fa\u3002");
      return;
    }
    if (!deleteArmed) {
      setDeleteArmed(true);
      setPhotoNote("\u518d\u6309\u4e00\u6b21\u522a\u9664\uff0c\u9019\u5f35\u5c31\u6703\u5f9e\u76f8\u7c3f\u62ff\u6389\u3002");
      setNote("\u518d\u6309\u4e00\u6b21\u522a\u9664\uff0c\u9019\u5f35\u5c31\u6703\u5f9e\u76f8\u7c3f\u62ff\u6389\u3002");
      return;
    }
    setPhotoBusy(true);
    try {
      await removeLookPhoto(rel);
      const wall = await loadWall();
      setDeleteArmed(false);
      setPhotoNote("");
      setNote("");
      if (!wall.length) {
        setViewer(null);
        setPicked(0);
      } else if (viewer == null) {
        setPicked(Math.min(index, wall.length - 1));
      } else {
        setViewer(Math.min(index, wall.length - 1));
        setPicked(Math.min(index, wall.length - 1));
      }
    } catch {
      setPhotoNote("\u522a\u9664\u6c92\u6210\u529f\u3002");
    } finally {
      setPhotoBusy(false);
    }
  };

  const replaceCurrent = async (file: File) => {
    const photo = currentPhoto;
    const rel = folderRel(photo);
    if (!photo || !rel) {
      setPhotoNote("\u8acb\u5148\u6253\u958b\u4e00\u5f35\u76f8\u7c3f\u88e1\u7684\u7167\u7247\u3002");
      return;
    }
    setPhotoBusy(true);
    setPhotoNote("");
    try {
      const saved = await replaceLookPhoto(rel, file, file.name);
      const wall = await loadWall();
      const next = wall.findIndex((row) => row.id === `folder:${saved.rel}`);
      setViewer(next >= 0 ? next : viewer);
    } catch {
      setPhotoNote("\u63db\u7167\u7247\u6c92\u5beb\u9032\u53bb\u3002");
    } finally {
      setPhotoBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35">
      <input
        ref={addRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (files.length) takeFiles(files, "replace-all");
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (files.length) takeFiles(files, "replace-one");
        }}
      />
      <div
        className="flex h-[min(44rem,92vh)] w-[min(68rem,96vw)] flex-col border bg-[#F0F0F0] shadow-lg"
        style={{ borderColor: HIS.chromeDark, fontFamily: HIS_FONT }}
      >
        <div className="flex shrink-0 items-center gap-2 bg-[#2060A0] px-2 py-1 text-xs font-bold text-white">
          <span>LOOK　相片</span>
          <span className="font-normal">
            {medicalNo ? `${medicalNo} ` : ""}
            {patientName || "—"}
          </span>
          <span className="font-normal">{photos.length ? `${photos.length} 張` : ""}</span>
          <button type="button" className="ml-auto px-2 hover:underline" onClick={startAdd}>
            新增
          </button>
          <button
            type="button"
            className="px-2 hover:underline"
            onClick={() => {
              if (!photos.length) {
                setNote("沒有照片可以編輯。");
                return;
              }
              showPhoto(Math.min(picked, photos.length - 1));
            }}
          >
            編輯
          </button>
          <button
            type="button"
            className="px-2 hover:underline"
            onClick={() => {
              if (!photos.length) {
                setNote("沒有照片可以刪除。");
                return;
              }
              const index = viewer != null ? viewer : Math.min(picked, photos.length - 1);
              void deleteCurrent(index);
            }}
          >
            刪除
          </button>
          <button type="button" className="px-2 hover:underline" onClick={onClose}>
            關閉
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {photos.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {photos.map((photo, index) => (
                <figure
                  key={photo.id}
                  className="flex min-w-0 cursor-pointer flex-col border bg-white"
                  style={{ borderColor: picked === index || viewer === index ? "#0047AB" : HIS.chromeBorder, outline: picked === index || viewer === index ? "2px solid #0047AB" : "none" }}
                  onClick={() => setPicked(index)}
                  onDoubleClick={() => showPhoto(index)}
                >
                  <div className="flex h-36 items-center justify-center bg-[#202020] sm:h-40">
                    <img src={photo.src} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  </div>
                  <figcaption className="truncate px-1 text-[11px] leading-4" title={`${photo.name} ${photo.date}`.trim()}>
                    {photo.name}
                    {photo.date ? `  ${photo.date}` : ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className="px-2 py-6 text-center text-xs text-slate-600">{busy ? "讀取中…" : note || "尚無相片"}</div>
          )}
        </div>
        {note && photos.length > 0 && <div className="shrink-0 px-2 py-1 text-[11px] text-slate-600">{note}</div>}
      </div>


      {viewer != null && currentPhoto && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70">
          <input ref={editRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void replaceCurrent(file);
          }} />
          <div className="flex h-[min(46rem,94vh)] w-[min(72rem,96vw)] flex-col border bg-[#111] shadow-lg" style={{ fontFamily: HIS_FONT }}>
            <div className="flex shrink-0 items-center gap-2 bg-[#2060A0] px-2 py-1 text-xs font-bold text-white">
              <span>照片 {viewer + 1} / {photos.length}</span>
              <span className="font-normal">{currentPhoto.name}</span>
              <button type="button" className="ml-auto px-2 hover:underline" onClick={() => { setViewer(null); setDeleteArmed(false); }}>關閉</button>
            </div>
            <button type="button" className="flex min-h-0 flex-1 items-center justify-center bg-black" onDoubleClick={() => showPhoto((viewer + 1) % photos.length)}>
              <img src={currentPhoto.src} alt="" className="max-h-full max-w-full object-contain" />
            </button>
            <div className="flex shrink-0 flex-wrap items-center gap-2 bg-[#F0F0F0] px-2 py-2">
              <button type="button" className="border bg-[#D4D0C8] px-2 py-1 text-xs font-bold" disabled={photoBusy || photos.length < 2} onClick={() => showPhoto((viewer - 1 + photos.length) % photos.length)}>上一張</button>
              <button type="button" className="border bg-[#D4D0C8] px-2 py-1 text-xs font-bold" disabled={photoBusy || photos.length < 2} onClick={() => showPhoto((viewer + 1) % photos.length)}>下一張</button>
              <button type="button" className="border bg-[#D4D0C8] px-2 py-1 text-xs font-bold" disabled={photoBusy} onClick={() => void rotateCurrent(-1)}>左轉</button>
              <button type="button" className="border bg-[#D4D0C8] px-2 py-1 text-xs font-bold" disabled={photoBusy} onClick={() => void rotateCurrent(1)}>右轉</button>
              <button type="button" className="border bg-[#D4D0C8] px-2 py-1 text-xs font-bold" disabled={photoBusy} onClick={() => editRef.current?.click()}>換成別張</button>
              <button type="button" className="border bg-[#F0C0C0] px-2 py-1 text-xs font-bold" disabled={photoBusy} onClick={() => void deleteCurrent(viewer ?? picked)}>{deleteArmed ? "確定刪除" : "刪除"}</button>
              <span className="text-[11px] text-slate-700">{photoNote || "雙擊大圖看下一張。刪除會把這張移出相簿，放到本機 data\\look-removed。"}</span>
            </div>
          </div>
        </div>
      )}

      {previewOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45">
          <div
            className="flex h-[min(40rem,88vh)] w-[min(64rem,94vw)] flex-col border bg-[#F0F0F0] shadow-lg"
            style={{ borderColor: HIS.chromeDark, fontFamily: HIS_FONT }}
          >
            <div className="flex shrink-0 items-center gap-2 bg-[#2060A0] px-2 py-1 text-xs font-bold text-white">
              <span>預覽相片</span>
              <span className="font-normal">{pending.length ? `${pending.length} 張尚未匯入` : "尚未選擇"}</span>
              <button type="button" className="ml-auto px-2 hover:underline" onClick={closePreview}>
                關閉
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {pending.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {pending.map((item) => {
                    const on = item.key === selectedKey;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className="flex min-w-0 flex-col border bg-white text-left"
                        style={{
                          borderColor: on ? "#0047AB" : HIS.chromeBorder,
                          outline: on ? "2px solid #0047AB" : "none",
                        }}
                        onClick={() => setSelectedKey(item.key)}
                      >
                        <div className="flex h-36 items-center justify-center bg-[#202020] sm:h-40">
                          <img src={item.url} alt="" className="max-h-full max-w-full object-contain" />
                        </div>
                        <span className="truncate px-1 text-[11px] leading-4" title={`${item.file.name} ${item.date}`.trim()}>
                          {item.file.name}
                          {item.date ? `  ${item.date}` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="px-2 py-6 text-center text-xs text-slate-600">還沒選圖片。可以按選擇圖片再挑。</div>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-2 py-2" style={{ borderColor: HIS.chromeDark }}>
              <button
                type="button"
                className="border bg-[#D4D0C8] px-3 py-1 text-xs font-bold disabled:opacity-50"
                style={{ borderColor: HIS.chromeBorder }}
                disabled={!pending.length || saving}
                onClick={() => void commitPending()}
              >
                {saving ? "匯入中…" : "新增照片"}
              </button>
              <button
                type="button"
                className="border bg-[#D4D0C8] px-3 py-1 text-xs font-bold"
                style={{ borderColor: HIS.chromeBorder }}
                disabled={saving}
                onClick={() => (selectedKey ? replaceRef.current?.click() : addRef.current?.click())}
              >
                選擇圖片
              </button>
              <button
                type="button"
                className="border bg-[#D4D0C8] px-3 py-1 text-xs font-bold disabled:opacity-50"
                style={{ borderColor: HIS.chromeBorder }}
                disabled={!selectedKey || saving}
                onClick={removeSelected}
              >
                刪除圖片
              </button>
              <span className="text-[11px] text-slate-600">新增照片才會寫進這個病人。選擇和刪除只改這次預覽。</span>
            </div>
            {previewNote && <div className="shrink-0 px-2 pb-2 text-[11px] text-red-700">{previewNote}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
