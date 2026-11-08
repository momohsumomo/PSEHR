/** Render a DOM node to a JPG with the browser alone (SVG foreignObject onto a canvas). */

const MM_TO_PX = 96 / 25.4;
const MAX_CANVAS_SIDE = 30000;

function pageCss(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText);
    } catch {
      // A cross-origin sheet cannot be read; the page still renders with the rest.
    }
  }
  return parts.join("\n");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image render failed"));
    img.src = src;
  });
}

/** Lay `nodes` out one under another at `widthMm` on white and return JPG bytes. */
export async function nodesToJpg(nodes: HTMLElement[], widthMm: number, padMm: number): Promise<Blob> {
  const widthPx = Math.round(widthMm * MM_TO_PX);
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${widthPx}px;background:#fff;color:#000;`;
  const sheet = document.createElement("div");
  sheet.style.cssText = `width:${widthPx}px;padding:${padMm}mm;box-sizing:border-box;background:#fff;color:#000;font-family:Consolas,'Courier New','Microsoft JhengHei',sans-serif;font-size:12px;`;
  for (const node of nodes) {
    const copy = node.cloneNode(true) as HTMLElement;
    copy.style.transform = "none";
    sheet.appendChild(copy);
  }
  host.appendChild(sheet);
  document.body.appendChild(host);
  let heightPx = 0;
  let markup = "";
  try {
    heightPx = Math.ceil(sheet.scrollHeight);
    const style = document.createElement("style");
    style.textContent = pageCss();
    sheet.insertBefore(style, sheet.firstChild);
    markup = new XMLSerializer().serializeToString(sheet);
  } finally {
    host.remove();
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`;
  const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
  const scale = Math.max(1, Math.min(2, MAX_CANVAS_SIDE / Math.max(widthPx, heightPx)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthPx * scale);
  canvas.height = Math.round(heightPx * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("jpg encode failed"))), "image/jpeg", 0.92);
  });
}
