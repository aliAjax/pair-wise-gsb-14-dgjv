<script setup lang="ts">
import { computed, ref } from "vue";
import type { ConflictItem, PriceOrder } from "../types";
import {
  discountText,
  formatRange,
  pricePosition,
  touchesLimit,
} from "../rules";
import { fuelName, stationName, STATIONS } from "../seed";
import { usePriceStore } from "../store";

const props = defineProps<{
  order: PriceOrder;
  conflicts: ConflictItem[];
  basedOnCode: string | null;
}>();

const emit = defineEmits<{
  (e: "adjust", order: PriceOrder): void;
}>();

const store = usePriceStore();

const manager = computed(
  () => STATIONS.find((s) => s.id === props.order.stationId)?.manager ?? ""
);

const position = computed(() =>
  pricePosition(props.order.finalPrice, props.order.ceiling, props.order.floor)
);
const isTouch = computed(() => touchesLimit(position.value));

const myBlockers = computed(() =>
  props.conflicts.filter(
    (c) => c.blockPublish && c.orderIds.includes(props.order.id)
  )
);

const memberActive = computed(() => store.memberActive(props.order));

const statusView = computed(() => {
  switch (props.order.status) {
    case "pending":
      return { text: "待发布", cls: "badge-amber" };
    case "published":
      return memberActive.value
        ? { text: props.order.method === "none" ? "挂牌生效中" : "会员优惠生效中", cls: "badge-green" }
        : { text: "已发布·价签待核验", cls: "badge-orange" };
    case "superseded":
      return { text: "已被新版本替代", cls: "badge-gray" };
    case "revoked":
      return { text: "已撤销", cls: "badge-red" };
  }
});

const feedback = ref("");
function fail(result: { ok: boolean; error?: string }) {
  feedback.value = result.ok ? "" : result.error ?? "操作失败";
}

// 站长复核
const reviewOpen = ref(false);
const reviewer = ref("");
const basis = ref("");
function openReview() {
  reviewer.value = props.order.review?.reviewer ?? manager.value;
  basis.value = props.order.review?.basis ?? "";
  reviewOpen.value = true;
  feedback.value = "";
}
function submitReview() {
  const r = store.review(props.order.id, reviewer.value, basis.value);
  if (r.ok) reviewOpen.value = false;
  fail(r);
}

// 价签核验
const tagOpen = ref(false);
const checker = ref("");
function openTag() {
  checker.value = props.order.tagCheck?.checker ?? "";
  tagOpen.value = true;
  feedback.value = "";
}
function submitTag() {
  const r = store.verifyTag(props.order.id, checker.value);
  if (r.ok) tagOpen.value = false;
  fail(r);
}

// 撤销
const revokeOpen = ref(false);
const revokeReason = ref("");
function openRevoke() {
  revokeReason.value = "";
  revokeOpen.value = true;
  feedback.value = "";
}
function submitRevoke() {
  const r = store.revoke(props.order.id, revokeReason.value);
  if (r.ok) revokeOpen.value = false;
  fail(r);
}

function doPublish() {
  feedback.value = "";
  fail(store.publish(props.order.id));
}

