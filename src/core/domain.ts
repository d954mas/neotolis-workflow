export const PROVIDERS = ['claude', 'codex'] as const;
export const SESSION_ID_FORMAT = PROVIDERS
  .map((provider) => `${provider}:<native-id>`)
  .join(' or ');
export const LIFECYCLES = [
  'intake-active',
  'brief-ready',
  'plan-ready',
  'plan-approved',
  'work-active',
  'delivery-ready',
] as const;
export const PHASE_SKILLS = ['nttask', 'ntgrill', 'ntplan', 'ntwork'] as const;
export const PHASES = [...PHASE_SKILLS, 'delivery-ready'] as const;
export const FINAL_REVIEW_KEYS = [
  'nyquist',
  'spec_integration',
  'code_review',
] as const;
export type FinalReviewKey = (typeof FINAL_REVIEW_KEYS)[number];
