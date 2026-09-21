/* 领域逻辑 + store 冒烟测试：npx esbuild test/smoke.ts --bundle --platform=node --format=esm | node */
import { assert } from "node:console";
import { createPinia, setActivePinia } from "pinia";
import {
  calcFinalPrice,
  overlaps,
  allConflicts,
  blockingConflicts,
  lastRestorableVersion,
  memberBoard,
  touchesBoundaries,
  getLimit,
  RULE_LABELS
} from "../src/domain";
import { seedLimits, seedOrders } from "../src/seed";
import { usePriceStore } from "../src/store";
import type { OrderFormModel, PriceOrder } from "../src/types";

let passed = 0;
function ok(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`  ✓ ${name}`);
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`FAIL: ${name}\n  actual=${a}\n  expect=${e}`);
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---- localStorage / crypto polyfill ----
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k)
};

// ---- 价格计算 ----
console.log("calcFinalPrice");
eq("无优惠=挂牌价", calcFinalPrice(7.85, { type: "none", value: 0 }), 7.85);
eq("直降", calcFinalPrice(7.85, { type: "amount", value: 0.3 }), 7.55);
eq("折扣率四舍五入到分", calcFinalPrice(8.36, { type: "percent", value: 96 }), 8.03);
eq("指定到手价", calcFinalPrice(9.39, { type: "fixed", value: 8.28 }), 8.28);

// ---- 种子冲突 ----
console.log("seed conflicts");
const limits = seedLimits();
const seeds = seedOrders();
const conflicts = allConflicts(seeds, limits);
const rulesOf = (id: string) =>
  conflicts.filter((c) => c.orderIds[0] === id).map((c) => c.rule).sort();
eq("BJ002 98 发布触成本线已复核 → 仅 R6（未核验）", rulesOf("seed-order-4"), ["R6"]);
eq("BJ002 92 草稿触上限未复核 → R4", rulesOf("seed-order-5"), ["R4"]);
eq("TJ001 0 价签价不符 → R8", rulesOf("seed-order-6"), ["R8"]);
ok("BJ001 92 重叠草稿/发布单互报 R1", rulesOf("seed-order-7").includes("R1"));
ok("被重叠的发布单也命中 R1", rulesOf("seed-order-1").includes("R1"));
ok("已取代版本不产生冲突", !conflicts.some((c) => c.orderIds.includes("seed-order-2")));

// ---- 时段重叠 ----
console.log("overlaps");
const o1 = seeds[0];
ok("半开区间相接不算重叠", !overlaps({ startAt: "2026-10-01T00:00", endAt: "2026-10-02T00:00" } as PriceOrder, { ...o1, startAt: "2026-09-30T23:59", endAt: "2026-10-01T00:00" } as PriceOrder));
ok("真实重叠能识别", overlaps({ startAt: "2026-09-25T08:00", endAt: "2026-09-27T08:00" } as PriceOrder, o1));

// ---- 触线判定 ----
console.log("touchesBoundaries");
const lim = getLimit(limits, "BJ002", "98")!;
ok("命中成本保护线", touchesBoundaries(8.28, lim));
ok("走廊中间不触线", !touchesBoundaries(8.9, lim));

// ---- 会员看板（固定当前时刻 2026-09-21 12:00）----
console.log("memberBoard");
const at = Date.parse("2026-09-21T12:00");
const board = memberBoard(seeds, limits, at);
const cell = (s: string, f: string) => board.find((r) => r.stationCode === s && r.fuelCode === f)!;
ok("BJ001 92 已核验 → 生效", cell("BJ001", "92").active);
ok("BJ002 98 未核验 → 不生效", !cell("BJ002", "98").active);
ok("TJ001 0 价签不符 → 不生效", !cell("TJ001", "0").active);
eq("BJ001 95 取 V2 价格", cell("BJ001", "95").order?.finalPrice, 8.03);

