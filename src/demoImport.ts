// 演示用：构造一份“外部系统导入”的历史记录，其中故意包含各类违规，
// 用于验证“重载后记录、核验和版本仍对应”，并按站点/油品/时段/命中规则列出冲突。
import type { PriceOrder } from "./types";
import { getLimit } from "./seed";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
function shift(hours: number): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + hours);
  return toLocal(d);
}

let demoSeq = 0;
function demoId(): string {
  demoSeq += 1;
  return `import-demo-${Date.now().toString(36)}-${demoSeq}`;
}

function baseOrder(partial: Partial<PriceOrder> & Pick<
  PriceOrder,
  "code" | "stationId" | "fuelId" | "startAt" | "endAt" | "listPrice" | "method" | "discountValue" | "finalPrice" | "status" | "reason" | "operator" | "versionNo"
>): PriceOrder {
  const limit = getLimit(partial.stationId, partial.fuelId) ?? {
    ceiling: 999,
    floor: 0,
  };
  return {
    id: demoId(),
    ceiling: limit.ceiling,
    floor: limit.floor,
    review: null,
    tagCheck: null,
    revokeReason: null,
    basedOnId: null,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    origin: "import",
    ...partial,
  };
}

export function buildDemoImports(): PriceOrder[] {
  return [
    // 1) 触线但无站长复核（待发布）→ TOUCH_UNREVIEWED
    baseOrder({
      code: "IMP-001",
      stationId: "S01",
      fuelId: "F95",
      startAt: shift(1),
      endAt: shift(24 * 7),
      listPrice: 8.35,
      method: "none",
      discountValue: 0,
      finalPrice: 8.35, // == 最高零售价
      status: "pending",
      reason: "外部导入：周挂牌价（缺复核记录）",
      operator: "外部系统",
      versionNo: 1,
    }),
    // 2) 与 IMP-001 同站同油品且时段重叠 → OVERLAP
    baseOrder({
      code: "IMP-002",
      stationId: "S01",
      fuelId: "F95",
      startAt: shift(3),
      endAt: shift(72),
      listPrice: 8.35,
      method: "fixed",
      discountValue: 7.9,
      finalPrice: 7.9,
      status: "pending",
      reason: "外部导入：车队会员固定价（与 IMP-001 时段撞车）",
      operator: "外部系统",
      versionNo: 1,
    }),
    // 3) 到手价高于最高零售价（已发布）→ OVER_CEILING
    baseOrder({
      code: "IMP-003",
      stationId: "S02",
      fuelId: "F0",
      startAt: shift(2),
      endAt: shift(48),
      listPrice: 7.99,
      method: "none",
      discountValue: 0,
      finalPrice: 7.99, // > 7.52 上限
      status: "published",
      reason: "外部导入：疑似错误挂牌价",
      operator: "外部系统",
      versionNo: 1,
      publishedAt: new Date().toISOString(),
    }),
    // 4) 已发布会员优惠但价签未核验 → TAG_UNVERIFIED（不拦截、但会员不生效）
    baseOrder({
      code: "IMP-004",
      stationId: "S03",
      fuelId: "F98",
      startAt: shift(4),
      endAt: shift(96),
      listPrice: 9.45,
      method: "percent",
      discountValue: 90,
      finalPrice: 8.51,
      status: "published",
      reason: "外部导入：会员 9 折活动（缺价签核验记录）",
      operator: "外部系统",
      versionNo: 1,
      publishedAt: new Date().toISOString(),
    }),
  ];
}
