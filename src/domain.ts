// 领域规则：常量、价格计算、时段重叠、冲突引擎、会员生效判定
import type {
  Conflict,
  Discount,
  DiscountType,
  Fuel,
  OrderFormModel,
  PriceLimit,
  PriceOrder,
  Station
} from "./types";

export const STORAGE_KEY = "dfwlfront-9-price-console-v1";

export const STATIONS: Station[] = [
  { code: "BJ001", name: "北京朝阳站", manager: "王立群" },
  { code: "BJ002", name: "北京海淀站", manager: "李建国" },
  { code: "TJ001", name: "天津滨海站", manager: "赵文海" }
];

export const FUELS: Fuel[] = [
  { code: "92", name: "92号汽油" },
  { code: "95", name: "95号汽油" },
  { code: "98", name: "98号汽油" },
  { code: "0", name: "0号柴油" }
];

export const DISCOUNT_OPTIONS: { value: DiscountType; label: string; hint: string }[] = [
  { value: "none", label: "无优惠", hint: "按挂牌价执行" },
  { value: "amount", label: "每升直降", hint: "单位：元/升" },
  { value: "percent", label: "折扣率", hint: "如 95 表示 95 折" },
  { value: "fixed", label: "指定到手价", hint: "直接录入会员到手价" }
];

/** 规则码 → 名称（冲突台「命中规则」列） */
export const RULE_LABELS: Record<string, string> = {
  R1: "时段重叠",
  R2: "突破最高零售价",
  R3: "跌破成本保护线",
  R4: "触线未经站长复核",
  R5: "复核依据缺失",
  R6: "价签待核验，暂不对会员生效",
  R7: "发布价超出最新限价走廊",
  R8: "价签价与到手价不一致"
};

export const PRICE_EPS = 0.009; // 金额按分四舍五入，命中边界容差
const HOUR = 3600_000;

// ---------- 基础工具 ----------

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function stationName(code: string): string {
  return STATIONS.find((s) => s.code === code)?.name ?? code;
}

export function fuelName(code: string): string {
  return FUELS.find((f) => f.code === code)?.name ?? code;
}

export function periodText(startAt: string, endAt: string): string {
  const fmt = (v: string) => v.replace("T", " ");
  return `${fmt(startAt)} ~ ${fmt(endAt)}`;
}

