/** Models compatible with the existing DashScope duplex protocol and 16 kHz PCM. */
export const TRANSCRIPTION_MODELS = [
  { id: 'fun-asr-realtime', label: 'Fun-ASR（默认）' },
  { id: 'fun-asr-realtime-2026-02-28', label: 'Fun-ASR（2026-02-28 固定版本）' },
  { id: 'paraformer-realtime-v2', label: 'Paraformer v2' }
] as const

export const DEFAULT_TRANSCRIPTION_MODEL = 'fun-asr-realtime'

export function resolveTranscriptionModel(value: unknown): string {
  return TRANSCRIPTION_MODELS.some((model) => model.id === value)
    ? (value as string)
    : DEFAULT_TRANSCRIPTION_MODEL
}