function doRemove() {
  if (confirm(`确认删除草稿 ${props.order.code}？`)) {
    fail(store.removeDraft(props.order.id));
  }
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <article class="record" :class="{ 'is-blocked': myBlockers.length > 0 && order.status === 'pending' }">
    <div class="record-head">
      <div>
        <p class="record-title">
          {{ order.code }}
          <span class="version">v{{ order.versionNo }}</span>
          <span v-if="order.origin === 'import'" class="origin-tag">外部导入</span>
        </p>
        <p class="record-sub">
          {{ stationName(order.stationId) }} · {{ fuelName(order.fuelId) }}
        </p>
      </div>
      <span class="status" :class="statusView.cls">{{ statusView.text }}</span>
    </div>

    <div class="time-range">
      <span class="clock">⏱</span>
      {{ formatRange(order) }}
    </div>

    <div class="price-line">
      <div class="price-box">
        <span>挂牌价</span>
        <strong>{{ order.listPrice.toFixed(2) }}</strong>
      </div>
      <span class="arrow">→</span>
      <div class="price-box final" :class="`pos-${position}`">
        <span>会员到手价</span>
        <strong>{{ order.finalPrice.toFixed(2) }}</strong>
        <em v-if="isTouch" class="touch-flag">
          触及{{ position === "ceiling" ? "最高零售价" : "成本保护线" }}
        </em>
      </div>
      <div class="price-box limit">
        <span>限价区间（元/升）</span>
        <strong>{{ order.floor.toFixed(2) }} ~ {{ order.ceiling.toFixed(2) }}</strong>
      </div>
    </div>

    <div class="details">
      <span>优惠方式：{{ discountText(order.method, order.discountValue) }}</span>
      <span>操作员：{{ order.operator }}</span>
      <span v-if="basedOnCode">上一版本：{{ basedOnCode }}</span>
      <span v-if="order.publishedAt">发布时间：{{ fmt(order.publishedAt) }}</span>
    </div>

    <p class="note"><b>原因：</b>{{ order.reason }}</p>

    <!-- 触线复核 -->
    <div v-if="isTouch" class="check-block" :class="order.review ? 'ok' : 'warn'">
      <template v-if="order.review">
        ✅ 站长复核：{{ order.review.reviewer }} 于 {{ fmt(order.review.at) }} 复核
        <p class="basis">依据：{{ order.review.basis }}</p>
      </template>
      <template v-else>
        ⚠ 到手价触及限价线，须站长复核并写明依据，未复核不得发布
        <button v-if="order.status === 'pending'" type="button" class="mini" @click="openReview">
          站长复核
        </button>
      </template>
    </div>

    <!-- 价签核验 -->
    <div
      v-if="order.status === 'published' || order.tagCheck"
      class="check-block"
      :class="order.tagCheck ? 'ok' : 'warn'"
    >
      <template v-if="order.tagCheck">
        🏷 价签已核验：{{ order.tagCheck.checker }} 于 {{ fmt(order.tagCheck.at) }}
      </template>
      <template v-else-if="order.method !== 'none'">
        ⚠ 价签未核验，会员优惠暂不对会员生效
        <button type="button" class="mini" @click="openTag">核验价签</button>
      </template>
    </div>

    <div v-if="order.status === 'revoked'" class="check-block revoked">
      已撤销（{{ fmt(order.createdAt) }} 单据）<br />
      撤销原因：{{ order.revokeReason }}
    </div>

    <ul v-if="myBlockers.length" class="blocker-list">
      <li v-for="c in myBlockers" :key="c.key">⛔ {{ c.ruleLabel }}：{{ c.detail }}</li>
    </ul>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>

    <div class="actions">
      <template v-if="order.status === 'pending'">
        <button type="button" :disabled="myBlockers.length > 0" @click="doPublish">
          发布价格
        </button>
        <button v-if="isTouch && !order.review" type="button" class="secondary" @click="openReview">
          站长复核
        </button>
        <button type="button" class="secondary" @click="emit('adjust', order)">复制为新单</button>
        <button type="button" class="danger ghost" @click="doRemove">删除草稿</button>
      </template>
      <template v-else-if="order.status === 'published'">
        <button type="button" class="secondary" @click="emit('adjust', order)">
          调整·另立版本
        </button>
        <button v-if="order.method !== 'none' && !order.tagCheck" type="button" class="secondary" @click="openTag">
          价签核验
        </button>
        <button type="button" class="danger" @click="openRevoke">撤销发布</button>
      </template>
      <template v-else>
        <button
          type="button"
          class="secondary"
          @click="navigator.clipboard?.writeText(`${order.code} ${stationName(order.stationId)} ${fuelName(order.fuelId)} ${order.finalPrice}`)"
        >
          复制摘要
        </button>
      </template>
    </div>

    <!-- 复核弹窗 -->
    <div v-if="reviewOpen" class="modal-mask" @click.self="reviewOpen = false">
      <div class="modal">
        <h3>站长复核 —— {{ order.code }}</h3>
        <p class="modal-tip">
          到手价 {{ order.finalPrice.toFixed(2) }} 元/升
          {{ position === "ceiling" ? "等于最高零售价" : "等于成本保护线" }}，
          须由站长复核并写明依据后方可发布。
        </p>
        <label>复核站长
          <input v-model="reviewer" placeholder="站长姓名" />
        </label>
        <label>复核依据
          <textarea v-model="basis" placeholder="如：市场指导价文件编号 / 成本核算单 / 促销审批单号" />
        </label>
        <p v-if="feedback" class="feedback">{{ feedback }}</p>
        <div class="modal-actions">
          <button type="button" class="secondary" @click="reviewOpen = false">取消</button>
          <button type="button" @click="submitReview">确认复核</button>
        </div>
      </div>
    </div>

    <!-- 价签核验弹窗 -->
    <div v-if="tagOpen" class="modal-mask" @click.self="tagOpen = false">
      <div class="modal">
        <h3>价签核验 —— {{ order.code }}</h3>
        <p class="modal-tip">核验站内价签与会员价屏显一致后，会员优惠才对会员生效。</p>
        <label>核验人
          <input v-model="checker" placeholder="现场核验人姓名" />
        </label>
        <p v-if="feedback" class="feedback">{{ feedback }}</p>
        <div class="modal-actions">
          <button type="button" class="secondary" @click="tagOpen = false">取消</button>
          <button type="button" @click="submitTag">确认核验</button>
        </div>
      </div>
    </div>

    <!-- 撤销弹窗 -->
    <div v-if="revokeOpen" class="modal-mask" @click.self="revokeOpen = false">
      <div class="modal">
        <h3>撤销发布 —— {{ order.code }}</h3>
        <p class="modal-tip">
          撤销后该价格立即停用，系统将沿版本链恢复最近有效版本（v{{ order.versionNo - 1 }}）。
        </p>
        <label>撤销原因
          <textarea v-model="revokeReason" placeholder="请填写撤销原因（必填）" />
        </label>
        <p v-if="feedback" class="feedback">{{ feedback }}</p>
        <div class="modal-actions">
          <button type="button" class="secondary" @click="revokeOpen = false">取消</button>
          <button type="button" class="danger" @click="submitRevoke">确认撤销并恢复旧版</button>
        </div>
      </div>
    </div>
  </article>
</template>
