// store 业务流断言：复核门禁、发布冻结、另立版本、撤销恢复、重载校验
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { rmSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// 每个场景用独立 storage 目录的 localStorage 存根
function makeEnv() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

const tmpdir = mkdtempSync(path.join(os.tmpdir(), "price-test-"));
const outfile = path.join(tmpdir, "store-bundle.js");

await build({
  stdin: {
    contents: `
export { usePriceStore } from "./src/store.ts";
export { calcFinalPrice } from "./src/rules.ts";
export { createPinia, setActivePinia } from "pinia";
`,
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
const { usePriceStore, calcFinalPrice, createPinia, setActivePinia } = mod;

let pass = 0;
function check(name, cond) {
  if (!cond) throw new Error("FAIL: " + name);
  pass++;
  console.log("  ✓ " + name);
}

const t = (h) => `2026-10-01T${h}`;
const draft = (p = {}) => ({
  stationId: "S01",
  fuelId: "F95",
  startAt: t("08:00"),
  endAt: t("20:00"),
  listPrice: 8.0,
  method: "perLiter",
  discountValue: 0.2,
  reason: "会员日",
  operator: "测试员",
  ...p,
});

function freshStore() {
  setActivePinia(createPinia());
  const s = usePriceStore();
  // 清掉种子，从零开始
  s.orders.splice(0, s.orders.length);
  return s;
}

// --- 场景 1：保存校验 ---
makeEnv();
let s = freshStore();
let r = s.createOrder(draft({ listPrice: 9 })); // 9 - 0.2 = 8.8 > 8.35 上限
check("到手价超上限禁止保存", !r.ok && r.error.includes("最高零售价"));

r = s.createOrder(draft({ discountValue: 2 })); // 8.0-2=6.0 < 7.3 成本线
check("到手价破成本线禁止保存", !r.ok && r.error.includes("成本保护线"));

r = s.createOrder(draft({ startAt: t("09:00"), endAt: t("08:00") }));
check("起止倒置禁止保存", !r.ok && r.error.includes("早于结束"));

r = s.createOrder(draft({ reason: "  " }));
check("缺原因禁止保存", !r.ok);

r = s.createOrder(draft());
check("正常单据保存成功", r.ok);
const id1 = r.id;
const o1 = s.orders.find((x) => x.id === id1);
check("到手价快照 7.80", o1.finalPrice === 7.8);
check("初始为待发布", o1.status === "pending");
check("版本号 v1", o1.versionNo === 1);

// 重叠
r = s.createOrder(
  draft({ startAt: t("09:00"), endAt: t("10:00"), discountValue: 0.1 })
);
check("同站同油品时段重叠禁止保存", !r.ok && r.error.includes("时段重叠"));
// 首尾相接允许
r = s.createOrder(
  draft({ startAt: t("20:00"), endAt: t("22:00"), discountValue: 0.1 })
);
check("首尾相接允许保存", r.ok);
s.removeDraft(r.id);

// --- 场景 2：触线 → 未复核拦截 → 复核 → 发布 ---
r = s.createOrder(draft({ fuelId: "F92", method: "none", discountValue: 0, listPrice: 7.85 }));
check("触线单(等于上限)可保存为待发布", r.ok);
const idTouch = r.id;
r = s.publish(idTouch);
check("触线未复核不得发布", !r.ok && r.error.includes("触线"));
r = s.review(idTouch, "", "依据");
check("复核缺站长姓名被拒", !r.ok);
r = s.review(idTouch, "王站长", "   ");
check("复核缺依据被拒", !r.ok);
r = s.review(idTouch, "王站长", "指导价文件 京价[2026]42 号");
check("站长复核成功", r.ok);
r = s.publish(idTouch);
check("复核后发布成功", r.ok);
check("发布时间已记录", !!s.orders.find((x) => x.id === idTouch).publishedAt);

// 发布后不可重复发布/删除
r = s.publish(idTouch);
check("已发布不能再次发布", !r.ok);
r = s.removeDraft(idTouch);
check("已发布不能删除，只能撤销", !r.ok);

// --- 场景 3：会员单发布后价签门控 ---
r = s.publish(id1);
check("普通会员单可直接发布（价签不拦截发布）", r.ok);
const pub = s.orders.find((x) => x.id === id1);
check("未核验时会员优惠不生效", s.memberActive(pub) === false);
check("未核验命中 TAG_UNVERIFIED", s.conflicts.some((c) => c.ruleId === "TAG_UNVERIFIED" && c.orderIds.includes(id1)));
r = s.verifyTag(id1, "");
check("核验缺人被拒", !r.ok);
r = s.verifyTag(id1, "核验员孙丽");
check("价签核验成功", r.ok);
check("核验后会员优惠生效", s.memberActive(pub) === true);
check("核验后冲突清除", !s.conflicts.some((c) => c.orderIds.includes(id1)));

// --- 场景 4：另立版本、发布替代、撤销恢复 ---
const basedOn = s.orders.find((x) => x.id === id1);
const newDraft = draft({
  startAt: basedOn.endAt,
  endAt: t("23:00"),
  discountValue: 0.5,
});
r = s.createOrder(newDraft, basedOn);
check("另立版本保存成功", r.ok);
const id2 = r.id;
const v2 = s.orders.find((x) => x.id === id2);
check("新版本号 v2 且 basedOnId 指向旧版", v2.versionNo === basedOn.versionNo + 1 && v2.basedOnId === id1);
check("新版本到手价 7.50", v2.finalPrice === 7.5);
check("新版本发布前旧版仍生效", s.orders.find((x) => x.id === id1).status === "published");

r = s.publish(id2);
check("新版本发布成功", r.ok);
check("发布后旧版本被替代(superseded)", s.orders.find((x) => x.id === id1).status === "superseded");
check("新版本为已发布", s.orders.find((x) => x.id === id2).status === "published");
check("版本链交接期间无重叠冲突", !s.conflicts.some((c) => c.ruleId === "OVERLAP"));

r = s.revoke(id2, "");
check("撤销缺原因被拒", !r.ok);
r = s.revoke(id2, "活动提前结束");
check("撤销成功", r.ok);
check("撤销单状态 revoked", s.orders.find((x) => x.id === id2).status === "revoked");
check("撤销后恢复最近有效版本为 published", s.orders.find((x) => x.id === id1).status === "published");
check("恢复后旧版会员仍生效（核验记录保留）", s.memberActive(s.orders.find((x) => x.id === id1)) === true);

// --- 场景 5：持久化 + 重载一致性 ---
s.reload();
check("重载后记录数一致", s.orders.length === 3);
check("重载后核验状态保留", s.orders.find((x) => x.id === id1).tagCheck !== null);
check("重载后复核状态保留", s.orders.find((x) => x.id === idTouch).review !== null);
check("重载后版本链对应无断裂", !s.reloadConflicts.some((c) => c.ruleId === "BROKEN_LINK"));
check("干净数据重载无冲突", s.reloadConflicts.length === 0);

// 破坏存储后再重载：版本链断裂可被列出
const raw = JSON.parse(globalThis.localStorage.getItem("member-price-console-v1"));
const victim = raw.orders.find((o) => o.basedOnId);
victim.basedOnId = "missing-id";
globalThis.localStorage.setItem("member-price-console-v1", JSON.stringify(raw));
s.reload();
check("版本链断裂在重载后被列出", s.reloadConflicts.some((c) => c.ruleId === "BROKEN_LINK"));
const broken = s.reloadConflicts.find((c) => c.ruleId === "BROKEN_LINK");
check("断裂冲突含站点/油品/时段", !!broken.stationId && !!broken.fuelId && !!broken.startAt && !!broken.endAt);

rmSync(outfile, { force: true });
console.log(`\n全部 ${pass} 项业务流断言通过 ✅`);
