import * as React from "react"
import { cn } from "../../lib/utils.jsx"

const Button = React.forwardRef(({ className, variant = "default", ...props }, ref) => {
    return (
        <button
            className={cn(
                "inline-flex items-center justify-center rounded-md text-xs sm:text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                variant === "default" && "bg-primary text-primary-foreground hover:bg-primary/90 px-3 sm:px-4 py-2",
                variant === "outline" && "border border-input bg-background hover:bg-accent hover:text-accent-foreground px-3 sm:px-4 py-2",
                className
            )}
            ref={ref}
            {...props}
        />
    )
})
Button.displayName = "Button"

export { Button }