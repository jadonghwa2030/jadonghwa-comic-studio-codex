/**
 * 이미지 생성 엔진이 안정적으로 소화하는 대표 비율 목록.
 * 캔버스 w/h를 가장 가까운 지원 비율로 매핑합니다.
 */
const IMAGE_ENGINE_SUPPORTED_RATIOS: [number, number, string][] = [
  [1, 1, "1:1"], [2, 3, "2:3"], [3, 2, "3:2"],
  [3, 4, "3:4"], [4, 3, "4:3"], [4, 5, "4:5"],
  [5, 4, "5:4"], [9, 16, "9:16"], [16, 9, "16:9"],
  [21, 9, "21:9"]
];

export const findClosestAspectRatio = (w: number, h: number): string => {
  if (w <= 0 || h <= 0) return "9:16";
  const target = w / h;
  let best = "9:16";
  let bestDist = Infinity;
  for (const [rw, rh, label] of IMAGE_ENGINE_SUPPORTED_RATIOS) {
    const dist = Math.abs(rw / rh - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = label;
    }
  }
  return best;
};
