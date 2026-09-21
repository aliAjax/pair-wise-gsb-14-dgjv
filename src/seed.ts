// 种子数据：站点、油品、限价与初始调价单
import type { Fuel, PriceLimit, PriceOrder, Station } from "./types";

export const STATIONS: Station[] = [
  { id: "S01", name: "城东加油站", manager: "王站长" },
  { id: "S02", name: "滨江加油站", manager: "李站长" },
  { id: "S03", name: "高新园区加油站", manager: "赵站长" },
];

export const FUELS: Fuel[] = [
  { id: "F92", name: "92号汽油" },
  { id: "F95", name: "95号汽油" },
  { id: "F98", name: "98号汽油" },
  { id: "F0", name: "0号柴油" },
];

/** 按 站点+油品 维度维护的限价 */
export const LIMITS: Record<string, PriceLimit> = {
  "S01/F92": { ceiling: 7.85, floor: 6.9 },
  "S01/F95": { ceiling: 8.35, floor: 7.3 },
  "S01/F98": { ceiling: 9.4, floor: 8.2 },
  "S01/F0": { ceiling: 7.55, floor: 6.6 },
  "S02/F92": { ceiling: 7.83, floor: 6.85 },
  "S02/F95": { ceiling: 8.32, floor: 7.25 },
  "S02/F98": { ceiling: 9.35, floor: 8.15 },
  "S02/F0": { ceiling: 7.52, floor: 6.55 },
  "S03/F92": { ceiling: 7.88, floor: 6.95 },
  "S03/F95": { ceiling: 8.4, floor: 7.35 },
  "S03/F98": { ceiling: 9.45, floor: 8.25 },
  "S03/F0": { ceiling: 7.58, floor: 6.62 },
};

export function limitKey(stationId: string, fuelId: string): string {
  return `${stationId}/${fuelId}`;
}

export function getLimit(stationId: string, fuelId: string): PriceLimit | null {
  return LIMITS[limitKey(stationId, fuelId)] ?? null;
}

export function stationName(id: string): string {
  return STATIONS.find((s) => s.id === id)?.name ?? id;
}

export function fuelName(id: string): string {
  return FUELS.find((f) => f.id === id)?.name ?? id;
}

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const dt = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
};

// 用固定基准日构造时段，保证示例时段合理
const base = new Date();
base.setMinutes(0, 0, 0);
const at = (dayOffset: number, hour: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return dt(d);
};

export const SEED_ORDERS: PriceOrder[] = [
  {
    id: "seed-1",
    code: "TJ-20260915-001",
    stationId: "S01",
    fuelId: "F92",
    startAt: at(-7, 0),
    endAt: at(0, 0),
    listPrice: 7.85,
    method: "none",
    discountValue: 0,
    finalPrice: 7.85,
    ceiling: 7.85,
    floor: 6.9,
    status: "superseded",
    reason: "上一周期挂牌价（已被会员优惠版本替代）",
    operator: "值班经理 周宁",
    basedOnId: null,
    versionNo: 1,
    review: { reviewer: "王站长", basis: "挂牌价等于最高零售价，按周例行复核", at: iso(-86400000 * 8) },
    tagCheck: { checker: "周宁", at: iso(-86400000 * 7) },
    revokeReason: null,
    createdAt: iso(-86400000 * 8),
    publishedAt: iso(-86400000 * 7),
    origin: "manual",
  },
  {
    id: "seed-2",
    code: "TJ-20260921-002",
    stationId: "S01",
    fuelId: "F92",
    startAt: at(0, 0),
    endAt: at(7, 0),
    listPrice: 7.85,
    method: "perLiter",
    discountValue: 0.35,
    finalPrice: 7.5,
    ceiling: 7.85,
    floor: 6.9,
    status: "published",
    reason: "会员日每升立减，提升会员复购",
    operator: "值班经理 周宁",
    basedOnId: "seed-1",
    versionNo: 2,
    review: null,
    tagCheck: { checker: "孙丽", at: iso(-3600000) },
    revokeReason: null,
    createdAt: iso(-86400000),
    publishedAt: iso(-3600000),
    origin: "manual",
  },
  {
    id: "seed-3",
    code: "TJ-20260921-003",
    stationId: "S02",
    fuelId: "F95",
    startAt: at(0, 8),
    endAt: at(2, 22),
    listPrice: 8.32,
    method: "percent",
    discountValue: 95,
    finalPrice: 7.9,
    ceiling: 8.32,
    floor: 7.25,
    status: "published",
    reason: "周末会员 95 折活动",
    operator: "值班经理 陈晨",
    basedOnId: null,
    versionNo: 1,
    review: null,
    tagCheck: null, // 价签未核验：会员优惠暂不生效
    revokeReason: null,
    createdAt: iso(-2 * 86400000),
    publishedAt: iso(-2 * 3600000),
    origin: "manual",
  },
  {
    id: "seed-4",
    code: "TJ-20260921-004",
    stationId: "S03",
    fuelId: "F0",
    startAt: at(1, 0),
    endAt: at(3, 0),
    listPrice: 7.58,
    method: "fixed",
    discountValue: 6.62,
    finalPrice: 6.62,
    ceiling: 7.58,
    floor: 6.62,
    status: "pending",
    reason: "物流车队会员固定价（等于成本保护线，待站长复核）",
    operator: "值班经理 何伟",
    basedOnId: null,
    versionNo: 1,
    review: null, // 触线但未复核：不得发布
    tagCheck: null,
    revokeReason: null,
    createdAt: iso(-3600000),
    publishedAt: null,
    origin: "manual",
  },
];
