import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * 尺寸档：高度取约定的四档（h-6 / h-7 / h-8 / h-9），内边距、圆角、字号与图标跟着档位走。
 * 只有 Button 保留尺寸档：有几十处调用点需要紧凑键，其余控件只有一个默认档。
 * 图标键用显式宽度而非 aspect-ratio，避免在纵向 flex 里被拉伸。
 */
const SIZE_CLASSES = {
  xs: {
    box: 'h-6 gap-1 rounded-sm text-xs',
    svg: '[&_svg]:size-3.5',
    pad: 'px-2',
    icon: 'w-6 px-0',
  },
  sm: {
    box: 'h-7 gap-1.5 rounded-sm text-xs',
    svg: '[&_svg]:size-4',
    pad: 'px-2.5',
    icon: 'w-7 px-0',
  },
  md: {
    box: 'h-8 gap-1.5 rounded-md text-body',
    svg: '[&_svg]:size-4',
    pad: 'px-3',
    icon: 'w-8 px-0',
  },
  lg: {
    box: 'h-9 gap-2 rounded-md text-sm',
    svg: '[&_svg]:size-5',
    pad: 'px-3.5',
    icon: 'w-9 px-0',
  },
} as const;

/**
 * 按钮外观的唯一来源。填充方式与语义色正交，选中态是状态而非变体；
 * 每个变体只有一条 hover 规则，调用处无法再自造 hover 效果。
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      /** 填充方式：实心、描边、透明、弱化文字 */
      variant: {
        solid: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        /* 自带不透明底色的变体：hover 换成同样不透明的 accent，用叠色会在图片和异色底上透出下层 */
        outline: 'hairline border-stroke-3 bg-background hover:bg-accent',
        ghost: 'hover:bg-hover-fill',
        quiet: 'text-muted-foreground hover:bg-hover-fill hover:text-foreground',
      },
      /** 语义色：与填充方式正交 */
      tone: {
        default: '',
        danger: '',
      },
      /** 选中态：由状态决定，不占用变体名额 */
      pressed: {
        true: 'bg-accent text-accent-foreground',
        false: '',
      },
    },
    compoundVariants: [
      {
        variant: 'solid',
        tone: 'danger',
        class: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover',
      },
      {
        variant: 'outline',
        tone: 'danger',
        class: 'border-danger-border text-danger-ink hover:bg-danger-surface',
      },
      /* ghost 的 danger 只在 hover 显色，静止态与普通 ghost 一致，用于窗口控件那类中性图标键 */
      { variant: 'ghost', tone: 'danger', class: 'hover:bg-danger-surface hover:text-danger-ink' },
      { variant: 'quiet', tone: 'danger', class: 'text-danger-ink hover:bg-danger-surface' },
    ],
    defaultVariants: {
      variant: 'solid',
      tone: 'default',
      pressed: false,
    },
  }
);

/**
 * 外观由 variant / tone / pressed 决定，尺寸由 size 决定。
 * className 用于布局与几何（宽度、对齐、圆角），不要用它改颜色、描边、阴影或 hover 反馈。
 */
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** 尺寸档：决定高度、内边距、圆角、字号与图标尺寸 */
  size?: keyof typeof SIZE_CLASSES;
  /** 图标键：保持正方形并去掉横向内边距 */
  icon?: boolean;
  /** 把按钮样式转发给子元素，用于链接等自定义容器 */
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, tone, pressed, size = 'md', icon = false, asChild = false, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    const box = SIZE_CLASSES[size];
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, tone, pressed }),
          box.box,
          box.svg,
          icon ? box.icon : box.pad,
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
