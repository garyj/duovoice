export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isFinal?: boolean;
}

export interface BlobData {
  data: string;
  mimeType: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: Date;
  messages: Message[];
}