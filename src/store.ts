// 会员优惠与限价发布台 —— 数据中枢（Pinia + localStorage）
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  ConflictItem,
  DiscountMethod,
  OrderDraft,
  PriceOrder,
} from "./types";
import { calcFinalPrice, pricePosition, scanConflicts } from "./rules";
import { getLimit, SEED_ORDERS } from "./seed";

const STORAGE_KEY = "member-price-console-v1";

interface StoredPayload {
  version: 1;
  orders: PriceOrder[];
  savedAt: string;
}

function loadFromStorage(): { orders: PriceOrder[]; restoredAt: string | null } {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { orders: structuredClone(SEED_ORDERS), restoredAt: null };
  try {
    const payload = JSON.parse(raw) as StoredPayload;
    if (!Array.isArray(payload.orders)) throw new Error("bad payload");
    return { orders: payload.orders, restoredAt: payload.savedAt ?? null };
  } catch {
    // 数据损坏时回退种子，避免白屏
    return { orders: structuredClone(SEED_ORDERS), restoredAt: null };
  }
}

let seq = 1;
function newId(): string {
  return `o-${Date.now().toString(36)}-${seq++}`;
}

function genCode(orders: PriceOrder[]): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const prefix = `TJ-${day}-`;
  const used = new Set(
    orders.filter((o) => o.code.startsWith(prefix)).map((o) => o.code)
  );
  for (let n = orders.length + 1; ; n++) {
    const code = `${prefix}${String(n).padStart(3, "0")}`;
    if (!used.has(code)) return code;
  }
}

