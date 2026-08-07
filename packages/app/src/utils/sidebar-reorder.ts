export function mergeWithRemainder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedVisibleKeys);
  let reorderedIndex = 0;
  const merged = input.currentOrder.map((key) => {
    if (!reorderedSet.has(key)) return key;
    const reorderedKey = input.reorderedVisibleKeys[reorderedIndex];
    if (reorderedKey === undefined) return key;
    reorderedIndex += 1;
    return reorderedKey;
  });
  return [...merged, ...input.reorderedVisibleKeys.slice(reorderedIndex)];
}

export function hasVisibleOrderChanged(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): boolean {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const currentVisible = input.currentOrder.filter((key) => visibleSet.has(key));
  if (currentVisible.length !== input.reorderedVisibleKeys.length) {
    return true;
  }
  return input.reorderedVisibleKeys.some((key, index) => currentVisible[index] !== key);
}
