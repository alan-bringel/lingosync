import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

interface SliderProps extends Omit<SliderPrimitive.Root.Props, 'onValueChange'> {
  thumbClassName?: string
  indicatorClassName?: string
  onValueChange?: (value: number[]) => void
  onValueCommitted?: (value: number[]) => void
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbClassName,
  indicatorClassName,
  onValueChange,
  onValueCommitted,
  ...props
}: SliderProps) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full flex items-center", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      {...props}
      onValueChange={(val) => onValueChange?.(Array.isArray(val) ? val as number[] : [val] as number[])}
      onValueCommitted={(val) => onValueCommitted?.(Array.isArray(val) ? val as number[] : [val] as number[])}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-white/5 select-none h-[1.5px] w-full"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn("bg-white/10 select-none h-full transition-none", indicatorClassName)}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className={cn(
              thumbClassName 
                ? "relative block h-3 w-8 shrink-0 rounded-full border-[1.5px] border-white bg-white shadow-xl select-none after:absolute after:-inset-4 hover:scale-110 active:scale-95 transition-[transform,scale] duration-200 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing"
                : "opacity-0 w-0 h-0 pointer-events-none transition-none",
              thumbClassName
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
