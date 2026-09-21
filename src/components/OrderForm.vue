<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { DiscountMethod, OrderDraft, PriceOrder } from "../types";
import { calcFinalPrice, pricePosition } from "../rules";
import { FUELS, getLimit, STATIONS } from "../seed";
import { usePriceStore } from "../store";

const store = usePriceStore();

const METHODS: { value: DiscountMethod; label: string; hint: string }[] = [
  { value: "none", label: "无优惠（挂牌价）", hint: "" },
  { value: "perLiter", label: "每升立减", hint: "每升减免固定金额（元）" },
  { value: "percent", label: "会员折扣", hint: "按百分比打折，如 95 表示 95 折" },
  { value: "fixed", label: "固定会员价", hint: "会员加油固定单价（元/升）" },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}
function defaultEnd(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  d.setDate(d.getDate() + 7);
  return toLocalInput(d);
}

interface FormState {
  stationId: string;
  fuelId: string;
  startAt: string;
  endAt: string;
  listPrice: number | null;
  method: DiscountMethod;
  discountValue: number | null;
  reason: string;
  operator: string;
}

function blank(): FormState {
  return {
    stationId: "",
    fuelId: "",
    startAt: defaultStart(),
    endAt: defaultEnd(),
    listPrice: null,
    method: "none",
    discountValue: 0,
    reason: "",
    operator: "",
  };
}

const form = reactive<FormState>(blank());
const basedOn = ref<PriceOrder | null>(null);
const error = ref("");
const savedTip = ref("");

const limit = computed(() =>
  form.stationId && form.fuelId ? getLimit(form.stationId, form.fuelId) : null
);

const methodHint = computed(
  () => METHODS.find((m) => m.value === form.method)?.hint ?? ""
);
const showDiscount = computed(() => form.method !== "none");

function syncListPrice() {
  // 选定站点/油品后若挂牌价为空，默认带出最高零售价
  if (limit.value && (form.listPrice === null || form.listPrice === 0)) {
    form.listPrice = limit.value.ceiling;
  }
}

const previewPrice = computed<number | null>(() => {
  if (form.listPrice === null || !limit.value) return null;
  return calcFinalPrice(form.listPrice, form.method, form.discountValue ?? 0);
});

const previewPosition = computed(() => {
  if (previewPrice.value === null || !limit.value) return null;
  return pricePosition(previewPrice.value, limit.value.ceiling, limit.value.floor);
});

function toDraft(): OrderDraft {
  return {
    stationId: form.stationId,
    fuelId: form.fuelId,
    startAt: form.startAt,
    endAt: form.endAt,
    listPrice: form.listPrice,
    method: form.method,
    discountValue: form.method === "none" ? 0 : form.discountValue,
    reason: form.reason,
    operator: form.operator,
  };
}

function resetForm() {
  Object.assign(form, blank());
  basedOn.value = null;
  error.value = "";
  savedTip.value = "";
}