export function nowText(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 半开区间 [start,end) 重叠判定 */
export function overlaps(a: PriceOrder | OrderFormModel, b: PriceOrder): boolean {
  const as = Date.parse(a.startAt);
  const ae = Date.parse(a.endAt);
  const bs = Date.parse(b.startAt);
  const be = Date.parse(b.endAt);
  if ([as, ae, bs, be].some((n) => Number.isNaN(n))) return false;
  return as < be && bs < ae;
}

/** 时段本身是否合法（必填、终点晚于起点、至少 1 小时） */
export function periodValid(o: PriceOrder | OrderFormModel): boolean {
  const s = Date.parse(o.startAt);
  const e = Date.parse(o.endAt);
  return !Number.isNaN(s) && !Number.isNaN(e) && e - s >= HOUR;
}

// ---------- 价格走廊 ----------

export function calcFinalPrice(basePrice: number, discount: Discount): number {
  switch (discount.type) {
    case "amount":
      return round2(basePrice - discount.value);
    case "percent":
      return round2((basePrice * discount.value) / 100);
    case "fixed":
      return round2(discount.value);
    case "none":
    default:
      return round2(basePrice);
  }
}

export function getLimit(limits: PriceLimit[], stationCode: string, fuelCode: string): PriceLimit | undefined {
  return limits.find((l) => l.stationCode === stationCode && l.fuelCode === fuelCode);
}

export function touchesBoundaries(price: number, limit: PriceLimit | undefined): boolean {
  if (!limit) return false;
  return (
    Math.abs(price - limit.retail) <= PRICE_EPS || Math.abs(price - limit.costFloor) <= PRICE_EPS
  );
}

export function withinCorridor(price: number, limit: PriceLimit | undefined): boolean {
  if (!limit) return true;
  return price >= limit.costFloor - PRICE_EPS && price <= limit.retail + PRICE_EPS;
}

// ---------- 版本链 ----------

export function latestChainVersion(orders: PriceOrder[], chainId: string): number {
  return orders.filter((o) => o.chainId === chainId).reduce((m, o) => Math.max(m, o.versionNo), 0);
}

/** 当前链上最近一次「已发布、未被取代」的版本（撤销当前版本时用于恢复） */
export function lastRestorableVersion(orders: PriceOrder[], chainId: string, excludeId: string): PriceOrder | undefined {
  return orders
    .filter((o) => o.chainId === chainId && o.id !== excludeId && o.status === "superseded")
    .sort((a, b) => b.versionNo - a.versionNo)[0];
}

// ---------- 冲突引擎 ----------

type Ctx = { orders: PriceOrder[]; limits: PriceLimit[] };

type Finding = {
  rule: keyof typeof RULE_LABELS;
  level: Conflict["level"];
  orderIds: string[];
  periodText: string;
  detail: string;
};

function pushConflict(out: Conflict[], order: PriceOrder, f: Finding) {
  const key = [f.rule, order.id, f.orderIds.join(">")].join("|");
  if (out.some((c) => c.key === key)) return;
  out.push({
    key,
    level: f.level,
    rule: f.rule,
    ruleLabel: RULE_LABELS[f.rule],
    stationCode: order.stationCode,
    fuelCode: order.fuelCode,
    orderIds: [order.id, ...f.orderIds],
    periodText: f.periodText,
    detail: f.detail
  });
}

/**
 * 参与时段比对的单据：草稿（本链新版本草稿不算冲突）与已发布单。
 * 同链版本是前后相继关系，永不互斥；不同版本链的已发布/草稿互斥。
 */
function overlapCandidates(orders: PriceOrder[], self: PriceOrder): PriceOrder[] {
  return orders.filter(
    (o) =>
      o.id !== self.id &&
      o.chainId !== self.chainId &&
      o.stationCode === self.stationCode &&
      o.fuelCode === self.fuelCode &&
      (o.status === "draft" || o.status === "published")
  );
}

function findForOrder(order: PriceOrder, { orders, limits }: Ctx): Finding[] {
  const findings: Finding[] = [];
  if (order.status === "revoked") return findings; // 撤销单不再占用资源

  const limit = getLimit(limits, order.stationCode, order.fuelCode);
  const range = periodText(order.startAt, order.endAt);
  const activeOrder = order.status === "draft" || order.status === "published";

  // R2/R3 走廊校验：仅占用资源的草稿与发布单
  if (activeOrder && limit) {
    if (order.finalPrice > limit.retail + PRICE_EPS) {
      findings.push({
        rule: "R2",
        level: "block",
        orderIds: [],
        periodText: range,
        detail: `到手价 ${order.finalPrice.toFixed(2)} 元高于最高零售价 ${limit.retail.toFixed(2)} 元`
      });
    }
    if (order.finalPrice < limit.costFloor - PRICE_EPS) {
      findings.push({
        rule: "R3",
        level: "block",
        orderIds: [],
        periodText: range,
        detail: `到手价 ${order.finalPrice.toFixed(2)} 元低于成本保护线 ${limit.costFloor.toFixed(2)} 元`
      });
    }
  }

  // R1 跨版本链时段重叠（仅草稿/发布单占用资源；同站同油品才比对）
  if (activeOrder) {
    for (const other of overlapCandidates(orders, order)) {
      if (overlaps(order, other)) {
        findings.push({
          rule: "R1",
          level: "block",
          orderIds: [other.id],
          periodText: range,
          detail: `与单据 ${other.code} 的时段 ${periodText(other.startAt, other.endAt)} 重叠`
        });
      }
    }
  }

  if (order.status === "draft") {
    // R4/R5 触线复核（仅拦截发布；历史发布单按 R7 处理）
    if (order.touchesBound) {
      if (!order.review) {
        findings.push({
          rule: "R4",
          level: "block",
          orderIds: [],
          periodText: range,
          detail: "到手价恰好命中最高零售价或成本保护线，须站长复核后方可发布"
        });
      } else if (!order.review.reviewer.trim() || !order.review.basis.trim()) {
        findings.push({
          rule: "R5",
          level: "block",
          orderIds: [],
          periodText: range,
          detail: "站长复核人或复核依据未填写完整"
        });
      }
    }
  }

  if (order.status === "published") {
    // R7 限价调整后，冻结价格落在新走廊之外
    if (limit && !withinCorridor(order.finalPrice, limit)) {
      findings.push({
        rule: "R7",
        level: "warn",
        orderIds: [],
        periodText: range,
        detail: `发布价 ${order.finalPrice.toFixed(2)} 元已超出最新限价走廊 [${limit.costFloor.toFixed(
          2
        )}, ${limit.retail.toFixed(2)}]，需另立版本调整`
      });
    }
    // R6 价签未核验 → 会员侧不生效
    if (!order.tagVerify) {
      findings.push({
        rule: "R6",
        level: "warn",
        orderIds: [],
        periodText: range,
        detail: "价签尚未核验，该价格暂不对会员生效"
      });
    } else {
      // R8 价签价与到手价不一致
      if (Math.abs(order.tagVerify.tagPrice - order.finalPrice) > PRICE_EPS) {
        findings.push({
          rule: "R8",
          level: "block",
          orderIds: [],
          periodText: range,
          detail: `现场价签 ${order.tagVerify.tagPrice.toFixed(2)} 元与到手价 ${order.finalPrice.toFixed(
            2
          )} 元不一致，会员价暂缓生效`
        });
      }
    }
  }

  return findings;
}

export function allConflicts(orders: PriceOrder[], limits: PriceLimit[]): Conflict[] {
  const out: Conflict[] = [];
  for (const order of orders) {
    for (const f of findForOrder(order, { orders, limits })) {
      pushConflict(out, order, f);
    }
  }
  const rank = { block: 0, warn: 1 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.rule.localeCompare(b.rule));
}

/** 发布前硬门槛：阻断类冲突存在即不可发布 */
export function blockingConflicts(
  order: PriceOrder,
  orders: PriceOrder[],
  limits: PriceLimit[]
): Conflict[] {
  return findForOrder(order, { orders, limits })
    .filter((f) => f.level === "block")
    .map((f, i) => ({
      key: `${f.rule}-${order.id}-${i}`,
      level: "block" as const,
      rule: f.rule,
      ruleLabel: RULE_LABELS[f.rule],
      stationCode: order.stationCode,
      fuelCode: order.fuelCode,
      orderIds: [order.id, ...f.orderIds],
      periodText: f.periodText,
      detail: f.detail
    }));
}

// ---------- 会员生效 ----------

export interface MemberPriceRow {
  stationCode: string;
  fuelCode: string;
  order?: PriceOrder;
  active: boolean;
  reason: string;
}

/**
 * 会员价看板：取当前时段「已发布」单据中最新版本；
 * 未核验 / 核验价不符 / 走廊失效（R7）均不生效。
 */
export function memberBoard(orders: PriceOrder[], limits: PriceLimit[], at = Date.now()): MemberPriceRow[] {
  const rows: MemberPriceRow[] = [];
  for (const station of STATIONS) {
    for (const fuel of FUELS) {
      const hit = orders
        .filter(
          (o) =>
            o.stationCode === station.code &&
            o.fuelCode === fuel.code &&
            o.status === "published" &&
            Date.parse(o.startAt) <= at &&
            Date.parse(o.endAt) > at
        )
        .sort((a, b) => b.versionNo - a.versionNo || Date.parse(b.publishedAt ?? b.createdAt) - Date.parse(a.publishedAt ?? a.createdAt))[0];

      if (!hit) {
        rows.push({ stationCode: station.code, fuelCode: fuel.code, active: false, reason: "当前时段无已发布价格" });
        continue;
      }

      const limit = getLimit(limits, station.code, fuel.code);
      if (!hit.tagVerify) {
        rows.push({ stationCode: station.code, fuelCode: fuel.code, order: hit, active: false, reason: "价签未核验，未对会员生效" });
      } else if (Math.abs(hit.tagVerify.tagPrice - hit.finalPrice) > PRICE_EPS) {
        rows.push({ stationCode: station.code, fuelCode: fuel.code, order: hit, active: false, reason: "价签价与到手价不一致" });
      } else if (limit && !withinCorridor(hit.finalPrice, limit)) {
        rows.push({ stationCode: station.code, fuelCode: fuel.code, order: hit, active: false, reason: "发布价已超出最新限价走廊" });
      } else {
        rows.push({ stationCode: station.code, fuelCode: fuel.code, order: hit, active: true, reason: "会员价生效中" });
      }
    }
  }
  return rows;
}
