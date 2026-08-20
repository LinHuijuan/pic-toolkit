<script setup lang="ts">
import { ref } from 'vue'
import HomeView from './views/HomeView.vue'
import GridSliceView from './views/GridSliceView.vue'
import WatermarkView from './views/WatermarkView.vue'
import BgRemovalView from './views/BgRemovalView.vue'

type ViewName = 'home' | 'grid' | 'watermark' | 'removeBg'

const currentView = ref<ViewName>('home')

function navigate(view: ViewName) {
  currentView.value = view
}
</script>

<template>
  <div class="app-shell">
    <HomeView v-if="currentView === 'home'" @navigate="navigate" />
    <GridSliceView v-else-if="currentView === 'grid'" @back="navigate('home')" />
    <WatermarkView v-else-if="currentView === 'watermark'" @back="navigate('home')" />
    <BgRemovalView v-else-if="currentView === 'removeBg'" @back="navigate('home')" />
  </div>
</template>
