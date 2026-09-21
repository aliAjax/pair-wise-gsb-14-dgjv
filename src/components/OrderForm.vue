<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { DiscountType, PriceOrder } from "../types";
import { DISCOUNT_OPTIONS, FUELS, STATIONS, calcFinalPrice, getLimit, round2, touchesBoundaries } from "../domain";
import { usePriceStore } from "../store";

const store = usePriceStore();

const props = defineProps<{ preset: { order: PriceOrder; mode: "edit" | "adjust" } | null }>();
const emit = defineEmits<{ (e: "done"): void }>();

function blank() {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return {
    id: undefined as string | undefined,
    stationCode: STATIONS[0].code,
    fuelCode: FUELS[0].code,
    startAt: `${day}T00:00`,
    endAt: `${day}T23:59`,
    basePrice: 0,
    discountType: "amount" as DiscountType,
    discountValue: 0,
    reason: "",
    createdBy: "",
    chainId: undefined as string | undefined,
    versionNo: undefined as number | undefined,
    parentId: undefined as string | undefined
  };
}

const form = reactive(blank());

watch(
  () => props.preset,
  (p) => {
    Object.assign(form, blank());
    if (!p) return;
    const o = p.order;
    form.stationCode = o.stationCode;
    form.fuelCode = o.fuelCode;
    form.startAt = o.startAt;
    form.endAt = o.endAt;
    form.basePrice = o.basePrice;
    form.discountType = o.discount.type;
    form.discountValue = o.discount.value;
    form.createdBy = o.createdBy;
    if (p.mode === "edit") {
      form.id = o.id;
      form.chainId = o.chainId;
      form.versionNo = o.versionNo;
      form.parentId = o.parentId;
      form.reason = o.reason;
    } else {
      // 调整：另立带原因的新版本
      form.chainId = o.chainId;
      form.versionNo = store.latestVersion(o.chainId) + 1;
      form.parentId = o.id;
    }
  },
  { immediate: true }
);

const limit = computed(() => getLimit(store.limits, form.stationCode, form.fuelCode));
const finalPrice = computed(() =>
  calcFinalPrice(Number(form.basePrice) || 0, { type: form.discountType, value: Number(form.discountValue) || 0 })
);
const touches = computed(() => touchesBoundaries(finalPrice.value, limit.value));
const corridorState = computed(() => {
  const l = limit.value;
  if (!l) return { kind: "none", text: "该站点油品尚未维护限价" };
  if (finalPrice.value > l.retail + 0.009)
    return { kind: "over-high", text: `高于最高零售价 ${l.retail.toFixed(2)} 元，保存后将被冲突台拦截` };
  if (finalPrice.value < l.costFloor - 0.009)
    return { kind: "over-low", text: `低于成本保护线 ${l.costFloor.toFixed(2)} 元，保存后将被冲突台拦截` };
  if (Math.abs(finalPrice.value - l.retail) <= 0.009)
    return { kind: "bound", text: "到手价等于最高零售价（触线，发布前须站长复核并写依据）" };
  if (Math.abs(finalPrice.value - l.costFloor) <= 0.009)
    return { kind: "bound", text: "到手价等于成本保护线（触线，发布前须站长复核并写依据）" };
  return { kind: "ok", text: `处于限价走廊 [${l.costFloor.toFixed(2)}, ${l.retail.toFixed(2)}] 内` };
});

const isNewVersion = computed(() => (form.versionNo ?? 1) > 1);
const needValue = computed(() => form.discountType !== "none");
const errors = ref<string[]>([]);

function validate(): boolean {
  const e: string[] = [];
  const s = Date.parse(form.startAt);
  const en = Date.parse(form.endAt);
  if (Number.isNaN(s) || Number.isNaN(en)) e.push("请填写完整的生效时段");
  else if (en <= s) e.push("时段结束时间必须晚于开始时间");
  else if (en - s < 3600_000) e.push("时段至少 1 小时");
  if (!(Number(form.basePrice) > 0)) e.push("挂牌价须大于 0");
  if (form.discountType === "amount" && Number(form.discountValue) < 0) e.push("直降金额不能为负");
  if (form.discountType === "percent" && (Number(form.discountValue) <= 0 || Number(form.discountValue) > 100))
    e.push("折扣率应在 0~100 之间");
  if (form.discountType === "fixed" && Number(form.discountValue) <= 0) e.push("到手价须大于 0");
  if (!form.createdBy.trim()) e.push("请填写制单人");
  if (isNewVersion.value && !form.reason.trim()) e.push("调整已冻结价格必须填写调整原因");
  errors.value = e;
  return e.length === 0;
}

