import type { UiLayout } from "@/types/uiConfig";

const COMPONENT_SYNONYMS: Record<string, string> = {
  "掛號": "queue-panel",
  "名單": "queue-panel",
  "病人": "patient-header",
  "病患": "patient-header",
  "標題": "patient-header",
  "過敏": "allergy-banner",
  "照片": "lesion-photos",
  "病灶": "lesion-photos",
  "圖片": "lesion-photos",
  "主訴": "chief-complaint",
  "cc": "chief-complaint",
  "診斷": "diagnoses",
  "病名": "diagnoses",
  "icd": "diagnoses",
  "處方": "current-rx",
  "開藥": "current-rx",
  "rx": "current-rx",
  "快捷": "right-panel",
  "歷史": "right-panel",
  "右欄": "right-panel",
};

export function parseLocalLayoutCommand(
  currentLayout: UiLayout,
  command: string,
  fallbackLayout: UiLayout
): { layout: UiLayout; message: string } | null {
  const cmd = command.toLowerCase().trim();

  // Reset command
  if (
    cmd.includes("還原") ||
    cmd.includes("預設") ||
    cmd.includes("重設") ||
    cmd.includes("reset")
  ) {
    return {
      layout: JSON.parse(JSON.stringify(fallbackLayout)),
      message: "已還原為模仿醫聖的基礎排版！",
    };
  }

  // Find target component
  let targetId: string | null = null;
  for (const [synonym, id] of Object.entries(COMPONENT_SYNONYMS)) {
    if (cmd.includes(synonym)) {
      targetId = id;
      break;
    }
  }

  if (!targetId) {
    return null; // Let LLM handle it or say we don't know
  }

  const nextLayout = JSON.parse(JSON.stringify(currentLayout)) as UiLayout;
  const comp = nextLayout.components.find((c) => c.id === targetId);

  if (!comp) {
    return null;
  }

  // Hide command
  if (
    cmd.includes("隱藏") ||
    cmd.includes("關閉") ||
    cmd.includes("拿掉") ||
    cmd.includes("刪除") ||
    cmd.includes("hide") ||
    cmd.includes("close")
  ) {
    comp.visible = false;
    return {
      layout: nextLayout,
      message: `已為您隱藏「${comp.title}」區塊。`,
    };
  }

  // Show command
  if (
    cmd.includes("顯示") ||
    cmd.includes("開啟") ||
    cmd.includes("叫出") ||
    cmd.includes("show") ||
    cmd.includes("open")
  ) {
    comp.visible = true;
    return {
      layout: nextLayout,
      message: `已為您顯示「${comp.title}」區塊。`,
    };
  }

  // Move right
  if (
    cmd.includes("移到右邊") ||
    cmd.includes("放右邊") ||
    cmd.includes("移至右邊") ||
    cmd.includes("右側") ||
    cmd.includes("move right")
  ) {
    comp.grid.x = 9;
    comp.grid.w = 3;
    return {
      layout: nextLayout,
      message: `已將「${comp.title}」移至右側欄位。`,
    };
  }

  // Move left
  if (
    cmd.includes("移到左邊") ||
    cmd.includes("放左邊") ||
    cmd.includes("移至左邊") ||
    cmd.includes("左側") ||
    cmd.includes("move left")
  ) {
    comp.grid.x = 0;
    comp.grid.w = 2;
    return {
      layout: nextLayout,
      message: `已將「${comp.title}」移至左側欄位。`,
    };
  }

  // Enlarge / Widen
  if (
    cmd.includes("放大") ||
    cmd.includes("調寬") ||
    cmd.includes("變寬") ||
    cmd.includes("擴大") ||
    cmd.includes("enlarge") ||
    cmd.includes("wider")
  ) {
    comp.grid.w = Math.min(12, comp.grid.w + 1);
    comp.grid.h = Math.min(12, comp.grid.h + 1);
    return {
      layout: nextLayout,
      message: `已將「${comp.title}」區塊放大。`,
    };
  }

  // Shrink
  if (
    cmd.includes("縮小") ||
    cmd.includes("調窄") ||
    cmd.includes("變窄") ||
    cmd.includes("shrink") ||
    cmd.includes("narrow")
  ) {
    comp.grid.w = Math.max(1, comp.grid.w - 1);
    comp.grid.h = Math.max(1, comp.grid.h - 1);
    return {
      layout: nextLayout,
      message: `已將「${comp.title}」區塊縮小。`,
    };
  }

  return null;
}
