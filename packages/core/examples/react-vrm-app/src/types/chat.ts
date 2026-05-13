export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** ユーザーが送信した画像（プレビュー用 data URL） */
  imageDataUrl?: string;
}