function submit() {
  if (!validate()) return;
  const saved = store.saveDraft({
    id: form.id,
    stationCode: form.stationCode,
    fuelCode: form.fuelCode,
    startAt: form.startAt,
    endAt: form.endAt,
    basePrice: round2(Number(form.basePrice)),
    discountType: form.discountType,
    discountValue: round2(Number(form.discountValue)),
    reason: form.reason,
    createdBy: form.createdBy,
    chainId: form.chainId,
    versionNo: form.versionNo,
    parentId: form.parentId
  });
  Object.assign(form, blank());
  emit("done");
  // 新草稿直接选中便于操作
  queueMicrotask(() => store.notify(`可在列表中复核/发布：${saved.code}`));
}

function reset() {
  Object.assign(form, blank());
  errors.value = [];
  emit("done");
}
</script>

<template>
  <form class="panel order-form" @submit.prevent="submit">
    <div class="panel-title">
      <h2>{{ isNewVersion ? `调整版本 V${form.versionNo}` : "新建调价单" }}</h2>
      <span v-if="isNewVersion" class="chain-flag">新版本须填写原因，发布后取代同链旧版本</span>
    </div>

    <div class="form-grid">
      <label>
        站点
        <select v-model="form.stationCode">
          <option v-for="s in STATIONS" :key="s.code" :value="s.code">{{ s.name }}（{{ s.code }}）</option>
        </select>
      </label>
      <label>
        油品
        <select v-model="form.fuelCode">
          <option v-for="f in FUELS" :key="f.code" :value="f.code">{{ f.name }}</option>
        </select>
      </label>
      <label>
        时段开始
        <input v-model="form.startAt" type="datetime-local" />
      </label>
      <label>
        时段结束
        <input v-model="form.endAt" type="datetime-local" />
      </label>
      <label>
        挂牌价（元/升）
        <input v-model.number="form.basePrice" type="number" min="0" step="0.01" />
      </label>
      <label>
        优惠方式
        <select v-model="form.discountType">
          <option v-for="o in DISCOUNT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label v-if="needValue" class="span-2">
        {{ DISCOUNT_OPTIONS.find((o) => o.value === form.discountType)?.label }}
        <span class="hint">{{ DISCOUNT_OPTIONS.find((o) => o.value === form.discountType)?.hint }}</span>
        <input v-model.number="form.discountValue" type="number" min="0" step="0.01" />
      </label>
      <label class="span-2">
        调整原因 <span v-if="isNewVersion" class="req">（新版本必填）</span>
        <textarea v-model="form.reason" :placeholder="isNewVersion ? '说明为何调整已冻结价格' : '可填写促销、保供等原因'" />
      </label>
      <label>
        制单人
        <input v-model="form.createdBy" placeholder="姓名" />
      </label>
    </div>

    <div class="price-preview" :class="corridorState.kind">
      <div>
        <span class="preview-label">会员到手价</span>
        <strong>{{ finalPrice.toFixed(2) }}</strong>
        <em>元/升</em>
      </div>
      <p>{{ corridorState.text }}</p>
      <p v-if="touches" class="bound-tip">触线单保存后，请在列表中完成「站长复核」再发布。</p>
    </div>

    <ul v-if="errors.length" class="form-errors">
      <li v-for="(e, i) in errors" :key="i">{{ e }}</li>
    </ul>

    <div class="form-actions">
      <button type="submit">保存草稿</button>
      <button type="button" class="secondary" @click="reset">{{ form.id ? "取消编辑" : "清空" }}</button>
    </div>
  </form>
</template>
