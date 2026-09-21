<script setup lang="ts">
import { reactive, watch } from "vue";
import { FUELS, STATIONS, getLimit } from "../domain";
import { usePriceStore } from "../store";

const store = usePriceStore();

interface Cell {
  retail: number;
  costFloor: number;
}

const edits = reactive<Record<string, Cell>>({});

function key(station: string, fuel: string): string {
  return `${station}/${fuel}`;
}

function sync() {
  for (const s of STATIONS) {
    for (const f of FUELS) {
      const l = getLimit(store.limits, s.code, f.code);
      edits[key(s.code, f.code)] = {
        retail: l?.retail ?? 0,
        costFloor: l?.costFloor ?? 0
      };
    }
  }
}

watch(() => store.limits, sync, { immediate: true, deep: true });

function cellError(station: string, fuel: string): string {
  const c = edits[key(station, fuel)];
  if (!(c.retail > 0) || !(c.costFloor > 0)) return "价格须大于 0";
  if (c.costFloor > c.retail) return "成本保护线不能高于最高零售价";
  return "";
}

function updatedAt(station: string, fuel: string): string {
  return getLimit(store.limits, station, fuel)?.updatedAt.replace("T", " ") ?? "—";
}

function save(station: string, fuel: string) {
  const c = edits[key(station, fuel)];
  if (cellError(station, fuel)) return;
  store.updateLimit(station, fuel, c.retail, c.costFloor);
}
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>限价发布台</h2>
      <span class="sum-tip">调整走廊上/下界后，冻结中的发布价将自动按 R7 规则重新校验</span>
    </div>

    <div v-for="s in STATIONS" :key="s.code" class="limit-block">
      <h3>{{ s.name }} <small>站长：{{ s.manager }}</small></h3>
      <div class="limit-grid">
        <div v-for="f in FUELS" :key="f.code" class="limit-card">
          <p class="limit-fuel">{{ f.name }}</p>
          <label>
            最高零售价
            <input v-model.number="edits[key(s.code, f.code)].retail" type="number" min="0" step="0.01" />
          </label>
          <label>
            成本保护线
            <input v-model.number="edits[key(s.code, f.code)].costFloor" type="number" min="0" step="0.01" />
          </label>
          <p v-if="cellError(s.code, f.code)" class="limit-err">{{ cellError(s.code, f.code) }}</p>
          <div class="limit-foot">
            <button type="button" :disabled="!!cellError(s.code, f.code)" @click="save(s.code, f.code)">发布限价</button>
            <span class="limit-time">更新于 {{ updatedAt(s.code, f.code) }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
