<script setup lang="ts">
import { reactive, watch } from "vue";
import type { PriceOrder } from "../types";
import { fuelName, stationName } from "../domain";

const props = defineProps<{ order: PriceOrder | null }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit", payload: { verifier: string; tagPrice: number }): void;
}>();

const form = reactive({ verifier: "", tagPrice: 0 });

watch(
  () => props.order,
  (o) => {
    form.verifier = o?.tagVerify?.verifier ?? "";
    form.tagPrice = o?.tagVerify?.tagPrice ?? o?.finalPrice ?? 0;
  },
  { immediate: true }
);

const mismatch = () => Math.abs(Number(form.tagPrice) - (props.order?.finalPrice ?? 0)) > 0.009;

function ok() {
  if (!form.verifier.trim() || !(Number(form.tagPrice) > 0)) return;
  emit("submit", { verifier: form.verifier, tagPrice: Number(form.tagPrice) });
}
</script>

<template>
  <template v-if="order">
    <div class="modal-mask" @click.self="emit('close')">
      <div class="modal">
        <h3>价签核验</h3>
        <p class="modal-sub">
          {{ stationName(order.stationCode) }} · {{ fuelName(order.fuelCode) }} · 系统到手价
          <strong>{{ order.finalPrice.toFixed(2) }}</strong> 元/升
        </p>
        <p class="modal-note">核对现场价签后登记；价签价与到手价不一致时，会员价不予生效。</p>
        <label>
          核验人
          <input v-model="form.verifier" placeholder="姓名" />
        </label>
        <label>
          现场价签会员价（元/升）
          <input v-model.number="form.tagPrice" type="number" min="0" step="0.01" />
        </label>
        <p v-if="mismatch()" class="mismatch-tip">
          ⚠ 价签 {{ Number(form.tagPrice).toFixed(2) }} 与到手价 {{ order.finalPrice.toFixed(2) }}
          不一致，核验后将标记「会员暂不生效」
        </p>
        <p v-else class="match-tip">✓ 价签价与到手价一致，核验后会员价生效</p>
        <div class="modal-actions">
          <button :disabled="!form.verifier.trim() || !(Number(form.tagPrice) > 0)" @click="ok">确认核验</button>
          <button class="secondary" @click="emit('close')">取消</button>
        </div>
      </div>
    </div>
  </template>
</template>