// ---- Store 全流程 ----
console.log("store flow");
mem.clear();
setActivePinia(createPinia());
const store = usePriceStore();

// 1) 触线草稿发布被拦截
const bj002_92 = store.orders.find((o) => o.id === "seed-order-5")!;
let blockers = blockingConflicts(bj002_92, store.orders, store.limits);
ok("触线未复核：发布前存在阻断", blockers.some((c) => c.rule === "R4"));
let res = store.publish(bj002_92.id);
ok("publish 返回失败", !res.ok);
eq("状态仍是草稿", bj002_92.status, "draft");

// 2) 补复核后发布成功
store.submitReview(bj002_92.id, { reviewer: "站长-李建国", basis: "保供批复 2026-077" });
res = store.publish(bj002_92.id);
ok("复核后发布成功", res.ok);
eq("状态变已发布", bj002_92.status, "published");
ok("发布时间已记录", !!bj002_92.publishedAt);

// 3) 发布后冻结：不能编辑（saveDraft 抛错）
let threw = false;
try {
  store.saveDraft({
    id: bj002_92.id,
    stationCode: bj002_92.stationCode,
    fuelCode: bj002_92.fuelCode,
    startAt: bj002_92.startAt,
    endAt: bj002_92.endAt,
    basePrice: 7.5,
    discountType: "fixed",
    discountValue: 7.5,
    reason: "x",
    createdBy: "y"
  });
} catch {
  threw = true;
}
ok("已发布单不可直接编辑", threw);

// 4) 调整另立 V2（带原因），时段可与旧版相同（同链不互斥）
const v2form: OrderFormModel = {
  stationCode: bj002_92.stationCode,
  fuelCode: bj002_92.fuelCode,
  startAt: bj002_92.startAt,
  endAt: bj002_92.endAt,
  basePrice: 7.82,
  discountType: "amount",
  discountValue: 0.1,
  reason: "竞争加剧，增加会员让利",
  createdBy: "值班经理-孙涛",
  chainId: bj002_92.chainId,
  versionNo: 2,
  parentId: bj002_92.id
};
const v2 = store.saveDraft(v2form);
eq("新版本号=2", v2.versionNo, 2);
ok("V2 到手价在走廊内（7.72）", v2.finalPrice === 7.72);
const sameChainOverlap = blockingConflicts(v2, store.orders, store.limits);
ok("同链时段重叠不构成阻断", !sameChainOverlap.some((c) => c.rule === "R1"));
store.publish(v2.id);
eq("V1 自动变为已取代", bj002_92.status, "superseded");
eq("V2 已发布", v2.status, "published");

// 5) 撤销 V2 → 恢复 V1
store.revoke(v2.id);
eq("V2 已撤销", v2.status, "revoked");
eq("V1 恢复为已发布", bj002_92.status, "published");
ok("撤销时间已记录", !!v2.revokedAt);
const restored = lastRestorableVersion(store.orders, v2.chainId, v2.id);
// V1 已恢复（published），不再有 superseded 候选
ok("恢复后无其他可恢复版本", restored === undefined || restored.id !== v2.id);

// 6) 价签核验：未核验不生效 → 核验通过生效 → 价签不符不生效
const bj001_92 = store.orders.find((o) => o.id === "seed-order-1")!;
let row = memberBoard(store.orders, store.limits, at).find((r) => r.stationCode === "BJ001" && r.fuelCode === "92")!;
ok("已核验价格生效", row.active && row.order?.finalPrice === 7.55);

const bj002_98 = store.orders.find((o) => o.id === "seed-order-4")!;
row = memberBoard(store.orders, store.limits, at).find((r) => r.stationCode === "BJ002" && r.fuelCode === "98")!;
ok("未核验不生效", !row.active);
store.verifyTag(bj002_98.id, { verifier: "核验员-周敏", tagPrice: 8.28 });
row = memberBoard(store.orders, store.limits, at).find((r) => r.stationCode === "BJ002" && r.fuelCode === "98")!;
ok("核验通过后生效", row.active);
store.verifyTag(bj002_98.id, { verifier: "核验员-周敏", tagPrice: 8.5 });
row = memberBoard(store.orders, store.limits, at).find((r) => r.stationCode === "BJ002" && r.fuelCode === "98")!;
ok("价签不符不生效", !row.active);
ok("冲突台出现 R8", store.conflicts.some((c) => c.rule === "R8" && c.orderIds.includes(bj002_98.id)));

