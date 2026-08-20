import { registerPlugin } from '@capacitor/core';
import {
  parseDailyAnalysisRequest,
  parseGoalDecompositionRequest,
  parseSystemCandidateReviewRequest,
  parseTaskFeedbackRequest,
  parseWeeklyReviewRequest,
} from './analysis-contract.ts';
import { analyzeWithModel, hasImmediateDangerSignal, type AnalysisRequest, type ModelPayload } from './ai-engine.ts';

interface NativeAiConfiguration { configured: boolean; model: string }
interface NativeAiResponse { status: number; data: string }
interface MiniMaxResponse { input_sensitive?: boolean; choices?: Array<{ message?: { content?: string } }> }
interface NativeAiBridge {
  configuration(): Promise<NativeAiConfiguration>;
  request(options: { payload: ModelPayload }): Promise<NativeAiResponse>;
}

const nativeAi = registerPlugin<NativeAiBridge>('QiguangAi');

function aiError(message: string, code: string, retryable = false): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, retryable });
}

function parseRequest(value: AnalysisRequest): AnalysisRequest {
  return value.operation === 'daily_analysis' ? parseDailyAnalysisRequest(value)
    : value.operation === 'task_feedback' ? parseTaskFeedbackRequest(value)
      : value.operation === 'weekly_review' ? parseWeeklyReviewRequest(value)
        : value.operation === 'system_candidate_review' ? parseSystemCandidateReviewRequest(value)
          : parseGoalDecompositionRequest(value);
}

export async function nativeAiConfiguration(): Promise<NativeAiConfiguration> {
  try {
    const value = await nativeAi.configuration();
    return { configured: value.configured === true, model: value.model || 'MiniMax-M3' };
  } catch {
    return { configured: false, model: 'MiniMax-M3' };
  }
}

export async function analyzeDirectWithBridge(request: AnalysisRequest, bridge: Pick<NativeAiBridge, 'request'>, model = 'MiniMax-M3') {
  const parsed = parseRequest(request);
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 256 * 1024) throw aiError('请求超过 256KB。', 'INPUT_TOO_LARGE');
  if (hasImmediateDangerSignal(parsed)) throw aiError('当下安全最重要；请先查看本地求助资源或联系可信任的人。', 'SAFETY_REVIEW');
  return analyzeWithModel(parsed, async (payload) => {
    let response: NativeAiResponse;
    try {
      response = await bridge.request({ payload });
    } catch {
      throw aiError('MiniMax 中国区接口暂时无法连接。', 'SERVICE_UNAVAILABLE', true);
    }
    let raw: MiniMaxResponse | null = null;
    try { raw = JSON.parse(response.data) as MiniMaxResponse; } catch { /* handled below */ }
    if (response.status === 429) throw aiError('模型服务请求过快，请稍后再试。', 'RATE_LIMITED');
    if (response.status < 200 || response.status >= 300) throw aiError('模型服务暂时不可用。', 'SERVICE_UNAVAILABLE', response.status >= 500);
    if (raw?.input_sensitive === true) throw aiError('本次内容需要进入安全支持流程。', 'SAFETY_REVIEW');
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw aiError('模型没有返回可用内容。', 'INVALID_MODEL_OUTPUT');
    return content;
  }, model);
}

export function analyzeWithNativeAi(request: AnalysisRequest, model: string) {
  return analyzeDirectWithBridge(request, nativeAi, model);
}
