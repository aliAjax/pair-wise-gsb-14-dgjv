<script setup lang="ts">
import { reactive, watch } from "vue";
import type { PriceOrder } from "../types";
import { fuelName, stationName } from "../domain";

const props = defineProps<{ order: PriceOrder | null }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit", payload: { reviewer: string; basis: string }): void;
}>();

const form = reactive({ reviewer: "", basis: "" });

watch(
  () => props.order,
  (o) => {
    form.reviewer = o?.review?.reviewer ?? "";
    form.basis = o?.review?.basis ?? "";
  },
  { immediate: true }
);

function ok() {
  if (!form.reviewer.trim() || !form.basis.trim()) return;
  emit("submit", { reviewer: form.reviewer, basis: form.basis });
}
</script>

<template>
  <div v-if="order" class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <h3>站长复核（触线单）</h3>
      <p class="modal-sub">
        {{ stationName(order.stationCode) }} · {{ fuelName(order.fuelCode) }} · 到手价
        <strong>{{ order.finalPrice.toFixed(2) }}</strong> 元/升
      </p>
      <p class="modal-note">到手价恰好命中最高零售价或成本保护线，须站长复核并写明依据，未复核不得发布。</p>
      <label>
        复核人（站长）
        <input v-model="form.reviewer" placeholder="姓名" />
      </label>
      <label>
        复核依据
        <textarea v-model="form.basis" placeholder="批复文件号、促销审批、成本测算说明等" />
      </label>
      <div class="modal-actions">
        <button :disabled="!form.reviewer.trim() || !form.basis.trim()" @click="ok">提交复核</button>
        <button class="secondary" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>
