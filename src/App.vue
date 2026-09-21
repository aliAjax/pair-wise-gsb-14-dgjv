<script setup lang="ts">
import { computed, ref } from "vue";
import OrderForm from "./components/OrderForm.vue";
import OrderCard from "./components/OrderCard.vue";
import ConflictTable from "./components/ConflictTable.vue";
import { usePriceStore } from "./store";
import { FUELS, STATIONS } from "./seed";
import { buildDemoImports } from "./demoImport";
import type { PriceOrder } from "./types";

const store = usePriceStore();
const formRef = ref<InstanceType<typeof OrderForm> | null>(null);

const stationFilter = ref("ALL");
const fuelFilter = ref("ALL");
const statusFilter = ref("ALL");

const STATUS_FILTERS = [
  { value: "ALL", label: "全部状态" },
  { value: "pending", label: "待发布" },
  { value: "published", label: "已发布/生效中" },
  { value: "superseded", label: "历史版本" },
  { value: "revoked", label: "已撤销" },
];

const codeById = computed(() => {
  const map = new Map<string, string>();
  store.orders.forEach((o) => map.set(o.id, o.code));
  return map;
});

const filtered = computed(() =>
  store.orders
    .filter((o) => stationFilter.value === "ALL" || o.stationId === stationFilter.value)
    .filter((o) => fuelFilter.value === "ALL" || o.fuelId === fuelFilter.value)
    .filter((o) => statusFilter.value === "ALL" || o.status === statusFilter.value)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
);

const metrics = computed(() => {
  const orders = store.orders;
  return [
    { label: "调价单总数", value: orders.length },
    { label: "待发布", value: orders.filter((o) => o.status === "pending").length },
    {
      label: "会员优惠生效中",
      value: orders.filter(
        (o) => o.status === "published" && o.method !== "none" && store.memberActive(o)
      ).length,
    },
    { label: "拦截性冲突", value: store.conflicts.filter((c) => c.blockPublish).length },
  ];
});

const blockedPendingCount = computed(
  () =>
    store.orders.filter(
      (o) => o.status === "pending" && store.blockerIds.has(o.id)
    ).length
);

function adjust(order: PriceOrder) {
  formRef.value?.prefillFrom(order);
}

function doReload() {
  store.reload();
}

function doImport() {
  store.importExternal(buildDemoImports());
}

function doReset() {
  if (confirm("确认清空本地数据并恢复内置示例？")) {
    store.resetAll();
    store.reload();
  }
}

function fmtReload(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "";
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 会员营销价格闭环</p>
          <h1>会员优惠与限价发布台</h1>
          <p class="subtitle">
            调价单选择站点、油品、时段与优惠方式；同站同油品时段不得重叠，优惠后到手价须落在
            成本保护线与最高零售价之间。触线须站长复核写明依据，未复核不得发布；发布后价格冻结，
            调整另立带原因版本，撤销恢复最近有效版本；价签未核验会员优惠不生效。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Pinia</span>
          <span class="tag">TypeScript</span>
          <span class="tag">规则引擎</span>
          <span class="tag">版本链</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <p v-if="blockedPendingCount > 0" class="global-banner">
        ⛔ 当前有 {{ blockedPendingCount }} 张待发布调价单命中拦截规则，复核/整改前无法发布。
      </p>

      <section class="workspace">
        <OrderForm ref="formRef" />

        <section class="list-panel">
          <div class="toolbar">
            <h2>调价单与版本</h2>
            <div class="toolbar-controls">
              <select v-model="stationFilter">
                <option value="ALL">全部站点</option>
                <option v-for="s in STATIONS" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <select v-model="fuelFilter">
                <option value="ALL">全部油品</option>
                <option v-for="f in FUELS" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
              <select v-model="statusFilter">
                <option v-for="s in STATUS_FILTERS" :key="s.value" :value="s.value">
                  {{ s.label }}
                </option>
              </select>
            </div>
          </div>

          <div class="record-grid">
            <div v-if="filtered.length === 0" class="empty">暂无匹配调价单</div>
            <OrderCard
              v-for="order in filtered"
              :key="order.id"
              :order="order"
              :conflicts="store.conflicts"
              :based-on-code="order.basedOnId ? codeById.get(order.basedOnId) ?? '（缺失版本）' : null"
              @adjust="adjust"
            />
          </div>
        </section>
      </section>

      <section class="rules-area">
        <ConflictTable
          title="实时规则门禁（保存/发布前校验）"
          :conflicts="store.conflicts"
        />
      </section>

      <section class="reload-area">
        <div class="reload-bar">
          <div>
            <h3>持久化与重载校验</h3>
            <p v-if="store.reloadNotice">
              已于 {{ fmtReload(store.reloadNotice) }} 从本地存储重载，
              记录、价签核验与版本链已重新对应校验。
            </p>
            <p v-else>记录实时写入 localStorage；点击“模拟页面重载”可复现刷新后的全量校验。</p>
          </div>
          <div class="reload-actions">
            <button type="button" class="secondary" @click="doReload">模拟页面重载并校验</button>
            <button type="button" class="secondary" @click="doImport">
              导入含冲突的外部记录
            </button>
            <button type="button" class="danger ghost" @click="doReset">重置示例数据</button>
          </div>
        </div>

        <ConflictTable
          v-if="store.reloadConflicts.length > 0"
          title="重载后冲突清单（按站点、油品、时段、命中规则列出）"
          :conflicts="store.reloadConflicts"
        />
        <div v-else-if="store.reloadNotice" class="reload-ok">
          ✅ 重载后未发现冲突：记录、核验状态与版本对应关系一致。
        </div>
      </section>

      <footer class="footnote">
        <p>规则说明：</p>
        <ul>
          <li>时段按半开区间判定，首尾相接不视为重叠；版本链直接交接的新旧版本在新版本发布时原子替代。</li>
          <li>到手价 = 挂牌价经立减/折扣/固定会员价计算，必须位于 [成本保护线, 最高零售价]；触线（等于边界）须站长复核并写明依据。</li>
          <li>发布后单据冻结不可改；“调整·另立版本”会基于原单生成带原因的新版本；撤销发布沿版本链恢复最近有效版本。</li>
          <li>含会员优惠的单据发布后须完成价签核验，核验前价格对会员不生效（挂牌价无此限制）。</li>
        </ul>
      </footer>
    </div>
  </main>
</template>
