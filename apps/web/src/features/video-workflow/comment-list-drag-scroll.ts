type DragScrollState = {
  container: HTMLElement | null;
  frameId: number | null;
  speed: number;
};

const dragScrollStates = new WeakMap<HTMLElement, DragScrollState>();
const EDGE_SIZE = 96;
const MIN_SCROLL_SPEED = 6;
const MAX_SCROLL_SPEED = 24;

function getScrollableContainers(commentList: HTMLElement): HTMLElement[] {
  const containers = [commentList];
  let parent = commentList.parentElement;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      containers.push(parent);
    }
    parent = parent.parentElement;
  }
  return containers;
}

function getDragScrollTarget(commentList: HTMLElement, pointerY: number) {
  for (const container of getScrollableContainers(commentList)) {
    const { bottom, top } = container.getBoundingClientRect();
    if (pointerY < top || pointerY > bottom) continue;

    const distanceFromTop = pointerY - top;
    const distanceFromBottom = bottom - pointerY;
    const direction =
      distanceFromTop < EDGE_SIZE ? -1 : distanceFromBottom < EDGE_SIZE ? 1 : 0;
    if (direction === 0) continue;

    const maxScrollTop = container.scrollHeight - container.clientHeight;
    if (
      (direction < 0 && container.scrollTop <= 0) ||
      (direction > 0 && container.scrollTop >= maxScrollTop - 1)
    ) {
      continue;
    }

    const distanceFromEdge = Math.min(distanceFromTop, distanceFromBottom);
    const speed =
      direction *
      Math.round(
        MIN_SCROLL_SPEED +
          ((EDGE_SIZE - Math.max(0, distanceFromEdge)) / EDGE_SIZE) *
            (MAX_SCROLL_SPEED - MIN_SCROLL_SPEED),
      );
    return { container, speed };
  }
  return null;
}

export function updateCommentListDragScroll(
  commentList: HTMLElement,
  pointerY: number,
) {
  const target = getDragScrollTarget(commentList, pointerY);
  const state = dragScrollStates.get(commentList) ?? {
    container: null,
    frameId: null,
    speed: 0,
  };
  dragScrollStates.set(commentList, state);
  state.container = target?.container ?? null;
  state.speed = target?.speed ?? 0;

  if (state.speed === 0) {
    if (state.frameId !== null) cancelAnimationFrame(state.frameId);
    state.frameId = null;
    return;
  }
  if (state.frameId !== null) return;

  const scroll = () => {
    if (state.speed === 0) {
      state.frameId = null;
      return;
    }
    const container = state.container;
    if (!container) {
      state.frameId = null;
      return;
    }
    const scrollTopBefore = container.scrollTop;
    container.scrollBy({ top: state.speed });
    if (container.scrollTop === scrollTopBefore) {
      state.speed = 0;
      state.frameId = null;
      return;
    }
    state.frameId = requestAnimationFrame(scroll);
  };
  state.frameId = requestAnimationFrame(scroll);
}

export function stopCommentListDragScroll(commentList: HTMLElement | null) {
  if (!commentList) return;
  const state = dragScrollStates.get(commentList);
  if (!state) return;
  state.container = null;
  state.speed = 0;
  if (state.frameId !== null) cancelAnimationFrame(state.frameId);
  state.frameId = null;
}
