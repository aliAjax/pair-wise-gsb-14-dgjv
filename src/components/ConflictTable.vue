<script setup lang="ts">
import type { ConflictItem } from "../types";
import { fuelName, stationName } from "../seed";

defineProps<{
  conflicts: ConflictItem[];
  title?: string;
  compact?: boolean;
}>();

function fmtTime(s: string) {
  return s.replace("T", " ");
}
</script>

<template>
  <section class="conflict-panel">
    <h3>
      {{ title ?? "冲突与门禁" }}
      <span class="conflict-count">{{ conflicts.length }}</span>
    </h3>
    <div v-if="conflicts.length === 0" class="empty-line">✅ 无命中规则，记录、核验与版本对应一致</div>
    <table v-else class="conflict-table">
      <thead>
        <tr>
          <th>站点</th>
          <th>油品</th>
          <th>冲突时段</th>
          <th>命中规则</th>
          <th>明细</th>
          <th>级别</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in conflicts" :key="c.key" :class="c.blockPublish ? 'row-block' : 'row-warn'">
          <td>{{ stationName(c.stationId) }}</td>
          <td>{{ fuelName(c.fuelId) }}</td>
          <td class="time-cell">{{ fmtTime(c.startAt) }}<br />~ {{ fmtTime(c.endAt) }}</td>
          <td><span class="rule-tag" :class="`rule-${c.ruleId}`">{{ c.ruleLabel }}</span></td>
          <td class="detail-cell">{{ c.detail }}</td>
          <td>
            <span v-if="c.blockPublish" class="level-block">拦截发布</span>
            <span v-else class="level-warn">提示/不生效</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
