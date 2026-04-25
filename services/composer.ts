
import { LayoutTemplate, PageSpec, PanelResult } from "../types";

export const composePage = async (
  page: PageSpec,
  panels: PanelResult[],
  template: LayoutTemplate
): Promise<string> => {
  const canvas = document.createElement('canvas');
  canvas.width = template.canvas.w;
  canvas.height = template.canvas.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Canvas context failed");

  // Background
  ctx.fillStyle = page.layout.background_color || "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Load panel images
  const imagePromises = panels.map(p => {
    return new Promise<HTMLImageElement>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = p.raw_image_url;
    });
  });

  const images = await Promise.all(imagePromises);

  // Sort by z-order
  const sortedPanels = [...template.panels].sort((a, b) => a.z - b.z);

  for (const tPanel of sortedPanels) {
    const img = images[tPanel.panel_index - 1];
    if (!img) continue;

    ctx.save();

    // 1. Clip Shape (마스킹)
    if (tPanel.shape === "poly" && tPanel.poly) {
      ctx.beginPath();
      const startX = tPanel.poly[0][0] * canvas.width;
      const startY = tPanel.poly[0][1] * canvas.height;
      ctx.moveTo(startX, startY);
      for (let i = 1; i < tPanel.poly.length; i++) {
        ctx.lineTo(tPanel.poly[i][0] * canvas.width, tPanel.poly[i][1] * canvas.height);
      }
      ctx.closePath();
      ctx.clip();
    } else if (tPanel.shape === "rect" && tPanel.rect) {
      const rx = tPanel.rect.x * canvas.width;
      const ry = tPanel.rect.y * canvas.height;
      const rw = tPanel.rect.w * canvas.width;
      const rh = tPanel.rect.h * canvas.height;
      
      const radius = page.layout.border_radius_px;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, radius);
      ctx.clip();
    }

    // 2. Draw Image (Cover Mode)
    // AI가 이미 target_aspect_ratio에 맞춰 생성했으므로 크롭은 최소화됨
    const drawRect = tPanel.shape === "rect" 
      ? { x: tPanel.rect!.x * canvas.width, y: tPanel.rect!.y * canvas.height, w: tPanel.rect!.w * canvas.width, h: tPanel.rect!.h * canvas.height }
      : getBoundingBox(tPanel.poly!, canvas.width, canvas.height);

    const imgRatio = img.width / img.height;
    const targetRatio = drawRect.w / drawRect.h;
    let sx, sy, sw, sh;

    // 이미지 비율이 타겟보다 크면 좌우를 자름
    if (imgRatio > targetRatio) {
      sh = img.height;
      sw = sh * targetRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      // 이미지 비율이 타겟보다 작으면 상하를 자름
      sw = img.width;
      sh = sw / targetRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }

    ctx.drawImage(img, sx, sy, sw, sh, drawRect.x, drawRect.y, drawRect.w, drawRect.h);

    // 3. Border & Decor
    ctx.restore();
    
    // 외곽선 그리기
    ctx.lineWidth = tPanel.decor?.border_px || page.layout.border_px;
    ctx.strokeStyle = "#000000";

    if (tPanel.shape === "poly" && tPanel.poly) {
      ctx.beginPath();
      ctx.moveTo(tPanel.poly[0][0] * canvas.width, tPanel.poly[0][1] * canvas.height);
      for (let i = 1; i < tPanel.poly.length; i++) {
        ctx.lineTo(tPanel.poly[i][0] * canvas.width, tPanel.poly[i][1] * canvas.height);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (tPanel.shape === "rect" && tPanel.rect) {
      const rx = tPanel.rect.x * canvas.width;
      const ry = tPanel.rect.y * canvas.height;
      const rw = tPanel.rect.w * canvas.width;
      const rh = tPanel.rect.h * canvas.height;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, page.layout.border_radius_px);
      ctx.stroke();
    }
  }

  return canvas.toDataURL("image/png");
};

function getBoundingBox(poly: number[][], cw: number, ch: number) {
  const xs = poly.map(p => p[0] * cw);
  const ys = poly.map(p => p[1] * ch);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
