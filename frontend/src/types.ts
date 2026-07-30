export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  created_at: string;
};

export type ConversationView = {
  conversation_id: string;
  peer: User;
  last_message?: string | null;
  last_message_type?: string | null;
  last_sender_id?: string | null;
  updated_at: string;
};

export type Message = {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  type: "text" | "image" | "video";
  text?: string | null;
  media_base64?: string | null;
  media_mime?: string | null;
  created_at: string;
};
