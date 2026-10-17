/**
 * 列表第一次画出时不播进入动画，避免整表重放。
 * 之后新增的卡片才滑入。挂到 `TransitionGroup` 的 `css` 上。
 */
import { onMounted, ref } from 'vue';

export function useRevealReady() {
  const ready = ref(false);
  onMounted(() => {
    requestAnimationFrame(() => {
      ready.value = true;
    });
  });
  return ready;
}
