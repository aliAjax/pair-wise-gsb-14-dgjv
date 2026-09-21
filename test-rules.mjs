// 轻量运行时校验：esbuild 打包规则引擎后执行断言
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const outfile = "/workspace/.tmp-test-bundle.js";

await build({
  stdin: {
    contents: `export { calcFinalPrice, pricePosition, overlaps, scanConflicts } from "./src/rules.ts";`,
    resolveDir: "/workspace",
    sourcefile: "entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "silent",
});

const mod = await import(pathToFileURL(outfile).href);
const { calcFinalPrice, pricePosition, overlaps, scanConflicts } = mod;

let pass = 0;
function check(name, cond) {
  if (!cond) throw new Error("FAIL: " + name);
  pass++;
  console.log("  ✓ " + name);
}

// 1. 到手价计算
check("立减 7.85-0.35=7.50", calcFinalPrice(7.85, "perLiter", 0.35) === 7.5);
check("95折 8.32*0.95=7.90", calcFinalPrice(8.32, "percent", 95) === 7.9);
check("固定会员价 6.62", calcFinalPrice(7.58, "fixed", 6.62) === 6.62);
check("无优惠=挂牌价", calcFinalPrice(7.85, "none", 0) === 7.85);

// 2. 限价位置
check("等于上限=ceiling", pricePosition(7.85, 7.85, 6.9) === "ceiling");
check("等于下限=floor", pricePosition(6.9, 7.85, 6.9) === "floor");
check("区间内=ok", pricePosition(7.5, 7.85, 6.9) === "ok");
check("超上限=over", pricePosition(7.99, 7.52, 6.55) === "over");
check("破下限=under", pricePosition(6.4, 7.52, 6.55) === "under");

// 3. 时段重叠：半开区间，相接不重叠
check("重叠", overlaps("2026-09-21T08:00", "2026-09-22T22:00", "2026-09-22T08:00", "2026-09-23T00:00"));
check("首尾相接不重叠", !overlaps("2026-09-21T00:00", "2026-09-22T00:00", "2026-09-22T00:00", "2026-09-29T00:00"));

// 4. 冲突扫描
const ord = (p) => ({
  id: p.id, code: p.code ?? p.id, stationId: "S01", fuelId: "F92",
  startAt: "2026-09-21T00:00", endAt: "2026-09-28T00:00",
  listPrice: 7.85, method: "perLiter", discountValue: 0.35,
  finalPrice: 7.5, ceiling: 7.85, floor: 6.9,
  status: "pending", reason: "r", operator: "o", basedOnId: null, versionNo: 1,
  review: null, tagCheck: null, revokeReason: null,
  createdAt: new Date().toISOString(), publishedAt: null, origin: "manual",
  ...p,
});

// 触线未复核
let cs = scanConflicts([ord({ id: "t1", finalPrice: 7.85 })]);
check("触线未复核命中 TOUCH_UNREVIEWED", cs.some((c) => c.ruleId === "TOUCH_UNREVIEWED" && c.blockPublish));

// 触线已复核 -> 不再报
cs = scanConflicts([ord({ id: "t2", finalPrice: 7.85, review: { reviewer: "王站长", basis: "审批单123", at: "x" } })]);
check("触线已复核不再命中", !cs.some((c) => c.ruleId === "TOUCH_UNREVIEWED"));

// 已发布会员优惠未核验
cs = scanConflicts([ord({ id: "t3", status: "published", publishedAt: "x", finalPrice: 7.5 })]);
check("已发布未核验命中 TAG_UNVERIFIED(不拦截)", cs.some((c) => c.ruleId === "TAG_UNVERIFIED" && !c.blockPublish));

// 已发布且已核验 -> 干净
cs = scanConflicts([ord({ id: "t4", status: "published", publishedAt: "x", finalPrice: 7.5, tagCheck: { checker: "a", at: "x" } })]);
check("已核验无冲突", cs.length === 0);

// 无优惠挂牌价不要求核验
cs = scanConflicts([ord({ id: "t5", status: "published", publishedAt: "x", method: "none", discountValue: 0, finalPrice: 7.85, review: { reviewer: "站长", basis: "b", at: "x" } })]);
check("挂牌价无需价签核验", !cs.some((c) => c.ruleId === "TAG_UNVERIFIED"));

// 重叠（非版本链）
cs = scanConflicts([
  ord({ id: "a", code: "A", startAt: "2026-09-21T00:00", endAt: "2026-09-25T00:00" }),
  ord({ id: "b", code: "B", startAt: "2026-09-22T00:00", endAt: "2026-09-26T00:00" }),
]);
check("非链单据重叠命中 OVERLAP", cs.some((c) => c.ruleId === "OVERLAP" && c.blockPublish));

// 版本链交接（b.basedOnId=a）且时段重叠 -> 不算冲突
cs = scanConflicts([
  ord({ id: "a", code: "A", status: "published", startAt: "2026-09-21T00:00", endAt: "2026-09-28T00:00", finalPrice: 7.5, tagCheck: { checker: "a", at: "x" } }),
  ord({ id: "b", code: "B", basedOnId: "a", startAt: "2026-09-22T00:00", endAt: "2026-09-29T00:00" }),
]);
check("版本链交接不算重叠", !cs.some((c) => c.ruleId === "OVERLAP"));

// 已撤销单不占用时段
cs = scanConflicts([
  ord({ id: "a", code: "A", status: "revoked", startAt: "2026-09-21T00:00", endAt: "2026-09-25T00:00" }),
  ord({ id: "b", code: "B", startAt: "2026-09-22T00:00", endAt: "2026-09-26T00:00" }),
]);
check("已撤销单不参与重叠", !cs.some((c) => c.ruleId === "OVERLAP"));

// 越界
cs = scanConflicts([ord({ id: "x", finalPrice: 7.99, ceiling: 7.52, floor: 6.55 })]);
check("超上限命中 OVER_CEILING", cs.some((c) => c.ruleId === "OVER_CEILING"));
cs = scanConflicts([ord({ id: "x", finalPrice: 6.4, ceiling: 7.52, floor: 6.55 })]);
check("破下限命中 UNDER_FLOOR", cs.some((c) => c.ruleId === "UNDER_FLOOR"));

const { rmSync } = await import("node:fs");
rmSync(outfile, { force: true });
console.log(`\n全部 ${pass} 项规则断言通过 ✅`);
