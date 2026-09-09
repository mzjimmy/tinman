export type LlmPurpose = 'map_architecture' | 'advise_part' | 'draft_goal' | 'verify_delivery'

export interface LlmCallInput {
  purpose: LlmPurpose
  input: unknown
}

export function llmCall(_purpose: LlmPurpose, _input: unknown): never {
  throw new Error("llm.call not connected — wire OpenAI-compatible endpoint or Ollama")
}
