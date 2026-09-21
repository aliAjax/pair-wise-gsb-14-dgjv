<script setup lang="ts">
import { computed } from "vue";
import { FUELS, STATIONS } from "../domain";
import { usePriceStore } from "../store";

const store = usePriceStore();

const rows = computed(() =>
  STATIONS.map((station) => ({
    station,
    cells: FUELS.map((fuel) =>
      store.board.find((r) => r.stationCode === station.code && r.fuelCode === fuel.code)!
    )
  }))
);

const activeCount = computed(() => store.board.filter((r) => r.active).length);
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>会员价生效看板（{{ activeCount }}/{{ store.board.length }} 生效）</h2>
      <span class="sum-tip">仅展示当前时段；未核验价签或价签不符的价格不对会员生效</span>
    </div>

    <table class="board-table">
      <thead>
        <tr>
          <th>站点 / 油品</th>
          <th v-for="f in FUELS" :key="f.code">{{ f.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.station.code">
          <th class="station-col">{{ row.station.name }}</th>
          <td v-for="cell in row.cells" :key="cell.fuelCode" :class="{ inactive: !cell.active }">
            <template v-if="cell.order">
              <strong class="board-price">{{ cell.order.finalPrice.toFixed(2) }}</strong>
              <span class="board-meta">V{{ cell.order.versionNo }}</span>
              <p :class="cell.active ? 'board-ok' : 'board-no'">{{ cell.reason }}</p>
            </template>
            <template v-else>
              <span class="board-empty">—</span>
              <p class="board-no">{{ cell.reason }}</p>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
