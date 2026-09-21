// 价格规则引擎：到手价计算、限价判定、时段重叠、冲突扫描（全部为纯函数）
import type {
  ConflictItem,
  DiscountMethod,
  PriceOrder,
  PricePosition,
  RuleId,
} from "./types";

export const RULE_LABELS: Record<RuleId, string> = {
  OVERLAP: "时段重叠",
  OVER_CEILING: "高于最高零售价",
  UNDER_FLOOR: "低于成本保护线",
  TOUCH_UNREVIEWED: "触线未复核",
  TAG_UNVERIFIED: "价签未核验",
  BROKEN_LINK: "版本链断裂",
};

const EPS = 1e-9;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 是否含会员优惠（决定价签核验是否为生效前提） */
export function isMemberOffer(method: DiscountMethod): boolean {
  return method !== "none";
}

/** 按优惠方式计算优惠后到手价 */
export function calcFinalPrice(
  listPrice: number,
  method: DiscountMethod,
  discountValue: number
): number {
  const value = Number.isFinite(discountValue) ? discountValue : 0;
  switch (method) {
    case "perLiter":
      return round2(Math.max(0, listPrice - value));
    case "percent":
      // 95 表示 95 折（即 95%）
      return round2((listPrice * Math.min(100, Math.max(0, value))) / 100);
    case "fixed":
      return round2(Math.max(0, value));
    case "none":
    default:
      return round2(listPrice);
  }
}

export function discountText(method: DiscountMethod, value: number): string {
  switch (method) {
    case "perLiter":
      return `每升立减 ${value.toFixed(2)} 元`;
    case "percent":
      return `会员 ${value.toFixed(1)} 折`;
    case "fixed":
      return `会员价 ${value.toFixed(2)} 元/升`;
    default:
      return "无优惠";
  }
}

/** 到手价相对限价区间的位置 */
export function pricePosition(
  finalPrice: number,
  ceiling: number,
  floor: number
): PricePosition {
  if (finalPrice > ceiling + EPS) return "over";
  if (finalPrice < floor - EPS) return "under";
  // 落在边界即视为触线（含相等）
  if (Math.abs(finalPrice - ceiling) <= EPS) return "ceiling";
  if (Math.abs(finalPrice - floor) <= EPS) return "floor";
  return "ok";
}

export function touchesLimit(position: PricePosition): boolean {
  return position === "ceiling" || position === "floor";
}

/** 半开区间 [aStart, aEnd) 与 [bStart, bEnd) 是否重叠；首尾相接不算重叠 */
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface OverlapPair {
  a: PriceOrder;
  b: PriceOrder;
}

/**
 * 找出同站同油品下时段重叠的单据对。
 * - 已撤销、已替代的历史版本不再占用时段；
 * - 版本链上直接交接的新旧版本（b.basedOnId === a.id）不算冲突，
 *   新版本发布时旧版本会被原子替代。
 */
export function findOverlaps(orders: PriceOrder[]): OverlapPair[] {
  const pairs: OverlapPair[] = [];
  const active = orders.filter((o) => o.status === "pending" || o.status === "published");
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const chainHandoff = a.basedOnId === b.id || b.basedOnId === a.id;
      if (
        !chainHandoff &&
        a.stationId === b.stationId &&
        a.fuelId === b.fuelId &&
        overlaps(a.startAt, a.endAt, b.startAt, b.endAt)
      ) {
        pairs.push({ a, b });
      }
    }
  }
  return pairs;
}

function conflict(
  partial: Omit<ConflictItem, "ruleLabel">
): ConflictItem {
  return { ...partial, ruleLabel: RULE_LABELS[partial.ruleId] };
}

/**
 * 全量冲突扫描。发布门禁与重载后校验共用同一套规则：
 * - OVERLAP       同站同油品时段重叠（拦截发布）
 * - OVER_CEILING  到手价高于最高零售价（拦截发布）
 * - UNDER_FLOOR   到手价低于成本保护线（拦截发布）
 * - TOUCH_UNREVIEWED 到手价触及上/下限但无站长复核（拦截发布）
 * - TAG_UNVERIFIED 已发布但价签未核验（不拦截发布、但不对会员生效）
 */
export function scanConflicts(orders: PriceOrder[]): ConflictItem[] {
  const items: ConflictItem[] = [];

  for (const o of orders) {
    if (o.status === "revoked") continue;

    const position = pricePosition(o.finalPrice, o.ceiling, o.floor);
    if (position === "over") {
      items.push(
        conflict({
          key: `over-${o.id}`,
          ruleId: "OVER_CEILING",
          detail: `到手价 ${o.finalPrice.toFixed(2)} 高于最高零售价 ${o.ceiling.toFixed(2)}`,
          stationId: o.stationId,
          fuelId: o.fuelId,
          startAt: o.startAt,
          endAt: o.endAt,
          orderIds: [o.id],
          blockPublish: true,
        })
      );
    } else if (position === "under") {
      items.push(
        conflict({
          key: `under-${o.id}`,
          ruleId: "UNDER_FLOOR",
          detail: `到手价 ${o.finalPrice.toFixed(2)} 低于成本保护线 ${o.floor.toFixed(2)}`,
          stationId: o.stationId,
          fuelId: o.fuelId,
          startAt: o.startAt,
          endAt: o.endAt,
          orderIds: [o.id],
          blockPublish: true,
        })
      );
    } else if (touchesLimit(position) && !o.review) {
      items.push(
        conflict({
          key: `touch-${o.id}`,
          ruleId: "TOUCH_UNREVIEWED",
          detail:
            position === "ceiling"
              ? `到手价 ${o.finalPrice.toFixed(2)} 触及最高零售价，须站长复核并写明依据`
              : `到手价 ${o.finalPrice.toFixed(2)} 触及成本保护线，须站长复核并写明依据`,
          stationId: o.stationId,
          fuelId: o.fuelId,
          startAt: o.startAt,
          endAt: o.endAt,
          orderIds: [o.id],
          blockPublish: true,
        })
      );
    }

    if (o.status === "published" && !o.tagCheck && o.method !== "none") {
      items.push(
        conflict({
          key: `tag-${o.id}`,
          ruleId: "TAG_UNVERIFIED",
          detail: "已发布但价签未核验，会员优惠暂不生效",
          stationId: o.stationId,
          fuelId: o.fuelId,
          startAt: o.startAt,
          endAt: o.endAt,
          orderIds: [o.id],
          blockPublish: false,
        })
      );
    }
  }

  for (const { a, b } of findOverlaps(orders)) {
    items.push(
      conflict({
        key: `overlap-${a.id}-${b.id}`,
        ruleId: "OVERLAP",
        detail: `${a.code}（${formatRange(a)}）与 ${b.code}（${formatRange(b)}）时段重叠`,
        stationId: a.stationId,
        fuelId: a.fuelId,
        startAt: a.startAt < b.startAt ? a.startAt : b.startAt,
        endAt: a.endAt > b.endAt ? a.endAt : b.endAt,
        orderIds: [a.id, b.id],
        blockPublish: true,
      })
    );
  }

  return items;
}

export function formatRange(o: PriceOrder): string {
  return `${o.startAt.replace("T", " ")} ~ ${o.endAt.replace("T", " ")}`;
}

/** 单据自身是否存在拦截发布的问题（排除与第三方单据的重叠，由全量扫描补充） */
export function ownBlockers(order: PriceOrder): ConflictItem[] {
  return scanConflicts([order]).filter((c) => c.blockPublish);
}
