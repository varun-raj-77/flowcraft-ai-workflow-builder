import React from 'react';
import type { CapabilityCoverage } from '@/types';

interface CapabilityFeedback {
  label: string;
  explanation: string;
  suggestion: string;
  promptExample: string;
}

const CAPABILITY_FEEDBACK: Record<string, CapabilityFeedback> = {
  api_call: {
    label: 'API Call',
    explanation: 'The prompt requested fetching data from an API, but no API Call node was generated in the required workflow sequence.',
    suggestion: 'Try writing: Use an API Call node to fetch data from the endpoint.',
    promptExample: 'API Call to fetch customer data',
  },
  condition: {
    label: 'Condition',
    explanation: 'The workflow appears to require branching or decision making, but no Condition node was created.',
    suggestion: 'Explicitly say: Branch if the condition is true, otherwise continue on the other path.',
    promptExample: 'Condition to branch when the customer is active',
  },
  qualification_condition: {
    label: 'Condition',
    explanation: 'The workflow appears to require branching or decision making, but no Condition node was created.',
    suggestion: 'Explicitly say: Branch if the condition is true, otherwise continue on the other path.',
    promptExample: 'Condition to branch when the customer is qualified',
  },
  transform: {
    label: 'Transform',
    explanation: 'The prompt requested processing or transforming data, but no Transform node was generated.',
    suggestion: 'Explicitly mention: Transform, calculate, filter, merge, or normalize the data.',
    promptExample: 'Transform to filter active customers',
  },
  output: {
    label: 'Output',
    explanation: 'The workflow produces data but never outputs it.',
    suggestion: 'Ask the workflow to log or display the final result.',
    promptExample: 'Output to log the final customer count',
  },
  delay: {
    label: 'Delay',
    explanation: 'The prompt requested waiting or scheduling, but no Delay node exists.',
    suggestion: 'Explicitly say how long the workflow should wait before continuing.',
    promptExample: 'Delay for 2 seconds before continuing',
  },
  start: {
    label: 'Start',
    explanation: 'The workflow has no Start node.',
    suggestion: 'Ask for the workflow to begin with a Start node.',
    promptExample: 'Start',
  },
  end: {
    label: 'End',
    explanation: 'The workflow never terminates.',
    suggestion: 'Ask for the workflow to finish with an End node.',
    promptExample: 'End',
  },
  ai_summary: {
    label: 'AI summary',
    explanation: 'The request requires an executable AI or LLM summary, which FlowCraft cannot run as a workflow node.',
    suggestion: 'Use supported nodes such as API Call, Transform, Condition, Output, and End instead.',
    promptExample: 'Transform the response and Output a concise summary',
  },
};

function fallbackFeedback(capability: string): CapabilityFeedback {
  const label = capability.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    label,
    explanation: `The generated workflow is missing the requested ${label} capability.`,
    suggestion: `Explicitly mention ${label} in your prompt and regenerate the workflow.`,
    promptExample: label,
  };
}

function getCapabilityFeedback(capability: string): CapabilityFeedback {
  return CAPABILITY_FEEDBACK[capability] ?? fallbackFeedback(capability);
}

function deduplicate(capabilities: string[]): string[] {
  return [...new Set(capabilities)];
}

interface GenerationValidationFeedbackProps {
  coverage: CapabilityCoverage;
}

export function GenerationValidationFeedback({ coverage }: GenerationValidationFeedbackProps) {
  const missing = deduplicate(coverage.missingCapabilities).map(getCapabilityFeedback);
  const unsupported = deduplicate(coverage.unsupportedCapabilities).map(getCapabilityFeedback);
  const promptSteps = [...missing, ...unsupported].map((feedback) => feedback.promptExample);

  return (
    <section
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100"
      aria-labelledby="generation-validation-title"
      aria-live="polite"
    >
      <h3 id="generation-validation-title" className="text-sm font-semibold">
        The generated workflow doesn&apos;t fully match your request.
      </h3>
      <p className="mt-1 text-xs text-red-800 dark:text-red-200">
        The AI generated a workflow, but some requested capabilities were missing or incomplete.
      </p>

      {missing.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">Missing components</h4>
          <ul className="mt-2 space-y-3">
            {missing.map((feedback) => (
              <li key={feedback.label}>
                <p className="text-xs font-semibold">{feedback.label}</p>
                <p className="mt-0.5 text-xs text-red-800 dark:text-red-200">{feedback.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unsupported.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">Unsupported request</h4>
          <ul className="mt-2 space-y-3">
            {unsupported.map((feedback) => (
              <li key={feedback.label}>
                <p className="text-xs font-semibold">{feedback.label}</p>
                <p className="mt-0.5 text-xs text-red-800 dark:text-red-200">{feedback.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">Suggestions</h4>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-red-800 dark:text-red-200">
          {deduplicate([...missing, ...unsupported].map((feedback) => feedback.suggestion)).map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
          <li>Click Regenerate to let the AI try again.</li>
        </ul>
      </div>

      <details className="mt-4 rounded-md border border-red-200/80 bg-white/40 px-3 py-2 text-xs dark:border-red-900/60 dark:bg-black/10">
        <summary className="cursor-pointer font-semibold text-red-900 outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-100">
          Improve my prompt
        </summary>
        <div className="mt-3 space-y-2 text-red-800 dark:text-red-200">
          <p className="font-medium">Instead of:</p>
          <p>Fetch customer data.</p>
          <p className="font-medium">Try:</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Start</li>
            {promptSteps.map((step) => <li key={step}>{step}</li>)}
            <li>End</li>
          </ol>
        </div>
      </details>
    </section>
  );
}
