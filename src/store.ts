import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { Conflict, OrderFormModel, PriceLimit, PriceOrder, ReviewInfo, TagVerify } from "./types";
import {
  STORAGE_KEY,
  allConflicts,
  blockingConflicts,
  calcFinalPrice,
  getLimit,
  lastRestorableVersion,
  latestChainVersion,
  memberBoard,
  nowText,
  round2,
  touchesBoundaries,
  uid
} from "./domain";
import { seedLimits, seedOrders } from "./seed";

interface PersistShape {
  orders: PriceOrder[];
  limits: PriceLimit[];
  seq: number;
}

function load(): PersistShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PersistShape;
      if (Array.isArray(parsed.orders) && Array.isArray(parsed.limits)) {
        return { orders: parsed.orders, limits: parsed.limits, seq: parsed.seq ?? 100 };
      }
    } catch {
      // 数据损坏时回落到种子数据
    }
  }
  return { orders: seedOrders(), limits: seedLimits(), seq: 100 };
}

export interface PublishResult {
  ok: boolean;
  conflicts: Conflict[];
}

export const usePriceStore = defineStore("price-console", () => {
  const initial = load();
  const orders = ref<PriceOrder[]>(initial.orders);
  const limits = ref<PriceLimit[]>(initial.limits);
  const seq = ref(initial.seq);
  const toast = ref("");

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ orders: orders.value, limits: limits.value, seq: seq.value } satisfies PersistShape)
    );
  }

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function notify(msg: string) {
    toast.value = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ""), 3200);
  }

  // ---------- 查询 ----------

  const conflicts = computed<Conflict[]>(() => allConflicts(orders.value, limits.value));
  const board = computed(() => memberBoard(orders.value, limits.value));

  function byId(id: string): PriceOrder | undefined {
    return orders.value.find((o) => o.id === id);
  }

  function chainOrders(chainId: string): PriceOrder[] {
    return orders.value
      .filter((o) => o.chainId === chainId)
      .sort((a, b) => a.versionNo - b.versionNo);
  }

  // ---------- 单号 ----------

  function nextCode(): string {
    seq.value += 1;
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `TJ-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${String(seq.value).padStart(3, "0")}`;
  }

  // ---------- 草稿 / 版本 ----------

  /** 新建或更新草稿；调整已发布单时携带 chainId/versionNo/parentId 形成新版本 */
  function saveDraft(form: OrderFormModel): PriceOrder {
    const limit = getLimit(limits.value, form.stationCode, form.fuelCode);
    const discount = { type: form.discountType, value: round2(form.discountValue) };
    const finalPrice = calcFinalPrice(form.basePrice, discount);
    const touches = touchesBoundaries(finalPrice, limit);
    const base = {
      stationCode: form.stationCode,
      fuelCode: form.fuelCode,
      startAt: form.startAt,
      endAt: form.endAt,
      basePrice: round2(form.basePrice),
      discount,
      finalPrice,
      reason: form.reason.trim(),
      createdBy: form.createdBy.trim()
    };

    let saved: PriceOrder;
    if (form.id) {
      const idx = orders.value.findIndex((o) => o.id === form.id);
      if (idx < 0) throw new Error("草稿不存在");
      const existing = orders.value[idx];
      if (existing.status !== "draft") throw new Error("仅草稿可编辑");
      // 命中状态变化：不再触线时作废原复核；触线保留原复核
      saved = {
        ...existing,
        ...base,
        touchesBound: touches,
        review: touches ? existing.review : undefined
      };
      orders.value[idx] = saved;
    } else {
      const chainId = form.chainId ?? uid();
      const versionNo = form.versionNo ?? 1;
      saved = {
        id: uid(),
        code: nextCode(),
        ...base,
        status: "draft",
        createdAt: new Date().toISOString(),
        chainId,
        versionNo,
        parentId: form.parentId,
        touchesBound: touches
      };
      orders.value = [saved, ...orders.value];
    }
    persist();
    notify(saved.versionNo > 1 ? `V${saved.versionNo} 新版本草稿已保存（${saved.code}）` : `草稿已保存（${saved.code}）`);
    return saved;
  }

  function removeDraft(id: string) {
    const order = byId(id);
    if (!order || order.status !== "draft") return;
    orders.value = orders.value.filter((o) => o.id !== id);
    persist();
    notify("草稿已删除");
  }

  /** 站长复核（仅触线草稿需要） */
  function submitReview(id: string, review: Omit<ReviewInfo, "reviewedAt">) {
    const order = byId(id);
    if (!order || order.status !== "draft" || !order.touchesBound) return;
    order.review = { ...review, reviewer: review.reviewer.trim(), basis: review.basis.trim(), reviewedAt: nowText() };
    persist();
    notify("站长复核已记录，可尝试发布");
  }

  /** 发布：逐条跑阻断规则；通过则冻结并把同链已发布版本置为「已取代」 */
  function publish(id: string): PublishResult {
    const order = byId(id);
    if (!order) return { ok: false, conflicts: [] };
    if (order.status !== "draft") {
      return { ok: false, conflicts: [] };
    }
    const blockers = blockingConflicts(order, orders.value, limits.value);
    if (blockers.length > 0) {
      notify(`发布被 ${blockers.length} 条阻断规则拦截，请先处理`);
      return { ok: false, conflicts: blockers };
    }
    // 同链旧发布版本 → 已取代
    for (const o of orders.value) {
      if (o.chainId === order.chainId && o.status === "published") {
        o.status = "superseded";
      }
    }
    order.status = "published";
    order.publishedAt = new Date().toISOString();
    persist();
    notify(`已发布并冻结：${order.code}（V${order.versionNo}）`);
    return { ok: true, conflicts: [] };
  }

  /** 价签核验：未核验不得对会员生效；核验价与到手价不符同样不生效 */
  function verifyTag(id: string, verify: Omit<TagVerify, "verifiedAt">) {
    const order = byId(id);
    if (!order || (order.status !== "published" && order.status !== "draft")) return;
    order.tagVerify = {
      verifier: verify.verifier.trim(),
      tagPrice: round2(verify.tagPrice),
      verifiedAt: nowText()
    };
    persist();
    const matched = Math.abs(order.tagVerify.tagPrice - order.finalPrice) <= 0.009;
    notify(matched ? "价签核验通过，会员价生效" : "已记录核验：价签价与到手价不一致，会员价暂缓生效");
  }

  /**
   * 撤销已发布单：恢复同版本链上最近一个有效（曾发布）版本；
   * 撤销单保留为「已撤销」，可追溯。
   */
  function revoke(id: string) {
    const order = byId(id);
    if (!order || order.status !== "published") return;
    order.status = "revoked";
    order.revokedAt = nowText();
    const restore = lastRestorableVersion(orders.value, order.chainId, order.id);
    if (restore) {
      restore.status = "published";
      notify(`已撤销 ${order.code}，恢复最近有效版本 ${restore.code}（V${restore.versionNo}）`);
    } else {
      notify(`已撤销 ${order.code}，该版本链无更早有效版本`);
    }
    persist();
  }

  // ---------- 限价维护 ----------

  function updateLimit(stationCode: string, fuelCode: string, retail: number, costFloor: number) {
    const idx = limits.value.findIndex((l) => l.stationCode === stationCode && l.fuelCode === fuelCode);
    const next: PriceLimit = {
      stationCode,
      fuelCode,
      retail: round2(retail),
      costFloor: round2(costFloor),
      updatedAt: nowText()
    };
    if (idx >= 0) limits.value[idx] = next;
    else limits.value.push(next);
    // 限价走廊变化后，重算待发布草稿的触线标记；不再触线则作废原复核
    for (const o of orders.value) {
      if (o.status !== "draft" || o.stationCode !== stationCode || o.fuelCode !== fuelCode) continue;
      const touches = touchesBoundaries(o.finalPrice, next);
      o.touchesBound = touches;
      if (!touches) o.review = undefined;
    }
    persist();
    notify("限价已更新，冲突台将重新校验冻结价格");
  }

  function resetAll() {
    const seeded = { orders: seedOrders(), limits: seedLimits(), seq: 100 };
    orders.value = seeded.orders;
    limits.value = seeded.limits;
    seq.value = seeded.seq;
    persist();
    notify("已恢复演示数据");
  }

  return {
    orders,
    limits,
    toast,
    conflicts,
    board,
    persist,
    notify,
    byId,
    chainOrders,
    latestVersion: (chainId: string) => latestChainVersion(orders.value, chainId),
    saveDraft,
    removeDraft,
    submitReview,
    publish,
    verifyTag,
    revoke,
    updateLimit,
    resetAll
  };
});
