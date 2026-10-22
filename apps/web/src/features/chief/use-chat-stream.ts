import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { probeAuth } from "@/lib/auth";
import { chatStreamReducer, initialChatStream } from "@/lib/chat";
import { chatQuery, keys } from "@/lib/queries";
import type { ChatStreamMessage } from "@/lib/types";

/**
 * Follows one conversation over `/api/stream?chat=<id>`: whether the Chief is answering, and the
 * run events of the turn in progress. When a turn finishes, the stored reply is refetched before
 * the live events are dropped, so the screen never flashes empty. Mount with `key={chatId}`.
 */
export function useChatStream(chatId: string) {
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(chatStreamReducer(chatId), initialChatStream);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(`/api/stream?chat=${encodeURIComponent(chatId)}`);
    source.onopen = () => {
      setConnected(true);
      // Anything that happened before the stream opened is in the stored chat.
      void qc.invalidateQueries({ queryKey: keys.chat(chatId) });
    };
    source.onerror = () => {
      setConnected(false);
      if (source.readyState === EventSource.CLOSED) void probeAuth();
    };
    source.addEventListener("chat", (e) => {
      let msg: ChatStreamMessage;
      try {
        msg = JSON.parse((e as MessageEvent<string>).data) as ChatStreamMessage;
      } catch {
        return;
      }
      dispatch(msg);
      if (msg.kind === "started") void qc.invalidateQueries({ queryKey: keys.chat(chatId) });
      if (msg.kind === "finished") {
        void Promise.all([
          qc.refetchQueries({ queryKey: chatQuery(chatId).queryKey }),
          qc.invalidateQueries({ queryKey: keys.chats }),
          // The Chief may have written knowledge or created tickets this turn.
          qc.invalidateQueries({ queryKey: keys.knowledge }),
          qc.invalidateQueries({ queryKey: keys.tickets }),
        ]).then(() => dispatch({ chatId, kind: "settled" }));
      }
    });
    return () => source.close();
  }, [chatId, qc]);

  return { ...state, connected };
}
