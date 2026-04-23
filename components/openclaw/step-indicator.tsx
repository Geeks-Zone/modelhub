"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StepDefinition<T extends string = string> = {
  description: string;
  id: T;
  label: string;
};

type OpenClawStepIndicatorProps<T extends string = string> = {
  activeStep: T;
  onStepChange: (id: T) => void;
  steps: StepDefinition<T>[];
};

export function OpenClawStepIndicator<T extends string = string>({
  activeStep,
  onStepChange,
  steps,
}: OpenClawStepIndicatorProps<T>) {
  const stepIndex = steps.findIndex((s) => s.id === activeStep);

  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {steps.map((step, idx) => (
        <button
          key={step.id}
          onClick={() => onStepChange(step.id)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors",
            activeStep === step.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full text-[10px] font-bold",
              idx < stepIndex
                ? "bg-primary/10 text-primary"
                : activeStep === step.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted-foreground/10 text-muted-foreground",
            )}
          >
            {idx < stepIndex ? <CheckIcon className="size-3" /> : idx + 1}
          </span>
          <span className="hidden sm:inline">{step.label}</span>
        </button>
      ))}
    </div>
  );
}