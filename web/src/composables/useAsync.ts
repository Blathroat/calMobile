import { ref } from 'vue';

export function useAsync<T>() {
  const data = ref<T>();
  const error = ref<Error>();
  const loading = ref(false);
  let sequence = 0;
  async function run(task: () => Promise<T>): Promise<T | undefined> {
    const current = ++sequence;
    loading.value = true;
    error.value = undefined;
    try { const result = await task(); if (current === sequence) data.value = result; return result; }
    catch (reason) { if (current === sequence) error.value = reason instanceof Error ? reason : new Error(String(reason)); return undefined; }
    finally { if (current === sequence) loading.value = false; }
  }
  return { data, error, loading, run };
}
