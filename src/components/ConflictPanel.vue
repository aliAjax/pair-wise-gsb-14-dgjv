<script setup lang="ts">
import { computed, ref } from "vue";
import { fuelName, stationName } from "../domain";
import { usePriceStore } from "../store";

const store = usePriceStore();
const levelFilter = ref("ALL");

const rows = computed(() =>
  store.conflicts.filter((c) => levelFilter.value === "ALL" || c.level === levelFilter.value)
);
const blockCount = computed(() => store.conflicts.filter((c) => c.level === "block").length);
const warnCount = computed(() => store.conflicts.filter((c) => c.level === "warn").length);

function orderCode(id: string): string {
  return store.byId(id)?.code ?? id;
}
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>冲突与规则命中（{{ store.conflicts.length }}）</h2>
      <div class="filters">
        <select v-model="levelFilter">
          <option value="ALL">全部级别</option>
          <option value="block">阻断（不可发布）</option>
          <option value="warn">警告（会员侧受限）</option>
        </select>
      </div>
    </div>

    <div class="conflict-summary">
      <span class="sum-chip block">{{ blockCount }} 条阻断</span>
      <span class="sum-chip warn">{{ warnCount }} 条警告</span>
      <span class="sum-tip">命中规则的单据必须先处理；发布价冻结后若限价变更产生警告，需另立版本调整。</span>
    </div>

    <div v-if="rows.length === 0" class="empty">规则校验全部通过，无冲突</div>

    <table v-else class="conflict-table">
      <thead>
        <tr>
          <th>级别</th>
          <th>站点</th>
          <th>油品</th>
          <th>时段</th>
          <th>命中规则</th>
          <th>涉及单据</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in rows" :key="c.key" :class="c.level">
          <td><span class="level-tag" :class="c.level">{{ c.level === "block" ? "阻断" : "警告" }}</span></td>
          <td>{{ stationName(c.stationCode) }}</td>
          <td>{{ fuelName(c.fuelCode) }}</td>
          <td class="period-cell">{{ c.periodText }}</td>
          <td><b>{{ c.rule }}</b> {{ c.ruleLabel }}</td>
          <td class="order-cell">
            <span v-for="(id, i) in c.orderIds" :key="id">
              <i>{{ orderCode(id) }}</i><template v-if="i < c.orderIds.length - 1"> × </template>
            </span>
          </td>
          <td class="detail-cell">{{ c.detail }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
