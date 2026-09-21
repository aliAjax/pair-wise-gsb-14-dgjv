<script setup lang="ts">
import { computed, ref } from "vue";
import type { PriceOrder } from "./types";
import { usePriceStore } from "./store";
import OrderForm from "./components/OrderForm.vue";
import OrderList from "./components/OrderList.vue";
import ConflictPanel from "./components/ConflictPanel.vue";
import MemberBoard from "./components/MemberBoard.vue";
import LimitPanel from "./components/LimitPanel.vue";
import ReviewDialog from "./components/ReviewDialog.vue";
import VerifyDialog from "./components/VerifyDialog.vue";

const store = usePriceStore();

type Tab = "orders" | "board" | "conflicts" | "limits";
const tab = ref<Tab>("orders");

const tabs: { key: Tab; label: string }[] = [
  { key: "orders", label: "调价单" },
  { key: "board", label: "会员生效看板" },
  { key: "conflicts", label: "冲突与规则" },
  { key: "limits", label: "限价发布台" }
];

const draftCount = computed(() => store.orders.filter((o) => o.status === "draft").length);
const publishedCount = computed(() => store.orders.filter((o) => o.status === "published").length);
const activeCount = computed(() => store.board.filter((r) => r.active).length);
const blockCount = computed(() => store.conflicts.filter((c) => c.level === "block").length);

// 弹窗与表单上下文
const preset = ref<{ order: PriceOrder; mode: "edit" | "adjust" } | null>(null);
const reviewTarget = ref<PriceOrder | null>(null);
const verifyTarget = ref<PriceOrder | null>(null);
const formKey = ref(0);

function edit(o: PriceOrder) {
  preset.value = { order: o, mode: "edit" };
  formKey.value++;
}
function adjust(o: PriceOrder) {
  preset.value = { order: o, mode: "adjust" };
  formKey.value++;
  tab.value = "orders";
}
function formDone() {
  preset.value = null;
  formKey.value++;
}
function onReview(o: PriceOrder) {
  reviewTarget.value = o;
}
function onVerify(o: PriceOrder) {
  verifyTarget.value = o;
}
function submitReviewPayload(p: { reviewer: string; basis: string }) {
  if (reviewTarget.value) store.submitReview(reviewTarget.value.id, p);
  reviewTarget.value = null;
}
function submitVerifyPayload(p: { verifier: string; tagPrice: number }) {
  if (verifyTarget.value) store.verifyTag(verifyTarget.value.id, p);
  verifyTarget.value = null;
}
function reloadPage() {
  location.reload();
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 会员营销与价格管控</p>
          <h1>会员优惠与限价发布台</h1>
          <p class="subtitle">
            调价单按站点、油品、时段与优惠方式编排；同站同油品时段不得跨链重叠，到手价须落在最高零售价与成本保护线之间。
            触线须站长复核写依据，发布即冻结、调整另立版本、撤销恢复最近有效版本，价签未核验不对会员生效。
          </p>
        </div>
        <div class="top-actions">
          <button class="secondary" type="button" @click="reloadPage">重载页面验证持久化</button>
          <button class="secondary" type="button" @click="store.resetAll()">恢复演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article class="metric"><span>待发布草稿</span><strong>{{ draftCount }}</strong></article>
        <article class="metric"><span>已发布冻结</span><strong>{{ publishedCount }}</strong></article>
        <article class="metric"><span>会员价生效</span><strong>{{ activeCount }}</strong></article>
        <article class="metric" :class="{ alert: blockCount > 0 }">
          <span>阻断冲突</span><strong>{{ blockCount }}</strong>
        </article>
      </section>

      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          :class="{ active: tab === t.key }"
          @click="tab = t.key"
        >
          {{ t.label }}
          <i v-if="t.key === 'conflicts' && blockCount" class="tab-badge">{{ blockCount }}</i>
        </button>
      </nav>

      <OrderForm
        v-if="tab === 'orders'"
        :key="formKey"
        :preset="preset"
        @done="formDone"
        style="margin-bottom: 18px"
      />

      <div class="workspace" :class="{ single: tab !== 'orders' }">
        <OrderList
          v-if="tab === 'orders'"
          @review="onReview"
          @verify="onVerify"
          @edit="edit"
          @adjust="adjust"
        />
        <MemberBoard v-if="tab === 'board'" />
        <ConflictPanel v-if="tab === 'conflicts'" />
        <LimitPanel v-if="tab === 'limits'" />
      </div>
    </div>

    <div v-if="store.toast" class="toast">{{ store.toast }}</div>

    <ReviewDialog
      :order="reviewTarget"
      @close="reviewTarget = null"
      @submit="submitReviewPayload"
    />
    <VerifyDialog
      :order="verifyTarget"
      @close="verifyTarget = null"
      @submit="submitVerifyPayload"
    />
  </main>
</template>
