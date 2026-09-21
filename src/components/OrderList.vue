<script setup lang="ts">
import { computed, ref } from "vue";
import type { PriceOrder } from "../types";
import { DISCOUNT_OPTIONS, STATIONS, fuelName, periodText, stationName } from "../domain";
import { usePriceStore } from "../store";

const store = usePriceStore();

const stationFilter = ref("ALL");
const statusFilter = ref("ALL");

const STATUS_LABEL: Record<PriceOrder["status"], { text: string; cls: string }> = {
  draft: { text: "待发布", cls: "st-draft" },
  published: { text: "已发布冻结", cls: "st-published" },
  superseded: { text: "已被取代", cls: "st-superseded" },
  revoked: { text: "已撤销", cls: "st-revoked" }
};

const filtered = computed(() =>
  [...store.orders]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .filter((o) => stationFilter.value === "ALL" || o.stationCode === stationFilter.value)
    .filter((o) => statusFilter.value === "ALL" || o.status === statusFilter.value)
);

function discountText(o: PriceOrder): string {
  const label = DISCOUNT_OPTIONS.find((d) => d.value === o.discount.type)?.label ?? "";
  if (o.discount.type === "none") return label;
  if (o.discount.type === "amount") return `${label} ${o.discount.value.toFixed(2)} 元/升`;
  if (o.discount.type === "percent") return `${label} ${o.discount.value} 折`;
  return `${label} ${o.discount.value.toFixed(2)} 元/升`;
}

function orderConflicts(o: PriceOrder) {
  return store.conflicts.filter((c) => c.orderIds.includes(o.id));
}

function blockers(o: PriceOrder) {
  return orderConflicts(o).filter((c) => c.level === "block");
}

const emit = defineEmits<{
  (e: "review", order: PriceOrder): void;
  (e: "verify", order: PriceOrder): void;
  (e: "edit", order: PriceOrder): void;
  (e: "adjust", order: PriceOrder): void;
}>();

function chainText(o: PriceOrder): string {
  return `V${o.versionNo}`;
}
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>调价单（{{ filtered.length }}）</h2>
      <div class="filters">
        <select v-model="stationFilter">
          <option value="ALL">全部站点</option>
          <option v-for="s in STATIONS" :key="s.code" :value="s.code">{{ s.name }}</option>
        </select>
        <select v-model="statusFilter">
          <option value="ALL">全部状态</option>
          <option value="draft">待发布</option>
          <option value="published">已发布冻结</option>
          <option value="superseded">已被取代</option>
          <option value="revoked">已撤销</option>
        </select>
      </div>
    </div>

    <div class="record-grid">
      <div v-if="filtered.length === 0" class="empty">暂无匹配调价单</div>

      <article v-for="o in filtered" :key="o.id" class="record" :class="`is-${o.status}`">
        <div class="record-head">
          <div>
            <p class="record-title">
              {{ stationName(o.stationCode) }} · {{ fuelName(o.fuelCode) }}
              <span class="ver-tag">{{ chainText(o) }}</span>
            </p>
            <p class="record-code">{{ o.code }}</p>
          </div>
          <span class="status" :class="STATUS_LABEL[o.status].cls">{{ STATUS_LABEL[o.status].text }}</span>
        </div>

        <div class="details">
          <span class="span-2"><b>时段</b>：{{ periodText(o.startAt, o.endAt) }}</span>
          <span><b>挂牌价</b>：{{ o.basePrice.toFixed(2) }} 元</span>
          <span><b>优惠</b>：{{ discountText(o) }}</span>
          <span><b>到手价</b>：<em class="final-price">{{ o.finalPrice.toFixed(2) }}</em> 元/升</span>
          <span><b>制单人</b>：{{ o.createdBy }}</span>
        </div>

        <p class="reason-text"><b>原因</b>：{{ o.reason || "—" }}</p>

        <div class="audit-row">
          <span v-if="o.touchesBound" class="chip chip-bound" :class="{ done: o.review }">
            {{ o.review ? "✓ 站长已复核" : "⚠ 触线待站长复核" }}
          </span>
          <span v-if="o.status === 'published' || o.tagVerify" class="chip" :class="o.tagVerify
            ? Math.abs(o.tagVerify.tagPrice - o.finalPrice) <= 0.009
              ? 'chip-ok'
              : 'chip-bad'
            : 'chip-wait'">
            <template v-if="!o.tagVerify">价签未核验（不对会员生效）</template>
            <template v-else>
              {{ Math.abs(o.tagVerify.tagPrice - o.finalPrice) <= 0.009 ? "✓ 价签已核验" : "⚠ 价签价不符" }}
              · {{ o.tagVerify.verifier }}
            </template>
          </span>
          <span v-if="o.publishedAt" class="chip chip-time">发布于 {{ o.publishedAt.replace("T", " ").slice(0, 16) }}</span>
          <span v-if="o.revokedAt" class="chip chip-time">撤销于 {{ o.revokedAt }}</span>
        </div>

        <ul v-if="orderConflicts(o).length" class="conflict-mini">
          <li v-for="c in orderConflicts(o)" :key="c.key" :class="c.level">
            <b>[{{ c.rule }} {{ c.ruleLabel }}]</b> {{ c.detail }}
          </li>
        </ul>

        <div class="review-box" v-if="o.review">
          复核：{{ o.review.reviewer }} · {{ o.review.reviewedAt }}
          <p>依据：{{ o.review.basis }}</p>
        </div>

        <div class="actions">
          <template v-if="o.status === 'draft'">
            <button v-if="o.touchesBound" type="button" class="warn-btn" @click="emit('review', o)">
              {{ o.review ? "更新复核" : "站长复核" }}
            </button>
            <button type="button" :disabled="blockers(o).length > 0" @click="store.publish(o.id)">发布</button>
            <button type="button" class="secondary" @click="emit('edit', o)">编辑</button>
            <button type="button" class="danger" @click="store.removeDraft(o.id)">删除</button>
          </template>
          <template v-else-if="o.status === 'published'">
            <button type="button" @click="emit('verify', o)">{{ o.tagVerify ? "重新核验价签" : "核验价签" }}</button>
            <button type="button" class="secondary" @click="emit('adjust', o)">调整（新版本）</button>
            <button type="button" class="danger" @click="store.revoke(o.id)">撤销</button>
          </template>
          <template v-else>
            <button type="button" class="secondary" disabled>{{ o.status === "superseded" ? "已被新版本取代" : "已撤销归档" }}</button>
          </template>
        </div>
      </article>
    </div>
  </section>
</template>