function prefillFrom(order: PriceOrder) {
  basedOn.value = order;
  form.stationId = order.stationId;
  form.fuelId = order.fuelId;
  form.startAt = order.endAt;
  const end = new Date(order.endAt.replace(" ", "T"));
  end.setDate(end.getDate() + 7);
  form.endAt = toLocalInput(end);
  form.listPrice = order.listPrice;
  form.method = order.method;
  form.discountValue = order.discountValue;
  form.reason = "";
  form.operator = order.operator;
  error.value = "";
  savedTip.value = "";
  requestAnimationFrame(() => {
    document.getElementById("order-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

defineExpose({ prefillFrom });

function submit() {
  error.value = "";
  savedTip.value = "";
  const result = store.createOrder(toDraft(), basedOn.value);
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  savedTip.value = basedOn.value
    ? `已基于 ${basedOn.value.code} 另立带原因版本（v${basedOn.value.versionNo + 1}），进入待发布；发布后旧版本将冻结替代。`
    : "调价单已保存，进入待发布。";
  resetFormKeepTime();
}

function resetFormKeepTime() {
  const start = form.startAt;
  const end = form.endAt;
  Object.assign(form, blank(), { startAt: start, endAt: end });
  basedOn.value = null;
}

const discountLabel = computed(() => {
  switch (form.method) {
    case "perLiter":
      return "每升立减（元）";
    case "percent":
      return "折扣（如 95）";
    case "fixed":
      return "固定会员价（元/升）";
    default:
      return "优惠数值";
  }
});
</script>

<template>
  <form id="order-form" class="panel form-panel" @submit.prevent="submit">
    <h2>{{ basedOn ? `调整价格 · 另立版本（基于 ${basedOn.code}）` : "新建调价单" }}</h2>
    <p v-if="basedOn" class="adjust-banner">
      已发布价格已冻结，不能直接改动；本次保存将作为带原因的新版本，发布时自动替代
      {{ basedOn.code }}（v{{ basedOn.versionNo }}）。
    </p>

    <div class="form-grid">
      <label>站点
        <select v-model="form.stationId" required @change="syncListPrice">
          <option value="">请选择站点</option>
          <option v-for="s in STATIONS" :key="s.id" :value="s.id">
            {{ s.name }}（{{ s.manager }}）
          </option>
        </select>
      </label>

      <label>油品
        <select v-model="form.fuelId" required @change="syncListPrice">
          <option value="">请选择油品</option>
          <option v-for="f in FUELS" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
      </label>

      <label>时段开始
        <input v-model="form.startAt" type="datetime-local" required />
      </label>

      <label>时段结束
        <input v-model="form.endAt" type="datetime-local" required />
      </label>

      <label>挂牌价（元/升）
        <input v-model.number="form.listPrice" type="number" step="0.01" min="0" required />
      </label>

      <label>优惠方式
        <select v-model="form.method">
          <option v-for="m in METHODS" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
      </label>

      <label v-if="showDiscount">
        {{ discountLabel }}
        <input v-model.number="form.discountValue" type="number" step="0.01" min="0" required />
        <small v-if="methodHint">{{ methodHint }}</small>
      </label>

      <label class="span-2">调价/优惠原因
        <textarea v-model="form.reason" placeholder="另立版本时必填原因，如：会员日促销 / 上游成本变动 / 竞品跟价" required />
      </label>

      <label>操作员
        <input v-model="form.operator" placeholder="填报人" required />
      </label>
    </div>

    <div v-if="limit" class="preview" :class="`pos-${previewPosition}`">
      <div>
        <span>最高零售价 / 成本保护线</span>
        <strong>{{ limit.ceiling.toFixed(2) }} / {{ limit.floor.toFixed(2) }} 元/升</strong>
      </div>
      <div>
        <span>优惠后到手价（预览）</span>
        <strong>{{ previewPrice?.toFixed(2) ?? "—" }} 元/升</strong>
      </div>
      <p v-if="previewPosition === 'over'" class="pv-warn">超出最高零售价，禁止保存</p>
      <p v-else-if="previewPosition === 'under'" class="pv-warn">低于成本保护线，禁止保存</p>
      <p v-else-if="previewPosition === 'ceiling' || previewPosition === 'floor'" class="pv-touch">
        到手价触及限价线，保存后须站长复核写依据，未复核不得发布
      </p>
      <p v-else-if="previewPosition === 'ok'" class="pv-ok">到手价位于限价区间内</p>
    </div>

    <p v-if="error" class="feedback error-text">{{ error }}</p>
    <p v-if="savedTip" class="feedback ok-text">{{ savedTip }}</p>

    <div class="form-actions">
      <button type="submit">{{ basedOn ? "保存为新版本" : "保存调价单" }}</button>
      <button type="button" class="secondary" @click="resetForm">清空</button>
    </div>
  </form>
</template>