// 7) 限价变更：冻结价超出走廊 → R7 警告
store.updateLimit("BJ001", "92", 7.5, 7.0);
ok("限价下调后冻结价触发 R7", store.conflicts.some((c) => c.rule === "R7" && c.orderIds.includes(bj001_92.id)));
ok("R7 是警告而非阻断", store.conflicts.find((c) => c.rule === "R7" && c.orderIds.includes(bj001_92.id))?.level === "warn");
store.updateLimit("BJ001", "92", 7.85, 6.9);
ok("限价恢复后 R7 消失", !store.conflicts.some((c) => c.rule === "R7" && c.orderIds.includes(bj001_92.id)));

// 8) 越界草稿 R2/R3 阻断
const badForm: OrderFormModel = {
  stationCode: "TJ001",
  fuelCode: "92",
  startAt: "2026-10-10T00:00",
  endAt: "2026-10-11T00:00",
  basePrice: 7.79,
  discountType: "amount",
  discountValue: 2, // 5.79 < 6.85
  reason: "违规低价",
  createdBy: "测试员"
};
const bad = store.saveDraft(badForm);
ok("跌破成本线触发 R3", blockingConflicts(bad, store.orders, store.limits).some((c) => c.rule === "R3"));
ok("越界草稿发布失败", !store.publish(bad.id).ok);

// 9) 不同站点同时段不冲突
const otherStation: OrderFormModel = {
  ...badForm,
  stationCode: "BJ002",
  fuelCode: "92",
  discountValue: 0,
  discountType: "none"
};
const os = store.saveDraft(otherStation);
// BJ002 92 链上已有单（seed-order-5 现在 published 恢复中，时段 9/22-9/24），新单 10/10 不重叠；
// 但 7.82 恰好触上限 → 仅 R4，不应有 R1
ok("不同站点/不同链不产生 R1", !blockingConflicts(os, store.orders, store.limits).some((c) => c.rule === "R1"));

// ---- 重载持久化 ----
console.log("persistence");
const snapshot = mem.get("dfwlfront-9-price-console-v1")!;
const parsed = JSON.parse(snapshot);
ok("localStorage 含 orders/limits/seq", Array.isArray(parsed.orders) && Array.isArray(parsed.limits));
setActivePinia(createPinia());
const store2 = usePriceStore();
eq("重载后单据数量一致", store2.orders.length, store.orders.length);
const reloaded = store2.byId(bj002_92.id)!;
eq("重载后复核仍在", reloaded.review?.reviewer, "站长-李建国");
eq("重载后版本号保留", reloaded.versionNo, 1);
const reloadedChain = store2.orders.filter((o) => o.chainId === bj002_92.chainId).map((o) => [o.versionNo, o.status]);
ok("重载后版本链状态对应", JSON.stringify(reloadedChain) === JSON.stringify([[2, "revoked"], [1, "published"]]));
const verifyReloaded = store2.byId(bj002_98.id)!.tagVerify;
eq("重载后价签核验保留（价签不符）", verifyReloaded?.tagPrice, 8.5);

// 冲突列字段完整性
const sample = store2.conflicts[0];
ok("冲突含站点/油品/时段/规则字段", !!sample && "stationCode" in sample && "fuelCode" in sample && "periodText" in sample && "rule" in sample && "ruleLabel" in sample);
ok("R1~R8 规则名齐全", ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"].every((r) => !!RULE_LABELS[r]));

console.log(`\n全部通过：${passed} 项断言`);
void assert;
