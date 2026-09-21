import type { PriceLimit, PriceOrder } from "./types";
import { calcFinalPrice, round2 } from "./domain";

// 初始限价（站点 × 油品）
export function seedLimits(): PriceLimit[] {
  const table: Array<[string, string, number, number]> = [
    ["BJ001", "92", 7.85, 6.9],
    ["BJ001", "95", 8.36, 7.4],
    ["BJ001", "98", 9.42, 8.3],
    ["BJ001", "0", 7.28, 6.4],
    ["BJ002", "92", 7.82, 6.88],
    ["BJ002", "95", 8.33, 7.38],
    ["BJ002", "98", 9.39, 8.28],
    ["BJ002", "0", 7.25, 6.38],
    ["TJ001", "92", 7.79, 6.85],
    ["TJ001", "95", 8.30, 7.35],
    ["TJ001", "98", 9.36, 8.25],
    ["TJ001", "0", 7.22, 6.35]
  ];
  return table.map(([stationCode, fuelCode, retail, costFloor]) => ({
    stationCode,
    fuelCode,
    retail,
    costFloor,
    updatedAt: "2026-09-18T08:00"
  }));
}

interface SeedSpec {
  stationCode: string;
  fuelCode: string;
  startAt: string;
  endAt: string;
  basePrice: number;
  type: PriceOrder["discount"]["type"];
  value: number;
  status: PriceOrder["status"];
  reason: string;
  createdBy: string;
  publishedAt?: string;
  review?: { reviewer: string; basis: string; reviewedAt: string };
  tagVerify?: { verifier: string; tagPrice: number; verifiedAt: string };
}

const SPECS: SeedSpec[] = [
  {
    // 1. 正常生效：92 直降、已核验
    stationCode: "BJ001",
    fuelCode: "92",
    startAt: "2026-09-20T00:00",
    endAt: "2026-09-30T23:59",
    basePrice: 7.85,
    type: "amount",
    value: 0.3,
    status: "published",
    reason: "月度会员日常促销",
    createdBy: "王立群",
    publishedAt: "2026-09-19T16:20",
    tagVerify: { verifier: "核验员-周敏", tagPrice: 7.55, verifiedAt: "2026-09-19T17:05" }
  },
  {
    // 2. 版本链：V1 被 V2 取代
    stationCode: "BJ001",
    fuelCode: "95",
    startAt: "2026-09-20T00:00",
    endAt: "2026-09-25T23:59",
    basePrice: 8.36,
    type: "amount",
    value: 0.2,
    status: "superseded",
    reason: "会员周活动（已被新版本取代）",
    createdBy: "王立群",
    publishedAt: "2026-09-19T10:00",
    tagVerify: { verifier: "核验员-周敏", tagPrice: 8.16, verifiedAt: "2026-09-19T11:00" }
  },
  {
    // 3. 同链 V2 当前发布（折扣率）
    stationCode: "BJ001",
    fuelCode: "95",
    startAt: "2026-09-20T00:00",
    endAt: "2026-09-25T23:59",
    basePrice: 8.36,
    type: "percent",
    value: 96,
    status: "published",
    reason: "竞争站点让利，95 号会员折扣加深",
    createdBy: "王立群",
    publishedAt: "2026-09-20T09:10",
    tagVerify: { verifier: "核验员-周敏", tagPrice: 8.03, verifiedAt: "2026-09-20T09:40" }
  },
  {
    // 4. 触成本线：站长已复核、价签未核验（R6 警告）
    stationCode: "BJ002",
    fuelCode: "98",
    startAt: "2026-09-21T06:00",
    endAt: "2026-09-27T23:59",
    basePrice: 9.39,
    type: "fixed",
    value: 8.28,
    status: "published",
    reason: "开业周年庆锁价至成本保护线",
    createdBy: "李建国",
    publishedAt: "2026-09-20T15:00",
    review: {
      reviewer: "站长-李建国",
      basis: "周年庆活动批复文件 BJ2026-09-018，按成本价锁价 7 天，损耗由营销费用承担",
      reviewedAt: "2026-09-20T14:30"
    }
  },
  {
    // 5. 草稿：触最高零售价线、未复核（R4，不能发布）
    stationCode: "BJ002",
    fuelCode: "92",
    startAt: "2026-09-22T00:00",
    endAt: "2026-09-24T23:59",
    basePrice: 7.82,
    type: "none",
    value: 0,
    status: "draft",
    reason: "油品保供期间按最高零售价挂牌",
    createdBy: "值班经理-孙涛"
  },
  {
    // 6. 已发布但价签价不符（R8，会员不生效）
    stationCode: "TJ001",
    fuelCode: "0",
    startAt: "2026-09-20T00:00",
    endAt: "2026-09-26T23:59",
    basePrice: 7.22,
    type: "amount",
    value: 0.17,
    status: "published",
    reason: "柴油车队会员优惠",
    createdBy: "赵文海",
    publishedAt: "2026-09-19T18:00",
    tagVerify: { verifier: "核验员-吴磊", tagPrice: 7.1, verifiedAt: "2026-09-19T18:30" }
  },
  {
    // 7. 草稿：与 #1（BJ001 92）跨链时段重叠 → R1
    stationCode: "BJ001",
    fuelCode: "92",
    startAt: "2026-09-25T08:00",
    endAt: "2026-09-27T08:00",
    basePrice: 7.85,
    type: "amount",
    value: 0.45,
    status: "draft",
    reason: "周末限时加码（待处理时段冲突）",
    createdBy: "值班经理-孙涛"
  }
];

function makeCode(index: number): string {
  return `TJ-20260919-${String(index + 1).padStart(3, "0")}`;
}

export function seedOrders(): PriceOrder[] {
  const orders: PriceOrder[] = [];
  SPECS.forEach((spec, index) => {
    const discount = { type: spec.type, value: round2(spec.value) };
    const finalPrice = calcFinalPrice(spec.basePrice, discount);
    // 规格 2/3 构成同一条版本链
    let chainId: string;
    let versionNo: number;
    let parentId: string | undefined;
    if (index === 1 || index === 2) {
      chainId = "seed-chain-bj001-95";
      versionNo = index; // 1, 2
      if (index === 2) parentId = "seed-order-2";
    } else {
      chainId = `seed-chain-${index + 1}`;
      versionNo = 1;
    }

    const limit = seedLimits().find(
      (l) => l.stationCode === spec.stationCode && l.fuelCode === spec.fuelCode
    );
    const touchesBound = limit
      ? Math.abs(finalPrice - limit.retail) <= 0.009 || Math.abs(finalPrice - limit.costFloor) <= 0.009
      : false;

    orders.push({
      id: `seed-order-${index + 1}`,
      code: makeCode(index),
      stationCode: spec.stationCode,
      fuelCode: spec.fuelCode,
      startAt: spec.startAt,
      endAt: spec.endAt,
      basePrice: spec.basePrice,
      discount,
      finalPrice,
      status: spec.status,
      reason: spec.reason,
      createdBy: spec.createdBy,
      createdAt: spec.publishedAt ?? "2026-09-19T09:00",
      publishedAt: spec.publishedAt,
      chainId,
      versionNo,
      parentId,
      touchesBound,
      review: spec.review,
      tagVerify: spec.tagVerify
    });
  });
  return orders;
}