export const usePriceStore = defineStore("price", () => {
  const initial = loadFromStorage();
  const orders = ref<PriceOrder[]>(initial.orders);
  const restoredAt = ref<string | null>(initial.restoredAt);
  /** 重载/导入后自动校验出的冲突（与实时冲突分开呈现，便于审计） */
  const reloadConflicts = ref<ConflictItem[]>([]);
  const reloadedOnce = ref(false);

  const conflicts = computed<ConflictItem[]>(() => scanConflicts(orders.value));
  const blockerIds = computed<Set<string>>(() => {
    const set = new Set<string>();
    for (const c of conflicts.value) {
      if (c.blockPublish) c.orderIds.forEach((id) => set.add(id));
    }
    return set;
  });

  function persist() {
    const payload: StoredPayload = {
      version: 1,
      orders: orders.value,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  /** 模拟重载：从 localStorage 重新读入并复跑全部一致性校验 */
  function reload() {
    const data = loadFromStorage();
    orders.value = data.orders;
    restoredAt.value = new Date().toISOString();
    reloadConflicts.value = scanConflicts(data.orders).concat(
      scanVersionChains(data.orders)
    );
    reloadedOnce.value = true;
  }

  /** 版本链完整性：basedOnId 指向必须存在 */
  function scanVersionChains(list: PriceOrder[]): ConflictItem[] {
    const byId = new Map(list.map((o) => [o.id, o]));
    const broken: ConflictItem[] = [];
    for (const o of list) {
      if (o.basedOnId && !byId.has(o.basedOnId)) {
        broken.push({
          key: `link-${o.id}`,
          ruleId: "BROKEN_LINK",
          ruleLabel: "版本链断裂",
          detail: `${o.code} 声明基于缺失版本（${o.basedOnId}），版本对应关系异常`,
          stationId: o.stationId,
          fuelId: o.fuelId,
          startAt: o.startAt,
          endAt: o.endAt,
          orderIds: [o.id],
          blockPublish: false,
        });
      }
    }
    return broken;
  }

  function nextVersionNo(stationId: string, fuelId: string): number {
    return (
      1 +
      Math.max(
        0,
        ...orders.value
          .filter((o) => o.stationId === stationId && o.fuelId === fuelId)
          .map((o) => o.versionNo)
      )
    );
  }

  function buildOrder(
    draft: OrderDraft,
    basedOn: PriceOrder | null
  ): PriceOrder | { error: string } {
    if (!draft.stationId || !draft.fuelId)
      return { error: "请选择站点与油品" };
    if (!draft.startAt || !draft.endAt) return { error: "请选择时段" };
    if (draft.startAt >= draft.endAt) return { error: "时段开始须早于结束" };
    if (draft.listPrice === null || draft.listPrice <= 0)
      return { error: "请输入挂牌价" };
    if (draft.method !== "none" && (draft.discountValue === null || draft.discountValue < 0))
      return { error: "请填写优惠数值" };
    if (!draft.reason.trim()) return { error: "请填写调价/优惠原因" };
    if (!draft.operator.trim()) return { error: "请填写操作员" };

    const limit = getLimit(draft.stationId, draft.fuelId);
    if (!limit) return { error: "该站点/油品未配置限价" };

    const finalPrice = calcFinalPrice(
      draft.listPrice,
      draft.method,
      draft.discountValue ?? 0
    );
    const position = pricePosition(finalPrice, limit.ceiling, limit.floor);
    if (position === "over")
      return {
        error: `优惠后到手价 ${finalPrice.toFixed(
          2
        )} 高于最高零售价 ${limit.ceiling.toFixed(2)}，无法保存`,
      };
    if (position === "under")
      return {
        error: `优惠后到手价 ${finalPrice.toFixed(
          2
        )} 低于成本保护线 ${limit.floor.toFixed(2)}，无法保存`,
      };

    const stationFuelOrders = orders.value.filter(
      (o) =>
        (o.status === "pending" || o.status === "published") &&
        o.stationId === draft.stationId &&
        o.fuelId === draft.fuelId &&
        !(basedOn && o.id === basedOn.id)
    );
    const clash = stationFuelOrders.find(
      (o) => draft.startAt < o.endAt && o.startAt < draft.endAt
    );
    if (clash)
      return {
        error: `与同站同油品调价单 ${clash.code} 时段重叠（${clash.startAt.replace(
          "T",
          " "
        )} ~ ${clash.endAt.replace("T", " ")}）`,
      };

    return {
      id: newId(),
      code: genCode(orders.value),
      stationId: draft.stationId,
      fuelId: draft.fuelId,
      startAt: draft.startAt,
      endAt: draft.endAt,
      listPrice: draft.listPrice,
      method: draft.method,
      discountValue: draft.method === "none" ? 0 : draft.discountValue ?? 0,
      finalPrice,
      ceiling: limit.ceiling,
      floor: limit.floor,
      status: "pending",
      reason: draft.reason.trim(),
      operator: draft.operator.trim(),
      basedOnId: basedOn?.id ?? null,
      versionNo: nextVersionNo(draft.stationId, draft.fuelId),
      review: null,
      tagCheck: null,
      revokeReason: null,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      origin: "manual",
    };
  }

  /** 新建调价单；basedOn 非空表示“另立带原因版本” */
  function createOrder(draft: OrderDraft, basedOn: PriceOrder | null = null) {
    const built = buildOrder(draft, basedOn);
    if ("error" in built) return { ok: false as const, error: built.error };
    orders.value = [built, ...orders.value];
    persist();
    return { ok: true as const, id: built.id };
  }

  /** 站长复核（仅触线单需要） */
  function review(
    id: string,
    reviewer: string,
    basis: string
  ): { ok: boolean; error?: string } {
    const order = orders.value.find((o) => o.id === id);
    if (!order) return { ok: false, error: "单据不存在" };
    const position = pricePosition(order.finalPrice, order.ceiling, order.floor);
    if (position !== "ceiling" && position !== "floor")
      return { ok: false, error: "仅触及限价线的单据需要复核" };
    if (!reviewer.trim()) return { ok: false, error: "请填写复核站长" };
    if (!basis.trim()) return { ok: false, error: "请写明复核依据" };
    order.review = { reviewer: reviewer.trim(), basis: basis.trim(), at: new Date().toISOString() };
    persist();
    return { ok: true };
  }

  /**
   * 发布门禁：
   * 1) 到手价在 [成本线, 最高零售价] 内（保存时已保证，发布前再由全量扫描兜底）
   * 2) 触线须有站长复核+依据
   * 3) 同站同油品时段不得重叠
   * 全部通过后才发布；新版本发布时原子替代其来源版本。
   * 价签未核验不拦截发布，但会员优惠在核验前不对会员生效。
   */
  function publish(id: string): { ok: boolean; error?: string } {
    const order = orders.value.find((o) => o.id === id);
    if (!order) return { ok: false, error: "单据不存在" };
    if (order.status !== "pending")
      return { ok: false, error: "仅待发布单据可发布" };

    const trial = orders.value.map((o) =>
      o.id === order.id ? { ...o, status: "published" as const } : o
    );
    if (order.basedOnId) {
      const src = trial.find((o) => o.id === order.basedOnId);
      if (src && src.status === "published") src.status = "superseded";
    }
    const blocking = scanConflicts(trial).filter((c) => c.blockPublish);
    if (blocking.length > 0) {
      const mine = blocking.find((c) => c.orderIds.includes(order.id));
      return {
        ok: false,
        error: mine
          ? `发布被拦截：${mine.ruleLabel} —— ${mine.detail}`
          : `发布被拦截：${blocking[0].ruleLabel} —— ${blocking[0].detail}`,
      };
    }

    if (order.basedOnId) {
      const src = orders.value.find((o) => o.id === order.basedOnId);
      if (src && src.status === "published") src.status = "superseded";
    }
    order.status = "published";
    order.publishedAt = new Date().toISOString();
    persist();
    return { ok: true };
  }

  /** 价签核验：仅已发布且含会员优惠的单据需要 */
  function verifyTag(id: string, checker: string): { ok: boolean; error?: string } {
    const order = orders.value.find((o) => o.id === id);
    if (!order) return { ok: false, error: "单据不存在" };
    if (order.status !== "published")
      return { ok: false, error: "仅已发布单据可核验价签" };
    if (order.method === "none")
      return { ok: false, error: "无会员优惠的挂牌价无需价签核验" };
    if (!checker.trim()) return { ok: false, error: "请填写核验人" };
    order.tagCheck = { checker: checker.trim(), at: new Date().toISOString() };
    persist();
    return { ok: true };
  }

  /**
   * 撤销已发布单据：恢复最近有效版本（沿版本链回溯，
   * 找到最近的 superseded 版本恢复为已发布），须填写撤销原因。
   */
  function revoke(id: string, reason: string): { ok: boolean; error?: string } {
    const order = orders.value.find((o) => o.id === id);
    if (!order) return { ok: false, error: "单据不存在" };
    if (order.status !== "published")
      return { ok: false, error: "仅已发布单据可撤销" };
    if (!reason.trim()) return { ok: false, error: "请填写撤销原因" };

    order.status = "revoked";
    order.revokeReason = reason.trim();

    // 沿版本链回溯最近有效版本
    let predecessorId = order.basedOnId;
    while (predecessorId) {
      const prev = orders.value.find((o) => o.id === predecessorId);
      if (!prev) break;
      if (prev.status === "superseded") {
        prev.status = "published";
        break;
      }
      if (prev.status === "revoked") {
        predecessorId = prev.basedOnId;
        continue;
      }
      break;
    }
    persist();
    return { ok: true };
  }

  /** 删除待发布草稿（已发布/历史版本只能撤销，不能删除） */
  function removeDraft(id: string): { ok: boolean; error?: string } {
    const order = orders.value.find((o) => o.id === id);
    if (!order) return { ok: false, error: "单据不存在" };
    if (order.status !== "pending")
      return { ok: false, error: "仅待发布草稿可删除" };
    orders.value = orders.value.filter((o) => o.id !== id);
    persist();
    return { ok: true };
  }

  /** 导入外部记录（演示重载后校验）：逐条编号，保留原始冲突 */
  function importExternal(rawList: PriceOrder[]) {
    const stamped = rawList.map((o) => ({
      ...o,
      id: newId(),
      origin: "import" as const,
      review: o.review ?? null,
      tagCheck: o.tagCheck ?? null,
    }));
    orders.value = [...stamped, ...orders.value];
    persist();
    reload();
  }

  function resetAll() {
    orders.value = structuredClone(SEED_ORDERS);
    reloadConflicts.value = [];
    persist();
  }

  /** 会员优惠当前是否真实对会员生效 */
  function memberActive(order: PriceOrder): boolean {
    if (order.status !== "published") return false;
    if (order.method === "none") return true; // 挂牌价不依赖价签核验
    return !!order.tagCheck;
  }

  return {
    orders,
    conflicts,
    blockerIds,
    reloadConflicts,
    restoredAt,
    reloadNotice: computed(() => (reloadedOnce.value ? restoredAt.value : null)),
    persist,
    reload,
    createOrder,
    review,
    publish,
    verifyTag,
    revoke,
    removeDraft,
    importExternal,
    resetAll,
    memberActive,
  };
});
