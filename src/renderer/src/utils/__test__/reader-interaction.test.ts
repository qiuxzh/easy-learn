import { describe, expect, it } from 'vitest';
import {
  CLICK_DRAG_TOLERANCE_PX,
  isClickRelease,
  resolveEdgeDirection,
  shouldSuppressSelection,
} from '@/utils/reader-interaction';

describe('resolveEdgeDirection', () => {
  it('宽度为 0 时不判定为边缘', () => {
    expect(resolveEdgeDirection(10, { left: 0, width: 0 })).toBeNull();
  });

  it('边缘区取「最小 48px」与「宽度 6%」中的较大者', () => {
    // 宽 1000：6% = 60 > 48，左边缘到 60
    expect(resolveEdgeDirection(60, { left: 0, width: 1000 })).toBe('left');
    expect(resolveEdgeDirection(61, { left: 0, width: 1000 })).toBeNull();
    // 宽 400：6% = 24 < 48，取 48
    expect(resolveEdgeDirection(148, { left: 100, width: 400 })).toBe('left');
    expect(resolveEdgeDirection(149, { left: 100, width: 400 })).toBeNull();
  });

  it('右侧边缘从阅读区右边界向里算', () => {
    expect(resolveEdgeDirection(940, { left: 0, width: 1000 })).toBe('right');
    expect(resolveEdgeDirection(939, { left: 0, width: 1000 })).toBeNull();
  });

  it('中间位置不判定为边缘', () => {
    expect(resolveEdgeDirection(500, { left: 0, width: 1000 })).toBeNull();
  });
});

describe('shouldSuppressSelection', () => {
  const blankPress = {
    primaryButton: true,
    detail: 1,
    onText: false,
    onInteractive: false,
  };

  it('空白处按下要阻止默认行为，否则会从页首选到指针处', () => {
    expect(shouldSuppressSelection(blankPress)).toBe(true);
  });

  it('点在文字上单击不阻止，保留正常选字', () => {
    expect(shouldSuppressSelection({ ...blankPress, onText: true })).toBe(false);
  });

  it('点在文字上连点要阻止，否则会选词、选段', () => {
    expect(shouldSuppressSelection({ ...blankPress, onText: true, detail: 2 })).toBe(true);
    expect(shouldSuppressSelection({ ...blankPress, onText: true, detail: 3 })).toBe(true);
  });

  it('点在链接或按钮上不阻止，交给它们自己处理', () => {
    expect(shouldSuppressSelection({ ...blankPress, onInteractive: true })).toBe(false);
    expect(shouldSuppressSelection({ ...blankPress, onText: true, onInteractive: true })).toBe(
      false
    );
  });

  it('非左键不阻止', () => {
    expect(shouldSuppressSelection({ ...blankPress, primaryButton: false })).toBe(false);
  });
});

describe('isClickRelease', () => {
  const cleanClick = {
    deltaX: 0,
    deltaY: 0,
    hadSelectionOnPress: false,
    hasSelectionNow: false,
  };

  it('没有位移、没有选区时算点击', () => {
    expect(isClickRelease(cleanClick)).toBe(true);
  });

  it('位移超过容差算拖选', () => {
    expect(isClickRelease({ ...cleanClick, deltaX: CLICK_DRAG_TOLERANCE_PX + 1 })).toBe(false);
    expect(isClickRelease({ ...cleanClick, deltaY: -(CLICK_DRAG_TOLERANCE_PX + 1) })).toBe(false);
  });

  it('位移在容差内仍算点击', () => {
    expect(isClickRelease({ ...cleanClick, deltaX: CLICK_DRAG_TOLERANCE_PX })).toBe(true);
  });

  it('本次手势选出文字时不算点击', () => {
    expect(isClickRelease({ ...cleanClick, hasSelectionNow: true })).toBe(false);
  });

  it('按下时就存在的残留选区不算本次选择，否则边缘点击会被一直挡住', () => {
    expect(
      isClickRelease({ ...cleanClick, hadSelectionOnPress: true, hasSelectionNow: true })
    ).toBe(true);
  });
});
